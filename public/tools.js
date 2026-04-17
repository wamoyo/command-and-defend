// Tool executor: maps LLM tool-call names to side-effecting scene actions,
// enforcing per-tool cooldowns and letting multi-call batches (e.g. "fire 3 times")
// play out as staggered volleys.

import {
  onCooldown, cooldownRemaining, markCooldown,
  flashCooldown, shouldLogCd, bumpMorale
} from './game.js'

// Per-batch repeat caps - generous on purpose so "fire 50 times" actually rains arrows.
// The cap exists only to stop a truly runaway LLM from scheduling thousands of timers.
var MAX_REPEATS = {
  fire_arrows:   60,
  cast_fireball: 4,
  rally_cry:     1,
  set_gate:      1,
  spawn_enemies: 6
}

// Side effect: dispatch each tool call. Multiple same-name calls in one batch are
// staggered (450ms apart); the CD is checked only on the FIRST occurrence and is
// extended to end AFTER the last scheduled action.
// calls: [{ name, arguments }]. Returns [{ name, ok, detail, cooldown? }] for the HUD.
export function executeToolCalls (calls, sceneApi) {
  var results = []
  var seen = {}    // per-tool count in this batch
  var delay = {}   // per-tool running stagger delay in ms

  for (let i = 0; i < calls.length; i++) {
    var call = calls[i]
    var args = call.arguments || {}
    var name = call.name

    var prior = seen[name] || 0
    seen[name] = prior + 1
    var isFirst = prior === 0

    // CD check only on the first occurrence of this tool in the batch.
    if (isFirst && onCooldown(name)) {
      flashCooldown(name)
      if (shouldLogCd(name)) {
        results.push({ name, ok: false, cooldown: true, detail: 'reloading (' + cooldownRemaining(name) + 's)' })
      }
      continue
    }

    // Per-batch repeat cap.
    var cap = MAX_REPEATS[name] || 1
    if (seen[name] > cap) {
      if (seen[name] === cap + 1) results.push({ name, ok: false, detail: 'capped at ' + cap })
      continue
    }

    delay[name] = delay[name] || 0
    var thisDelay = delay[name]

    try {
      if (name === 'set_gate') {
        var wantOpen = args.state === 'open'
        sceneApi.setGate(wantOpen)
        markCooldown('set_gate')
        results.push({ name, ok: true, detail: 'gate ' + (wantOpen ? 'opening' : 'closing') })

      } else if (name === 'fire_arrows') {
        var tgt = args.target || 'nearest'
        setTimeout( () => sceneApi.fireArrows(tgt), thisDelay )
        // Re-stamp cooldown when the LAST scheduled volley fires so CD starts from then.
        setTimeout( () => markCooldown('fire_arrows'), thisDelay + 1 )
        delay[name] += 450
        results.push({ name, ok: true, detail: seen[name] === 1 ? 'volley @ ' + tgt : 'volley #' + seen[name] })

      } else if (name === 'cast_fireball') {
        var ftgt = args.target || 'nearest'
        sceneApi.castFireball(ftgt)
        markCooldown('cast_fireball')
        results.push({ name, ok: true, detail: 'fireball @ ' + ftgt })

      } else if (name === 'rally_cry') {
        var msg = (args.message || '').slice(0, 120)
        bumpMorale(15)
        sceneApi.rallyPulse()
        markCooldown('rally_cry')
        results.push({ name, ok: true, detail: 'morale +15 ("' + msg + '")' })

      } else if (name === 'spawn_enemies') {
        var type = args.type || 'orc'
        var count = Math.max(1, Math.min(10, Number(args.count) || 3))
        var actually = sceneApi.spawnEnemies(type, count)
        markCooldown('spawn_enemies')
        results.push({ name, ok: true, detail: actually + ' ' + type + (actually === 1 ? '' : 's') })

      } else {
        results.push({ name, ok: false, detail: 'unknown tool' })
      }

    } catch (err) {
      results.push({ name, ok: false, detail: err && err.message || 'error' })
    }
  }

  return results
}
