//! Naked Brain - the Capture script (Notion notes): plain global scope, shared by all js/capture/* files -- video capture and compression (muxers). Edit here, then run: python build.py
// ─── VIDEO CAPTURE CARD ───────────────────────────────────────

document.getElementById('clearTranscriptBtn').addEventListener('click', async () => {
  if (!await sureClear(document.getElementById('transcriptText'))) return;
  document.getElementById('transcriptText').value = '';
  updateSubmitBtn();
});

// ─── VIDEO COMPRESSION ───────────────────────────────────────
// No longer gated by Groq's 25 MB cap (transcription now uses extracted audio
// — see extractGroqAudio) — this now targets "average quality" for Notion:
// ~85 MB for a full 8-minute clip (1.35 Mbps video + 128 kbps audio), safely
// under the 100 MB budget with headroom for encoder/container variance.
const COMPRESS_MAX_H     = 720;
const COMPRESS_VIDEO_BPS = 1_350_000;
const COMPRESS_AUDIO_BPS =   128_000;
const COMPRESS_FPS       = 24;
// Frame-capture speed for the PLAYBACK fallback path (video.playbackRate).
// Kept at the known-good 4 — above that the encoder backpressure check drops
// frames (choppy, "compact" output, tested 8/16 in v1.42/43). The primary
// path below (_compressDemuxDecode) doesn't play the video at all, so it has
// no rate ceiling and never drops frames.
const COMPRESS_PLAYBACK_RATE = 4;

// Entry point — demux+decode (hardware speed, no frame drops), then
// playback capture (4×), then canvas+MediaRecorder (real-time) as last resort.
// audioLazy: () => Promise<WAV File|null> — decode-based audio extraction,
// started only if a fallback path actually needs it (the eager version held a
// whole-file ArrayBuffer at select time, part of the iOS memory spike).
// groqAudioP: Promise<m4a File|null> from the transcription extraction,
// reused by the fast path so the source AAC is only demuxed once.
async function compressVideoFast(file, onProgress, audioLazy = null, groqAudioP = null) {
  // Tag results with the path that produced them (shown as a bolt in the label
  // for the fast path — tells us on-device which pipeline made a given file).
  const tag = (f, path) => { try { f._compressPath = path; } catch(_) {} return f; };
  if (typeof VideoEncoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    if (typeof VideoDecoder !== 'undefined') {
      try {
        return tag(await _compressDemuxDecode(file, onProgress, groqAudioP), 'demux');
      } catch(e) {
        console.warn('Demux-decode compression failed, falling back to playback capture:', e.message);
        onProgress?.(0); // reset progress display
      }
    }
    try {
      return tag(await _compressWebCodecs(file, onProgress, audioLazy), 'playback');
    } catch(e) {
      console.warn('WebCodecs compression failed, falling back to canvas:', e.message);
      onProgress?.(0); // reset progress display
    }
  }
  return tag(await _compressCanvas(file, onProgress), 'canvas');
}

