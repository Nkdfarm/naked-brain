//! Naked Brain - the Capture script (Notion notes): plain global scope, shared by all js/capture/* files -- audio extraction, wake lock, background compression, media. Edit here, then run: python build.py
// ─── AUDIO EXTRACTION ────────────────────────────────────────
// Extracts audio-only from a video file and returns a 16 kHz mono WAV File.
// A 15 MB video becomes ~1–2 MB WAV — uploads 10× faster to Groq.
async function extractAudioFromVideo(videoFile) {
  // Fast Web Audio decode only (7 s cap) — quick on Android/desktop, returns a
  // small 16 kHz WAV used to give the compressed video its audio track. iOS
  // camera videos can't be decoded here; on failure this rejects and the caller
  // treats audio as unavailable (transcription then sends the compressed video
  // straight to Groq, which extracts the audio server-side).
  return _decodeViaWebAudio(videoFile);
}

// Web Audio path, with a hard timeout so a hung decodeAudioData can't stall.
async function _decodeViaWebAudio(videoFile) {
  const arrayBuffer = await videoFile.arrayBuffer();
  const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffer;
  try {
    if (tmpCtx.state === 'suspended') { try { await tmpCtx.resume(); } catch(_) {} }
    audioBuffer = await Promise.race([
      tmpCtx.decodeAudioData(arrayBuffer),
      new Promise((_, rej) => setTimeout(() => rej(new Error('decodeAudioData-timeout')), 7000))
    ]);
  } finally {
    tmpCtx.close();
  }
  return _resampleToWav16kMono(audioBuffer);
}

// Demux the source's AAC audio track with MP4Box and return its encoded samples
// verbatim (no decoding) so the compressor can remux them into the output MP4.
// This is the iOS audio fix: decodeAudioData can't read the camera container,
// but copying the already-encoded AAC frames needs no decoder at all.
async function _demuxAacFrames(file) {
  if (typeof MP4Box === 'undefined') throw new Error('MP4Box unavailable');
  const buf = await file.arrayBuffer();
  buf.fileStart = 0;
  return await new Promise((resolve, reject) => {
    const mp4 = MP4Box.createFile();
    const frames = [];
    mp4.onError = e => reject(new Error('mp4box: ' + e));
    mp4.onReady = info => {
      const at = info.audioTracks && info.audioTracks[0];
      if (!at) { reject(new Error('no audio track')); return; }
      if (!/mp4a/i.test(at.codec || '')) { reject(new Error('audio not AAC: ' + at.codec)); return; }
      const asc = _audioSpecificConfig(mp4, at.id);
      mp4.onSamples = (id, user, samples) => {
        for (const s of samples) {
          frames.push({ timestampMs: (s.cts / s.timescale) * 1000, data: s.data.slice(0) });
        }
      };
      mp4.setExtractionOptions(at.id, null, { nbSamples: 10_000_000 });
      mp4.start();
      // appendBuffer + flush below run synchronously; resolve once they finish.
      Promise.resolve().then(() => resolve({
        frames,
        sampleRate: (at.audio && at.audio.sample_rate) || 44100,
        channels: (at.audio && at.audio.channel_count) || 2,
        asc,
      }));
    };
    try {
      mp4.appendBuffer(buf);
      mp4.flush();
    } catch(e) { reject(new Error('mp4box: ' + e.message)); return; }
    // If onReady never fired (not an MP4 — e.g. webm), reject instead of
    // hanging forever. onReady's deferred resolve is queued first and wins.
    Promise.resolve().then(() => reject(new Error('not an MP4 (no moov parsed)')));
  });
}

// Pull the AAC AudioSpecificConfig (esds DecoderSpecificInfo) MP4Box parsed out
// of the sample description — used as the output track's esds so players/Groq
// decode the remuxed audio correctly.
function _audioSpecificConfig(mp4, trackId) {
  try {
    const trak = mp4.getTrackById(trackId);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const esds = entry.esds;
      const dcd = esds && esds.esd && esds.esd.descs && esds.esd.descs[0];
      const dsi = dcd && dcd.descs && dcd.descs[0];
      if (dsi && dsi.data) return dsi.data; // Uint8Array
    }
  } catch (_) {}
  return null;
}

