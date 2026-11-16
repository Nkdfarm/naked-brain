//! Naked Brain - the Capture script (Notion notes): plain global scope, shared by all js/capture/* files -- recording, Groq transcription and AI summaries. Edit here, then run: python build.py
// ─── RECORDING ───────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks = [];
let timerInterval = null;
let recordingSeconds = 0;
let recordedBlob = null;
// Per-recording stop state. `stopHandled` gates handleRecordingStop so the iOS
// fallback below and a real (possibly late) onstop can't both transcribe; it is
// reset for every recording, unlike recordedBlob, which persists until the note
// is submitted and so could not be used as the guard.
let stopHandled = false;
let stopFallbackTimer = null;

const recordBtn  = document.getElementById('recordBtn');
const micIcon    = document.getElementById('micIcon');
const stopIcon   = document.getElementById('stopIcon');
const recTimer   = document.getElementById('recTimer');
const recStatus  = document.getElementById('recStatus');

function formatTime(s) {
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}

// One start at a time: a second tap while the phone was still opening the microphone started a second recorder —
// the first was never stopped (the microphone stayed open until the app was closed) and the timer ran double.
// The guard is a time (ten seconds), not a switch: a phone whose microphone never answers must not lock the button.
let recStartAt = 0;
recordBtn.addEventListener('click', async () => {
  if (Math.abs(Date.now() - recStartAt) < 10000) return;
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    recStartAt = Date.now();
    try { await startRecording(); } finally { recStartAt = 0; }
  }
});

async function startRecording() {
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    // Reset per-recording state, or the fallback in stopRecording() stays armed
    // against the previous take and silently does nothing from take 2 onward.
    recordedBlob = null;
    stopHandled = false;
    clearTimeout(stopFallbackTimer);
    // Use explicit MIME type so iOS records a complete, well-formed container
    const mime = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
                : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = handleRecordingStop;
    mediaRecorder.start();

    recordBtn.classList.add('recording');
    micIcon.style.display = 'none';
    stopIcon.style.display = '';
    recordBtn.setAttribute('aria-pressed', 'true');
    recStatus.textContent = 'Recording… tap to stop';
    recTimer.classList.add('visible');
    recordingSeconds = 0;
    recTimer.textContent = formatTime(0);
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      recordingSeconds++;
      recTimer.textContent = formatTime(recordingSeconds);
    }, 1000);
  } catch(e) {
    console.warn('Recording did not start:', e);
    // the microphone that was opened is closed again when the recorder did not start on it (it stayed open)
    try {
      if (stream && !(mediaRecorder && mediaRecorder.stream === stream && mediaRecorder.state === 'recording')) stream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    // only a refusal is a refusal: every failure used to read "Microphone access denied"
    const refused = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'PermissionDeniedError');
    showToast(refused ? 'The microphone is not allowed — allow it in the phone settings' : 'Recording did not start — try again', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder) {
    mediaRecorder.stop();
    // Do NOT stop tracks here — on iOS, stopping the stream before onstop fires
    // interrupts encoding and ondataavailable/onstop never arrive.
    // Tracks are stopped inside handleRecordingStop after the data chunk arrives.

    // iOS safety net: if onstop never fires within 8 s, trigger it manually.
    const mr = mediaRecorder;
    clearTimeout(stopFallbackTimer);
    stopFallbackTimer = setTimeout(() => {
      if (stopHandled) return;               // onstop already ran — nothing to do
      if (audioChunks.length > 0) {
        mr.stream?.getTracks().forEach(t => t.stop());
        handleRecordingStop();
      } else {
        // Nothing was captured — bail out gracefully
        stopHandled = true;
        mr.stream?.getTracks().forEach(t => t.stop());
        recStatus.textContent = 'Tap to record voice note';
        showToast('Recording failed — try again', 'error');
      }
    }, 8000);
  }
  clearInterval(timerInterval);
  recordBtn.classList.remove('recording');
  micIcon.style.display = '';
  stopIcon.style.display = 'none';
  recordBtn.setAttribute('aria-pressed', 'false');
  recTimer.classList.remove('visible');
  recStatus.textContent = 'Transcribing…';
}

