/**
 * generate-sounds.js
 *
 * Synthesizes all 18 WAV sound files for TypeClack's three switch packs.
 * Run once with: node generate-sounds.js
 *
 * Each sound is built from layered oscillators + noise that model the
 * physical acoustics of real mechanical switch actuation.
 */

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;

// ─── WAV encoding ────────────────────────────────────────────

function f32ToInt16(f) {
  const s = Math.max(-1, Math.min(1, f));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}

function encodeWAV(samples) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);           // PCM chunk
  buf.writeUInt16LE(1, 20);            // PCM format
  buf.writeUInt16LE(1, 22);            // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byteRate
  buf.writeUInt16LE(2, 32);            // blockAlign
  buf.writeUInt16LE(16, 34);           // bitsPerSample
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(f32ToInt16(samples[i]), 44 + i * 2);
  }
  return buf;
}

// ─── Low-pass filter ─────────────────────────────────────────

function lowPass(samples, cutoff) {
  const k = 1 - cutoff;
  const out = new Float64Array(samples.length);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev = prev * k + samples[i] * (1 - k);
    out[i] = prev;
  }
  return out;
}

// ─── Synthesis core ──────────────────────────────────────────

function synth(p) {
  const n = Math.ceil(p.duration * SAMPLE_RATE);
  const raw = new Float64Array(n);

  const clickN  = Math.ceil(p.clickDur  * SAMPLE_RATE);
  const noiseN  = Math.ceil(p.noiseDur  * SAMPLE_RATE);
  const noise2N = Math.ceil(p.noise2Dur * SAMPLE_RATE);

  // Pre-generate noise tables
  const noise1 = Float64Array.from({ length: noiseN }, () => Math.random() * 2 - 1);
  const noise2 = Float64Array.from({ length: noise2N }, () => Math.random() * 2 - 1);

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;

    // 1. Click transient (sharp sine burst)
    if (i < clickN) {
      const env = Math.pow(1 - i / clickN, 1.4);
      s += Math.sin(2 * Math.PI * p.clickFreq * t) * env * p.clickAmp;
    }

    // 2. Attack noise (broadband "clack")
    if (i < noiseN) {
      const env = Math.exp(-i / noiseN * 7);
      s += noise1[i] * env * p.noiseAmp;
    }

    // 3. Secondary noise (bottom-out thud)
    if (i < noise2N) {
      const env = Math.exp(-i / noise2N * 9);
      s += noise2[i] * env * p.noise2Amp;
    }

    // 4. Body resonance (key cap / switch housing)
    s += Math.sin(2 * Math.PI * p.bodyFreq * t)
       * Math.exp(-t * p.bodyDecay) * p.bodyAmp;

    // 5. PCB / plate resonance (lower harmonic)
    s += Math.sin(2 * Math.PI * p.plateFreq * t)
       * Math.exp(-t * p.plateDecay) * p.plateAmp;

    // 6. Spring ping (very high frequency, very fast decay)
    if (p.springFreq > 0) {
      s += Math.sin(2 * Math.PI * p.springFreq * t)
         * Math.exp(-t * p.springDecay) * p.springAmp;
    }

    raw[i] = s;
  }

  // Filter and normalize
  const filt = lowPass(raw, p.lpCutoff);
  let peak = 0;
  for (const v of filt) { if (Math.abs(v) > peak) { peak = Math.abs(v); } }
  if (peak > 0) {
    for (let i = 0; i < filt.length; i++) { filt[i] = filt[i] / peak * 0.92; }
  }

  return filt;
}

// ─── Switch profiles ─────────────────────────────────────────

/**
 * Each profile defines base parameters; key variants get a tiny
 * pitch/amplitude jitter so key1/key2/key3 all sound slightly different.
 */