// ── FASTEST PATH: MP4Box demux → VideoDecoder → VideoEncoder ──
// Feeds the source's encoded video samples straight into a hardware
// VideoDecoder instead of playing the file, so compression runs as fast as
// decode+encode allows (not a fixed multiple of real time) and — unlike the
// playback path — applies backpressure by *waiting*, never by dropping
// frames. Audio is the same verbatim AAC remux used everywhere else (no
// decode — the part of WebCodecs that actually works on iOS; the v1.27
// failure was AudioDecoder, which this never touches). Also keeps running
// when the tab is backgrounded, since nothing here depends on playback.
// Throws whenever anything is unsupported so compressVideoFast falls back.
async function _compressDemuxDecode(file, onProgress, groqAudioP = null) {
  // Audio: reuse the transcription extraction's .m4a when available — same
  // AAC track, already demuxed, a few MB — instead of a second whole-file
  // read (long clips were hitting iOS's per-tab memory kill). Falls back to
  // demuxing the source; throws for non-AAC → playback fallback re-encodes.
  let remux = null;
  if (groqAudioP) {
    const m4a = await groqAudioP.catch(() => null);
    if (m4a && m4a.type === 'audio/mp4') remux = await _demuxAacFrames(m4a).catch(() => null);
  }
  if (!remux) remux = await _demuxAacFrames(file);
  if (!remux.frames.length) throw new Error('no AAC frames to remux');

  // Prefer hardware, but settle for software (helps desktops; iOS is
  // always hardware for both).
  const pickCfg = async (Codec, base) => {
    for (const hwa of ['prefer-hardware', 'no-preference']) {
      const cfg = { ...base, hardwareAcceleration: hwa };
      const s = await Codec.isConfigSupported(cfg).catch(() => null);
      if (s && s.supported) return cfg;
    }
    return null;
  };

  const videoFrames = [];
  let avccConfig = null, vErr = null, vEnc = null, dec = null;
  let w = 0, h = 0, rot = 0, sw = 0, sh = 0, ofc = null, ctx = null;
  let keepEvery = 1, total = 0, fed = 0;
  // Re-base timestamps to 0 (first decoded frame = presentation-order start):
  // camera files can have nonzero cts bases (edit lists, B-frame offsets), and
  // the muxer's proven input profile — from the playback path — starts at ~0.
  let frameIdx = 0, lastKeyUs = -Infinity, baseUs = null;

  // Called by the streamer once moov is parsed, before any samples arrive.
  const onTrackReady = async (vt, description) => {
    // Display dims = coded dims with the container rotation applied (portrait
    // camera video stores landscape frames + a 90° matrix; the playback path
    // got the rotation for free from <video>, here it must be applied by hand).
    rot = _trackRotation(vt.matrix);
    const cw = (vt.video && vt.video.width)  || vt.track_width;
    const chh = (vt.video && vt.video.height) || vt.track_height;
    const dw = rot % 180 ? chh : cw;
    const dh = rot % 180 ? cw : chh;
    const scale = Math.min(1, COMPRESS_MAX_H / dh);
    w = Math.round(dw * scale / 2) * 2;
    h = Math.round(dh * scale / 2) * 2;
    sw = rot % 180 ? h : w;   // scaled coded dims before rotation —
    sh = rot % 180 ? w : h;   // ctx.rotate() maps them onto w×h
    total = vt.nb_samples || 0;

    // Deterministic thinning for high-fps sources (60 → 30): even cadence at
    // the fixed bitrate, instead of the load-dependent drops of the old path.
    const srcFps = vt.samples_duration ? vt.nb_samples / (vt.samples_duration / vt.timescale) : 0;
    keepEvery = (isFinite(srcFps) && srcFps > 34) ? 2 : 1;

    const dCfg = await pickCfg(VideoDecoder, { codec: vt.codec, codedWidth: cw,
      codedHeight: chh, description });
    if (!dCfg) throw new Error('decoder unsupported: ' + vt.codec);
    const vCfg = await pickCfg(VideoEncoder, { codec: 'avc1.42E01E', width: w, height: h,
      bitrate: COMPRESS_VIDEO_BPS, framerate: COMPRESS_FPS, avc: { format: 'avc' } });
    if (!vCfg) throw new Error('H.264 encoder unsupported');

    ofc = new OffscreenCanvas(w, h);
    ctx = ofc.getContext('2d', { alpha: false });
    vEnc = new VideoEncoder({
      output: (chunk, meta) => {
        if (chunk.type === 'key' && !avccConfig && meta?.decoderConfig?.description)
          avccConfig = meta.decoderConfig.description;
        const b = new ArrayBuffer(chunk.byteLength); chunk.copyTo(b);
        videoFrames.push({ timestampMs: Math.round(chunk.timestamp / 1000), keyframe: chunk.type === 'key', data: b });
      },
      error: e => { vErr = e; }
    });
    vEnc.configure(vCfg);
    dec = new VideoDecoder({
      output: (vf) => {
        const idx = frameIdx++;
        if (baseUs === null) baseUs = vf.timestamp;
        if (idx % keepEvery) { vf.close(); return; }
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(rot * Math.PI / 180);
        ctx.drawImage(vf, -sw / 2, -sh / 2, sw, sh);
        ctx.restore();
        const tUs = Math.max(0, vf.timestamp - baseUs);
        const isKey = (tUs - lastKeyUs) >= 2_000_000;
        const out = new VideoFrame(ofc, { timestamp: tUs });
        vEnc.encode(out, { keyFrame: isKey });
        if (isKey) lastKeyUs = tUs;
        out.close();
        vf.close();
      },
      error: e => { vErr = e; }
    });
    dec.configure(dCfg);
  };

  // Called by the streamer for each extracted sample, in decode order.
  const onSample = async (s) => {
    if (vErr) throw vErr;
    // Backpressure: wait for the pipeline to drain — never drop a frame.
    while (dec.decodeQueueSize > 12 || vEnc.encodeQueueSize > 12) {
      if (vErr) throw vErr;
      await new Promise(r => setTimeout(r, 2));
    }
    dec.decode(new EncodedVideoChunk({
      type: s.is_sync ? 'key' : 'delta',
      timestamp: Math.round(s.cts / s.timescale * 1_000_000),
      duration: Math.round(s.duration / s.timescale * 1_000_000),
      data: s.data,
    }));
    fed++;
    if (total) onProgress?.(fed / total);
  };

  try {
    await _streamVideoSamples(file, onTrackReady, onSample);
    if (!fed) throw new Error('no video samples');
    await dec.flush();
    await vEnc.flush();
    if (vErr) throw vErr;
  } finally {
    try { dec && dec.close(); } catch(_) {}
    try { vEnc && vEnc.close(); } catch(_) {}
  }
  if (!avccConfig) throw new Error('encoder produced no decoder config');
  if (!videoFrames.length) throw new Error('encoder produced no frames');

  videoFrames.sort((a, b) => a.timestampMs - b.timestampMs);
  const audioFrames = remux.frames;
  audioFrames.sort((a, b) => a.timestampMs - b.timestampMs);
  audioFrames.sr = remux.sampleRate;
  audioFrames.ch = remux.channels;

  // Duration from what was actually encoded (0-based) — immune to odd source
  // metadata (missing last-sample duration, edit-list offsets, NaN math).
  const durMs = videoFrames[videoFrames.length - 1].timestampMs + Math.round(1000 / COMPRESS_FPS);

  const blob = _buildMP4(videoFrames, w, h, durMs, avccConfig, audioFrames, remux.asc || null);
  const out = new File([blob], file.name.replace(/\.[^.]+$/, '.mp4'), { type: 'video/mp4' });

  // Self-check: prove this device can re-parse and decode our own output
  // before anyone uploads it. Throwing here sends compressVideoFast down the
  // known-good playback fallback instead of shipping a broken file.
  await _validateCompressedMp4(out);
  console.log(`demux-decode compression OK: ${videoFrames.length} frames, ${durMs} ms, ${(out.size/1024/1024).toFixed(1)} MB`);
  return out;
}

