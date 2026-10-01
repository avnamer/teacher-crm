// Offscreen document (MV3's only place with getUserMedia/MediaRecorder access
// from an extension). Exists solely to record a WhatsApp voice message's real
// audio output via chrome.tabCapture — see background.js's captureVoicePlayback
// for why: every standard JS-observable audio API (Audio(), HTMLMediaElement,
// AudioContext incl. audioWorklet, WebCodecs, even a Worker) was confirmed
// live to never fire when WhatsApp Web plays a voice note, even though real
// sound demonstrably comes out of the speakers — so the only way left to
// capture it is to record the tab's actual audio output, which doesn't care
// which internal API produced it.

let mediaRecorder = null
let chunks = []
let recordedMimeType = ''
let analyser = null

async function startRecording(streamId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        // Confirmed via research (2026-09-29): Chrome applies mic-oriented
        // audio processing (echo cancellation, auto-gain, noise suppression)
        // to a tab-audio getUserMedia stream by default, and the modern
        // constraint names (echoCancellation: false etc.) don't reach it
        // under this legacy `mandatory` syntax — only these Google-prefixed
        // ones do. Recorded clips were coming back as unintelligible noise
        // (Whisper hallucinating plausible-sounding text in random languages
        // instead of erroring) even though the audio audibly played fine —
        // gain-pumping/suppression designed for a voice-shaped mic signal,
        // applied to a mostly-silent-then-a-burst-of-speech tab signal, is
        // the likely cause.
        googEchoCancellation: false,
        googAutoGainControl: false,
        googNoiseSuppression: false,
        googHighpassFilter: false,
      },
    },
    video: false,
  })

  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  // Route the captured stream back to the speakers — tabCapture otherwise
  // silences the tab for as long as the stream is held.
  source.connect(ctx.destination)

  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)

  chunks = []
  recordedMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  mediaRecorder = new MediaRecorder(stream, { mimeType: recordedMimeType })
  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  mediaRecorder.start()
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      return reject(new Error('לא נמצאה הקלטה פעילה'))
    }
    const recorder = mediaRecorder
    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: recordedMimeType })
        const audioBase64 = await blobToBase64(blob)
        resolve({ audioBase64, mimeType: recordedMimeType })
      } catch (err) {
        reject(err)
      }
    }
    recorder.stop()
    recorder.stream.getTracks().forEach(track => track.stop())
    mediaRecorder = null
    analyser = null
  })
}

// Confirmed live (2026-09-29): a fixed capture-duration guess produced mostly
// silence — WhatsApp Web has some unknown delay between the play click and
// real audio actually starting (decrypt/load time, presumably), and Whisper
// hallucinates plausible-sounding phrases in random languages when fed
// silence instead of erroring out. Voice-activity detection handles that
// unknown start delay: wait for real audio to begin before counting down.
//
// Confirmed live (2026-09-30): stopping at the first silence GAP (the
// original design) was wrong the other way — natural speech has pauses
// longer than a short silence threshold, so longer messages got cut off
// mid-sentence (a 26s message captured maybe its first several seconds).
// Worse, WhatsApp remembers each voice note's playback position, so the next
// attempt on the same message resumed from that cut-off point instead of the
// beginning, compounding the problem across retries. Fix: once speech
// starts, record for the message's OWN KNOWN duration (durationMs, read
// straight from the DOM's "0:26" label) instead of guessing from silence
// gaps — that's ground truth, not a heuristic. silenceMs is now just a
// last-resort escape if a message somehow finishes far short of its stated
// duration. maxMs is the outer safety cap regardless (so a stuck stream
// can't hang the sync).
//
// setInterval, NOT requestAnimationFrame — confirmed live (2026-09-29): an
// offscreen document is never actually painted, so rAF may never fire there
// at all, which hung an entire sync run on the first voice message (nothing
// to bound the wait, since every stop condition lived inside a callback that
// never ran). setInterval doesn't depend on rendering.
function waitForSpeechThenDuration({ durationMs, maxMs, silenceMs = 2500, threshold = 0.02, startTimeoutMs = 5000 }) {
  return new Promise(resolve => {
    const data = new Uint8Array(analyser.fftSize)
    const startedAt = Date.now()
    let speechStartedAt = null
    let lastLoudAt = null
    const intervalId = setInterval(() => {
      if (!analyser) return finish() // recording already stopped from elsewhere
      analyser.getByteTimeDomainData(data)
      let sumSq = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sumSq += v * v
      }
      const rms = Math.sqrt(sumSq / data.length)
      const now = Date.now()
      if (rms > threshold) {
        if (!speechStartedAt) speechStartedAt = now
        lastLoudAt = now
      }
      const elapsed = now - startedAt
      if (!speechStartedAt && elapsed > startTimeoutMs) return finish() // never heard anything — give up
      if (speechStartedAt && now - speechStartedAt > durationMs) return finish() // captured the message's full known length
      if (speechStartedAt && now - lastLoudAt > silenceMs) return finish() // finished far short of its stated duration — take what we got
      if (elapsed > maxMs) return finish()
    }, 100)
    function finish() {
      clearInterval(intervalId)
      resolve()
    }
  })
}

async function recordForDuration(durationMs, maxMs) {
  await waitForSpeechThenDuration({ durationMs, maxMs })
  return stopRecording()
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false
  if (message.action === 'startRecording') {
    startRecording(message.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (message.action === 'recordForDuration') {
    recordForDuration(message.durationMs, message.maxMs)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }))
    return true
  }
  return false
})