const PROFILES = {
  blue: {
    // MX Blue: hard click transient, crisp, high-pitched
    base: {
      duration: 0.13,
      clickFreq: 6800, clickDur: 0.006, clickAmp: 1.0,
      noiseAmp: 0.55,  noiseDur: 0.018,
      noise2Amp: 0.30, noise2Dur: 0.010,
      bodyFreq: 2900,  bodyDecay: 60,  bodyAmp: 0.40,
      plateFreq: 1450, plateDecay: 45, plateAmp: 0.20,
      springFreq: 8200, springDecay: 180, springAmp: 0.18,
      lpCutoff: 0.72,
    },
    enter: {
      duration: 0.19,
      clickFreq: 4500, clickDur: 0.009, clickAmp: 1.0,
      noiseAmp: 0.65,  noiseDur: 0.026,
      noise2Amp: 0.40, noise2Dur: 0.015,
      bodyFreq: 1900,  bodyDecay: 38,  bodyAmp: 0.55,
      plateFreq: 950,  plateDecay: 28, plateAmp: 0.30,
      springFreq: 6000, springDecay: 140, springAmp: 0.14,
      lpCutoff: 0.60,
    },
    backspace: {
      duration: 0.11,
      clickFreq: 7400, clickDur: 0.005, clickAmp: 0.88,
      noiseAmp: 0.48,  noiseDur: 0.014,
      noise2Amp: 0.25, noise2Dur: 0.008,
      bodyFreq: 3200,  bodyDecay: 68,  bodyAmp: 0.35,
      plateFreq: 1600, plateDecay: 52, plateAmp: 0.18,
      springFreq: 9000, springDecay: 200, springAmp: 0.16,
      lpCutoff: 0.78,
    },
    space: {
      duration: 0.22,
      clickFreq: 3400, clickDur: 0.011, clickAmp: 0.95,
      noiseAmp: 0.70,  noiseDur: 0.034,
      noise2Amp: 0.50, noise2Dur: 0.020,
      bodyFreq: 1400,  bodyDecay: 28,  bodyAmp: 0.65,
      plateFreq: 700,  plateDecay: 20, plateAmp: 0.38,
      springFreq: 4500, springDecay: 110, springAmp: 0.12,
      lpCutoff: 0.50,
    },
  },

  brown: {
    // MX Brown: softer click, more "thock", less spring ping
    base: {
      duration: 0.11,
      clickFreq: 5200, clickDur: 0.005, clickAmp: 0.70,
      noiseAmp: 0.62,  noiseDur: 0.020,
      noise2Amp: 0.38, noise2Dur: 0.012,
      bodyFreq: 2400,  bodyDecay: 50,  bodyAmp: 0.48,
      plateFreq: 1200, plateDecay: 38, plateAmp: 0.24,
      springFreq: 6500, springDecay: 160, springAmp: 0.08,
      lpCutoff: 0.62,
    },
    enter: {
      duration: 0.17,
      clickFreq: 3600, clickDur: 0.008, clickAmp: 0.74,
      noiseAmp: 0.68,  noiseDur: 0.028,
      noise2Amp: 0.45, noise2Dur: 0.016,
      bodyFreq: 1700,  bodyDecay: 32,  bodyAmp: 0.60,
      plateFreq: 850,  plateDecay: 24, plateAmp: 0.32,
      springFreq: 4800, springDecay: 130, springAmp: 0.06,
      lpCutoff: 0.52,
    },
    backspace: {
      duration: 0.10,
      clickFreq: 5800, clickDur: 0.004, clickAmp: 0.65,
      noiseAmp: 0.55,  noiseDur: 0.015,
      noise2Amp: 0.30, noise2Dur: 0.009,
      bodyFreq: 2700,  bodyDecay: 58,  bodyAmp: 0.42,
      plateFreq: 1350, plateDecay: 44, plateAmp: 0.20,
      springFreq: 7200, springDecay: 180, springAmp: 0.07,
      lpCutoff: 0.68,
    },
    space: {
      duration: 0.20,
      clickFreq: 2800, clickDur: 0.010, clickAmp: 0.78,
      noiseAmp: 0.72,  noiseDur: 0.036,
      noise2Amp: 0.52, noise2Dur: 0.022,
      bodyFreq: 1200,  bodyDecay: 24,  bodyAmp: 0.68,
      plateFreq: 600,  plateDecay: 18, plateAmp: 0.40,
      springFreq: 3800, springDecay: 100, springAmp: 0.05,
      lpCutoff: 0.44,
    },
  },

  red: {
    // MX Red: no click, linear, very "thocky" and quiet
    base: {
      duration: 0.09,
      clickFreq: 3800, clickDur: 0.003, clickAmp: 0.35,
      noiseAmp: 0.68,  noiseDur: 0.022,
      noise2Amp: 0.45, noise2Dur: 0.013,
      bodyFreq: 2000,  bodyDecay: 44,  bodyAmp: 0.55,
      plateFreq: 1000, plateDecay: 34, plateAmp: 0.28,
      springFreq: 0,   springDecay: 0, springAmp: 0,
      lpCutoff: 0.52,
    },
    enter: {
      duration: 0.15,
      clickFreq: 2600, clickDur: 0.005, clickAmp: 0.38,
      noiseAmp: 0.72,  noiseDur: 0.030,
      noise2Amp: 0.50, noise2Dur: 0.018,
      bodyFreq: 1500,  bodyDecay: 29,  bodyAmp: 0.62,
      plateFreq: 750,  plateDecay: 22, plateAmp: 0.34,
      springFreq: 0,   springDecay: 0, springAmp: 0,
      lpCutoff: 0.44,
    },
    backspace: {
      duration: 0.08,
      clickFreq: 4200, clickDur: 0.003, clickAmp: 0.32,
      noiseAmp: 0.60,  noiseDur: 0.016,
      noise2Amp: 0.38, noise2Dur: 0.010,
      bodyFreq: 2200,  bodyDecay: 50,  bodyAmp: 0.48,
      plateFreq: 1100, plateDecay: 38, plateAmp: 0.24,
      springFreq: 0,   springDecay: 0, springAmp: 0,
      lpCutoff: 0.56,
    },
    space: {
      duration: 0.18,
      clickFreq: 2000, clickDur: 0.007, clickAmp: 0.40,
      noiseAmp: 0.75,  noiseDur: 0.038,
      noise2Amp: 0.55, noise2Dur: 0.024,
      bodyFreq: 1100,  bodyDecay: 22,  bodyAmp: 0.70,
      plateFreq: 550,  plateDecay: 17, plateAmp: 0.42,
      springFreq: 0,   springDecay: 0, springAmp: 0,
      lpCutoff: 0.38,
    },
  },
};

