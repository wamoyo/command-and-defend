// Voice Tower Defense - backend proxy.
// Side effect only: serves ./public as static, exposes /transcribe, /command, /pep-talk.
// Reads GROQ_KEY (or GREEK_GROQ_KEY fallback) from env. Never logs the key.

import express from 'express'
import multer from 'multer'
import Groq from 'groq-sdk'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, readFileSync } from 'fs'

var here = dirname(fileURLToPath(import.meta.url))

// Side effect: loads KEY=VALUE lines from ./.env into process.env if the file exists.
function loadDotEnv () {
  var p = join(here, '.env')
  if (!existsSync(p)) return
  var raw = readFileSync(p, 'utf8')
  raw.split(/\r?\n/).forEach( line => {
    var m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) return
    var k = m[1]
    var v = m[2].replace(/^['"]|['"]$/g, '')
    if (!process.env[k]) process.env[k] = v
  })
}
loadDotEnv()

var apiKey = process.env.GROQ_KEY || process.env.GREEK_GROQ_KEY
if (!apiKey) {
  console.error('Missing API key. Set GROQ_KEY (or GREEK_GROQ_KEY) in env, or copy .env.example to .env.')
  process.exit(1)
}

var groq = new Groq({ apiKey })
var app = express()
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
})

app.use(express.json({ limit: '1mb' }))
app.use(express.static(join(here, 'public')))

// Pure: the OpenAI-compatible tool schema advertised to the LLM for battle commands.
function commandTools () {
  return [
    {
      type: 'function',
      function: {
        name: 'set_gate',
        description: "Open or close the castle gate. Trigger on: 'open the gate', 'raise the portcullis', 'close the gate', 'seal the gate', 'drop the portcullis'. Do NOT use for spells or arrows.",
        parameters: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: ['open', 'closed'], description: 'Desired gate state' }
          },
          required: ['state']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'fire_arrows',
        description: "Archers loose arrows. Trigger on: 'fire', 'loose', 'shoot arrows', 'volley', 'let fly', 'arrows'. DO NOT use for 'fireball' or magic - that is cast_fireball. Optional target filter selects which enemies to aim at.",
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', enum: ['nearest', 'trolls', 'dragons'], description: 'Which enemies to target (defaults to nearest).' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'cast_fireball',
        description: "Wizard casts a fireball with AoE splash damage. Trigger on: 'fireball', 'burn them', 'cast fire', 'magic missile', 'blast them', 'incinerate'. Heavy cooldown - use on clusters or tough enemies. Optional target filter.",
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', enum: ['nearest', 'trolls', 'dragons'], description: 'Which enemies to target (defaults to nearest cluster).' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'rally_cry',
        description: "A brief passionate mid-battle shout that boosts troop morale. Trigger ONLY on short inspirational utterances ('For the king!', 'Stand fast!', 'Hold the line!', 'Victory or death!'). Do NOT use for calm speech, logistics, or commands - those go to other tools.",
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The exact rallying words the commander shouted.' }
          },
          required: ['message']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'spawn_enemies',
        description: "Summon extra enemies onto the battlefield (for demos / sandbox). Trigger on: 'spawn orcs', 'send a wave', 'bring the trolls', 'summon a dragon', 'here they come'.",
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['orc', 'troll', 'dragon'], description: 'Enemy type (defaults to orc).' },
            count: { type: 'integer', minimum: 1, maximum: 10, description: 'How many (defaults to 3).' }
          },
          required: []
        }
      }
    }
  ]
}

// Pure: system prompt for the battle command LLM.
function commandSystem () {
  return [
    'You are the battle-AI of a medieval castle defense game. The commander speaks in medieval English.',
    'You translate spoken orders into game actions by invoking the correct tool(s).',
    '',
    'Call a tool ONLY when the order clearly maps to one of the available actions.',
    'If the commander issues several orders in one breath, call multiple tools in parallel.',
    'If the transcript is empty, noise, a filler ("uh", "you", "hello", "."), or does not clearly',
    'match any action, DO NOT guess. Reply with a short in-character line asking them to repeat.',
    '',
    'DISAMBIGUATION:',
    '- "fire" / "loose" / "volley" / "shoot arrows" -> fire_arrows',
    '- "fireball" / "burn" / "blast" / "magic" -> cast_fireball (NEVER fire_arrows)',
    '- Short rallying shouts like "For the king!" -> rally_cry',
    '- Requests to add enemies for practice -> spawn_enemies'
  ].join('\n')
}