// Re-demux the freshly built MP4 and test-decode its first GOP. Any failure
// throws, which makes compressVideoFast fall back to the playback path.
async function _validateCompressedMp4(file) {
  const vd = await _demuxVideoSamples(file);
  if (!vd.samples.length) throw new Error('self-check: no samples in output');
  if (!vd.samples[0].is_sync) throw new Error('self-check: output does not start on a keyframe');
  let decoded = 0, err = null;
  const dec = new VideoDecoder({ output: vf => { decoded++; vf.close(); }, error: e => { err = e; } });
  try {
    dec.configure({ codec: vd.codec, codedWidth: vd.codedWidth, codedHeight: vd.codedHeight, description: vd.description });
    for (const s of vd.samples.slice(0, 8)) {
      dec.decode(new EncodedVideoChunk({
        type: s.is_sync ? 'key' : 'delta',
        timestamp: Math.round(s.cts / s.timescale * 1_000_000),
        duration: Math.round(s.duration / s.timescale * 1_000_000),
        data: s.data,
      }));
    }
    await dec.flush();
  } finally {
    try { dec.close(); } catch(_) {}
  }
  if (err) throw new Error('self-check: output not decodable: ' + (err.message || err));
  if (!decoded) throw new Error('self-check: output decoded 0 frames');
}

// Walk the file's top-level boxes cheaply (16-byte header reads via slice)
// so the streamer can append moov before mdat regardless of where the camera
// put it (iPhone MOV keeps moov at the END of the file).
async function _scanTopBoxes(file) {
  const boxes = [];
  let off = 0;
  while (off + 8 <= file.size) {
    const hdr = new DataView(await file.slice(off, Math.min(off + 16, file.size)).arrayBuffer());
    let size = hdr.getUint32(0);
    const type = String.fromCharCode(hdr.getUint8(4), hdr.getUint8(5), hdr.getUint8(6), hdr.getUint8(7));
    if (size === 1) {                      // 64-bit largesize
      if (hdr.byteLength < 16) break;
      size = hdr.getUint32(8) * 4294967296 + hdr.getUint32(12);
    } else if (size === 0) {               // box extends to end of file
      size = file.size - off;
    }
    if (size < 8) throw new Error('malformed box at offset ' + off);
    boxes.push({ type, start: off, size });
    off += size;
  }
  return boxes;
}

// Streamed MP4 video-sample reader with BOUNDED memory: appends header boxes
// (ftyp/moov/moof — moov may sit at the end of camera files) to MP4Box first,
// then the mdat payload in chunks, calling `onSample` for each extracted
// sample as its bytes arrive and releasing consumed data. Replaces holding
// the whole file plus every sample copy in RAM, which iOS killed on ~4-min
// clips. `onTrackReady(vt, description)` runs once moov is parsed, before any
// samples flow; both callbacks may be async and are awaited.
async function _streamVideoSamples(file, onTrackReady, onSample) {
  if (typeof MP4Box === 'undefined') throw new Error('MP4Box unavailable');
  const boxes = await _scanTopBoxes(file);
  if (!boxes.some(b => b.type === 'moov')) throw new Error('no moov box');

  const mp4 = MP4Box.createFile();
  const pending = [];
  let vt = null, demuxErr = null, readyRes, readyRej;
  const ready = new Promise((res, rej) => { readyRes = res; readyRej = rej; });
  ready.catch(() => {});   // settled via race below; avoid unhandled-rejection noise
  mp4.onError = e => { demuxErr = new Error('mp4box: ' + e); readyRej(demuxErr); };
  mp4.onReady = info => {
    vt = info.videoTracks && info.videoTracks[0];
    if (!vt) { readyRej(new Error('no video track')); return; }
    const description = _videoDecoderDescription(mp4, vt.id);
    if (!description) { readyRej(new Error('no avcC/hvcC decoder config')); return; }
    mp4.onSamples = (id, user, arr) => { for (const s of arr) pending.push(s); };
    mp4.setExtractionOptions(vt.id, null, { nbSamples: 100 });
    mp4.start();
    readyRes({ vt, description });
  };

  const CHUNK = 16 * 1024 * 1024;
  let released = 0;
  const drain = async () => {
    while (pending.length) {
      if (demuxErr) throw demuxErr;
      const s = pending.shift();
      await onSample(s);
      released = s.number;
    }
    // Free sample data (and the buffers backing it) the pipeline is done with.
    if (released && vt) { try { mp4.releaseUsedSamples(vt.id, released); } catch(_) {} }
  };
  const append = async (start, end, doDrain) => {
    for (let off = start; off < end; off += CHUNK) {
      if (demuxErr) throw demuxErr;
      const ab = await file.slice(off, Math.min(off + CHUNK, end)).arrayBuffer();
      ab.fileStart = off;
      mp4.appendBuffer(ab);
      if (doDrain) await drain();
    }
  };

  // Header boxes first — MP4Box assembles them by fileStart, so skipping the
  // mdat payload here is fine. onReady fires synchronously during these
  // appends once moov is complete.
  for (const b of boxes) if (b.type !== 'mdat') await append(b.start, b.start + b.size, false);
  const track = await Promise.race([
    ready,
    Promise.resolve().then(() => { throw demuxErr || new Error('moov present but not parsed'); }),
  ]);
  await onTrackReady(track.vt, track.description);

  // Now the sample data, decode-as-we-go.
  for (const b of boxes) if (b.type === 'mdat') await append(b.start, b.start + b.size, true);
  mp4.flush();
  await drain();
  if (demuxErr) throw demuxErr;
}

