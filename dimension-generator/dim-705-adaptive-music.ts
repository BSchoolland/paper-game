/**
 * Dimension 705 "The Sundered Crowns" — adaptive music rendered as three sample-locked stems
 * (calm / pulse / war) over one 32-bar grid. D dorian, 96 BPM, 80.0s exactly.
 *
 * The piece is composed vertically: the calm stem is the primary piece (lute air over a
 * hurdy-gurdy drone, A–B–A'–coda), and the pulse/war stems are counterpoint written against
 * it — tabor march and horn counter-lines in pulse; war drums, spiccato ostinato, and trumpet
 * fanfares (the calm motif, rhythmicized) answering in the melody's gaps in war.
 *
 * Reuses dim-706-engine.ts only as infrastructure (wrap-add notes, circular 2-pass effects,
 * WAV writer). Every instrument here is new — no 706 timbres.
 *
 * Usage: bun dim-705-adaptive-music.ts <outDir>
 */
import { createEngine, writeWav, SR, type Bus } from "./dim-706-engine.js";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: bun dim-705-adaptive-music.ts <outDir>");

const eng = createEngine({ seed: 70505, bpm: 96, bars: 32 });
const { BEAT, TOTAL, mtof, cents, rng, bus, put, secAt, reverb, pingPong } = eng;

// ------------------------------------------------------------------ palette ----

function fadeTail(out: Float64Array, sec: number): void {
  const n = Math.min(out.length, Math.round(sec * SR));
  for (let i = 0; i < n; i++) out[out.length - 1 - i]! *= i / n;
}

/** Gut-string lute — Karplus-Strong with a lowpassed pick burst. */
function lute(b: Bus, t: number, midi: number, vel: number, pan: number, soft = 0.55, gain = 0.5): void {
  const f = mtof(midi);
  const N = Math.max(2, Math.round(SR / f));
  const buf = new Float64Array(N);
  let pk = 0;
  for (let i = 0; i < N; i++) {
    const nz = rng() * 2 - 1;
    pk += soft * (nz - pk);
    buf[i] = pk;
  }
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i]!;
  mean /= N;
  for (let i = 0; i < N; i++) buf[i]! -= mean;
  const durSec = Math.min(2.6, 0.9 + 260 / f);
  const n = Math.round(durSec * SR);
  const out = new Float64Array(n);
  const rho = Math.pow(0.02, 1 / (f * durSec));
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[pos]!;
    const nxt = buf[(pos + 1) % N]!;
    out[i] = cur;
    buf[pos] = rho * 0.5 * (cur + nxt);
    pos = (pos + 1) % N;
  }
  fadeTail(out, 0.08);
  put(b, t, out, pan, gain * vel);
}

/** Round, distant horn — additive sines, slow attack, gentle swell. */
function horn(b: Bus, t: number, durBeats: number, midi: number, vel: number, pan = -0.12): void {
  const dur = durBeats * BEAT * 0.96;
  const n = Math.round((dur + 0.3) * SR);
  const out = new Float64Array(n);
  const f = mtof(midi);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    const vibIn = Math.min(1, Math.max(0, (dt - 0.3) / 0.5));
    phase += (2 * Math.PI * f * cents(5 * vibIn * Math.sin(2 * Math.PI * 4.7 * dt))) / SR;
    const s = Math.sin(phase) + 0.45 * Math.sin(2 * phase) + 0.17 * Math.sin(3 * phase) + 0.06 * Math.sin(4 * phase);
    const swell = 1 + 0.18 * Math.sin(Math.PI * Math.min(dt / dur, 1));
    const env = Math.min(1, dt / 0.1) * (dt < dur ? 1 : Math.max(0, 1 - (dt - dur) / 0.25));
    out[i] = Math.tanh(1.1 * s) * env * swell * vel;
  }
  put(b, t, out, pan, 0.3);
}

