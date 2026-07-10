/**
 * Dimension 707 "Escapement" — adaptive stems (calm / pulse / war).
 *
 * The exposed interior of a planet-sized machine: everything still ticks, slow and out of
 * rhythm. Substrate is war-first — 116 BPM clockwork 8th grid (war doubles to 16ths), D natural
 * minor, an 8-bar Dm–Bb–Gm–C bed with two bars per chord. Calm is a half-time music-box piece
 * with a real form (statement / development / harmonized restatement / break / return); its
 * melody states the theme in bars 0–3 of each section and rests in bars 4–7, where war's low
 * brass answers. The break (bars 24–31) is calm's near-silence and war's climax. All aggression
 * is rhythm, register, mass, and dynamics — every pitched line stays inside D natural minor.
 *
 *   bun dimension-generator/dim-707-adaptive-music.ts
 */

import { createEngine, writeWav, SR, type Bus } from "./dim-706-engine";

const OUT_DIR = "/tmp/claude-1000/-home-ben-Projects-turn-based-game/9e8a50ca-871a-418d-ba76-b058e15ff96c/scratchpad/dim707";

const e = createEngine({ seed: 707707, bpm: 116, bars: 40 });
const { BEAT, TOTAL, secAt, put, mtof, cents, rng } = e;

// Bass-register chord roots per bar of the 8-bar loop: Dm Dm Bb Bb Gm Gm C C.
const ROOTS = [38, 38, 34, 34, 31, 31, 36, 36];
const rootAt = (bar: number): number => ROOTS[bar % 8]!;
// Mid-register chord tones for arps/harmony.
const CHORD: Record<number, number[]> = {
  38: [50, 53, 57], // D F A
  34: [46, 50, 53], // Bb D F
  31: [43, 46, 50], // G Bb D
  36: [48, 52, 55], // C E G
};

// ------------------------------------------------------------ 707 voices ----

/** Escapement click: a pitched ping plus a filtered metal-grit burst. The world's tick. */
function tick(b: Bus, t: number, vel: number, pan: number, low = false): void {
  const n = Math.round(0.05 * SR);
  const out = new Float64Array(n);
  const f = low ? 1180 : 3140;
  let phase = 0;
  let bp = 0;
  let lp = 0;
  const fk = 2 * Math.sin((Math.PI * Math.min(f * 1.4, 9000)) / SR);
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    phase += (2 * Math.PI * f) / SR;
    const nz = rng() * 2 - 1;
    lp += fk * bp;
    const hp = nz - lp - 0.25 * bp;
    bp += fk * hp;
    const ping = Math.sin(phase) * Math.exp(-dt / (low ? 0.016 : 0.009));
    const grit = bp * Math.exp(-dt / 0.004) * 0.8;
    out[i] = (ping + grit) * Math.min(1, i / (0.0006 * SR)) * vel;
  }
  put(b, t, out, pan, 0.34);
}

/** Music box / celesta pluck — calm's lead. Harmonic partials, glassy, quick hammer. */
function musicBox(b: Bus, t: number, midi: number, vel: number, pan = 0.12): void {
  const n = Math.round(1.6 * SR);
  const out = new Float64Array(n);
  const f = mtof(midi);
  const gains = [1, 0.42, 0.2, 0.09];
  const phases = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const fk = f * (k + 1) * (1 + 0.0006 * k);
      s += Math.sin(2 * Math.PI * fk * dt + phases[k]!) * gains[k]! * Math.exp(-dt / (1.05 / (k + 1)));
    }
    const hammer = (rng() * 2 - 1) * Math.exp(-dt / 0.0015) * 0.25;
    out[i] = (s + hammer) * Math.min(1, i / (0.0008 * SR)) * vel;
  }
  put(b, t, out, pan, 0.3);
}