// Demux the source's video track with MP4Box and return its encoded samples
// plus everything VideoDecoder needs (codec string, coded dims, avcC/hvcC
// extradata, container rotation). Mirrors _demuxAacFrames.
async function _demuxVideoSamples(file) {
  if (typeof MP4Box === 'undefined') throw new Error('MP4Box unavailable');
  const buf = await file.arrayBuffer();
  buf.fileStart = 0;
  return await new Promise((resolve, reject) => {
    const mp4 = MP4Box.createFile();
    const samples = [];
    mp4.onError = e => reject(new Error('mp4box: ' + e));
    mp4.onReady = info => {
      const vt = info.videoTracks && info.videoTracks[0];
      if (!vt) { reject(new Error('no video track')); return; }
      const description = _videoDecoderDescription(mp4, vt.id);
      if (!description) { reject(new Error('no avcC/hvcC decoder config')); return; }
      mp4.onSamples = (id, user, arr) => { for (const s of arr) samples.push(s); };
      mp4.setExtractionOptions(vt.id, null, { nbSamples: 10_000_000 });
      mp4.start();
      // appendBuffer + flush below run synchronously; resolve once they finish.
      Promise.resolve().then(() => resolve({
        samples,
        codec: vt.codec,
        codedWidth:  (vt.video && vt.video.width)  || vt.track_width,
        codedHeight: (vt.video && vt.video.height) || vt.track_height,
        description,
        rotation: _trackRotation(vt.matrix),
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

// Pull the avcC/hvcC box (minus its 8-byte header) out of the sample
// description — VideoDecoder's `description` config field.
function _videoDecoderDescription(mp4, trackId) {
  try {
    if (typeof DataStream === 'undefined') return null;
    const trak = mp4.getTrackById(trackId);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const cbox = entry.avcC || entry.hvcC;
      if (!cbox) continue;
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      cbox.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  } catch(_) {}
  return null;
}

// Rotation (0/90/180/270) from the tkhd matrix (16.16 fixed point).
function _trackRotation(matrix) {
  if (!matrix || matrix.length < 5) return 0;
  const a = matrix[0] / 65536, b = matrix[1] / 65536,
        c = matrix[3] / 65536, d = matrix[4] / 65536;
  if (a === 0 && d === 0) {
    if (b === 1 && c === -1) return 90;
    if (b === -1 && c === 1) return 270;
  }
  if (a === -1 && d === -1) return 180;
  return 0;
}

// ── FAST PATH: WebCodecs + sped-up playback + fMP4/WebM muxer ─────
// Video encoded at COMPRESS_PLAYBACK_RATE× via requestVideoFrameCallback + VideoEncoder.
// Audio decoded via AudioContext and encoded in parallel via AudioEncoder.
async function _compressWebCodecs(file, onProgress, audioP = null) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true; video.playsInline = true;
    video.setAttribute('playsinline', '');

    video.onloadedmetadata = async () => {
      const dur = video.duration;
      if (!dur || !isFinite(dur)) { reject(new Error('Cannot read duration')); return; }

      const scale = Math.min(1, COMPRESS_MAX_H / video.videoHeight);
      const w = Math.round(video.videoWidth  * scale / 2) * 2;
      const h = Math.round(video.videoHeight * scale / 2) * 2;

      // ── Video codec: H.264 hardware > VP8 ────────────────────
      let useH264 = false;
      try {
        const s = await VideoEncoder.isConfigSupported({
          codec: 'avc1.42E01E', width: w, height: h,
          bitrate: COMPRESS_VIDEO_BPS, framerate: COMPRESS_FPS,
          hardwareAcceleration: 'prefer-hardware',
        });
        useH264 = !!s.supported;
      } catch(e) {}

      const vCfg = useH264
        ? { codec: 'avc1.42E01E', width: w, height: h, bitrate: COMPRESS_VIDEO_BPS,
            framerate: COMPRESS_FPS, hardwareAcceleration: 'prefer-hardware', avc: { format: 'avc' } }
        : { codec: 'vp8', width: w, height: h, bitrate: COMPRESS_VIDEO_BPS,
            framerate: COMPRESS_FPS, hardwareAcceleration: 'prefer-hardware' };

      const videoFrames = [];
      let vErr = null, avccConfig = null;
      const vEnc = new VideoEncoder({
        output: (chunk, meta) => {
          if (useH264 && chunk.type === 'key' && !avccConfig && meta?.decoderConfig?.description)
            avccConfig = meta.decoderConfig.description;
          const b = new ArrayBuffer(chunk.byteLength); chunk.copyTo(b);
          videoFrames.push({ timestampMs: Math.round(chunk.timestamp / 1000), keyframe: chunk.type === 'key', data: b });
        },
        error: e => { vErr = e; }
      });
      vEnc.configure(vCfg);

      // ── Audio: encode in parallel with AudioEncoder ───────────
      // If audioP is provided (shared promise from transcription extraction),
      // decode the small WAV (~5 MB) instead of re-reading the original video
      // file (~100–200 MB). Falls back to decoding the original file if needed.
      const aCODEC    = useH264 ? 'mp4a.40.2' : 'opus';
      const audioFrames = [];
      let ascConfig = null;

      const audioPromise = (async () => {
        try {
          // iOS-first path: when the output is MP4/AAC, copy (remux) the source's
          // AAC track verbatim — no decodeAudioData (fails on iOS), no re-encode.
          // This is what gives the compressed video (and the Groq transcript) audio
          // on iPhone. Falls through to decode+encode for webm output / non-AAC.
          if (useH264) {
            const remux = await _demuxAacFrames(file).catch(() => null);
            if (remux && remux.frames.length) {
              for (const fr of remux.frames) audioFrames.push(fr);
              audioFrames.sr = remux.sampleRate;
              audioFrames.ch = remux.channels;
              ascConfig = remux.asc || null;
              return;
            }
          }

          if (typeof AudioEncoder === 'undefined') return;

          // Decode from shared WAV (lazily started decode-based extraction)
          // or the original file. audioP is a thunk since v1.46 — the WAV
          // extraction only runs if this branch actually needs it.
          let decoded;
          if (audioP) {
            const wav = await audioP();
            if (!wav) return;
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            decoded = await ctx.decodeAudioData(await wav.arrayBuffer());
            ctx.close();
          } else {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            decoded = await ctx.decodeAudioData(await file.arrayBuffer());
            ctx.close();
          }

          // Use the audio's actual sample rate and channel count
          const AUDIO_SR = Math.round(decoded.sampleRate);
          const nCh      = decoded.numberOfChannels;
          const bitrate  = nCh === 1 ? 48000 : 96000;

          const as = await AudioEncoder.isConfigSupported({
            codec: aCODEC, sampleRate: AUDIO_SR, numberOfChannels: nCh, bitrate
          });
          if (!as.supported) return;

          const aEnc = new AudioEncoder({
            output: (chunk, meta) => {
              if (!ascConfig && meta?.decoderConfig?.description) ascConfig = meta.decoderConfig.description;
              const b = new ArrayBuffer(chunk.byteLength); chunk.copyTo(b);
              audioFrames.push({ timestampMs: Math.round(chunk.timestamp / 1000), data: b });
            },
            error: () => {}
          });
          aEnc.configure({ codec: aCODEC, sampleRate: AUDIO_SR, numberOfChannels: nCh, bitrate });

          // Tag frames with actual SR and channels so the muxer knows
          audioFrames.sr = AUDIO_SR;
          audioFrames.ch = nCh;

          // Feed PCM to AudioEncoder in 4096-frame chunks (f32-planar)
          const CHUNK = 4096, total = decoded.length;
          const chs = Array.from({ length: nCh }, (_, i) => decoded.getChannelData(i));
          for (let off = 0; off < total; off += CHUNK) {
            const len = Math.min(CHUNK, total - off);
            const tUs = Math.round(off / AUDIO_SR * 1_000_000);
            const pcm = new Float32Array(len * nCh);
            for (let c = 0; c < nCh; c++) pcm.set(chs[c].subarray(off, off + len), c * len);
            const ad = new AudioData({ format: 'f32-planar', sampleRate: AUDIO_SR,
              numberOfFrames: len, numberOfChannels: nCh, timestamp: tUs, data: pcm });
            aEnc.encode(ad); ad.close();
          }
          await aEnc.flush(); aEnc.close();
        } catch(e) {
          console.warn('Audio encoding failed, video will be silent:', e.message);
        }
      })();

      // ── Video: sped-up playback + frame capture ───────────────
      const ofc = new OffscreenCanvas(w, h);
      const ctx = ofc.getContext('2d', { alpha: false });
      let lastKeyT = -Infinity, ended = false;

      video.playbackRate = COMPRESS_PLAYBACK_RATE;
      video.play().catch(reject);

      const tick = async (_, meta) => {
        if (vErr) { reject(vErr); return; }
        if (vEnc.encodeQueueSize > 8) { video.requestVideoFrameCallback(tick); return; }
        ctx.drawImage(video, 0, 0, w, h);
        const tUs   = Math.round(meta.mediaTime * 1_000_000);
        const isKey = (meta.mediaTime - lastKeyT) >= 2;
        const frame = new VideoFrame(ofc, { timestamp: tUs });
        vEnc.encode(frame, { keyFrame: isKey });
        if (isKey) lastKeyT = meta.mediaTime;
        frame.close();
        onProgress?.(meta.mediaTime / dur);
        if (!ended) video.requestVideoFrameCallback(tick);
      };
      video.requestVideoFrameCallback(tick);

      video.onended = async () => {
        ended = true;
        try {
          await vEnc.flush(); vEnc.close();
          URL.revokeObjectURL(video.src);
          if (vErr) throw vErr;
          await audioPromise;  // wait for parallel audio encoding
          videoFrames.sort((a, b) => a.timestampMs - b.timestampMs);
          audioFrames.sort((a, b) => a.timestampMs - b.timestampMs);
          const durMs = Math.round(dur * 1000);
          if (useH264 && avccConfig) {
            const blob = _buildMP4(videoFrames, w, h, durMs, avccConfig, audioFrames, ascConfig);
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.mp4'), { type: 'video/mp4' }));
          } else {
            const blob = _buildWebM(videoFrames, w, h, durMs, audioFrames);
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.webm'), { type: 'video/webm' }));
          }
        } catch(e) { reject(e); }
      };
      video.onerror = () => reject(new Error('Video playback error'));
    };
    video.onerror = () => reject(new Error('Cannot open video'));
  });
}

// ── WEBM MUXER (VP8 video + optional Opus audio) ─────────────
function _buildWebM(frames, width, height, durationMs, audioFrames = []) {
  const toU8 = a => a instanceof Uint8Array ? a : ArrayBuffer.isView(a) ? new Uint8Array(a.buffer,a.byteOffset,a.byteLength) : new Uint8Array(a);
  const cat  = (...aa) => { const p=aa.map(toU8); const o=new Uint8Array(p.reduce((s,a)=>s+a.byteLength,0)); let x=0; for(const a of p){o.set(a,x);x+=a.byteLength;} return o; };
  const vi   = n => n<0x7F?new Uint8Array([0x80|n]):n<0x3FFF?new Uint8Array([0x40|(n>>8),n&0xFF]):n<0x1FFFFF?new Uint8Array([0x20|(n>>16),(n>>8)&0xFF,n&0xFF]):new Uint8Array([0x10|(n>>>24),(n>>16)&0xFF,(n>>8)&0xFF,n&0xFF]);
  const eid  = n => n<=0xFF?new Uint8Array([n]):n<=0xFFFF?new Uint8Array([n>>8,n&0xFF]):n<=0xFFFFFF?new Uint8Array([(n>>16),(n>>8)&0xFF,n&0xFF]):new Uint8Array([n>>>24,(n>>16)&0xFF,(n>>8)&0xFF,n&0xFF]);
  const el   = (id,d) => { const b=d instanceof Uint8Array?d:cat(...d); return cat(eid(id),vi(b.byteLength),b); };
  const u    = (n,bytes) => { const r=new Uint8Array(bytes); for(let i=bytes-1;i>=0;i--){r[i]=n&0xFF;n=Math.floor(n/256);} return r; };
  const f64  = n => { const b=new ArrayBuffer(8); new DataView(b).setFloat64(0,n,false); return new Uint8Array(b); };
  const str  = s => new TextEncoder().encode(s);
  const le   = (n,bytes) => { const r=new Uint8Array(bytes); for(let i=0;i<bytes;i++){r[i]=n&0xFF;n=Math.floor(n/256);} return r; };

  const ebml = el(0x1A45DFA3,[el(0x4286,u(1,1)),el(0x42F7,u(1,1)),el(0x42F2,u(4,1)),el(0x42F3,u(8,1)),el(0x4282,str('webm')),el(0x4287,u(4,1)),el(0x4285,u(2,1))]);
  const inf  = el(0x1549A966,[el(0x2AD7B1,u(1000000,4)),el(0x4489,f64(durationMs)),el(0x4D80,str('Brain+')),el(0x5741,str('Brain+'))]);

  const vTrack = el(0xAE,[el(0xD7,u(1,1)),el(0x73C5,u(1,8)),el(0x83,u(1,1)),el(0x86,str('V_VP8')),el(0xE0,[el(0xB0,u(width,2)),el(0xBA,u(height,2))])]);
  let trkEl;
  if (audioFrames.length > 0) {
    // OpusHead required as CodecPrivate for A_OPUS track (all fields little-endian)
    const aSR = audioFrames.sr || 48000, aCH = audioFrames.ch || 2;
    const opusHead = cat(str('OpusHead'), new Uint8Array([1,aCH]), le(312,2), le(aSR,4), le(0,2), new Uint8Array([0]));
    const aTrack = el(0xAE,[el(0xD7,u(2,1)),el(0x73C5,u(2,8)),el(0x83,u(2,1)),el(0x86,str('A_OPUS')),el(0x63A2,opusHead),el(0xE1,[el(0xB5,f64(aSR)),el(0x9F,u(aCH,1))])]);
    trkEl = el(0x1654AE6B,[vTrack, aTrack]);
  } else {
    trkEl = el(0x1654AE6B,[vTrack]);
  }

  // Merge video + audio by timestamp; new cluster on every video keyframe
  const all = [
    ...frames.map(f => ({ track:1, timestampMs:f.timestampMs, keyframe:f.keyframe, data:f.data })),
    ...audioFrames.map(f => ({ track:2, timestampMs:f.timestampMs, keyframe:false, data:f.data }))
  ].sort((a,b) => a.timestampMs - b.timestampMs);

  const clusterEls = []; let cf=[], clusterT=-1;
  const flush = () => {
    if (!cf.length) return;
    const t0 = clusterT;
    clusterEls.push(el(0x1F43B675,[el(0xE7,u(t0,4)),...cf.map(b => {
      const rel = b.timestampMs - t0;
      return el(0xA3, cat(new Uint8Array([b.track===2?0x82:0x81,(rel>>8)&0xFF,rel&0xFF,(b.track===1&&b.keyframe)?0x80:0x00]), toU8(b.data)));
    })]));
    cf = [];
  };
  for (const b of all) {
    if (b.track===1 && b.keyframe && (clusterT<0 || b.timestampMs-clusterT>=2000)) { flush(); clusterT=b.timestampMs; }
    else if (clusterT<0) clusterT=b.timestampMs;
    cf.push(b);
  }
  flush();

  return new Blob([ebml, new Uint8Array([0x18,0x53,0x80,0x67,0x01,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF]), cat(inf,trkEl,...clusterEls)], {type:'video/webm'});
}

// ── FRAGMENTED MP4 MUXER (H.264/AVCC + optional AAC audio) ───
function _buildMP4(frames, width, height, durationMs, avccBuf, audioFrames = [], ascConfig = null) {
  const toU8 = a => a instanceof Uint8Array ? a : ArrayBuffer.isView(a) ? new Uint8Array(a.buffer,a.byteOffset,a.byteLength) : new Uint8Array(a);
  const cat  = (...aa) => { const p=aa.map(toU8); const o=new Uint8Array(p.reduce((s,a)=>s+a.byteLength,0)); let x=0; for(const a of p){o.set(a,x);x+=a.byteLength;} return o; };
  const u8   = n => new Uint8Array([n&0xFF]);
  const u16  = n => new Uint8Array([(n>>8)&0xFF, n&0xFF]);
  const u24  = n => new Uint8Array([(n>>16)&0xFF, (n>>8)&0xFF, n&0xFF]);
  const u32  = n => { const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,n>>>0,false); return b; };
  const i32  = n => { const b=new Uint8Array(4); new DataView(b.buffer).setInt32(0,n,false); return b; };
  const str  = s => new TextEncoder().encode(s);
  const box  = (t,...d) => { const data=cat(...d); return cat(u32(data.byteLength+8),str(t),data); };
  const fbox = (t,v,f,...d) => box(t,u8(v),u24(f),...d);
  const dLen = n => n<128 ? new Uint8Array([n]) : new Uint8Array([0x80|(n>>7),n&0x7F]);
  const desc = (tag,...parts) => { const d=cat(...parts); return cat(new Uint8Array([tag]),dLen(d.byteLength),d); };

  const TS  = 90000;   // video/movie timescale
  const ATS = audioFrames.sr || 44100;  // audio timescale = actual sample rate
  const ACH = audioFrames.ch || 2;
  const totTick  = Math.round(durationMs * TS  / 1000);
  const totATick = Math.round(durationMs * ATS / 1000);
  const fpsTick  = Math.round(TS / COMPRESS_FPS);
  const hasAudio = audioFrames.length > 0;

  const vDurs = frames.map((f,i) =>
    i < frames.length-1 ? Math.max(1, Math.round((frames[i+1].timestampMs - f.timestampMs) * TS / 1000)) : fpsTick
  );
  const mat = cat(u32(0x00010000),u32(0),u32(0), u32(0),u32(0x00010000),u32(0), u32(0),u32(0),u32(0x40000000));

  // ── Video track ──────────────────────────────────────────────
  const ftyp = box('ftyp', str('isom'),u32(0x200), str('isom'),str('iso2'),str('avc1'),str('mp41'));
  const mvhd = fbox('mvhd',0,0, u32(0),u32(0), u32(TS),u32(totTick),
    u32(0x00010000),u16(0x0100),new Uint8Array(10), mat, new Uint8Array(24), u32(hasAudio?3:2));
  const vTkhd = fbox('tkhd',0,3, u32(0),u32(0),u32(1),u32(0),u32(totTick),
    new Uint8Array(8),u16(0),u16(0),u16(0),u16(0), mat, u32(width<<16),u32(height<<16));
  const vMdhd = fbox('mdhd',0,0, u32(0),u32(0),u32(TS),u32(totTick),u16(0x55C4),u16(0));
  const vHdlr = fbox('hdlr',0,0, u32(0),str('vide'),new Uint8Array(12),str('VideoHandler'),u8(0));
  const avc1  = box('avc1', new Uint8Array(6),u16(1),new Uint8Array(16),
    u16(width),u16(height),u32(0x00480000),u32(0x00480000),
    u32(0),u16(1),new Uint8Array(32),u16(0x0018),u16(0xFFFF), box('avcC',toU8(avccBuf)));
  const vStbl = box('stbl', fbox('stsd',0,0,u32(1),avc1),
    fbox('stts',0,0,u32(0)),fbox('stsc',0,0,u32(0)),fbox('stsz',0,0,u32(0),u32(0)),fbox('stco',0,0,u32(0)));
  const vTrak = box('trak', vTkhd,
    box('mdia', vMdhd, vHdlr, box('minf', fbox('vmhd',0,1,u16(0),new Uint8Array(6)),
      box('dinf',fbox('dref',0,0,u32(1),fbox('url ',0,1))), vStbl)));

  // ── Audio track (AAC-LC) ─────────────────────────────────────
  let aTrak = null;
  if (hasAudio) {
    // Build AudioSpecificConfig for the actual SR/channels
    const aFreqTable = [96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350];
    const aFreqIdx = aFreqTable.indexOf(ATS);
    const ascWord  = (2 << 11) | (aFreqIdx << 7) | (ACH << 3);
    const asc = (ascConfig && toU8(ascConfig).byteLength)
      ? toU8(ascConfig)
      : aFreqIdx >= 0 ? new Uint8Array([(ascWord>>8)&0xFF, ascWord&0xFF])
      : new Uint8Array([0x12,0x10]); // fallback 44100 Hz stereo
    const aBitrate = ACH === 1 ? 48000 : 96000;
    const esds = fbox('esds',0,0,
      desc(0x03, u16(1),new Uint8Array([0x00]),
        desc(0x04, new Uint8Array([0x40,0x15,0,0,0]), u32(aBitrate),u32(aBitrate), desc(0x05,asc)),
        desc(0x06, new Uint8Array([0x02]))));
    const mp4a = box('mp4a', new Uint8Array(6),u16(1),new Uint8Array(8),
      u16(ACH),u16(16),u16(0),u16(0), u32(ATS<<16), esds);
    const aTkhd = fbox('tkhd',0,3, u32(0),u32(0),u32(2),u32(0),u32(totTick),
      new Uint8Array(8),u16(0),u16(0),u16(0x0100),u16(0), mat, u32(0),u32(0));
    const aStbl = box('stbl', fbox('stsd',0,0,u32(1),mp4a),
      fbox('stts',0,0,u32(0)),fbox('stsc',0,0,u32(0)),fbox('stsz',0,0,u32(0),u32(0)),fbox('stco',0,0,u32(0)));
    aTrak = box('trak', aTkhd,
      box('mdia', fbox('mdhd',0,0,u32(0),u32(0),u32(ATS),u32(totATick),u16(0x55C4),u16(0)),
        fbox('hdlr',0,0,u32(0),str('soun'),new Uint8Array(12),str('SoundHandler'),u8(0)),
        box('minf', fbox('smhd',0,0,u16(0),u16(0)),
          box('dinf',fbox('dref',0,0,u32(1),fbox('url ',0,1))), aStbl)));
  }

  const mvex = hasAudio
    ? box('mvex', fbox('trex',0,0,u32(1),u32(1),u32(0),u32(0),u32(0)), fbox('trex',0,0,u32(2),u32(1),u32(0),u32(0),u32(0)))
    : box('mvex', fbox('trex',0,0,u32(1),u32(1),u32(0),u32(0),u32(0)));
  const moov = hasAudio ? box('moov',mvhd,vTrak,aTrak,mvex) : box('moov',mvhd,vTrak,mvex);

  // ── Fragments: one moof+mdat per video keyframe group ────────
  const parts = [ftyp, moov];
  const VFL = 0x0701; // data-offset + duration + size + flags
  const AFL = 0x0301; // data-offset + duration + size
  let seq=1, fi=0, ai=0;

  while (fi < frames.length) {
    const vStart=fi++;
    while (fi < frames.length && !frames[fi].keyframe) fi++;
    const grp = frames.slice(vStart, fi);
    const fragEndMs = fi < frames.length ? frames[fi].timestampMs : Infinity;

    const vBaseT  = Math.round(grp[0].timestampMs * TS / 1000);
    const vSamples = cat(...grp.map((f,j) => cat(u32(vDurs[vStart+j]),u32(f.data.byteLength),u32(f.keyframe?0x02000000:0x01010000))));
    const vTotalSz = grp.reduce((s,f)=>s+f.data.byteLength,0);

    // Audio frames for this fragment's time range
    const aStart = ai;
    while (ai < audioFrames.length && audioFrames[ai].timestampMs < fragEndMs) ai++;
    const aGrp = audioFrames.slice(aStart, ai);
    const aBaseT   = aGrp.length>0 ? Math.round(aGrp[0].timestampMs * ATS / 1000) : 0;
    const aSamples = aGrp.length>0 ? cat(...aGrp.map((f,j) => cat(
      u32(j<aGrp.length-1 ? Math.max(1,Math.round((aGrp[j+1].timestampMs-f.timestampMs)*ATS/1000)) : 1024),
      u32(f.data.byteLength)
    ))) : null;

    const buildMoof = (vOff, aOff) => {
      const vTrun = fbox('trun',0,VFL, u32(grp.length),i32(vOff),vSamples);
      const vTraf = box('traf', fbox('tfhd',0,0x020000,u32(1)), fbox('tfdt',0,0,u32(vBaseT)), vTrun);
      if (aGrp.length>0) {
        const aTrun = fbox('trun',0,AFL, u32(aGrp.length),i32(aOff),aSamples);
        const aTraf = box('traf', fbox('tfhd',0,0x020000,u32(2)), fbox('tfdt',0,0,u32(aBaseT)), aTrun);
        return box('moof', fbox('mfhd',0,0,u32(seq)), vTraf, aTraf);
      }
      return box('moof', fbox('mfhd',0,0,u32(seq)), vTraf);
    };
    const dummy = buildMoof(0,0);
    const vOff  = dummy.byteLength + 8;   // +8 = mdat size+type header
    const aOff  = vOff + vTotalSz;
    const moof  = buildMoof(vOff, aOff);
    seq++;

    parts.push(moof, box('mdat', cat(...grp.map(f=>toU8(f.data)), ...aGrp.map(f=>toU8(f.data)))));
  }

  return new Blob(parts, { type: 'video/mp4' });
}

// ── FALLBACK: canvas + MediaRecorder (real-time, with audio) ──
async function _compressCanvas(file, onProgress) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true; video.playsInline = true;
    video.setAttribute('playsinline', '');

    video.onloadedmetadata = () => {
      const dur = video.duration;
      if (!dur || !isFinite(dur)) { reject(new Error('Cannot read video duration')); return; }

      const scale = Math.min(1, COMPRESS_MAX_H / video.videoHeight);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(video.videoWidth  * scale / 2) * 2;
      canvas.height = Math.round(video.videoHeight * scale / 2) * 2;
      const ctx = canvas.getContext('2d', { alpha: false });

      let mime = 'video/webm';
      for (const m of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1','video/webm;codecs=vp8,opus','video/webm;codecs=vp8','video/webm']) {
        if (MediaRecorder.isTypeSupported(m)) { mime = m; break; }
      }

      const canvasStream = canvas.captureStream(COMPRESS_FPS);
      const srcStream = video.captureStream?.() || video.mozCaptureStream?.();
      srcStream?.getAudioTracks().forEach(t => canvasStream.addTrack(t));

      const recorder = new MediaRecorder(canvasStream, { mimeType: mime, videoBitsPerSecond: COMPRESS_VIDEO_BPS, audioBitsPerSecond: COMPRESS_AUDIO_BPS });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        canvasStream.getTracks().forEach(t => t.stop());
        URL.revokeObjectURL(video.src);
        const type = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
        const ext  = mime.startsWith('video/mp4') ? '.mp4' : '.webm';
        resolve(new File(chunks, file.name.replace(/\.[^.]+$/, ext), { type }));
      };

      const draw = () => ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      recorder.start(500);
      video.currentTime = 0;
      video.play().catch(reject);

      if ('requestVideoFrameCallback' in video) {
        const tick = (_, meta) => { draw(); onProgress?.(meta.mediaTime / dur); if (!video.ended) video.requestVideoFrameCallback(tick); };
        video.requestVideoFrameCallback(tick);
      } else {
        let raf;
        const tick = () => { draw(); onProgress?.(video.currentTime / dur); raf = requestAnimationFrame(tick); };
        video.onplay = () => { cancelAnimationFrame(raf); tick(); };
        video.onpause = () => cancelAnimationFrame(raf);
      }
      video.onended = () => { draw(); recorder.stop(); };
      video.onerror = () => reject(new Error('Video load error during compression'));
    };
    video.onerror = () => reject(new Error('Cannot open video file'));
  });
}