/** Bright fanfare trumpet — two detuned saws + square, fast attack, opening filter. */
function trumpet(b: Bus, t: number, durBeats: number, midi: number, vel: number, pan = 0.12): void {
  const dur = durBeats * BEAT * 0.9;
  const n = Math.round((dur + 0.12) * SR);
  const f0 = mtof(midi);
  for (const det of [-4, 4]) {
    const out = new Float64Array(n);
    const f = f0 * cents(det);
    let sawP = rng();
    let sqP = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      sawP += f / SR;
      sqP += f / (2 * SR);
      const saw = 2 * (sawP - Math.floor(sawP + 0.5));
      const sq = sqP - Math.floor(sqP) < 0.5 ? 0.3 : -0.3;
      const cutoff = 800 + 2400 * Math.exp(-dt / 0.09) + 1400 * vel;
      const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
      lp += alpha * (saw + sq - lp);
      const env =
        Math.min(1, dt / 0.02) * (dt < dur ? 0.75 + 0.25 * Math.exp(-dt / 0.15) : 0.75 * Math.max(0, 1 - (dt - dur) / 0.07));
      out[i] = Math.tanh(1.5 * lp) * env;
    }
    put(b, t, out, pan + det * 0.02, 0.26 * vel);
  }
}

/** Hurdy-gurdy drone — detuned dark saws + sub sine, slow undulation. */
function droneBow(b: Bus, t: number, durBeats: number, midis: number[], vel: number, attack = 1.6): void {
  const dur = durBeats * BEAT;
  const n = Math.round((dur + 1.2) * SR);
  const alpha = 1 - Math.exp((-2 * Math.PI * 250) / SR);
  for (const midi of midis) {
    for (const det of [-5, 4]) {
      const out = new Float64Array(n);
      const f = mtof(midi) * cents(det);
      let sawP = rng();
      let lp = 0;
      const wobPh = rng() * 6.28;
      for (let i = 0; i < n; i++) {
        const dt = i / SR;
        sawP += f / SR;
        const saw = 2 * (sawP - Math.floor(sawP + 0.5));
        lp += alpha * (saw - lp);
        const wob = 1 + 0.13 * Math.sin(2 * Math.PI * 0.11 * dt + wobPh);
        const env = Math.min(1, dt / attack) * (dt < dur ? 1 : Math.max(0, 1 - (dt - dur) / 1.1));
        out[i] = lp * env * wob;
      }
      put(b, t, out, det > 0 ? 0.35 : -0.35, 0.075 * vel);
    }
  }
  const out = new Float64Array(n);
  const f = mtof(midis[0]!);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    ph += (2 * Math.PI * f) / SR;
    const env = Math.min(1, dt / attack) * (dt < dur ? 1 : Math.max(0, 1 - (dt - dur) / 1.1));
    out[i] = Math.sin(ph) * env;
  }
  put(b, t, out, 0, 0.11 * vel);
}

/** Small chapel bell — inharmonic partials, the "bright dangerous magic" glint. */
function bell(b: Bus, t: number, midi: number, vel: number, pan = 0.3): void {
  const n = Math.round(2.2 * SR);
  const out = new Float64Array(n);
  const f = mtof(midi);
  const parts: [number, number, number][] = [
    [1, 1, 1.1],
    [2.76, 0.45, 0.55],
    [5.4, 0.22, 0.28],
    [8.93, 0.1, 0.14],
  ];
  const phs = parts.map(() => rng() * 6.28);
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    let s = 0;
    for (let k = 0; k < parts.length; k++) {
      const [r, a, dec] = parts[k]!;
      s += Math.sin(2 * Math.PI * f * r * dt + phs[k]!) * a * Math.exp(-dt / dec);
    }
    out[i] = s * Math.min(1, i / (0.0008 * SR));
  }
  put(b, t, out, pan, 0.16 * vel);
}

/** Spiccato string chug — short bowed saw with bow-noise scratch. */
function spiccato(b: Bus, t: number, midi: number, vel: number, pan = -0.2): void {
  const durSec = 0.09;
  const n = Math.round((durSec + 0.04) * SR);
  const out = new Float64Array(n);
  const f = mtof(midi);
  let sawP = rng();
  let lp = 0;
  let hp = 0;
  const alpha = 1 - Math.exp((-2 * Math.PI * 1600) / SR);
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    sawP += f / SR;
    const saw = 2 * (sawP - Math.floor(sawP + 0.5));
    lp += alpha * (saw - lp);
    const nz = rng() * 2 - 1;
    hp += 0.25 * (nz - hp);
    const scratch = (nz - hp) * Math.exp(-dt / 0.012) * 0.5;
    const env = Math.min(1, dt / 0.004) * (dt < durSec ? 1 - (0.5 * dt) / durSec : 0.5 * Math.max(0, 1 - (dt - durSec) / 0.035));
    out[i] = (lp + scratch) * env;
  }
  put(b, t, out, pan, 0.26 * vel);
}

