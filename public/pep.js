// Pep-talk overlay lifecycle + submission to /pep-talk.

import { state, setPhase, setMorale, updateHud } from './game.js'

var el = {}

// Side effect: cache DOM references for the pep overlay.
export function initPep () {
  el.root    = document.getElementById('pep-overlay')
  el.hint    = document.getElementById('pep-hint')
  el.loading = document.getElementById('pep-loading')
  el.result  = document.getElementById('pep-result')
  el.fill    = document.getElementById('pep-morale-fill')
  el.num     = document.getElementById('pep-morale-num')
  el.resp    = document.getElementById('pep-response')
  el.crit    = document.getElementById('pep-critique')
  el.begin   = document.getElementById('pep-begin')
}

// Side effect: show overlay + reset to hint state.
export function showPepOverlay () {
  if (!el.root) return
  el.root.hidden = false
  el.hint.hidden = false
  el.loading.hidden = true
  el.result.hidden = true
}

// Side effect: hide overlay.
export function hidePepOverlay () {
  if (el.root) el.root.hidden = true
}

// Side effect: switch to "grading..." loader.
function showLoader () {
  el.hint.hidden = true
  el.loading.hidden = false
  el.result.hidden = true
}

// Side effect: animate morale fill from 0 to `morale` over ~900ms.
function animateMorale (morale) {
  var start = performance.now()
  var dur = 900
  function step () {
    var t = Math.min(1, (performance.now() - start) / dur)
    // ease-out
    var k = 1 - Math.pow(1 - t, 2)
    var v = morale * k
    el.fill.style.height = v + '%'
    el.num.textContent = Math.round(v)
    if (t < 1) requestAnimationFrame(step)
  }
  step()
}

// Side effect: display the grade + troop response.
function showResult (morale, troopResponse, critique) {
  el.hint.hidden = true
  el.loading.hidden = true
  el.result.hidden = false
  el.resp.textContent = troopResponse || 'The troops await your orders.'
  el.crit.textContent = critique || ''
  animateMorale(morale)
}

// Side effect: upload audio to /transcribe then text to /pep-talk; update state & overlay.
// blob: webm audio. Sets phase to PEP_RESULT. On Enter, caller begins battle.
export async function submitPepTalk (blob) {
  showLoader()
  try {
    var fd = new FormData()
    fd.append('audio', blob, 'pep.webm')
    var tr = await fetch('/transcribe', { method: 'POST', body: fd })
    if (!tr.ok) throw new Error('transcription failed (' + tr.status + ')')
    var trJson = await tr.json()
    var text = (trJson.text || '').trim()
    if (!text) {
      // nothing heard - return to hint
      showPepOverlay()
      return
    }
    var res = await fetch('/pep-talk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    })
    if (!res.ok) throw new Error('pep eval failed (' + res.status + ')')
    var data = await res.json()
    var morale = Math.max(0, Math.min(100, Number(data.morale) || 50))
    setMorale(morale)
    setPhase('PEP_RESULT')
    showResult(morale, data.troop_response, data.critique)
  } catch (err) {
    // graceful fallback
    setMorale(50)
    setPhase('PEP_RESULT')
    showResult(50, 'The troops await your word.', '(' + (err.message || 'grader unavailable') + ')')
  }
}