/** Long consonant chime — harmonic partials with slow detune beating, for the break. */
function chime(b: Bus, t: number, midi: number, vel: number): void {
  const n = Math.round(4.5 * SR);
  const f = mtof(midi);
  for (const det of [-3, 3]) {
    const out = new Float64Array(n);
    const fd = f * cents(det);
    const phases = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
    for (let i = 0; i < n; i++) {
      const dt = i / SR;
      let s = 0;
      for (let k = 0; k < 3; k++) {
        s += (Math.sin(2 * Math.PI * fd * (k + 1) * dt + phases[k]!) * Math.exp(-dt / (2.6 / (k + 1)))) / (k + 1);
      }
      out[i] = s * Math.min(1, dt / 0.004) * vel;
    }
    put(b, t, out, det > 0 ? 0.45 : -0.45, 0.16);
  }
}

/** Anvil — unpitched metal-on-metal backbeat for war. Short ring, no sustained tone. */
function anvil(b: Bus, t: number, vel: number): void {
  const n = Math.round(0.22 * SR);
  const out = new Float64Array(n);
  const rings = [2731, 3853, 5323];
  const phases = rings.map(() => rng() * 6.28);
  let hp = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    let s = 0;
    for (let k = 0; k < rings.length; k++) {
      s += (Math.sin(2 * Math.PI * rings[k]! * dt + phases[k]!) * Math.exp(-dt / (0.06 / (k * 0.6 + 1)))) / (k + 1);
    }
    const nz = rng() * 2 - 1;
    hp += 0.5 * (nz - hp);
    const clank = (nz - hp) * Math.exp(-dt / 0.006);
    const thud = Math.sin(2 * Math.PI * 190 * dt) * Math.exp(-dt / 0.02) * 0.7;
    out[i] = (s * 0.6 + clank * 0.8 + thud) * Math.min(1, i / (0.0004 * SR)) * vel;
  }
  put(b, t, out, -0.18, 0.4);
}

/** Downbeat impact — pitch-dropping boom, lands section boundaries in war. */
function boom(b: Bus, t: number, vel: number): void {
  const n = Math.round(1.1 * SR);
  const out = new Float64Array(n);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    const f = 36 + 46 * Math.exp(-dt / 0.09);
    phase += (2 * Math.PI * f) / SR;
    const nz = rng() * 2 - 1;
    lp += 0.02 * (nz - lp);
    const body = Math.sin(phase) * Math.exp(-dt / 0.4);
    const thud = lp * Math.exp(-dt / 0.06) * 2.2;
    out[i] = Math.tanh(1.4 * (body + thud)) * Math.min(1, i / (0.001 * SR)) * vel;
  }
  put(b, t, out, 0, 0.85);
}

/** Winding ratchet — a fast run of escapement clicks, pulse's bar-end fill. */
function ratchet(b: Bus, t: number, vel: number): void {
  for (let k = 0; k < 5; k++) tick(b, t + k * 0.034, vel * (0.45 + 0.14 * k), 0.3 - k * 0.15, k % 2 === 0);
}

// -------------------------------------------------------------- melodies ----
// Note events: [bar, beat, lenBeats, midi, vel].
type Note = [number, number, number, number, number];

const play = (b: Bus, notes: Note[], inst: (b: Bus, t: number, dur: number, midi: number, vel: number) => void, barOfs = 0): void => {
  for (const [bar, beat, len, midi, vel] of notes) inst(b, secAt(bar + barOfs, beat), len, midi, vel);
};
const box = (b: Bus, notes: Note[], barOfs = 0, velMul = 1): void => {
  for (const [bar, beat, , midi, vel] of notes) musicBox(b, secAt(bar + barOfs, beat), midi, vel * velMul);
};

// The Escapement theme — calm states it in bars 0–3, then leaves bars 4–7 nearly empty.
const THEME: Note[] = [
  [0, 0, 2, 69, 1], [0, 2, 1, 74, 0.9], [0, 3, 1, 72, 0.85],
  [1, 0, 3, 69, 0.95],
  [2, 0, 2, 70, 1], [2, 2, 1, 74, 0.9], [2, 3, 1, 77, 0.95],
  [3, 0, 3, 74, 1],
  [4, 0, 1, 70, 0.6], [4, 2, 1.5, 67, 0.55], // lonely echoes in the space bars
  [6, 0, 1, 67, 0.5], [6, 2, 1, 72, 0.55],
  [7, 3, 1, 69, 0.6],
];