// ─── GROQ AUDIO (demux, no decode) ────────────────────────────
// Wraps demuxed AAC frames (see _demuxAacFrames) in a minimal, non-fragmented
// .m4a container — one of Groq's officially supported formats (flac, mp3,
// mp4, mpeg, mpga, m4a, ogg, wav, webm; raw ".aac" is NOT on that list, which
// is why the original ADTS-only version got rejected). Needs no decode and
// no encode, so it works on iOS (where decodeAudioData fails) and is a
// fraction of the size of the compressed video, since Groq only ever needed
// the audio track.
function _buildM4a(demux) {
  const toU8 = a => a instanceof Uint8Array ? a : ArrayBuffer.isView(a) ? new Uint8Array(a.buffer,a.byteOffset,a.byteLength) : new Uint8Array(a);
  const cat  = (...aa) => { const p=aa.map(toU8); const o=new Uint8Array(p.reduce((s,a)=>s+a.byteLength,0)); let x=0; for(const a of p){o.set(a,x);x+=a.byteLength;} return o; };
  const u8   = n => new Uint8Array([n&0xFF]);
  const u16  = n => new Uint8Array([(n>>8)&0xFF, n&0xFF]);
  const u24  = n => new Uint8Array([(n>>16)&0xFF, (n>>8)&0xFF, n&0xFF]);
  const u32  = n => { const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,n>>>0,false); return b; };
  const str  = s => new TextEncoder().encode(s);
  const box  = (t,...d) => { const data=cat(...d); return cat(u32(data.byteLength+8),str(t),data); };
  const fbox = (t,v,f,...d) => box(t,u8(v),u24(f),...d);
  const dLen = n => n<128 ? new Uint8Array([n]) : new Uint8Array([0x80|(n>>7),n&0x7F]);
  const desc = (tag,...parts) => { const d=cat(...parts); return cat(new Uint8Array([tag]),dLen(d.byteLength),d); };

  const frames = demux.frames;
  const N   = frames.length;
  const ATS = demux.sampleRate || 44100; // audio timescale = actual sample rate
  const ACH = demux.channels || 2;
  const FRAME_TICKS = 1024; // samples per AAC-LC frame — universal for this codec
  const totalTicks = N * FRAME_TICKS;
  const mat = cat(u32(0x00010000),u32(0),u32(0), u32(0),u32(0x00010000),u32(0), u32(0),u32(0),u32(0x40000000));

  const ftyp = box('ftyp', str('M4A '), u32(0), str('M4A '), str('mp42'), str('isom'));

  const aFreqTable = [96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350];
  const aFreqIdx = Math.max(0, aFreqTable.indexOf(ATS));
  const ascWord  = (2 << 11) | (aFreqIdx << 7) | (ACH << 3);
  const asc = (demux.asc && toU8(demux.asc).byteLength) ? toU8(demux.asc) : new Uint8Array([(ascWord>>8)&0xFF, ascWord&0xFF]);
  const aBitrate = ACH === 1 ? 48000 : 96000;
  const esds = fbox('esds',0,0,
    desc(0x03, u16(1),new Uint8Array([0x00]),
      desc(0x04, new Uint8Array([0x40,0x15,0,0,0]), u32(aBitrate),u32(aBitrate), desc(0x05,asc)),
      desc(0x06, new Uint8Array([0x02]))));
  const mp4a = box('mp4a', new Uint8Array(6),u16(1),new Uint8Array(8),
    u16(ACH),u16(16),u16(0),u16(0), u32(ATS<<16), esds);

  const sizes = frames.map(f => f.data.byteLength);
  const stsz = fbox('stsz',0,0, u32(0), u32(N), ...sizes.map(u32));
  const stsc = fbox('stsc',0,0, u32(1), u32(1),u32(N),u32(1)); // one chunk holding all samples
  const stts = fbox('stts',0,0, u32(1), u32(N),u32(FRAME_TICKS));

  const buildMoov = (chunkOffset) => {
    const stbl = box('stbl', fbox('stsd',0,0,u32(1),mp4a), stts, stsc, stsz,
      fbox('stco',0,0,u32(1), u32(chunkOffset)));
    const mdia = box('mdia',
      fbox('mdhd',0,0, u32(0),u32(0), u32(ATS),u32(totalTicks), u16(0x55C4),u16(0)),
      fbox('hdlr',0,0, u32(0),str('soun'), new Uint8Array(12), str('SoundHandler'), u8(0)),
      box('minf', fbox('smhd',0,0,u16(0),u16(0)),
        box('dinf', fbox('dref',0,0,u32(1), fbox('url ',0,1))), stbl));
    const tkhd = fbox('tkhd',0,3, u32(0),u32(0),u32(1),u32(0),u32(totalTicks),
      new Uint8Array(8), u16(0),u16(0),u16(0x0100),u16(0), mat, u32(0),u32(0));
    const mvhd = fbox('mvhd',0,0, u32(0),u32(0), u32(ATS),u32(totalTicks),
      u32(0x00010000),u16(0x0100), new Uint8Array(10), mat, new Uint8Array(24), u32(2));
    return box('moov', mvhd, box('trak', tkhd, mdia));
  };

  // Two-pass: the chunk offset only changes the STCO value (fixed 4 bytes),
  // never the box sizes, so building once with a placeholder gives the exact
  // prefix length needed to compute the real mdat offset.
  const prefixLen = ftyp.byteLength + buildMoov(0).byteLength + 8; // +8 = mdat header
  const moov = buildMoov(prefixLen);
  const mdat = box('mdat', cat(...frames.map(f => toU8(f.data))));

  return new File([ftyp, moov, mdat], 'audio.m4a', { type: 'audio/mp4' });
}