/** Tabor (field drum), low stroke. */
function taborLow(b: Bus, t: number, vel: number): void {
  const n = Math.round(0.14 * SR);
  const out = new Float64Array(n);
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    ph += (2 * Math.PI * (72 + 55 * Math.exp(-dt / 0.02))) / SR;
    const nz = rng() * 2 - 1;
    lp += 0.12 * (nz - lp);
    out[i] = (Math.sin(ph) * Math.exp(-dt / 0.06) + lp * Math.exp(-dt / 0.02) * 0.8) * Math.min(1, i / (0.0015 * SR)) * vel;
  }
  put(b, t, out, -0.1, 0.55);
}

/** Tabor snare stroke — rattly bandpassed noise over a small body. */
function taborSnare(b: Bus, t: number, vel: number): void {
  const n = Math.round(0.16 * SR);
  const out = new Float64Array(n);
  let ph = 0;
  let lpS = 0;
  let bpS = 0;
  const fk = 2 * Math.sin((Math.PI * 1500) / SR);
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    ph += (2 * Math.PI * 195) / SR;
    const nz = rng() * 2 - 1;
    lpS += fk * bpS;
    const hpS = nz - lpS - 0.6 * bpS;
    bpS += fk * hpS;
    const rattle = bpS * Math.exp(-dt / 0.055);
    out[i] = (rattle * 0.9 + Math.sin(ph) * Math.exp(-dt / 0.03) * 0.5) * Math.min(1, i / (0.001 * SR)) * vel;
  }
  put(b, t, out, 0.12, 0.42);
}

/** Deep war drum — long low body, no click, felt more than heard. */
function warDrum(b: Bus, t: number, vel: number, pitch = 1): void {
  const n = Math.round(0.55 * SR);
  const out = new Float64Array(n);
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    ph += (2 * Math.PI * (44 + 62 * Math.exp(-dt / 0.055)) * pitch) / SR;
    const nz = rng() * 2 - 1;
    lp += 0.03 * (nz - lp);
    const body = Math.sin(ph) * Math.exp(-dt / 0.24);
    const thud = lp * Math.exp(-dt / 0.07) * 1.6;
    out[i] = Math.tanh(1.7 * (body + thud)) * Math.min(1, i / (0.002 * SR)) * vel;
  }
  put(b, t, out, 0, 0.72);
}

/** Anvil — clashing steel, inharmonic partial stack. */
function anvil(b: Bus, t: number, vel: number, pan: number): void {
  const n = Math.round(0.9 * SR);
  const out = new Float64Array(n);
  const base = 810 * (0.97 + rng() * 0.06);
  const parts = [1, 1.34, 1.72, 2.31, 2.94, 3.76, 5.1];
  const phs = parts.map(() => rng() * 6.28);
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    let s = 0;
    for (let k = 0; k < parts.length; k++)
      s += (Math.sin(2 * Math.PI * base * parts[k]! * dt + phs[k]!) * Math.exp(-dt / (0.5 / (k + 1)))) / (k + 1);
    const ping = (rng() * 2 - 1) * Math.exp(-dt / 0.003);
    out[i] = (s + ping * 0.6) * Math.min(1, i / (0.0005 * SR)) * vel;
  }
  put(b, t, out, pan, 0.2);
}

/** Wide cymbal crash for section downbeats. */
function crash(b: Bus, t: number, vel: number): void {
  for (const pan of [-0.45, 0.45]) {
    const n = Math.round(1.8 * SR);
    const out = new Float64Array(n);
    let hp = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      const nz = rng() * 2 - 1;
      hp += 0.35 * (nz - hp);
      lp += 0.5 * (nz - hp - lp);
      out[i] = lp * Math.exp(-dt / 0.55) * Math.min(1, i / (0.001 * SR));
    }
    put(b, t, out, pan, 0.15 * vel);
  }
}