// Development variation (section 1) — higher, more motion, same space bars.
const VARIATION: Note[] = [
  [0, 0, 1, 74, 0.95], [0, 1, 1, 77, 0.95], [0, 2, 2, 76, 0.9],
  [1, 0, 2, 74, 0.95], [1, 2, 1, 72, 0.85], [1, 3, 1, 69, 0.8],
  [2, 0, 2, 77, 1], [2, 2, 1, 74, 0.9], [2, 3, 1, 72, 0.85],
  [3, 0, 3, 74, 1],
  [4, 0, 1, 74, 0.6], [4, 1, 1, 70, 0.55], [4, 2, 2, 67, 0.55],
  [6, 0, 1, 76, 0.5], [6, 2, 2, 72, 0.55],
  [7, 3, 1, 69, 0.6],
];

// Harmony under the theme's statement bars (section 2) — thirds/sixths, chord-safe.
const THEME_HARMONY: Note[] = [
  [0, 0, 2, 65, 0.6], [0, 2, 1, 69, 0.55], [0, 3, 1, 69, 0.5],
  [1, 0, 3, 65, 0.55],
  [2, 0, 2, 65, 0.6], [2, 2, 1, 70, 0.55], [2, 3, 1, 74, 0.55],
  [3, 0, 3, 70, 0.6],
];

// War's answering lead — bars 4–7 of a section, heavy register, owns calm's rest bars.
const WAR_ANSWER: Note[] = [
  [4, 0, 0.75, 55, 0.95], [4, 1, 0.75, 55, 0.85], [4, 2, 1, 58, 0.95], [4, 3, 1, 62, 1],
  [5, 0, 1.5, 58, 0.95], [5, 2, 2, 55, 0.9],
  [6, 0, 1, 60, 0.95], [6, 1.5, 0.5, 62, 0.85], [6, 2, 2, 64, 1],
  [7, 0, 1, 67, 1], [7, 2, 2, 57, 0.9],
];

// A pushier answer for the development section.
const WAR_ANSWER_B: Note[] = [
  [4, 0, 0.5, 55, 0.95], [4, 0.75, 0.5, 55, 0.8], [4, 1.5, 0.5, 58, 0.9], [4, 2, 1, 62, 1], [4, 3, 1, 58, 0.9],
  [5, 0, 1.5, 55, 0.95], [5, 2.5, 1.5, 50, 0.9],
  [6, 0, 1, 60, 0.95], [6, 1.5, 0.5, 64, 0.9], [6, 2, 2, 67, 1],
  [7, 0, 1, 64, 0.95], [7, 2, 1, 60, 0.9], [7, 3, 1, 57, 0.9],
];

// War's break climax — the full theme, low brass, bars 24–31.
const WAR_BREAK_THEME: Note[] = [
  [0, 0, 2, 57, 1], [0, 2, 1, 62, 0.95], [0, 3, 1, 60, 0.9],
  [1, 0, 3, 57, 1],
  [2, 0, 2, 58, 1], [2, 2, 1, 62, 0.95], [2, 3, 1, 65, 1],
  [3, 0, 3, 62, 1],
  [4, 0, 1.5, 55, 1], [4, 2, 1, 58, 0.95], [4, 3, 1, 62, 1],
  [5, 0, 2, 62, 1], [5, 2, 2, 58, 0.95],
  [6, 0, 1, 60, 1], [6, 1.5, 0.5, 62, 0.9], [6, 2, 2, 64, 1],
  [7, 0, 1.5, 67, 1], [7, 2, 1, 64, 0.95], [7, 3, 1, 57, 0.95],
];

// ------------------------------------------------------------------ CALM ----
// Half-time over the grid: drone bed, limping out-of-phase clock, music-box theme.

const calm = e.bus();
const isBreak = (bar: number): boolean => bar >= 24 && bar < 32;

