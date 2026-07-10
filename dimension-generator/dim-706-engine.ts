/**
 * Synthesis engine for dimension 706's music — pure-TypeScript PCM rendering shared by the
 * combat track and the adaptive stem set. Everything is seeded and deterministic; note tails
 * wrap-add past the buffer end back to the head, and the delay/reverb run two circular passes
 * so effect state is continuous across the loop seam.
 */

export const SR = 44100;

export interface Bus {
  L: Float64Array;
  R: Float64Array;
}

export interface EngineConfig {
  seed: number;
  bpm: number;
  bars: number;
}

export function createEngine(cfg: EngineConfig) {
  const BPM = cfg.bpm;
  const BEAT = 60 / BPM;
  const BAR = 4 * BEAT;
  const BARS = cfg.bars;
  const TOTAL = Math.round(BARS * BAR * SR);

  const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
  const cents = (c: number): number => Math.pow(2, c / 1200);

  // Deterministic RNG (mulberry32) so every render is identical.
  let rngState = cfg.seed;
  function rng(): number {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const bus = (): Bus => ({ L: new Float64Array(TOTAL), R: new Float64Array(TOTAL) });

  /** Wrap-add a mono note into a bus: tails past the end land at the head (seamless loop). */
  function put(b: Bus, tSec: number, mono: Float64Array, pan: number, gain: number): void {
    const start = Math.round(tSec * SR);
    const a = ((pan + 1) * Math.PI) / 4;
    const gl = Math.cos(a) * gain;
    const gr = Math.sin(a) * gain;
    for (let i = 0; i < mono.length; i++) {
      const idx = (start + i) % TOTAL;
      b.L[idx]! += mono[i]! * gl;
      b.R[idx]! += mono[i]! * gr;
    }
  }

  const secAt = (barIdx: number, beat: number): number => barIdx * BAR + beat * BEAT;

  // ---------------------------------------------------------- percussion ----

  function taiko(b: Bus, t: number, vel: number, pitch = 1): void {
    const n = Math.round(0.4 * SR);
    const out = new Float64Array(n);
    let phase = 0;
    let hpLast = 0;
    let lpBody = 0;
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      const f = (52 + 98 * Math.exp(-dt / 0.045)) * pitch;
      phase += (2 * Math.PI * f) / SR;
      const amp = Math.exp(-dt / 0.16) * Math.min(1, i / (0.002 * SR));
      const body = Math.sin(phase) * amp;
      const nz = rng() * 2 - 1;
      const click = (nz - hpLast) * Math.exp(-dt / 0.004) * 0.5;
      hpLast = nz * 0.95;
      lpBody += 0.055 * (nz - lpBody); // ~400Hz skin noise
      const skin = lpBody * Math.exp(-dt / 0.05) * 1.2;
      out[i] = Math.tanh(1.6 * (body + click + skin)) * vel;
    }
    put(b, t, out, 0, 0.95);
  }

  function logDrum(b: Bus, t: number, midi: number, vel: number): void {
    const n = Math.round(0.28 * SR);
    const out = new Float64Array(n);
    const f = mtof(midi);
    let p1 = 0;
    let p2 = 0;
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      const bend = 1 + 0.35 * Math.exp(-dt / 0.015);
      p1 += (2 * Math.PI * f * bend) / SR;
      p2 += (2 * Math.PI * f * 2.76) / SR;
      const amp = Math.exp(-dt / 0.07) * Math.min(1, i / (0.0015 * SR));
      const tick = (rng() * 2 - 1) * Math.exp(-dt / 0.002) * 0.4;
      out[i] = (Math.sin(p1) * amp + Math.sin(p2) * Math.exp(-dt / 0.02) * 0.4 + tick) * vel;
    }
    put(b, t, out, ((midi - 49) / 8) * 0.6 - 0.1, 0.7);
  }

  function conga(b: Bus, t: number, vel: number, slap: boolean): void {
    const n = Math.round(0.16 * SR);
    const out = new Float64Array(n);
    const f = slap ? 230 : 185;
    let phase = 0;
    let hp = 0;
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      phase += (2 * Math.PI * f * (1 + 0.15 * Math.exp(-dt / 0.01))) / SR;
      const nz = rng() * 2 - 1;
      hp += 0.18 * (nz - hp);
      const smack = (nz - hp) * Math.exp(-dt / 0.008) * (slap ? 0.9 : 0.45);
      out[i] = (Math.sin(phase) * Math.exp(-dt / 0.045) + smack) * vel;
    }
    put(b, t, out, 0.28, 0.55);
  }

  function shaker(b: Bus, t: number, vel: number): void {
    const n = Math.round(0.09 * SR);
    const out = new Float64Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      const nz = rng() * 2 - 1;
      lp += 0.55 * (nz - lp); // keep only the top
      const env = Math.min(1, i / (0.004 * SR)) * Math.exp(-dt / 0.025);
      out[i] = (nz - lp) * env;
    }
    put(b, t, out, -0.35, 0.23 * vel);
  }

  function gong(b: Bus, t: number, vel: number, base = 73.4): void {
    const n = Math.round(3.5 * SR);
    const out = new Float64Array(n);
    const ratios = [1, 1.48, 2.05, 2.74, 3.52, 4.4];
    const phases = ratios.map(() => rng() * 6.28);
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      let s = 0;
      for (let k = 0; k < ratios.length; k++) {
        const wob = 1 + 0.004 * Math.sin(2 * Math.PI * 0.7 * dt + k);
        s += (Math.sin(2 * Math.PI * base * ratios[k]! * wob * dt + phases[k]!) * Math.exp(-dt / (1.8 / Math.pow(k + 1, 0.7)))) / (k + 1);
      }
      const strike = (rng() * 2 - 1) * Math.exp(-dt / 0.01) * 0.5;
      out[i] = (s + strike) * Math.min(1, i / (0.001 * SR)) * vel;
    }
    put(b, t, out, 0, 0.35);
  }

  /** Bandpassed-noise sweep rising over `durBeats`, hard stop at the downbeat it targets. */
  function riser(b: Bus, t: number, durBeats: number, vel: number): void {
    const n = Math.round(durBeats * BEAT * SR);
    const out = new Float64Array(n);
    let lpS = 0;
    let bpS = 0;
    for (let i = 0; i < n; i++) {
      const x01 = i / n;
      const fc = 250 * Math.pow(5500 / 250, x01);
      const f = 2 * Math.sin((Math.PI * fc) / SR);
      const nz = rng() * 2 - 1;
      lpS += f * bpS;
      const hpS = nz - lpS - 0.35 * bpS;
      bpS += f * hpS;
      const env = x01 * x01 * Math.min(1, (n - i) / (0.01 * SR));
      out[i] = bpS * env;
    }
    put(b, t, out, 0, 0.4 * vel);
  }

  // -------------------------------------------------------------- pitched ----

  function bass(b: Bus, t: number, durBeats: number, midi: number, vel: number): void {
    const dur = durBeats * BEAT;
    const n = Math.round((dur + 0.03) * SR);
    const out = new Float64Array(n);
    const f = mtof(midi);
    let phase = 0;
    let sawP = 0;
    let lp = 0;
    const alpha = 1 - Math.exp((-2 * Math.PI * 350) / SR);
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      phase += (2 * Math.PI * f) / SR;
      sawP += f / SR;
      const saw = 2 * (sawP - Math.floor(sawP + 0.5));
      lp += alpha * (saw - lp);
      const env = Math.min(1, i / (0.003 * SR)) * (dt < dur ? 1 : Math.max(0, 1 - (dt - dur) / 0.025));
      out[i] = Math.tanh(1.3 * (Math.sin(phase) + lp * 0.4)) * env * vel;
    }
    put(b, t, out, 0, 0.62);
  }

  /** Marcato detuned-saw string stab — the driving 8th-note chug. Stereo via alternating pans. */
  function chug(b: Bus, t: number, midi: number, vel: number, durSec = 0.17): void {
    const dets = [-9, -4, 0, 5, 10];
    const f0 = mtof(midi);
    const n = Math.round((durSec + 0.05) * SR);
    const cutoff = 900 + vel * 1100;
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    for (let k = 0; k < dets.length; k++) {
      const out = new Float64Array(n);
      const f = f0 * cents(dets[k]!);
      let sawP = rng();
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const dt = i / SR;
        sawP += f / SR;
        const saw = 2 * (sawP - Math.floor(sawP + 0.5));
        lp += alpha * (saw - lp);
        const env =
          Math.min(1, i / (0.006 * SR)) * (dt < durSec ? 1 - (0.4 * dt) / durSec : Math.max(0, 0.6 * (1 - (dt - durSec) / 0.04)));
        out[i] = lp * env;
      }
      put(b, t, out, (k / (dets.length - 1)) * 1.2 - 0.6, (0.16 * vel) / Math.sqrt(dets.length));
    }
  }

  /** Low brass stab/sustain — pitch scoop in, filter blat, saturation. The motif voice. */
  function stab(b: Bus, t: number, durBeats: number, midi: number, vel: number): void {
    const dur = durBeats * BEAT * 0.92;
    const n = Math.round((dur + 0.08) * SR);
    const out = new Float64Array(n);
    const f0 = mtof(midi);
    const dets = [-11, 0, 9];
    const sawPs = dets.map(() => rng());
    let sqP = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      const scoop = cents(-80 * Math.exp(-dt / 0.045));
      let s = 0;
      for (let k = 0; k < dets.length; k++) {
        sawPs[k] = sawPs[k]! + (f0 * scoop * cents(dets[k]!)) / SR;
        s += 2 * (sawPs[k]! - Math.floor(sawPs[k]! + 0.5));
      }
      sqP += (f0 * scoop) / (2 * SR);
      s = s / 3 + (sqP - Math.floor(sqP) < 0.5 ? 0.35 : -0.35);
      const cutoff = dt < 0.05 ? 300 + (2800 - 300) * (dt / 0.05) : 1000 + 1800 * Math.exp(-(dt - 0.05) / 0.3);
      const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
      lp += alpha * (s - lp);
      const env =
        Math.min(1, i / (0.008 * SR)) * (dt < dur ? Math.exp(-dt / 1.2) : Math.exp(-dur / 1.2) * Math.max(0, 1 - (dt - dur) / 0.06));
      out[i] = Math.tanh(2 * lp) * 0.75 * env * vel;
    }
    put(b, t, out, midi > 58 ? 0.18 : -0.12, 0.5);
  }

  /** Breathy flute — the B-section counter-line and break echoes. */
  function flute(b: Bus, t: number, durBeats: number, midi: number, vel: number): void {
    const dur = durBeats * BEAT * 0.95;
    const n = Math.round((dur + 0.1) * SR);
    const out = new Float64Array(n);
    const f = mtof(midi);
    let phase = 0;
    let lpS = 0;
    let bpS = 0;
    const fk = 2 * Math.sin((Math.PI * Math.min(f, 8000)) / SR);
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      const vibDepth = Math.min(1, Math.max(0, (dt - 0.12) / 0.25)) * 12;
      const vib = cents(vibDepth * Math.sin(2 * Math.PI * 5.3 * dt));
      phase += (2 * Math.PI * f * vib) / SR;
      const nz = rng() * 2 - 1;
      lpS += fk * bpS;
      const hpS = nz - lpS - 0.12 * bpS;
      bpS += fk * hpS;
      const env = Math.min(1, dt / 0.05) * (dt < dur ? 1 : Math.max(0, 1 - (dt - dur) / 0.08));
      out[i] = (Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase) + bpS * 0.06) * env * vel;
    }
    put(b, t, out, 0.15, 0.34);
  }

  /** Slow dark pad on root+fifth — intro coil and the break. */
  function drone(b: Bus, t: number, durBeats: number, rootMidi: number, vel: number): void {
    const dur = durBeats * BEAT;
    const n = Math.round((dur + 1.0) * SR);
    const midis = [rootMidi, rootMidi + 7];
    const alpha = 1 - Math.exp((-2 * Math.PI * 480) / SR);
    for (let v = 0; v < midis.length; v++) {
      for (const det of [-6, 5]) {
        const out = new Float64Array(n);
        const f = mtof(midis[v]!) * cents(det);
        let sawP = rng();
        let lp = 0;
        for (let i = 0; i < n; i++) {
          const dt = i / SR;
          sawP += f / SR;
          const saw = 2 * (sawP - Math.floor(sawP + 0.5));
          lp += alpha * (saw - lp);
          const env = Math.min(1, dt / 1.5) * (dt < dur ? 1 : Math.max(0, 1 - (dt - dur) / 0.9));
          out[i] = lp * env;
        }
        put(b, t, out, det > 0 ? 0.4 : -0.4, 0.085 * vel);
      }
    }
  }

  // ------------------------------------------------------------- effects ----
  // Every effect runs two full circular passes: pass 0 only warms the state so the
  // tail at sample TOTAL-1 feeds sample 0 exactly — the loop seam carries the reverb/echoes.

  function pingPong(b: Bus, delaySec: number, fb: number, mix: number): void {
    const d = Math.round(delaySec * SR);
    const dl = new Float64Array(d);
    const dr = new Float64Array(d);
    const inL = b.L.slice();
    const inR = b.R.slice();
    let pos = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < TOTAL; i++) {
        const wetL = dl[pos]!;
        const wetR = dr[pos]!;
        dl[pos] = inL[i]! + wetR * fb;
        dr[pos] = inR[i]! + wetL * fb;
        if (pass === 1) {
          b.L[i] = inL[i]! + wetL * mix;
          b.R[i] = inR[i]! + wetR * mix;
        }
        pos = (pos + 1) % d;
      }
    }
  }

  /** Schroeder reverb over a stereo send; returns the wet signal (circular, 2 passes). */
  function reverb(sendL: Float64Array, sendR: Float64Array): Bus {
    const wet = bus();
    const combsMs = [29.7, 37.1, 41.1, 43.7];
    for (const [src, dst, spread] of [
      [sendL, wet.L, 1] as const,
      [sendR, wet.R, 1.013] as const,
    ]) {
      const combs = combsMs.map((ms) => ({ buf: new Float64Array(Math.round((ms / 1000) * spread * SR)), pos: 0, damp: 0 }));
      const ap1 = { buf: new Float64Array(Math.round(0.005 * spread * SR)), pos: 0 };
      const ap2 = { buf: new Float64Array(Math.round(0.0017 * spread * SR)), pos: 0 };
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < TOTAL; i++) {
          let s = 0;
          for (const c of combs) {
            const y = c.buf[c.pos]!;
            c.damp += 0.35 * (y - c.damp);
            c.buf[c.pos] = src[i]! + c.damp * 0.79;
            c.pos = (c.pos + 1) % c.buf.length;
            s += y;
          }
          s *= 0.25;
          for (const ap of [ap1, ap2]) {
            const y = ap.buf[ap.pos]!;
            const x = s + y * 0.7;
            ap.buf[ap.pos] = x;
            ap.pos = (ap.pos + 1) % ap.buf.length;
            s = y - x * 0.7;
          }
          if (pass === 1) dst[i] = s;
        }
      }
    }
    return wet;
  }

  return { BEAT, BAR, BARS, TOTAL, mtof, cents, rng, bus, put, secAt, taiko, logDrum, conga, shaker, gong, riser, bass, chug, stab, flute, drone, pingPong, reverb };
}

export type Engine = ReturnType<typeof createEngine>;

// ------------------------------------------------------------- wav write ----

export async function writeWav(path: string, L: Float64Array, R: Float64Array): Promise<void> {
  const total = L.length;
  const data = new Int16Array(total * 2);
  for (let i = 0; i < total; i++) {
    data[i * 2] = Math.round(Math.max(-1, Math.min(1, L[i]!)) * 32767);
    data[i * 2 + 1] = Math.round(Math.max(-1, Math.min(1, R[i]!)) * 32767);
  }
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const bytes = data.byteLength;
  v.setUint32(0, 0x52494646, false); // RIFF
  v.setUint32(4, 36 + bytes, true);
  v.setUint32(8, 0x57415645, false); // WAVE
  v.setUint32(12, 0x666d7420, false); // fmt
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  v.setUint32(36, 0x64617461, false); // data
  v.setUint32(40, bytes, true);
  await Bun.write(path, new Blob([header, data.buffer as ArrayBuffer]));
}