/** Dragon roar — detuned sub-saw cluster swelling into the next downbeat, growl AM. */
function roar(b: Bus, t: number, durBeats: number, vel: number): void {
  const dur = durBeats * BEAT;
  const n = Math.round((dur + 0.35) * SR);
  const voices: [number, number][] = [
    [26, -28],
    [26, 20],
    [33, -12],
    [38, 32],
  ];
  for (const [midi, det] of voices) {
    const out = new Float64Array(n);
    const f = mtof(midi) * cents(det);
    let sawP = rng();
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      const x = Math.min(1, dt / dur);
      sawP += f / SR;
      const saw = 2 * (sawP - Math.floor(sawP + 0.5));
      const cutoff = 120 + 320 * x * x;
      const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
      lp += alpha * (saw - lp);
      const growl = 1 + 0.35 * x * Math.sin(2 * Math.PI * 27 * dt);
      const env = dt < dur ? Math.pow(x, 2.4) : Math.max(0, 1 - (dt - dur) / 0.3);
      out[i] = Math.tanh(1.5 * lp) * growl * env;
    }
    put(b, t, out, det > 0 ? 0.3 : -0.3, 0.11 * vel);
  }
}

/** Wing-beat whoosh riser into a downbeat. */
function whoosh(b: Bus, t: number, durBeats: number, vel: number): void {
  const n = Math.round(durBeats * BEAT * SR);
  const out = new Float64Array(n);
  let lpS = 0;
  let bpS = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const fc = 180 * Math.pow(2600 / 180, x);
    const fk = 2 * Math.sin((Math.PI * fc) / SR);
    const nz = rng() * 2 - 1;
    lpS += fk * bpS;
    const hpS = nz - lpS - 0.4 * bpS;
    bpS += fk * hpS;
    out[i] = bpS * Math.pow(x, 1.8) * Math.min(1, (n - i) / (0.012 * SR));
  }
  put(b, t, out, -0.1, 0.3 * vel);
}

// -------------------------------------------------------------------- score ----

interface Chord {
  bass: number;
  tones: [number, number, number];
}
const Dm: Chord = { bass: 38, tones: [50, 53, 57] };
const Cmaj: Chord = { bass: 36, tones: [48, 52, 55] };
const Gmaj: Chord = { bass: 43, tones: [55, 59, 62] };
const Fmaj: Chord = { bass: 41, tones: [53, 57, 60] };
const Am: Chord = { bass: 45, tones: [57, 60, 64] };
const Amaj: Chord = { bass: 45, tones: [57, 61, 64] };

// A (0-7) · B (8-15) · A' (16-23) · coda (24-31); A major is the "danger" pivot back to Dm.
const PROG: Chord[] = [
  Dm, Cmaj, Gmaj, Dm, Fmaj, Cmaj, Dm, Dm,
  Fmaj, Gmaj, Am, Cmaj, Fmaj, Gmaj, Dm, Amaj,
  Dm, Cmaj, Gmaj, Dm, Fmaj, Cmaj, Dm, Dm,
  Fmaj, Cmaj, Gmaj, Dm, Fmaj, Gmaj, Cmaj, Amaj,
];

type Note = [number, number, number, number]; // bar, beat, durBeats, midi

const MEL_A: Note[] = [
  [0, 0, 1, 62], [0, 1, 1, 65], [0, 2, 2, 69],
  [1, 0, 1, 67], [1, 1, 1, 64], [1, 2, 2, 62],
  [2, 0, 1, 71], [2, 1, 1, 69], [2, 2, 2, 67],
  [3, 0, 2, 69], [3, 2, 1, 65], [3, 3, 1, 64],
  [4, 0, 1, 65], [4, 1, 1, 69], [4, 2, 2, 72],
  [5, 0, 1, 71], [5, 1, 1, 67], [5, 2, 2, 64],
  [6, 0, 1, 65], [6, 1, 1, 64], [6, 2, 2, 62],
  [7, 0, 4, 62],
];