for (let bar = 0; bar < 40; bar++) {
  const brk = isBreak(bar);
  // Drone bed follows the chords, two-bar strokes, thinner in the break.
  if (bar % 2 === 0) e.drone(calm, secAt(bar, 0), 8, rootAt(bar) + 12, brk ? 0.32 : 0.55);
  // Deep tock heartbeat — calm's designed low end.
  if (!brk || bar % 2 === 0) boom(calm, secAt(bar, 0), brk ? 0.2 : 0.3);
  // The clock: tock on 0, tick on 2 — and the late tick, half a beat behind, where the melody rests.
  tick(calm, secAt(bar, 0), 0.55, -0.4, true);
  tick(calm, secAt(bar, 2), 0.5, 0.4, false);
  const rest = bar % 8 >= 4;
  if (rest && !brk) tick(calm, secAt(bar, 2.5), 0.4, 0.15, false);
  if (brk) tick(calm, secAt(bar, [2.5, 1.75, 3.25, 2.75][bar % 4]!), 0.45, [0.2, -0.3, 0.35, -0.15][bar % 4]!, bar % 2 === 1);
}

// Section 0 — statement, music box alone.
box(calm, THEME, 0);
// Section 1 — development: variation plus a breathy counter-line.
box(calm, VARIATION, 8);
play(calm, [[8, 0, 4, 65, 0.5], [10, 0, 4, 62, 0.5], [12, 0, 4, 62, 0.45], [14, 0, 4, 64, 0.5]], (b, t, d, m, v) => e.flute(b, t, d, m, v));
// Section 2 — restatement, harmonized.
box(calm, THEME, 16);
box(calm, THEME_HARMONY, 16);
play(calm, [[20, 0, 4, 67, 0.45], [22, 0, 4, 67, 0.45]], (b, t, d, m, v) => e.flute(b, t, d, m, v));
// Section 3 — the break: a chime remembers three notes of the theme; the great wheel strikes.
chime(calm, secAt(26, 0), 69, 0.8);
chime(calm, secAt(26, 2), 74, 0.7);
chime(calm, secAt(27, 0), 72, 0.6);
chime(calm, secAt(30, 0), 62, 0.55);
e.gong(calm, secAt(24, 0), 0.5);
e.gong(calm, secAt(28, 0), 0.4);
// Section 4 — return, fullest calm, cadence dovetails into the loop head.
box(calm, THEME, 32);
play(calm, [[32, 0, 4, 65, 0.5], [34, 0, 4, 62, 0.5], [36, 0, 4, 58, 0.45], [38, 0, 4, 64, 0.5]], (b, t, d, m, v) => e.flute(b, t, d, m, v));
musicBox(calm, secAt(39, 0), 72, 0.7);
musicBox(calm, secAt(39, 2), 76, 0.6);
musicBox(calm, secAt(39, 3), 74, 0.75);

// ----------------------------------------------------------------- PULSE ----
// The machine engages: 8th tick lattice, dotted bass, march skeleton, winding arps.

const pulse = e.bus();