// ─── Jitter helpers ──────────────────────────────────────────

/** Returns p with all freq/amp values slightly randomised */
function jitter(p, seed) {
  // Deterministic-ish variation per variant index
  const rng = (x) => ((Math.sin(seed * 9301 + x * 49297) + 1) / 2);
  return {
    ...p,
    clickFreq:  p.clickFreq  * (0.95 + rng(1) * 0.10),
    clickAmp:   p.clickAmp   * (0.92 + rng(2) * 0.16),
    noiseAmp:   p.noiseAmp   * (0.92 + rng(3) * 0.16),
    bodyFreq:   p.bodyFreq   * (0.96 + rng(4) * 0.08),
    bodyAmp:    p.bodyAmp    * (0.94 + rng(5) * 0.12),
    plateFreq:  p.plateFreq  * (0.95 + rng(6) * 0.10),
    springFreq: p.springFreq * (0.94 + rng(7) * 0.12),
  };
}

// ─── Generate all files ──────────────────────────────────────

const MEDIA = path.join(__dirname, 'media');

let total = 0;
for (const [packName, pack] of Object.entries(PROFILES)) {
  const dir = path.join(MEDIA, packName);

  // key1.wav, key2.wav, key3.wav — each with a unique jitter seed
  for (let v = 1; v <= 3; v++) {
    const params = jitter(pack.base, v);
    const wav = encodeWAV(synth(params));
    const fp = path.join(dir, `key${v}.wav`);
    fs.writeFileSync(fp, wav);
    console.log(`✓ ${packName}/key${v}.wav  (${wav.length} bytes)`);
    total++;
  }

  // enter, backspace, space — single canonical file each
  for (const [name, params] of [
    ['enter',     pack.enter],
    ['backspace', pack.backspace],
    ['space',     pack.space],
  ]) {
    const wav = encodeWAV(synth(params));
    const fp = path.join(dir, `${name}.wav`);
    fs.writeFileSync(fp, wav);
    console.log(`✓ ${packName}/${name}.wav  (${wav.length} bytes)`);
    total++;
  }
}

console.log(`\n✓ Done — ${total} WAV files synthesized`);