const MEL_B: Note[] = [
  [8, 0, 1, 69], [8, 1, 1, 72], [8, 2, 2, 74],
  [9, 0, 1, 71], [9, 1, 1, 74], [9, 2, 2, 76],
  [10, 0, 2, 72], [10, 2, 1, 71], [10, 3, 1, 69],
  [11, 0, 2, 67], [11, 2, 1, 64], [11, 3, 1, 67],
  [12, 0, 1, 69], [12, 1, 1, 72], [12, 2, 2, 77],
  [13, 0, 1, 76], [13, 1, 1, 74], [13, 2, 2, 71],
  [14, 0, 2, 69], [14, 2, 1, 65], [14, 3, 1, 69],
  [15, 0, 1, 69], [15, 1, 1, 73], [15, 2, 2, 76],
];

const MEL_CODA: Note[] = [
  [24, 0, 2, 72], [24, 2, 2, 69],
  [25, 0, 2, 67], [25, 2, 2, 64],
  [26, 0, 2, 71], [26, 2, 2, 67],
  [27, 0, 4, 69],
  [28, 0, 1, 65], [28, 1, 1, 69], [28, 2, 2, 72],
  [29, 0, 2, 74], [29, 2, 2, 71],
  [30, 0, 4, 67],
  [31, 0, 1, 69], [31, 1, 1, 73], [31, 2, 1, 76], [31, 3, 1, 73],
];

// D dorian scale, in scale order starting on D, for diatonic organum thirds.
const SCALE = [2, 4, 5, 7, 9, 11, 0];
function thirdBelow(m: number): number {
  const pc = ((m % 12) + 12) % 12;
  const idx = SCALE.indexOf(pc);
  const lowPc = SCALE[(idx + 5) % 7]!;
  return m - ((pc - lowPc + 12) % 12);
}

// ---------------------------------------------------------------- calm stem ----
// The primary piece: lute air + harp-style arpeggios + hurdy drone. A: lute states the
// theme. B: it climbs and peaks. A': the horn takes the theme, lute in diatonic thirds.
// Coda: fragments exhale over the returning drone, C# pivot pulls the loop home to D.

const calmMel = bus();
const calmAcc = bus();
const calmLow = bus();

for (const [bar, beat, dur, midi] of [...MEL_A, ...MEL_B]) {
  lute(calmMel, secAt(bar, beat), midi, bar >= 8 ? 1.1 : 1.0, 0.1);
  void dur;
}
for (const [bar, beat, dur, midi] of MEL_A) {
  horn(calmMel, secAt(bar + 16, beat), dur, midi, 0.55);
  lute(calmMel, secAt(bar + 16, beat), thirdBelow(midi), 0.6, 0.22);
}
for (const [bar, beat, dur, midi] of MEL_CODA) {
  lute(calmMel, secAt(bar, beat), midi, 0.72, 0.1);
  void dur;
}

// Bell glints double the phrase-end long tones an octave up.
for (const [bar, beat, midi] of [
  [3, 0, 81], [7, 0, 74], [12, 2, 89], [15, 2, 88], [19, 0, 81], [23, 0, 74], [27, 0, 81], [31, 2, 88],
] as const) {
  bell(calmMel, secAt(bar, beat), midi, 0.55);
}
for (const barX of [7, 23]) {
  bell(calmMel, secAt(barX, 2), 74, 0.4, -0.2);
  bell(calmMel, secAt(barX, 2.5), 81, 0.35, 0.1);
  bell(calmMel, secAt(barX, 3), 86, 0.3, 0.4);
}

// Broken-chord accompaniment, an arch per bar with beat 4 left open to breathe.
for (let bar = 0; bar < 32; bar++) {
  const ch = PROG[bar]!;
  const inCoda = bar >= 24;
  const arch = [ch.tones[0], ch.tones[1], ch.tones[2], ch.tones[0] + 12, ch.tones[2], ch.tones[1]];
  const steps = inCoda ? 4 : 6;
  for (let k = 0; k < steps; k++) {
    const accVel = inCoda ? 0.46 : bar >= 8 && bar < 16 ? 0.68 : 0.6;
    lute(calmAcc, secAt(bar, k * 0.5), arch[k]!, accVel, k % 2 === 0 ? -0.3 : -0.05, 0.4, 0.42);
  }
}

// Low end: hurdy drone on D-A through A/A'/coda, bowed bass roots walk the B section,
// and a soft low pluck marks every downbeat.
droneBow(calmLow, secAt(0, 0), 32, [38, 45], 1.1);
droneBow(calmLow, secAt(16, 0), 64, [38, 45], 1.05);
for (let bar = 8; bar < 16; bar++) {
  droneBow(calmLow, secAt(bar, 0), 4, [PROG[bar]!.bass], 1.25, 0.3);
}
for (let bar = 0; bar < 32; bar++) {
  lute(calmLow, secAt(bar, 0), PROG[bar]!.bass, 0.7, 0, 0.3, 0.55);
}