async function handleRecordingStop() {
  // Runs once per recording — whether it arrives via onstop or the iOS fallback.
  // Without this guard a late onstop after the 8 s fallback would transcribe twice.
  if (stopHandled) return;
  stopHandled = true;
  clearTimeout(stopFallbackTimer);

  // Stop the mic stream only now — data has arrived
  mediaRecorder?.stream?.getTracks().forEach(t => t.stop());
  const mimeType = mediaRecorder?.mimeType || 'audio/webm';
  recordedBlob = new Blob(audioChunks, { type: mimeType });
  recStatus.textContent = 'Tap to record voice note';
  updateSubmitBtn();

  await transcribeAudio(recordedBlob);
}

// ─── API ERROR REPORTING ─────────────────────────────────────
// The AI handlers used to answer every failure with "check Groq key" and throw
// the real error away, so a rate limit, an expired app password, a too-large
// file and a dead connection were indistinguishable from the toast — which is
// exactly the guesswork this app gets debugged with. These turn a failure into
// something short and true; the original always goes to the console.

// Failed response → a short reason. Groq/Notion send {"error":{"message":…}}.
async function apiErrorMessage(res) {
  let detail = '';
  try {
    const body = await res.text();
    try { detail = JSON.parse(body)?.error?.message || ''; }
    catch(_) { detail = body.trim(); }
  } catch(_) {}

  // 429 is the one worth naming outright: the workspace is on Groq's free tier,
  // so a daily/rate cap is a routine failure that looks nothing like a bad key.
  // Groq's own text here is long and full of org ids — that goes to the console.
  if (res.status === 429) return 'Groq rate limit reached — wait and retry';
  const base = detail || `HTTP ${res.status}`;
  return base.length > 110 ? base.slice(0, 107) + '…' : base;
}

// Thrown value → a short reason. Covers the cases a bare e.message describes badly.
function failureReason(e) {
  if (e?.name === 'AbortError') return 'timed out — connection too slow';
  // fetch() rejects with a TypeError when the request never reached the server:
  // offline, DNS failure, or a network blocking the proxy domain.
  if (e instanceof TypeError) return 'cannot reach the server — check your connection';
  const msg = e?.message || 'unknown error';
  return msg.length > 110 ? msg.slice(0, 107) + '…' : msg;
}

// ─── TRANSCRIPTION (GROQ WHISPER) ────────────────────────────
// 0.11.92: a transcript is added to what the box holds (typing during it, or an earlier recording, used to be
// replaced), a slower earlier request cannot land last over a newer one, and a recording that could not be
// transcribed (offline in the field) stays on the note as an attachment — tap it to try again; it goes with the note.
let transcribeSeq = 0;
const appendText = (id, text) => {
  const box = document.getElementById(id), t = String(text || '').trim();
  if (!t) return;
  box.value = box.value.trim() ? box.value.trim() + '\n\n' + t : t;
};
async function transcribeAudio(blob, fromAttachment = null) {
  const my = ++transcribeSeq;
  const bar = document.getElementById('transcribingBar');
  bar.style.display = 'flex';
  try {
    const t = blob.type || '';
    const ext = (t.includes('mp4') || t.includes('aac') || t.includes('mpeg') || t.includes('m4a')) ? 'm4a' : 'webm';
    const fd = new FormData();
    fd.append('file', blob, `audio.${ext}`);
    fd.append('model', 'whisper-large-v3-turbo');

    const res = await cfFetch(PROXY + '/groq/openai/v1/audio/transcriptions', {
      method: 'POST',
      body: fd
    });
    if (!res.ok) throw new Error(await apiErrorMessage(res));
    const data = await res.json();
    appendText('transcriptText', data.text);
    if (fromAttachment) { mediaFiles = mediaFiles.filter(m => m !== fromAttachment); renderMediaPreviews(); }
    updateSubmitBtn();
    showToast('Transcription complete ✓', 'success');
  } catch(e) {
    console.warn('Transcription failed:', e);
    // the recording is not lost: on the note as an attachment, to retry or to send as it is
    if (!fromAttachment && blob && blob.size) {
      const ext = /mp4|aac|m4a|mpeg/.test(blob.type || '') ? 'm4a' : 'webm';
      const file = new File([blob], `voice-note-${new Date().toTimeString().slice(0, 5).replace(':', 'h')}.${ext}`, { type: blob.type || 'audio/webm' });
      mediaFiles.push({ type: 'audio', file, blob });
      renderMediaPreviews();
      updateSubmitBtn();
    }
    showToast(`Transcription failed — ${failureReason(e)}. The recording is kept on the note: tap it to try again.`, 'error');
  } finally {
    if (my === transcribeSeq) bar.style.display = 'none';
  }
}

