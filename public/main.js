// Entry point: orchestrates world + audio + phases + tools. Runs the game loop.

import * as THREE from 'three'

import { initWorld, renderer, camera, scene, tickWorld } from './world.js'
import {
  tickBattle, startBattle, fireArrows, castFireball,
  spawnEnemies, spawnRallyPulse, clearBattle
} from './battle.js'
import { initHud, state, updateCooldownChips, updateHud, phase, setPhase } from './game.js'
import { initPushToTalk, transcribeAndCommand } from './audio.js'
import { executeToolCalls } from './tools.js'
import { initPep, showPepOverlay, hidePepOverlay, submitPepTalk } from './pep.js'
import { setGatePosition } from './world.js'

// ---------- init ----------

initWorld()
initHud()
initPep()
showPepOverlay()

// sceneApi - the side-effect surface for tool dispatch.
var sceneApi = {
  setGate:       function (open)         { setGatePosition(open) },
  fireArrows:    function (target)       { fireArrows(target) },
  castFireball:  function (target)       { castFireball(target) },
  rallyPulse:    function ()             { spawnRallyPulse() },
  spawnEnemies:  function (type, count)  { return spawnEnemies(type, count) }
}

// ---------- mic wiring ----------

var micEl = document.getElementById('mic')
var logEl = document.getElementById('log')

// Side effect: prepend a styled row to the overlay log.
function appendLog (html) {
  var row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = html
  logEl.prepend(row)
  while (logEl.childNodes.length > 8) logEl.removeChild(logEl.lastChild)
}

// Side effect: update the mic status pill based on state.
function setMicState (s, msg) {
  if (s === 'recording')       { micEl.classList.add('active'); micEl.textContent = '\u{1F534} LISTENING... (release SPACE)' }
  else if (s === 'processing') { micEl.classList.remove('active'); micEl.textContent = '\u23F3 thinking...' }
  else if (s === 'error')      { micEl.classList.remove('active'); micEl.textContent = '\u26A0\uFE0F mic error: ' + (msg || 'check permissions') }
  else                          { micEl.classList.remove('active'); micEl.textContent = '\u{1F3A4} HOLD SPACE to command your troops' }
}

// Pure: HTML-escape a short string.
function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  })
}

// Side effect: route utterance based on phase.
async function handleUtterance (blob) {
  if (phase() === 'PEP_TALK') {
    setMicState('processing')
    await submitPepTalk(blob)
    setMicState('idle')
    return
  }
  if (phase() === 'PEP_RESULT') return // ignore until battle starts
  if (phase() !== 'BATTLE') return      // WIN / LOSE: ignore
  setMicState('processing')
  try {
    var res = await transcribeAndCommand(blob)
    if (!res.text) {
      appendLog('<span class="err">(no speech - hold SPACE longer)</span>')
      return
    }
    appendLog('<span class="you">you:</span> "' + escapeHtml(res.text) + '"')
    if (res.junk) {
      appendLog('<span class="err">(unclear - try a specific order)</span>')
      return
    }
    var results = executeToolCalls(res.tool_calls, sceneApi)
    if (!results.length) {
      var reply = res.reply || 'I did not catch that, Commander.'
      appendLog('<span class="tool">commander: ' + escapeHtml(reply) + '</span>')
    }
    for (let i = 0; i < results.length; i++) {
      var r = results[i]
      var cls = r.cooldown ? 'cd' : (r.ok ? 'tool' : 'err')
      appendLog('<span class="' + cls + '">&rarr; ' + r.name + ': ' + escapeHtml(r.detail) + '</span>')
    }
  } catch (err) {
    appendLog('<span class="err">' + escapeHtml(err && err.message || 'error') + '</span>')
  } finally {
    setMicState('idle')
  }
}

initPushToTalk(handleUtterance, setMicState)
setMicState('idle')

// ---------- enter key to begin battle ----------

window.addEventListener('keydown', function (e) {
  if (e.code === 'Enter' && phase() === 'PEP_RESULT') {
    e.preventDefault()
    hidePepOverlay()
    clearBattle()
    startBattle()
  }
})

// ---------- game loop ----------

var clock = new THREE.Clock()

// Side effect: one frame - update world + battle, render.
function tick () {
  var dt = Math.min(clock.getDelta(), 0.05)
  tickWorld(dt)
  tickBattle(dt)
  updateCooldownChips()
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
tick()

// ---------- expose for console smoke tests ----------

window.sceneApi = sceneApi
window.state = state
window.startBattle = function () {
  hidePepOverlay()
  clearBattle()
  startBattle()
}