// --------------------------------------------------------------- pulse stem ----
// Armies on the horizon: tabor march, plucked bass roots, horn counter-lines that answer
// the calm melody's long tones, and a section-marker chime.

const pulsePerc = bus();
const pulseHrm = bus();

for (let bar = 0; bar < 32; bar++) {
  const phrasePos = bar % 8;
  taborLow(pulsePerc, secAt(bar, 0), 0.85);
  taborSnare(pulsePerc, secAt(bar, 1), 0.6);
  taborLow(pulsePerc, secAt(bar, 2), 0.7);
  taborSnare(pulsePerc, secAt(bar, 3), 0.65);
  taborSnare(pulsePerc, secAt(bar, 2.75), 0.25);
  taborSnare(pulsePerc, secAt(bar, 2.875), 0.3);
  if (phrasePos >= 6) for (const off of [0.5, 1.5, 2.5]) taborSnare(pulsePerc, secAt(bar, off), 0.22);
  if (phrasePos === 7) for (let k = 0; k < 8; k++) taborSnare(pulsePerc, secAt(bar, 3 + k / 8), 0.25 + 0.05 * k);
}

for (let bar = 0; bar < 32; bar++) {
  const ch = PROG[bar]!;
  if (bar >= 8 && bar < 16) {
    const walk = [ch.bass, ch.bass + 7, ch.bass + 12, ch.bass + 7];
    for (let k = 0; k < 4; k++) lute(pulseHrm, secAt(bar, k), walk[k]!, 0.62, 0, 0.3, 0.6);
  } else {
    lute(pulseHrm, secAt(bar, 0), ch.bass, 0.68, 0, 0.3, 0.6);
    lute(pulseHrm, secAt(bar, 2), ch.bass + 7, 0.55, 0, 0.3, 0.6);
  }
}

const CTR_A: [number, number, number][] = [
  [0, 8, 57], [2, 8, 55], [4, 8, 57], [6, 4, 53], [7, 4, 57],
];
for (const [bar, dur, midi] of CTR_A) {
  horn(pulseHrm, secAt(bar, 0), dur, midi, 0.45);
  horn(pulseHrm, secAt(bar + 16, 0), dur, midi, 0.45);
}
const CTR_B = [60, 59, 60, 55, 57, 59, 57, 61];
for (let k = 0; k < 8; k++) horn(pulseHrm, secAt(8 + k, 0), 4, CTR_B[k]!, 0.48);
for (const [bar, midi] of [[28, 53], [29, 55], [30, 55], [31, 57], [31, 61]] as const) {
  horn(pulseHrm, secAt(bar, 0), 4, midi, 0.42);
}

for (const bar of [0, 8, 16, 24]) bell(pulseHrm, secAt(bar, 0), 86, 0.4, -0.35);

// ----------------------------------------------------------------- war stem ----
// The battle joined, dragons overhead: war drums and crashes, 16th spiccato ostinato in a
// 3+3+2 accent grid, trumpet fanfares built from the calm motif answering in its gaps,
// anvils of clashing steel, roar-swells and wing whooshes into section downbeats.

const warPerc = bus();
const warOst = bus();
const warFan = bus();

for (let bar = 0; bar < 32; bar++) {
  const quiet = bar >= 24 && bar < 26 ? 0.7 : 1;
  warDrum(warPerc, secAt(bar, 0), 0.95 * quiet);
  warDrum(warPerc, secAt(bar, 1.5), 0.6 * quiet);
  warDrum(warPerc, secAt(bar, 2), 0.8 * quiet);
  warDrum(warPerc, secAt(bar, 3.5), 0.55 * quiet);
  if (bar >= 8) warDrum(warPerc, secAt(bar, 3), 0.5 * quiet, 1.2);
  const surge = (bar >= 12 && bar < 16) || (bar >= 28 && bar < 32);
  if (surge) for (const off of [0.5, 1, 2.5]) warDrum(warPerc, secAt(bar, off), 0.4, 1.5);
  if (bar % 8 === 7) for (let k = 0; k < 8; k++) warDrum(warPerc, secAt(bar, 3 + k / 8), 0.35 + 0.07 * k, 1.35);
  if (bar % 4 === 2) anvil(warPerc, secAt(bar, 2), 0.55, bar % 8 === 2 ? -0.4 : 0.4);
}
for (const bar of [0, 8, 24]) crash(warPerc, secAt(bar, 0), 0.8);
crash(warPerc, secAt(16, 0), 0.95);