// Primary path for Groq transcription: demux the AAC track directly (no
// decode — works on iOS camera video). Falls back to the Web Audio decode
// path (extractAudioFromVideo) when the source audio isn't AAC or has no
// audio track at all; that path still fails on iOS, same as it always has.
async function extractGroqAudio(videoFile) {
  try {
    const demux = await _demuxAacFrames(videoFile);
    if (demux && demux.frames.length) return _buildM4a(demux);
  } catch (e) {}
  return extractAudioFromVideo(videoFile).catch(() => null);
}

// Downsample/downmix any AudioBuffer to a 16 kHz mono WAV File (ideal for Whisper).
function _resampleToWav16kMono(audioBuffer) {
  const sampleRate = 16000;
  const offCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
    1, Math.max(1, Math.ceil(audioBuffer.duration * sampleRate)), sampleRate);
  const src = offCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(offCtx.destination); // mono destination downmixes multi-channel input
  src.start();
  return offCtx.startRendering().then(audioBufferToWavFile);
}

function audioBufferToWavFile(buffer) {
  const sampleRate = buffer.sampleRate;
  const pcmFloat = buffer.getChannelData(0);
  const pcm16 = new Int16Array(pcmFloat.length);
  for (let i = 0; i < pcmFloat.length; i++) {
    pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(pcmFloat[i] * 32767)));
  }

  const wavBuf = new ArrayBuffer(44 + pcm16.byteLength);
  const v = new DataView(wavBuf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };

  str(0,  'RIFF');  v.setUint32(4,  36 + pcm16.byteLength, true);
  str(8,  'WAVE');  str(12, 'fmt ');
  v.setUint32(16, 16, true);   // PCM chunk size
  v.setUint16(20,  1, true);   // PCM format
  v.setUint16(22,  1, true);   // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);  // byte rate
  v.setUint16(32,  2, true);   // block align
  v.setUint16(34, 16, true);   // bits per sample
  str(36, 'data');  v.setUint32(40, pcm16.byteLength, true);
  new Int16Array(wavBuf, 44).set(pcm16);

  return new File([wavBuf], 'audio.wav', { type: 'audio/wav' });
}

// ─── MEDIA ───────────────────────────────────────────────────
let mediaFiles = []; // {type:'image'|'video'|'link', file?, url?, name?}

// ─── WAKE LOCK ───────────────────────────────────────────────
// Keeps the screen on while compressing so the browser doesn't suspend the tab.
let _wakeLock = null;
let _wakeLockCount = 0;
async function acquireWakeLock() {
  _wakeLockCount++;
  if ('wakeLock' in navigator && !_wakeLock) {
    try { _wakeLock = await navigator.wakeLock.request('screen'); } catch(e) {}
  }
}
function releaseWakeLock() {
  _wakeLockCount = Math.max(0, _wakeLockCount - 1);
  if (_wakeLockCount === 0 && _wakeLock) { _wakeLock.release(); _wakeLock = null; }
}

