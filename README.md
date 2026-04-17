# Command & Defend

> Medieval castle defense — shout at your troops.

A browser tower-defense where every order is spoken. Rally your men with a
pep talk, then hold `SPACE` mid-battle to fire volleys, cast fireballs,
open gates, and roar `"For the king!"` at the horde.

---

## How to play

### Before the battle — the pep talk
A full-screen overlay asks you to address your troops. Hold `SPACE`, give
a speech, release. An LLM grades it 0–100 and your **morale** score
affects archer accuracy for the whole battle. Empty mumbling scores ≤20;
a Henry-V-style banger scores 80+.

Press `ENTER` to begin the battle.

### During the battle — voice commands
Hold `SPACE`, speak, release. The transcript is parsed into tool calls
and executed against the Three.js scene. Medieval English welcomed.

| Try saying… | What happens |
|---|---|
| `"fire"` / `"loose"` / `"volley"` | Archers loose one volley |
| `"fire arrows 50 times"` | 50 staggered volleys (seriously) |
| `"fire at the trolls"` | Archers target trolls only |
| `"fireball on the dragon"` | Wizard casts an AoE fireball |
| `"open the gate"` / `"raise the portcullis"` | Gate slides up |
| `"close the gate"` / `"seal it"` | Gate slides down |
| `"For the king!"` / `"Stand fast!"` | Rally cry: +15 morale |
| `"spawn three trolls"` / `"summon a dragon"` | Sandbox spawns |

Survive three waves of orcs, trolls, and a dragon without losing your
castle HP.

---

## Tech stack

- **Speech-to-text:** Groq `whisper-large-v3-turbo`.
- **Intent parsing:** Groq `llama-3.3-70b-versatile` with OpenAI-compatible
  tool calling. `response_format: "json_object"` for the pep-talk grader.
- **Rendering:** Three.js (r160) via CDN import map. No bundler, no build step.
- **Server:** Deno 2.x with `Deno.serve` + `@std/http/file-server`. Two
  small endpoints that proxy to Groq plus static file serving.

---

## Architecture

```
  HOLD SPACE
        │
        ▼
  MediaRecorder (webm/opus)
        │   POST /transcribe
        ▼
  Groq Whisper  ─►  text
        │   POST /command  (battle)   │   POST /pep-talk  (pre-battle)
        ▼                              ▼
  Groq llama-3.3 + tool schema        Groq llama-3.3 + JSON mode
        │                              │
        ▼                              ▼
  [{name, args}, ...]           { morale, troop_response, critique }
        │                              │
        ▼                              ▼
   tools.js  ──►  sceneApi       morale drives archer aim jitter
                    │
                    ▼
                Three.js scene
```

Five tools advertised to the LLM:

- `set_gate(state)` — open / close
- `fire_arrows(target?)` — archers, optional filter: nearest / trolls / dragons
- `cast_fireball(target?)` — wizard, AoE
- `rally_cry(message)` — +15 morale
- `spawn_enemies(type?, count?)` — sandbox

Each tool has a per-batch repeat cap, a cooldown, and a HUD chip. Multi-calls
in one utterance (e.g. `"fire 50 times"`) are staggered 450 ms apart and
the cooldown is pushed out so it starts after the last scheduled action —
not the first.

The LLM is **not** told about cooldowns (it would second-guess itself). The
client-side executor silently drops on-cooldown calls and flashes the HUD chip.

---

## Run locally

You need a [Groq API key](https://console.groq.com/keys).

```sh
git clone git@github.com:wamoyo/command-and-defend.git
cd command-and-defend
echo "GROQ_KEY=gsk_...your_key..." > .env
deno task dev
```

Then open <http://localhost:3000> and grant mic permission on the first
`SPACE` press.

### Node.js fallback
There's a `server.js` (Express + `groq-sdk`) if you prefer Node for local
hacking: `npm install && npm start`.

---

## File layout

```
main.js               Deno server: /transcribe, /command, /pep-talk + static
deno.json             Deno tasks and imports
server.js             Optional Node/Express equivalent for local dev
public/
  index.html          canvas + HUD overlay + import map for three.js
  main.js             entry - wires audio, phases, tools, runs the rAF loop
  world.js            scene + unit factories (archer, wizard, orc, troll, dragon)
  battle.js           arrows, fireballs, hit detection, wave spawner
  game.js             state machine, morale, HP, cooldowns, HUD DOM
  pep.js              pep-talk overlay + submission
  tools.js            tool executor with cooldown enforcement and multi-call stagger
  audio.js            push-to-talk mic capture
  style.css           HUD, overlays, animations
```

---

## License

MIT — do what thou wilt.