for (let bar = 0; bar < 40; bar++) {
  const brk = isBreak(bar);
  const g = brk ? 0.65 : 1;
  // Quarter tick-tock plus faint 8th offbeats — the grid arriving.
  for (let q = 0; q < 4; q++) {
    tick(pulse, secAt(bar, q), (q % 2 === 0 ? 0.6 : 0.5) * g, q % 2 === 0 ? -0.35 : 0.35, q % 2 === 0);
    if (!brk) tick(pulse, secAt(bar, q + 0.5), 0.24, q % 2 === 0 ? 0.5 : -0.5, false);
  }
  // March skeleton.
  e.logDrum(pulse, secAt(bar, 0), 45, 0.7 * g);
  if (!brk) {
    e.logDrum(pulse, secAt(bar, 2), 50, 0.5);
    e.conga(pulse, secAt(bar, 1), 0.45, false);
    e.conga(pulse, secAt(bar, 3), 0.55, true);
  }
  // Dotted clockwork bass; whole notes through the break.
  const r = rootAt(bar);
  if (brk) {
    e.bass(pulse, secAt(bar, 0), 3.6, r, 0.55);
  } else {
    e.bass(pulse, secAt(bar, 0), 0.7, r, 0.8);
    e.bass(pulse, secAt(bar, 1.5), 0.45, r, 0.6);
    e.bass(pulse, secAt(bar, 2), 0.7, r, 0.75);
    e.bass(pulse, secAt(bar, 3.5), 0.45, bar % 2 === 1 ? r + 7 : r, 0.65);
  }
  // Winding arp fills the melody's rest bars (sections 0,1,2,4).
  if (!brk && bar % 8 >= 4) {
    const tones = CHORD[r]!;
    const seq = [0, 1, 2, 1];
    for (let s = 0; s < 8; s++) musicBox(pulse, secAt(bar, s * 0.5), tones[seq[s % 4]!]!, 0.42, s % 2 === 0 ? -0.25 : 0.25);
  }
  if (!brk && bar % 4 === 3) ratchet(pulse, secAt(bar, 3.5), 0.6);
}

// ------------------------------------------------------------------- WAR ----
// Double-time: 16th ratchet lattice, taiko mass, anvils, gallop low end, the answering lead.

const war = e.bus();

for (let bar = 0; bar < 40; bar++) {
  const brk = isBreak(bar);
  // 16th escapement lattice — the whole machine at speed.
  for (let s = 0; s < 16; s++) {
    const vel = [0.5, 0.16, 0.3, 0.16][s % 4]! * (brk ? 1.1 : 1);
    tick(war, secAt(bar, s * 0.25), vel, s % 2 === 0 ? -0.5 : 0.5, s % 8 === 0);
  }
  // Taiko mass — double-time march, fills every fourth bar.
  const hits: [number, number][] =
    bar % 4 === 3
      ? [[0, 1], [0.75, 0.55], [1.5, 0.8], [2, 0.95], [2.75, 0.6], [3, 0.55], [3.25, 0.65], [3.5, 0.75], [3.75, 0.9]]
      : [[0, 1], [0.75, 0.55], [1.5, 0.8], [2, 0.95], [2.75, 0.55], [3.25, 0.5], [3.5, 0.75]];
  for (const [bt, v] of hits) e.taiko(war, secAt(bar, bt), v * (brk ? 1.12 : 1));
  if (brk) {
    e.taiko(war, secAt(bar, 0), 0.9, 0.78);
    e.taiko(war, secAt(bar, 2), 0.85, 0.78);
  }
  // Metal backbeat.
  anvil(war, secAt(bar, 1), 0.7);
  anvil(war, secAt(bar, 3), 0.85);
  // Gallop low end: war's bass interlocks on the offbeats of pulse's dotted line.
  const r = rootAt(bar);
  for (const bt of [0.5, 1.5, 2.5, 3.5]) e.bass(war, secAt(bar, bt), 0.35, r, 0.62);
  if (r === 38) e.bass(war, secAt(bar, 0), 1.2, 26, 0.7); // sub-octave D under the tonic bars
  // 8th-note string chug under calm's statement bars keeps drive while the lead waits.
  if (!brk && bar % 8 < 4) for (let s = 0; s < 8; s++) e.chug(war, secAt(bar, s * 0.5), r + 12, s % 2 === 0 ? 0.8 : 0.55);
  if (brk) for (let s = 0; s < 8; s++) e.chug(war, secAt(bar, s * 0.5), r + 12, s % 2 === 0 ? 0.9 : 0.6);
}

// Section boundaries: risers into every 8-bar downbeat, impacts landing on them.
for (const bar of [7, 15, 23, 31, 39]) e.riser(war, secAt(bar, 2), 2, 0.85);
for (const bar of [0, 8, 16, 24, 32]) {
  boom(war, secAt(bar, 0), 1);
  anvil(war, secAt(bar, 0), 1);
}