// ─── BACKGROUND COMPRESSION ──────────────────────────────────
// Starts (or restarts) background compression for a media entry.
function startBackgroundCompression(entry) {
  if (entry.compressing) return;           // one compression of a file at a time (0.11.92)
  entry.compressing = true;
  entry.compressInterrupted = false;
  entry.compressProgress = 0;
  const lbl = () => document.getElementById('cl-' + entry.uid);
  const setLbl = (text, done = false) => {
    const el = lbl(); if (!el) return;
    nbLabel(el, text);
    done ? el.classList.add('done') : el.classList.remove('done');
  };
  setLbl('{i:settings} 0%');
  acquireWakeLock();

  entry.compressPromise = compressVideoFast(entry.file, p => {
    entry.compressProgress = p;
    setLbl(`{i:settings} ${Math.round(p * 100)}%`);
  }, entry._audioP || null, entry._groqAudioP || null).then(compressed => {
    entry.compressing = false;
    entry.compressed = compressed;
    releaseWakeLock();
    const sizeMB = compressed.size / 1024 / 1024;
    const badge = compressed._compressPath === 'demux' ? ' {i:bolt}' : '';
    setLbl(`✓ ${sizeMB.toFixed(1)} MB${badge}`, true);
    return compressed;
  }).catch(err => {
    entry.compressing = false;
    entry.compressInterrupted = true;      // only a compression that really stopped is restarted on return
    releaseWakeLock();
    console.warn('Background compression interrupted:', err.message);
    setLbl('{i:settings} paused');
    return null; // visibilitychange handler will restart; upload fallback if not
  });
}

// ─── RESUME ON RETURN ────────────────────────────────────────
// When user comes back to the app, restart any compressions that were
// interrupted because the tab went to the background (video.play() pauses).
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    // a compression still running in the background is not restarted beside itself (0.11.92) — two at once doubled
    // the memory and crashed iPhones; a stopped one marks itself in its .catch. Where it stood is noted here, so one
    // that stalled without failing (the fallback path) can be told apart on return.
    mediaFiles.forEach(e => { if (e.type === 'video' && e.compressing) e._hiddenAt = e.compressProgress; });
  } else {
    setTimeout(() => {
      const stalled = mediaFiles.filter(e => e.type === 'video' && e.compressing && !e.compressed && e._hiddenAt != null && e.compressProgress === e._hiddenAt);
      stalled.forEach(e => { e.compressing = false; e._hiddenAt = null; startBackgroundCompression(e); });
    }, 4000);
    // Re-acquire wake lock if compressions are still pending
    if (_wakeLockCount > 0 && 'wakeLock' in navigator && !_wakeLock) {
      try { _wakeLock = await navigator.wakeLock.request('screen'); } catch(e) {}
    }
    // Restart interrupted compressions
    const toResume = mediaFiles.filter(e => e.type === 'video' && e.compressInterrupted && !e.compressed && !e.compressing);
    if (toResume.length) {
      showToast(`Resuming compression (${toResume.length} video${toResume.length > 1 ? 's' : ''})…`, 'info');
      toResume.forEach(startBackgroundCompression);
    }
  }
});

document.getElementById('videoSummaryPhotoBtn').addEventListener('click', () => document.getElementById('videoSummaryPhotoInput').click());
document.getElementById('videoSummaryVideoBtn').addEventListener('click', () => document.getElementById('videoSummaryVideoInput').click());

// ─── iCLOUD-OFFLOADED MEDIA ──────────────────────────────────
// With Settings → Photos → "Optimize iPhone Storage", the full-size asset lives
// in iCloud and only a proxy sits on the device. The picker still hands over a
// File, but reading it fails until iOS has fetched the original — so an
// un-downloaded video used to stall getVideoDuration for its full 10 s timeout,
// get waved through ("duration unknown"), and then fail somewhere deep in
// compression with a message that never mentioned iCloud. Catch it at the door.
async function isFileReadable(file) {
  if (!file || file.size === 0) return false;
  try {
    // Touching the first bytes is enough: iOS throws here for an asset it
    // hasn't materialised, rather than returning short data.
    const head = await file.slice(0, 64 * 1024).arrayBuffer();
    return head.byteLength > 0;
  } catch(e) {
    console.warn('File not readable (likely still in iCloud):', file.name, e);
    return false;
  }
}