const ACCENTS = new Set([0, 3, 6, 8, 11, 14]);
for (let bar = 0; bar < 32; bar++) {
  if (bar === 24 || bar === 25) continue;
  const ch = PROG[bar]!;
  const lift = bar >= 8 && bar < 24 ? 1 : bar >= 28 ? 0.95 : bar >= 26 ? 0.75 : 0.85;
  for (let k = 0; k < 16; k++) {
    const midi = k === 6 || k === 7 ? ch.tones[0] + 12 + 7 : ch.tones[0] + 12;
    spiccato(warOst, secAt(bar, k / 4), (ACCENTS.has(k) ? 0.8 : 0.42) * lift, k % 2 === 0 ? -0.25 : -0.12);
  }
}

const FAN: [number, number, number, number, number][] = [
  [3, 2, 0.75, 62, 0.8], [3, 2.75, 0.25, 65, 0.7], [3, 3, 1, 69, 0.85],
  [7, 0, 0.75, 62, 0.85], [7, 0.75, 0.25, 65, 0.75], [7, 1, 0.75, 69, 0.85], [7, 1.75, 0.25, 72, 0.8], [7, 2, 2, 74, 0.9],
  [15, 0, 0.5, 69, 0.8], [15, 0.5, 0.5, 73, 0.85], [15, 1, 0.5, 76, 0.9], [15, 1.5, 0.5, 73, 0.85], [15, 2, 2, 76, 0.95],
  [19, 2, 0.75, 62, 0.8], [19, 2.75, 0.25, 65, 0.7], [19, 3, 1, 69, 0.85],
  [23, 0, 0.75, 62, 0.85], [23, 0.75, 0.25, 65, 0.75], [23, 1, 0.75, 69, 0.85], [23, 1.75, 0.25, 72, 0.8], [23, 2, 2, 74, 0.9],
  [29, 2, 0.75, 67, 0.8], [29, 2.75, 0.25, 71, 0.75], [29, 3, 1, 74, 0.85],
  [31, 0, 0.5, 69, 0.85], [31, 0.5, 0.5, 73, 0.85], [31, 1, 0.5, 76, 0.9], [31, 1.5, 0.5, 73, 0.85], [31, 2, 2, 76, 0.95],
];
for (const [bar, beat, dur, midi, vel] of FAN) trumpet(warFan, secAt(bar, beat), dur, midi, vel);
for (let bar = 8; bar < 15; bar++) {
  const ch = PROG[bar]!;
  trumpet(warFan, secAt(bar, 0), 0.75, ch.tones[1] + 12, 0.55, -0.05);
  trumpet(warFan, secAt(bar, 0), 0.75, ch.tones[2] + 12, 0.55, 0.28);
}

roar(warPerc, secAt(14, 0), 8, 0.9);
roar(warPerc, secAt(30, 0), 8, 1);
for (const [bar, beat] of [[7, 2], [23, 2], [31, 2]] as const) whoosh(warPerc, secAt(bar, beat), 2, 0.8);

// ------------------------------------------------------------ mix + effects ----
// Per-stem sends into the circular reverb keep every stem's seam continuous on its own;
// the fanfares also echo across the field via ping-pong before joining the war stem.

function addBus(dst: Bus, src: Bus, g: number): void {
  for (let i = 0; i < TOTAL; i++) {
    dst.L[i]! += src.L[i]! * g;
    dst.R[i]! += src.R[i]! * g;
  }
}

function sendOf(parts: [Bus, number][]): Bus {
  const s = bus();
  for (const [b, g] of parts) addBus(s, b, g);
  return s;
}

pingPong(warFan, 0.75 * BEAT, 0.35, 0.3);