// ─── AI SUMMARY HELPERS ───────────────────────────────────────
function bulletPrompt(text) {
  const words = text.trim().split(/\s+/).length;
  const max = words < 15 ? 1 : words < 40 ? 2 : words < 80 ? 3 : words < 150 ? 4 : 5;
  return `You are a precise summariser. Respond with bullet points using • as the bullet character.
STRICT RULES:
- Maximum ${max} bullet point${max === 1 ? '' : 's'} — do NOT exceed this limit
- Use fewer if the content is simple or repetitive
- Each bullet must be a single short sentence capturing one distinct fact
- No preamble, no commentary, no extra text — bullets only`;
}

// ─── AI SUMMARY (GROQ) ───────────────────────────────────────
// Groq retires models on a schedule and the old id then hard-fails: summaries
// broke on 2026-08-16 when llama-3.1-8b-instant was shut down, while
// transcription kept working because Whisper is a separate model. Keep the id
// in one place so the next retirement is a one-line change, and check
// https://console.groq.com/docs/deprecations when summaries start failing.
const SUMMARY_MODEL = 'openai/gpt-oss-20b';   // replaces llama-3.1-8b-instant
// gpt-oss is a reasoning model: reasoning tokens are billed against the
// completion budget even though they come back in a separate field, so the
// old 300/400 caps could leave nothing for the answer. 'low' effort suits
// bullet-point summarising and keeps latency down.
const SUMMARY_REASONING_EFFORT = 'low';
const SUMMARY_MAX_TOKENS = 1024;

// Voice summary — runs when its Generate button is tapped (transcription itself is automatic).
async function runVoiceSummary() {
  const transcript = document.getElementById('transcriptText').value.trim();
  const note       = document.getElementById('noteText').value.trim();
  const text       = [transcript, note].filter(Boolean).join('\n\n');
  if (!text) { showToast('Nothing to summarise — record or type a transcription first', 'error'); return; }

  const gen = document.getElementById('summaryGenerating');
  const btn = document.getElementById('generateSummaryBtn');
  gen.style.display = 'flex';
  btn.disabled = true;
  try {
    const res = await cfFetch(PROXY + '/groq/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        temperature: 0,
        reasoning_effort: SUMMARY_REASONING_EFFORT,
        messages: [
          { role: 'system', content: bulletPrompt(text) },
          { role: 'user', content: text }
        ],
        max_completion_tokens: SUMMARY_MAX_TOKENS
      })
    });
    if (!res.ok) throw new Error(await apiErrorMessage(res));
    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || '';
    // An empty completion is a failure, not a summary (a reasoning model that
    // spends its whole budget thinking returns exactly this).
    if (!summary) throw new Error('model returned an empty summary');
    document.getElementById('summaryText').value = summary;
    updateSubmitBtn();
    showToast('Voice summary written ✓', 'success');
  } catch(e) {
    console.warn('Summary failed:', e);
    showToast(`Voice summary failed — ${failureReason(e)}`, 'error');
  } finally {
    gen.style.display = 'none';
    btn.disabled = false;
  }
}