function iCloudToast(file) {
  showToast(`"${file.name}" hasn't downloaded from iCloud yet — open it once in Photos, then try again.`, 'error');
}

document.getElementById('videoSummaryPhotoInput').addEventListener('change', async e => {
  const picked = [...e.target.files];
  e.target.value = '';
  for (const f of picked) {
    if (!(await isFileReadable(f))) { iCloudToast(f); continue; }
    mediaFiles.push({ type: 'image', file: f });
  }
  renderMediaPreviews();
  updateSubmitBtn();
});

// ─── VIDEO LENGTH CAP ──────────────────────────────────────────
// Notion multi-part upload goes up to 5 GB, but we still bound video length
// so a single note can't balloon into a huge chunked upload / long transcription.
const MAX_VIDEO_SECONDS = 8 * 60;

function getVideoDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const timer = setTimeout(() => { URL.revokeObjectURL(video.src); resolve(null); }, 10_000);
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(video.src);
      resolve(isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => { clearTimeout(timer); URL.revokeObjectURL(video.src); resolve(null); };
    video.src = URL.createObjectURL(file);
  });
}

document.getElementById('videoSummaryVideoInput').addEventListener('change', async e => {
  const rawFiles = [...e.target.files];
  e.target.value = '';

  // Reject anything over 8 minutes before it touches compression/upload. If
  // duration can't be read (rare), let the file through — downstream size
  // limits still apply.
  const files = [];
  for (const f of rawFiles) {
    // Before the duration probe: an iCloud-only asset would otherwise burn the
    // full 10 s timeout here and then fail unhelpfully further down.
    if (!(await isFileReadable(f))) { iCloudToast(f); continue; }
    const dur = await getVideoDuration(f);
    if (dur !== null && dur > MAX_VIDEO_SECONDS) {
      showToast(`"${f.name}" is ${formatTime(Math.round(dur))} — videos must be 8 minutes or under. Please trim it and try again.`, 'error');
      continue;
    }
    files.push(f);
  }
  if (!files.length) return;

  // Build entries. _audioP is a LAZY thunk for the decode-based WAV extraction
  // (only runs if the playback fallback's non-H264 audio branch needs it —
  // running it eagerly held a whole-file ArrayBuffer at select time, part of
  // the iOS memory kill on long clips); _groqAudioP is the demux-based audio
  // used for transcription AND reused by the fast compression path.
  files.forEach(f => {
    const entry = { type: 'video', file: f, compressed: null, compressProgress: 0, compressInterrupted: false, uid: Math.random().toString(36).slice(2) };
    entry._audioP = () => (entry._audioWavP || (entry._audioWavP = extractAudioFromVideo(f).catch(() => null)));
    entry._groqAudioP = extractGroqAudio(f).catch(() => null);
    mediaFiles.push(entry);
    startBackgroundCompression(entry);
  });

  e.target.value = '';
  renderMediaPreviews();
  updateSubmitBtn();

  // ── Transcription for the first file (reuses shared audio extraction) ──
  if (files.length > 0) {
    const file = files[0];
    const bar    = document.getElementById('videoTranscribingBar');
    const status = document.getElementById('videoTranscribingStatus');
    bar.style.display = 'flex';
    try {
      const firstEntry = mediaFiles.find(e => e.file === file && e.type === 'video');
      const LIMIT = 25 * 1024 * 1024;

      // Primary path: demuxed AAC audio (see extractGroqAudio) — a few MB,
      // no decode required, works on iOS. Falls back to the original file if
      // small enough, then the compressed video as a last resort.
      status.textContent = 'Extracting audio for transcription…';
      const groqAudio = await firstEntry._groqAudioP;

      let toSend = null, srcLabel = '';
      if (groqAudio && groqAudio.size <= LIMIT) {
        toSend = groqAudio; srcLabel = 'audio';
      } else if (file.size <= LIMIT) {
        const isQuicktime = file.type === 'video/quicktime' || /\.mov$/i.test(file.name);
        toSend = isQuicktime
          ? new File([file], file.name.replace(/\.mov$/i, '.mp4'), { type: 'video/mp4' })
          : file;
        srcLabel = 'original video';
      } else {
        const compressed = await firstEntry.compressPromise.catch(() => null);
        if (compressed && compressed.size <= LIMIT) { toSend = compressed; srcLabel = 'compressed video'; }
      }
      if (!toSend) throw new Error('No file under 25 MB to transcribe (audio extraction unavailable)');

      const sendMb = (toSend.size / 1024 / 1024).toFixed(1);
      status.textContent = `Transcribing ${srcLabel} (${sendMb} MB)…`;
      const fd = new FormData();
      fd.append('file', toSend, toSend.name || 'audio.mp4');
      fd.append('model', 'whisper-large-v3-turbo');
      const res = await cfFetch(PROXY + '/groq/openai/v1/audio/transcriptions', {
        method: 'POST', body: fd
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const data = await res.json();
      appendText('videoTranscriptText', data.text);   // added to what the box holds (0.11.92), not replacing it
      updateSubmitBtn();
      showToast('Video transcribed ✓', 'success');
    } catch(err) {
      console.warn('Auto-transcription failed:', err);
      showToast(`Auto-transcription failed — ${failureReason(err)}`, 'error');
    } finally {
      bar.style.display = 'none';
    }
  }
});

var previewUrls = [];   // released at each repaint (0.11.92): every repaint made new ones and kept the old (var: may run at start-up)
function previewUrl(f) { const u = URL.createObjectURL(f); previewUrls.push(u); return u; }
function renderMediaPreviews() {
  const container = document.getElementById('mediaPreviews');
  container.innerHTML = '';
  previewUrls.forEach(u => URL.revokeObjectURL(u)); previewUrls = [];
  mediaFiles.forEach((m, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'media-thumb';
    if (m.type === 'audio') {
      const a = document.createElement('button');
      a.type = 'button'; a.className = 'video-link-thumb';
      nbLabel(a, '{i:mic} Voice note — tap to transcribe');
      a.onclick = () => transcribeAudio(m.blob || m.file, m);
      thumb.appendChild(a);
    } else if (m.type === 'image') {
      const img = document.createElement('img');
      img.src = previewUrl(m.file);
      img.alt = m.file.name;
      thumb.appendChild(img);
    } else if (m.type === 'video') {
      const inner = document.createElement('div');
      inner.className = 'video-thumb-inner';
      const vid = document.createElement('video');
      vid.src = previewUrl(m.file);
      vid.muted = true;
      inner.appendChild(vid);
      const overlay = document.createElement('div');
      overlay.className = 'video-play-overlay';
      overlay.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      inner.appendChild(overlay);
      // Compression progress label (only for entries started via video picker)
      if (m.uid) {
        const lbl = document.createElement('div');
        lbl.id = 'cl-' + m.uid;
        lbl.className = 'compress-label' + (m.compressed ? ' done' : '');
        nbLabel(lbl, m.compressed
          ? `✓ ${(m.compressed.size / 1024 / 1024).toFixed(1)} MB`
          : `{i:settings} ${Math.round((m.compressProgress || 0) * 100)}%`);
        inner.appendChild(lbl);
      }
      thumb.appendChild(inner);
    } else {
      const linkDiv = document.createElement('div');
      linkDiv.className = 'video-link-thumb';
      linkDiv.textContent = m.url;
      thumb.appendChild(linkDiv);
    }
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-media';
    removeBtn.innerHTML = '✕';
    removeBtn.setAttribute('aria-label', 'Remove media');
    removeBtn.addEventListener('click', () => {
      // a voice note that could not be transcribed exists nowhere else, and a video took minutes to prepare: ask first
      if (m.type === 'audio' && !confirm('Remove this voice note? It is not kept anywhere else.')) return;
      if (m.type === 'video' && !confirm('Remove this video from the note?')) return;
      mediaFiles.splice(i, 1); renderMediaPreviews(); updateSubmitBtn();
    });
    thumb.appendChild(removeBtn);
    container.appendChild(thumb);
  });
}