const calm = bus();
addBus(calm, calmMel, 1);
addBus(calm, calmAcc, 1);
addBus(calm, calmLow, 1);
const calmSend = sendOf([[calmMel, 0.4], [calmAcc, 0.3], [calmLow, 0.06]]);
addBus(calm, reverb(calmSend.L, calmSend.R), 1);

const pulse = bus();
addBus(pulse, pulsePerc, 1);
addBus(pulse, pulseHrm, 1);
const pulseSend = sendOf([[pulseHrm, 0.28], [pulsePerc, 0.12]]);
addBus(pulse, reverb(pulseSend.L, pulseSend.R), 1);

const war = bus();
addBus(war, warPerc, 1);
addBus(war, warOst, 1);
addBus(war, warFan, 1);
const warSend = sendOf([[warFan, 0.2], [warOst, 0.12], [warPerc, 0.05]]);
addBus(war, reverb(warSend.L, warSend.R), 1);

// -------------------------------------------------- normalize + verify + write ----
// Intensity only ever raises stem gains within [0,1] (calm always at 1), so the worst-case
// instantaneous sum is at a corner of the gain box: scan max(|c|, |c+p|, |c+w|, |c+p+w|).

let worst = 0;
for (let i = 0; i < TOTAL; i++) {
  for (const ch of ["L", "R"] as const) {
    const c = calm[ch][i]!;
    const p = pulse[ch][i]!;
    const w = war[ch][i]!;
    const m = Math.max(Math.abs(c), Math.abs(c + p), Math.abs(c + w), Math.abs(c + p + w));
    if (m > worst) worst = m;
  }
}
const k = 0.97 / worst;
for (const stem of [calm, pulse, war]) {
  for (let i = 0; i < TOTAL; i++) {
    stem.L[i]! *= k;
    stem.R[i]! *= k;
  }
}

function db(x: number): string {
  return (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
}

function report(name: string, b: Bus): void {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < TOTAL; i++) {
    const l = Math.abs(b.L[i]!);
    const r = Math.abs(b.R[i]!);
    if (l > peak) peak = l;
    if (r > peak) peak = r;
    sum += b.L[i]! * b.L[i]! + b.R[i]! * b.R[i]!;
  }
  const rms = Math.sqrt(sum / (TOTAL * 2));
  const win = SR;
  let minWin = Infinity;
  let maxWin = 0;
  for (let s = 0; s + win <= TOTAL; s += win >> 1) {
    let ws = 0;
    for (let i = s; i < s + win; i++) ws += b.L[i]! * b.L[i]! + b.R[i]! * b.R[i]!;
    const wr = Math.sqrt(ws / (win * 2));
    if (wr < minWin) minWin = wr;
    if (wr > maxWin) maxWin = wr;
  }
  console.log(`${name.padEnd(16)} peak ${db(peak)} dB  rms ${db(rms)} dB  win-rms ${db(minWin)}..${db(maxWin)} dB`);
}

console.log(`TOTAL ${TOTAL} samples (${(TOTAL / SR).toFixed(3)}s), norm x${k.toFixed(3)}`);
report("calm", calm);
report("pulse", pulse);
report("war", war);
const cp = bus();
addBus(cp, calm, 1);
addBus(cp, pulse, 1);
report("calm+pulse", cp);
addBus(cp, war, 1);
report("full mix", cp);

// Per-4-bar arc of the calm stem alone — its dynamic shape is the piece's shape.
{
  const blk = Math.round(4 * 4 * BEAT * SR);
  const arcs: string[] = [];
  for (let s = 0; s + blk <= TOTAL; s += blk) {
    let ws = 0;
    for (let i = s; i < s + blk; i++) ws += calm.L[i]! * calm.L[i]! + calm.R[i]! * calm.R[i]!;
    arcs.push(db(Math.sqrt(ws / (blk * 2))));
  }
  console.log(`calm arc (4-bar rms dB): ${arcs.join("  ")}`);
}

await writeWav(`${OUT}/dim-705-calm.wav`, calm.L, calm.R);
await writeWav(`${OUT}/dim-705-pulse.wav`, pulse.L, pulse.R);
await writeWav(`${OUT}/dim-705-war.wav`, war.L, war.R);
console.log(`wrote ${OUT}/dim-705-{calm,pulse,war}.wav`);