// Pure: system prompt for the pep-talk grader. Must contain the word JSON.
function pepTalkSystem () {
  return [
    "You are a grizzled battle-captain judging a lord's pre-battle speech to his troops on the dawn of a great siege.",
    'Score it harshly but fairly on ONE number, "morale" (integer 0-100):',
    '  0-20:   empty, incoherent, mumbled, single word, or silent',
    '  21-40:  weak, generic, uninspired, or off-topic',
    '  41-60:  adequate, some passion or specificity',
    '  61-80:  stirring, coherent, brave, specific, references the enemy or the stakes',
    '  81-100: legendary - would make men charge to their deaths smiling',
    '',
    'Return STRICT JSON, no prose outside:',
    '{',
    '  "morale": <int 0-100>,',
    '  "troop_response": "<one sentence in-character reaction from the troops>",',
    '  "critique": "<one short sentence of direct feedback to the lord>"',
    '}'
  ].join('\n')
}

// Pure: safely parse a JSON string, returning null on failure.
function safeJsonParse (s) {
  try { return s ? JSON.parse(s) : null } catch (_) { return null }
}

// Pure: same as safeJsonParse but returns {} on failure (for tool args).
function safeToolArgs (s) {
  var v = safeJsonParse(s)
  return v && typeof v === 'object' ? v : {}
}

// Side effect: POST /transcribe - accepts multipart 'audio' blob, returns { text }.
app.post('/transcribe', upload.single('audio'), async function (req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file (expected multipart field "audio")' })
    var mime = req.file.mimetype || 'audio/webm'
    var blob = new Blob([req.file.buffer], { type: mime })
    var file = new File([blob], 'utterance.webm', { type: mime })
    var result = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      language: 'en',
      response_format: 'json'
    })
    res.json({ text: (result.text || '').trim() })
  } catch (err) {
    console.error('[transcribe] error:', String(err && err.message || err).slice(0, 200))
    res.status(500).json({ error: 'transcription failed' })
  }
})

// Side effect: POST /command - text -> LLM with tool calling -> { tool_calls, reply }.
app.post('/command', async function (req, res) {
  try {
    var text = (req.body && req.body.text || '').trim()
    if (!text) return res.status(400).json({ error: 'missing text' })
    var completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: commandSystem() },
        { role: 'user', content: text }
      ],
      tools: commandTools(),
      tool_choice: 'auto',
      parallel_tool_calls: true,
      temperature: 0.3
    })
    var msg = completion.choices && completion.choices[0] && completion.choices[0].message
    var rawCalls = (msg && msg.tool_calls) || []
    var toolCalls = rawCalls.map( c => ({ name: c.function.name, arguments: safeToolArgs(c.function.arguments) }) )
    var reply = (msg && msg.content || '').trim()
    res.json({ text, tool_calls: toolCalls, reply })
  } catch (err) {
    console.error('[command] error:', String(err && err.message || err).slice(0, 200))
    res.status(500).json({ error: 'command parsing failed' })
  }
})

// Side effect: POST /pep-talk - text -> morale grade via JSON mode.
app.post('/pep-talk', async function (req, res) {
  try {
    var text = (req.body && req.body.text || '').trim().slice(0, 3000)
    if (!text) return res.status(400).json({ error: 'missing text' })
    var completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: pepTalkSystem() },
        { role: 'user', content: 'Here is the lord\'s speech to his troops:\n\n"' + text + '"\n\nReturn your grading JSON.' }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5
    })
    var msg = completion.choices && completion.choices[0] && completion.choices[0].message
    var parsed = safeJsonParse(msg && msg.content)
    if (!parsed || typeof parsed.morale !== 'number') {
      // graceful fallback - don't retry
      return res.json({ morale: 50, troop_response: 'The troops await your word.', critique: '' })
    }
    var morale = Math.max(0, Math.min(100, Math.round(parsed.morale)))
    var troop = String(parsed.troop_response || 'The troops await your word.').slice(0, 300)
    var crit = String(parsed.critique || '').slice(0, 300)
    res.json({ morale, troop_response: troop, critique: crit })
  } catch (err) {
    console.error('[pep-talk] error:', String(err && err.message || err).slice(0, 200))
    res.json({ morale: 50, troop_response: 'The troops await your word.', critique: '' })
  }
})

// Side effect: start the HTTP server.
var port = Number(process.env.PORT) || 3000
app.listen(port, function () {
  console.log('voice-tower-defense listening on http://localhost:' + port)
})
