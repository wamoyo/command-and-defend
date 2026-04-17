// Central game state, phase machine, morale / HP / cooldowns, and HUD DOM wiring.
// All functions here are side-effecting (mutate state or DOM).

// Single mutable object - imported by everyone.
export var state = {
  phase: 'PEP_TALK',    // PEP_TALK | PEP_RESULT | BATTLE | WIN | LOSE
  morale: 50,
  hp: 100,
  maxHp: 100,
  wave: 0,              // 0 before first wave, 1..N during, N+1 after
  totalWaves: 3,
  enemiesKilled: 0,
  moraleSamples: [],    // for scoring
  cooldowns: {
    set_gate:      { last: -1e9, cd: 1500 },
    fire_arrows:   { last: -1e9, cd: 1500 },
    cast_fireball: { last: -1e9, cd: 5000 },
    rally_cry:     { last: -1e9, cd: 20000 },
    spawn_enemies: { last: -1e9, cd: 500 }
  },
  cdLogLast: {}          // per-tool last "on-cd" log timestamp (debounce)
}

// DOM refs (filled in by initHud)
var el = {}

// Side effect: caches DOM references on startup.
export function initHud () {
  el.morale   = document.getElementById('morale-fill')
  el.moraleV  = document.getElementById('morale-value')
  el.wave     = document.getElementById('wave-value')
  el.hp       = document.getElementById('hp-fill')
  el.hpV      = document.getElementById('hp-value')
  el.banner   = document.getElementById('wave-banner')
  el.endS     = document.getElementById('end-screen')
  el.endT     = document.getElementById('end-title')
  el.endSub   = document.getElementById('end-sub')
  el.endScore = document.getElementById('end-score')
  el.chips    = document.getElementById('cooldown-chips')
  updateHud()
}

// Side effect: refresh morale / wave / HP text and bars.
export function updateHud () {
  if (!el.morale) return
  el.morale.style.height = state.morale + '%'
  el.moraleV.textContent = Math.round(state.morale)
  el.wave.textContent = state.wave === 0 ? '—' : (state.wave + ' / ' + state.totalWaves)
  var hpPct = Math.max(0, (state.hp / state.maxHp) * 100)
  el.hp.style.width = hpPct + '%'
  el.hpV.textContent = Math.max(0, Math.round(state.hp))
}

// Side effect: switch phase, persist morale sample.
export function setPhase (next) {
  state.phase = next
  state.moraleSamples.push(state.morale)
}

// Pure: get current phase.
export function phase () { return state.phase }

// Side effect: clamp and set morale.
export function setMorale (v) {
  state.morale = Math.max(0, Math.min(100, Math.round(v)))
  updateHud()
}

// Side effect: adjust morale by delta (clamped).
export function bumpMorale (delta) {
  setMorale(state.morale + delta)
}

// Side effect: apply damage to castle HP. Triggers LOSE when hp hits 0.
export function damage (amount) {
  if (state.phase === 'LOSE' || state.phase === 'WIN') return
  state.hp = Math.max(0, state.hp - amount)
  updateHud()
  if (state.hp <= 0) loseGame()
}

// Pure: true if tool is currently on cooldown.
export function onCooldown (toolName) {
  var cd = state.cooldowns[toolName]
  if (!cd) return false
  return (performance.now() - cd.last) < cd.cd
}

// Pure: remaining cooldown seconds (string, 1 decimal).
export function cooldownRemaining (toolName) {
  var cd = state.cooldowns[toolName]
  if (!cd) return '0.0'
  var left = Math.max(0, cd.cd - (performance.now() - cd.last))
  return (Math.ceil(left / 100) / 10).toFixed(1)
}

// Side effect: stamp cooldown start (after a successful tool dispatch).
export function markCooldown (toolName) {
  var cd = state.cooldowns[toolName]
  if (cd) cd.last = performance.now()
}

// Pure: debounce check for on-cooldown log spam. Returns true if we should log.
export function shouldLogCd (toolName) {
  var now = performance.now()
  var last = state.cdLogLast[toolName] || 0
  if (now - last < 500) return false
  state.cdLogLast[toolName] = now
  return true
}

// Side effect: briefly pulse the HUD chip for a tool (CSS class + timeout).
export function flashCooldown (toolName) {
  if (!el.chips) return
  var chip = el.chips.querySelector('[data-tool="' + toolName + '"]')
  if (!chip) return
  chip.classList.add('denied')
  setTimeout(function () { chip.classList.remove('denied') }, 220)
}

// Side effect: per-frame cooldown chip fills update.
export function updateCooldownChips () {
  if (!el.chips) return
  var chips = el.chips.children
  for (let i = 0; i < chips.length; i++) {
    var chip = chips[i]
    var name = chip.dataset.tool
    var cd = state.cooldowns[name]
    if (!cd) continue
    var elapsed = performance.now() - cd.last
    var pct = Math.max(0, Math.min(1, 1 - elapsed / cd.cd))
    var fill = chip.querySelector('.fill')
    var secs = chip.querySelector('.secs')
    if (fill) fill.style.transform = 'scaleX(' + pct + ')'
    if (pct > 0.01) {
      chip.classList.add('cooling')
      if (secs) secs.textContent = ((cd.cd - elapsed) / 1000).toFixed(1) + 's'
    } else {
      chip.classList.remove('cooling')
      if (secs) secs.textContent = 'ready'
    }
  }
}

// Side effect: show a center-screen banner for `ms` then hide.
export function showWaveBanner (html, ms) {
  if (!el.banner) return
  el.banner.innerHTML = html
  el.banner.hidden = false
  clearTimeout(el.banner._t)
  el.banner._t = setTimeout(function () { el.banner.hidden = true }, ms || 2500)
}

// Side effect: show WIN screen with a score line.
export function winGame () {
  if (state.phase === 'WIN' || state.phase === 'LOSE') return
  setPhase('WIN')
  var moraleAvg = state.moraleSamples.reduce( (a,b) => a+b, 0 ) / Math.max(1, state.moraleSamples.length)
  var score = Math.round(moraleAvg + state.hp + state.totalWaves * 25)
  el.endT.textContent = 'The horde breaks! The realm is saved.'
  el.endSub.textContent = 'Morale avg ' + Math.round(moraleAvg) + ' - HP remaining ' + state.hp
  el.endScore.textContent = 'SCORE ' + score
  el.endS.hidden = false
}

// Side effect: show LOSE screen.
export function loseGame () {
  if (state.phase === 'LOSE' || state.phase === 'WIN') return
  setPhase('LOSE')
  el.endT.textContent = 'The castle has fallen...'
  el.endSub.textContent = 'You fell on wave ' + state.wave + ', morale ' + Math.round(state.morale) + '.'
  el.endScore.textContent = 'Refresh to try again.'
  el.endS.hidden = false
}