// The lead handoff: war answers in calm's rest bars, then owns the break outright.
play(war, WAR_ANSWER, (b, t, d, m, v) => e.stab(b, t, d, m, v), 0);
play(war, WAR_ANSWER_B, (b, t, d, m, v) => e.stab(b, t, d, m, v), 8);
play(war, WAR_ANSWER, (b, t, d, m, v) => e.stab(b, t, d, m, v), 16);
play(war, WAR_BREAK_THEME, (b, t, d, m, v) => e.stab(b, t, d, m, v), 24);
play(war, WAR_ANSWER, (b, t, d, m, v) => e.stab(b, t, d, m, v), 32);
play(war, [[7, 0, 1, 62, 0.6], [7, 2, 2, 64, 0.6]], (b, t, d, m, v) => e.stab(b, t, d, m, v), 32); // parting fifth over the last answer

// ----------------------------------------------------------------- master ----

function addReverb(b: Bus, amt: number): void {
  const sendL = new Float64Array(TOTAL);
  const sendR = new Float64Array(TOTAL);
  for (let i = 0; i < TOTAL; i++) {
    sendL[i] = b.L[i]! * amt;
    sendR[i] = b.R[i]! * amt;
  }
  const wet = e.reverb(sendL, sendR);
  for (let i = 0; i < TOTAL; i++) {
    b.L[i]! += wet.L[i]!;
    b.R[i]! += wet.R[i]!;
  }
}

e.pingPong(calm, 0.75 * BEAT, 0.3, 0.24);
addReverb(calm, 0.34);
addReverb(pulse, 0.14);
addReverb(war, 0.2);

/** Stem trim + soft transient shave: tanh(k·x)/k barely touches the body but compresses drum
 *  peaks, so the subset normalization isn't spent entirely on war's crest. */
function trim(b: Bus, gain: number, k: number): void {
  for (let i = 0; i < TOTAL; i++) {
    b.L[i] = Math.tanh(b.L[i]! * gain * k) / k;
    b.R[i] = Math.tanh(b.R[i]! * gain * k) / k;
  }
}
trim(calm, 1.9, 0.7);
trim(pulse, 1.5, 0.7);
trim(war, 1.0, 0.55);

// Normalize so every stem subset (all 7) peaks below 0.95.
const stems = { calm, pulse, war };
const names = Object.keys(stems) as (keyof typeof stems)[];
let maxPeak = 0;
let maxSubset = "";
const subsetPeaks: Record<string, number> = {};
for (let mask = 1; mask < 8; mask++) {
  const active = names.filter((_, i) => mask & (1 << i));
  let peak = 0;
  for (let i = 0; i < TOTAL; i++) {
    let l = 0;
    let r = 0;
    for (const nm of active) {
      l += stems[nm].L[i]!;
      r += stems[nm].R[i]!;
    }
    const p = Math.max(Math.abs(l), Math.abs(r));
    if (p > peak) peak = p;
  }
  subsetPeaks[active.join("+")] = peak;
  if (peak > maxPeak) {
    maxPeak = peak;
    maxSubset = active.join("+");
  }
}
const scale = 0.95 / maxPeak;
for (const nm of names) {
  for (let i = 0; i < TOTAL; i++) {
    stems[nm].L[i]! *= scale;
    stems[nm].R[i]! *= scale;
  }
}
console.log(`loop: ${(TOTAL / SR).toFixed(2)}s, ${TOTAL} samples/stem`);
console.log(`pre-scale subset peaks (scaled by ${scale.toFixed(3)}, loudest = ${maxSubset}):`);
for (const [k, v] of Object.entries(subsetPeaks)) console.log(`  ${k.padEnd(15)} ${(v * scale).toFixed(3)}`);

// Silence guard: every stem must have signal in every 1-second window.
for (const nm of names) {
  const win = SR;
  for (let w = 0; w * win < TOTAL; w++) {
    let m = 0;
    for (let i = w * win; i < Math.min((w + 1) * win, TOTAL); i++) m = Math.max(m, Math.abs(stems[nm].L[i]!), Math.abs(stems[nm].R[i]!));
    if (m < 0.008) throw new Error(`stem ${nm}: near-silent window at ${w}s (peak ${m.toFixed(5)})`);
  }
}