document.getElementById('generateSummaryBtn').addEventListener('click', runVoiceSummary);
document.getElementById('generateVideoSummaryBtn').addEventListener('click', runVideoSummary);
// Clear asks first when the box holds text: it sits a few millimetres from Copy, and what it wipes — the box and
// its kept draft — does not come back
// 0.11.147: asked on the app's own sheet (window.askSheet, js/cloud/ask.js); confirm() only if that did not load
const askOk = o => window.askSheet ? window.askSheet(o) : Promise.resolve(confirm(o.title));
const sureClear = async box => !box.value.trim() || await askOk({ title: 'Clear this text?', yes: 'Clear it', no: 'Keep it', danger: true });
const clearBox = id => async () => { const box = document.getElementById(id); if (!await sureClear(box)) return; box.value = ''; updateSubmitBtn(); };
document.getElementById('clearSummaryBtn').addEventListener('click', clearBox('summaryText'));
document.getElementById('clearVideoTranscriptBtn').addEventListener('click', clearBox('videoTranscriptText'));
document.getElementById('clearVideoSummaryBtn').addEventListener('click', clearBox('videoSummaryText'));
document.getElementById('copyVideoTranscriptBtn').addEventListener('click', () => {
  const v = document.getElementById('videoTranscriptText').value;
  if (!v) return;
  navigator.clipboard.writeText(v).then(() => showToast('Video transcription copied', 'success'));
});

// ─── COPY BUTTONS ────────────────────────────────────────────
document.getElementById('copyTranscriptBtn').addEventListener('click', () => {
  const v = document.getElementById('transcriptText').value;
  if (!v) return;
  navigator.clipboard.writeText(v).then(() => showToast('Transcript copied', 'success'));
});
document.getElementById('copySummaryBtn').addEventListener('click', () => {
  const v = document.getElementById('summaryText').value;
  if (!v) return;
  navigator.clipboard.writeText(v).then(() => showToast('Summary copied', 'success'));
});

// ─── VIDEO AI SUMMARY ─────────────────────────────────────────
// Video summary — runs when its Generate button is tapped (transcription itself is automatic).
async function runVideoSummary() {
  const transcript = document.getElementById('videoTranscriptText').value.trim();
  if (!transcript) { showToast('Nothing to summarise — add a video or paste its transcription first', 'error'); return; }

  const gen = document.getElementById('videoSummaryGenerating');
  const btn = document.getElementById('generateVideoSummaryBtn');
  gen.style.display = 'flex';
  btn.disabled = true;
  try {
    const res = await cfFetch(PROXY + '/groq/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        temperature: 0,
        reasoning_effort: SUMMARY_REASONING_EFFORT,
        messages: [
          { role: 'system', content: bulletPrompt(transcript) },
          { role: 'user', content: transcript }
        ],
        max_completion_tokens: SUMMARY_MAX_TOKENS
      })
    });
    if (!res.ok) throw new Error(await apiErrorMessage(res));
    const data = await res.json();
    const videoSummary = data.choices?.[0]?.message?.content?.trim() || '';
    if (!videoSummary) throw new Error('model returned an empty summary');
    document.getElementById('videoSummaryText').value = videoSummary;
    updateSubmitBtn();
    showToast('Video summary written ✓', 'success');
  } catch(e) {
    console.warn('Video summary failed:', e);
    showToast(`Video summary failed — ${failureReason(e)}`, 'error');
  } finally {
    gen.style.display = 'none';
    btn.disabled = false;
  }
}

document.getElementById('copyVideoSummaryBtn').addEventListener('click', () => {
  const v = document.getElementById('videoSummaryText').value;
  if (!v) return;
  navigator.clipboard.writeText(v).then(() => showToast('Video summary copied', 'success'));
});

