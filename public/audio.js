// Audio capture + server round-trip.
// All functions are side-effecting (mic access, network).

var stream = null
var recorder = null
var chunks = []
var pressed = false

// Side effect: lazily acquire a MediaStream for the mic.
async function ensureStream () {
  if (stream) return
  stream = await navigator.mediaDevices.getUserMedia({ audio: true })
}

// Side effect: installs Space keydown/keyup to start/stop MediaRecorder.
// onUtterance: called with the recorded webm Blob on release.
// onStateChange: called with 'recording' | 'idle' | 'error' | 'processing'.
export function initPushToTalk (onUtterance, onStateChange) {
  window.addEventListener('keydown', async function (e) {
    if (e.code !== 'Space' || e.repeat || pressed) return
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
    e.preventDefault()
    pressed = true
    try {
      await ensureStream()
      chunks = []
      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      recorder.ondataavailable = function (ev) {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data)
      }
      recorder.start()
      if (onStateChange) onStateChange('recording')
    } catch (err) {
      pressed = false
      if (onStateChange) onStateChange('error', err && err.message || 'mic error')
    }
  })

  window.addEventListener('keyup', function (e) {
    if (e.code !== 'Space' || !pressed) return
    e.preventDefault()
    pressed = false
    if (!recorder || recorder.state !== 'recording') return
    recorder.onstop = function () {
      var blob = new Blob(chunks, { type: 'audio/webm' })
      if (blob.size > 200) onUtterance(blob)
      else if (onStateChange) onStateChange('idle')
    }
    try { recorder.stop() } catch (_) {}
  })
}

// Known Whisper hallucinations on silent / near-silent audio (lowercased, punctuation-stripped).
var WHISPER_JUNK = new Set([
  '', 'you', 'thank you', 'thanks', 'thanks for watching',
  'thank you for watching', '.', '...', 'uh', 'um', 'hmm',
  'bye', 'bye bye', 'okay', 'ok'
])

// Pure: normalize a transcript for junk-check (lowercase, strip punctuation & extra spaces).
function normalizeForJunk (s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

// Side effect: POST the audio blob to /transcribe, then the text to /command.
// Returns { text, tool_calls, reply, junk }.
export async function transcribeAndCommand (blob) {
  var fd = new FormData()
  fd.append('audio', blob, 'utterance.webm')
  var tr = await fetch('/transcribe', { method: 'POST', body: fd })
  if (!tr.ok) throw new Error('transcribe failed (' + tr.status + ')')
  var trJson = await tr.json()
  var text = (trJson.text || '').trim()
  if (!text) return { text: '', tool_calls: [], reply: '', junk: true }
  var norm = normalizeForJunk(text)
  if (WHISPER_JUNK.has(norm) || norm.length < 2) {
    return { text, tool_calls: [], reply: '', junk: true }
  }
  var cm = await fetch('/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text })
  })
  if (!cm.ok) throw new Error('command failed (' + cm.status + ')')
  var cmJson = await cm.json()
  return {
    text,
    tool_calls: cmJson.tool_calls || [],
    reply: cmJson.reply || '',
    junk: false
  }
}