await writeWav(`${OUT_DIR}/dim-707-calm.wav`, calm.L, calm.R);
await writeWav(`${OUT_DIR}/dim-707-pulse.wav`, pulse.L, pulse.R);
await writeWav(`${OUT_DIR}/dim-707-war.wav`, war.L, war.R);
console.log(`wrote WAVs to ${OUT_DIR}`);

// ---------------------------------------------------- character analysis ----
// Calm alone vs full mix: RMS arc, spectral centroid, onset density.

function mono(b: Bus[]): Float64Array {
  const m = new Float64Array(TOTAL);
  for (let i = 0; i < TOTAL; i++) for (const s of b) m[i]! += (s.L[i]! + s.R[i]!) / 2;
  return m;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i]!, re[j]!] = [re[j]!, re[i]!];
      [im[i]!, im[j]!] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * wr - im[i + k + len / 2]! * wi;
        const vi = re[i + k + len / 2]! * wi + im[i + k + len / 2]! * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
}

/** Energy-flux envelope at 10ms hop — shared basis for cross-mix onset comparison. */
function energyFlux(sig: Float64Array): number[] {
  const hop = Math.round(0.01 * SR);
  const env: number[] = [];
  for (let ofs = 0; ofs + hop <= sig.length; ofs += hop) {
    let s = 0;
    for (let i = ofs; i < ofs + hop; i++) s += sig[i]! * sig[i]!;
    env.push(s);
  }
  return env.map((v, i) => Math.max(0, v - (env[i - 1] ?? 0)));
}

/** Count local flux maxima above a fixed absolute threshold. */
function onsetsAbove(flux: number[], thresh: number): number {
  let n = 0;
  for (let i = 1; i < flux.length - 1; i++) if (flux[i]! > thresh && flux[i]! >= flux[i - 1]! && flux[i]! > flux[i + 1]!) n++;
  return n;
}

function analyze(label: string, sig: Float64Array): void {
  const win = SR; // 1s RMS windows
  const arcs: number[] = [];
  for (let w = 0; w * win < sig.length; w++) {
    let sum = 0;
    let cnt = 0;
    for (let i = w * win; i < Math.min((w + 1) * win, sig.length); i++, cnt++) sum += sig[i]! * sig[i]!;
    arcs.push(Math.sqrt(sum / cnt));
  }
  const rms = Math.sqrt(arcs.reduce((a, v) => a + v * v, 0) / arcs.length);
  // Spectral centroid, 4096-pt frames.
  const N = 4096;
  let centSum = 0;
  let centW = 0;
  for (let ofs = 0; ofs + N <= sig.length; ofs += N * 4) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = sig[ofs + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const mag = Math.hypot(re[k]!, im[k]!);
      centSum += ((k * SR) / N) * mag;
      centW += mag;
    }
  }
  const arcStr = arcs.map((v) => v.toFixed(2)).join(" ");
  console.log(`\n${label}: RMS ${rms.toFixed(3)}, centroid ${(centSum / centW).toFixed(0)} Hz`);
  console.log(`  RMS arc (1s): ${arcStr}`);
}

const calmMono = mono([calm]);
const cpMono = mono([calm, pulse]);
const fullMono = mono([calm, pulse, war]);
analyze("calm alone", calmMono);
analyze("calm+pulse", cpMono);
analyze("full mix  ", fullMono);

// Onset density against one shared absolute threshold (2% of the full mix's peak flux).
const fullFlux = energyFlux(fullMono);
const thresh = 0.02 * fullFlux.reduce((a, v) => Math.max(a, v), 0);
const dur = TOTAL / SR;
console.log(`\nonset density (shared threshold): calm ${(onsetsAbove(energyFlux(calmMono), thresh) / dur).toFixed(1)}/s, calm+pulse ${(onsetsAbove(energyFlux(cpMono), thresh) / dur).toFixed(1)}/s, full ${(onsetsAbove(fullFlux, thresh) / dur).toFixed(1)}/s`);
