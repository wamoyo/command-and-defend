// Voice Tower Defense - Deno backend for Deno Deploy.
// Serves ./public and proxies /transcribe, /command, /pep-talk to the Groq API.
// Reads CAD-GROQ-KEY from env (with GROQ_KEY / GREEK_GROQ_KEY fallbacks for local dev).

import { serveDir } from '@std/http/file-server'

var apiKey =
  Deno.env.get('CAD-GROQ-KEY') ||
  Deno.env.get('GROQ_KEY') ||
  Deno.env.get('GREEK_GROQ_KEY')

if (!apiKey) {
  console.error('Missing API key. Set CAD-GROQ-KEY (or GROQ_KEY) in env, or in .env for local dev.')
  Deno.exit(1)
}

var GROQ_BASE = 'https://api.groq.com/openai/v1'

// Pure: the OpenAI-compatible tool schema advertised for battle commands.
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
        description: "Archers loose arrows. Trigger on: 'fire', 'loose', 'shoot arrows', 'volley', 'let fly', 'arrows'. DO NOT use for 'fireball' or magic - that is cast_fireball. Optional target filter selects which enemies to aim at. May be called multiple times in one response (e.g. 'fire 3 times' -> 3 parallel calls).",
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
        description: "A brief passionate mid-battle shout that boosts troop morale. Trigger ONLY on short inspirational utterances ('For the king!', 'Stand fast!', 'Hold the line!', 'Victory or death!'). Do NOT use for calm speech, logistics, or commands.",
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

// Pure: system prompt for battle command parsing.
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

// Pure: system prompt for the pep-talk JSON grader. The word JSON is required by Groq.
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

// Pure: safely parse a JSON string, null on failure.
function safeJsonParse (s) {
  try { return s ? JSON.parse(s) : null } catch (_) { return null }
}

// Pure: parse tool-call arguments, returning {} if malformed.
function safeToolArgs (s) {
  var v = safeJsonParse(s)
  return v && typeof v === 'object' ? v : {}
}

// Pure: small JSON response helper.
function json (body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json' }
  })
}

// Side effect: POST /transcribe - forward multipart audio to Groq Whisper.
async function handleTranscribe (request) {
  try {
    var form = await request.formData()
    var audio = form.get('audio')
    if (!audio) return json({ error: 'no audio field' }, 400)
    var out = new FormData()
    out.append('file', audio, 'utterance.webm')
    out.append('model', 'whisper-large-v3-turbo')
    out.append('language', 'en')
    out.append('response_format', 'json')
    var res = await fetch(GROQ_BASE + '/audio/transcriptions', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + apiKey },
      body: out
    })
    if (!res.ok) throw new Error('groq transcribe ' + res.status)
    var body = await res.json()
    return json({ text: (body.text || '').trim() })
  } catch (err) {
    console.error('[transcribe]', String(err && err.message || err).slice(0, 200))
    return json({ error: 'transcription failed' }, 500)
  }
}

// Side effect: POST /command - text -> Groq chat with tool calling.
async function handleCommand (request) {
  try {
    var body = await request.json()
    var text = (body && body.text || '').trim()
    if (!text) return json({ error: 'missing text' }, 400)
    var res = await fetch(GROQ_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
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
    })
    var data = await res.json()
    var msg = data.choices && data.choices[0] && data.choices[0].message
    var rawCalls = (msg && msg.tool_calls) || []
    var toolCalls = rawCalls.map( c => ({ name: c.function.name, arguments: safeToolArgs(c.function.arguments) }) )
    var reply = (msg && msg.content || '').trim()
    return json({ text, tool_calls: toolCalls, reply })
  } catch (err) {
    console.error('[command]', String(err && err.message || err).slice(0, 200))
    return json({ error: 'command parsing failed' }, 500)
  }
}

// Side effect: POST /pep-talk - text -> morale JSON via Groq chat (JSON mode).
async function handlePepTalk (request) {
  try {
    var body = await request.json()
    var text = (body && body.text || '').trim().slice(0, 3000)
    if (!text) return json({ error: 'missing text' }, 400)
    var res = await fetch(GROQ_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: pepTalkSystem() },
          { role: 'user', content: 'Here is the lord\'s speech to his troops:\n\n"' + text + '"\n\nReturn your grading JSON.' }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5
      })
    })
    var data = await res.json()
    var msg = data.choices && data.choices[0] && data.choices[0].message
    var parsed = safeJsonParse(msg && msg.content)
    if (!parsed || typeof parsed.morale !== 'number') {
      return json({ morale: 50, troop_response: 'The troops await your word.', critique: '' })
    }
    var morale = Math.max(0, Math.min(100, Math.round(parsed.morale)))
    var troop = String(parsed.troop_response || 'The troops await your word.').slice(0, 300)
    var crit = String(parsed.critique || '').slice(0, 300)
    return json({ morale, troop_response: troop, critique: crit })
  } catch (err) {
    console.error('[pep-talk]', String(err && err.message || err).slice(0, 200))
    return json({ morale: 50, troop_response: 'The troops await your word.', critique: '' })
  }
}

// Side effect: route a request to the right handler (or static serveDir).
async function handler (request) {
  var url = new URL(request.url)
  if (request.method === 'POST' && url.pathname === '/transcribe') return handleTranscribe(request)
  if (request.method === 'POST' && url.pathname === '/command')    return handleCommand(request)
  if (request.method === 'POST' && url.pathname === '/pep-talk')   return handlePepTalk(request)
  return serveDir(request, { fsRoot: 'public', quiet: true })
}

// Deno.serve - on Deno Deploy the port option is ignored and the platform assigns one.
Deno.serve({ port: 3000 }, handler)
console.log('voice-tower-defense listening on http://localhost:3000')
