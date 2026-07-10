/**
 * Dimension 705 "The Sundered Crowns" — adaptive music, take two.
 *
 * Composed vertically, but the SUBSTRATE is designed war-first:
 *   - 140 BPM grid: war percussion runs 8ths/16ths natively; calm rides the same grid
 *     in half-time (whole/half-note melody), so doubling event density never changes the loop.
 *   - D phrygian over a static tonic pedal. No functional cadences, no raised 6th: the bed
 *     is dark and inert, so war's added dissonance (Eb pedal, D-Ab tritone, b2 jabs) lands
 *     as intent instead of a wrong note. Calm restricts itself to the minor-pentatonic
 *     subset (D F G A C) — modally neutral-dark, never sweet.
 *   - Harmony is one 8-bar cell (D pedal, dip to C and Bb, return) repeated with different
 *     orchestration each phrase; harmonic rhythm stays slow so war can own the motion.
 *
 * Melody handoff: the lute states the theme in the A phrases; in B and the C peak the lute
 * retreats to arpeggio texture and the war brass takes a phrygianized transform of the same
 * theme an octave down, in parallel fifths at the peak. War also answers in every rest the
 * calm melody leaves. Soloing war+calm should read as a combat track with a quiet cousin.
 *
 * Renders 3 stems (calm/pulse/war), identical sample counts, wrap-add loop tails, circular
 * 2-pass effects, then verifies: subset-sum peaks, per-stem stats, and character metrics
 * (RMS arc, spectral centroid, onset density) for calm-alone vs full mix.
 *
 * Usage: bun dim-705-adaptive-v2.ts <outDir>
 */
import { createEngine, writeWav, SR, type Bus } from "./dim-706-engine";

const BPM = 140;
const BARS = 48; // 48 * 4 * 60/140 ≈ 82.3 s
const E = createEngine({ seed: 70517, bpm: BPM, bars: BARS });
const { BEAT, TOTAL } = E;

const OUT_DIR = process.argv[2] ?? ".";

// ------------------------------------------------------------------ harmony ----
// One 8-bar cell: four bars of D pedal, dip to C and Bb (bVII, bVI — plagal-dark,
// non-functional), and back. Midi roots in the great octave.
const CELL = [38, 38, 38, 38, 36, 34, 36, 38];
const rootAt = (bar: number): number => CELL[bar % 8]!;

// Phrases: A1 A2 B C break A' — 8 bars each.
const phraseOf = (bar: number): number => Math.floor(bar / 8);

// ------------------------------------------------------------------- voices ----

/** Karplus-Strong lute — the calm figure. Two slightly detuned strings per note. */
function lute(b: Bus, t: number, durBeats: number, midi: number, vel: number, pan = -0.12): void {
  for (const det of [0, 4]) {
    const f = E.mtof(midi) * E.cents(det);
    const N = Math.max(2, Math.round(SR / f - 0.5));
    const dl = new Float64Array(N);
    const nz = new Float64Array(N);
    for (let i = 0; i < N; i++) nz[i] = E.rng() * 2 - 1;
    const pick = Math.max(1, Math.round(N * 0.27));
    for (let i = 0; i < N; i++) dl[i] = nz[i]! - 0.85 * nz[(i + pick) % N]!;
    const ring = Math.min(durBeats * BEAT + 0.6, 2.4);
    const n = Math.round(ring * SR);
    const out = new Float64Array(n);
    const decay = Math.exp(-N / (SR * 1.1));
    const alpha = 1 - Math.exp((-2 * Math.PI * 3400) / SR);
    let pos = 0;
    let body = 0;
    for (let i = 0; i < n; i++) {
      const y = dl[pos]!;
      dl[pos] = decay * 0.5 * (y + dl[(pos + 1) % N]!);
      pos = (pos + 1) % N;
      body += alpha * (y - body);
      const dt = i / SR;
      const gate = dt < ring - 0.12 ? 1 : Math.max(0, (ring - dt) / 0.12);
      out[i] = body * Math.min(1, i / (0.0015 * SR)) * gate;
    }
    E.put(b, t, out, pan + det * 0.02, 0.78 * vel * (det === 0 ? 1 : 0.45));
  }
}

/** Tabor — field snare of the medieval march: skin thump plus rattle buzz. */
function tabor(b: Bus, t: number, vel: number): void {
  const n = Math.round(0.12 * SR);
  const out = new Float64Array(n);
  let lp = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    const nz = E.rng() * 2 - 1;
    lp += 0.22 * (nz - lp);
    const buzz = (nz - lp) * Math.exp(-dt / 0.045);
    phase += (2 * Math.PI * 192 * (1 + 0.45 * Math.exp(-dt / 0.01))) / SR;
    const thump = Math.sin(phase) * Math.exp(-dt / 0.035);
    out[i] = (buzz * 0.85 + thump * 0.8) * Math.min(1, i / (0.001 * SR)) * vel;
  }
  E.put(b, t, out, 0.2, 0.5);
}

/** Anvil — inharmonic clang, the sound of a field forge / sword on shield. */
let anvilFlip = 1;
function anvil(b: Bus, t: number, vel: number): void {
  const n = Math.round(0.5 * SR);
  const out = new Float64Array(n);
  const ratios = [1, 1.51, 2.03, 2.68, 3.42, 4.79];
  const phases = ratios.map(() => E.rng() * 6.28);
  const f0 = 1170;
  let hp = 0;
  for (let i = 0; i < n; i++) {
    const dt = i / SR;
    let s = 0;
    for (let k = 0; k < ratios.length; k++) {
      s += (Math.sin(2 * Math.PI * f0 * ratios[k]! * dt + phases[k]!) * Math.exp(-dt / (0.34 / Math.pow(k + 1, 0.85)))) / (k + 1);
    }
    const nz = E.rng() * 2 - 1;
    const strike = (nz - hp) * Math.exp(-dt / 0.0025) * 0.7;
    hp = nz * 0.9;
    out[i] = Math.tanh(1.4 * (s + strike)) * Math.min(1, i / (0.0006 * SR)) * vel;
  }
  anvilFlip = -anvilFlip;
  E.put(b, t, out, 0.32 * anvilFlip, 0.3);
}

// ------------------------------------------------------------------- themes ----
// [barOffset, beat, durBeats, midi, vel]
type Ev = [number, number, number, number, number];

// Calm theme — lute, D minor pentatonic only (no Eb, no 6th). Rests at bar 3 beat 3
// and bar 7 beat 3 are deliberate: war answers there.
const THEME: Ev[] = [
  [0, 0, 1.5, 62, 1.0], [0, 1.5, 0.5, 65, 0.7], [0, 2, 1, 67, 0.85], [0, 3, 1, 69, 0.9],
  [1, 0, 2, 72, 1.0], [1, 2, 1, 69, 0.8], [1, 3, 1, 67, 0.75],
  [2, 0, 1.5, 65, 0.9], [2, 1.5, 0.5, 67, 0.7], [2, 2, 2, 69, 0.95],
  [3, 0, 3, 62, 0.95],
  [4, 0, 1, 72, 0.9], [4, 1, 1, 70, 0.8], [4, 2, 2, 69, 0.9],
  [5, 0, 2, 65, 0.85], [5, 2, 1, 67, 0.7], [5, 3, 1, 65, 0.7],
  [6, 0, 2, 67, 0.85], [6, 2, 2, 65, 0.8],
  [7, 0, 3, 62, 0.95],
];

// War theme — same contour, octave down, phrygianized: Ab (tritone) replaces the sweet A
// in the call, the answer cadences Eb→D (the phrygian half-step), C-Bb-A descent stays.
const WAR_THEME: Ev[] = [
  [0, 0, 1.5, 50, 1.0], [0, 1.5, 0.5, 53, 0.8], [0, 2, 1, 55, 0.9], [0, 3, 1, 56, 1.0],
  [1, 0, 2, 60, 1.0], [1, 2, 1, 56, 0.85], [1, 3, 1, 55, 0.8],
  [2, 0, 1.5, 53, 0.9], [2, 1.5, 0.5, 55, 0.75], [2, 2, 2, 57, 0.95],
  [3, 0, 2, 51, 1.0], [3, 2, 2, 50, 0.95],
  [4, 0, 1, 60, 0.9], [4, 1, 1, 58, 0.85], [4, 2, 2, 57, 0.9],
  [5, 0, 2, 53, 0.85], [5, 2, 1, 55, 0.75], [5, 3, 1, 53, 0.75],
  [6, 0, 2, 55, 0.9], [6, 2, 2, 51, 0.95],
  [7, 0, 3, 50, 1.0],
];

// Lute arpeggio chord tones per root (B section texture while war owns the figure).
const ARP: Record<number, number[]> = {
  38: [62, 69, 74, 77], // D A D F
  36: [60, 67, 72, 74], // C G C D
  34: [58, 65, 70, 74], // Bb F Bb D
};
const ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 1];

// -------------------------------------------------------------------- stems ----

const calm = E.bus();
const pulse = E.bus();
const war = E.bus();

const at = (bar: number, beat: number): number => E.secAt(bar, beat);

// ---- CALM: a real piece — melody-led, its own arc, designed low end. Half-time feel.
{
  // Pedal drone (D3+A3) all the way through, swelling with the form. This is the bed
  // that tolerates war's dissonance: static root+fifth, no third.
  const droneVel = [0.5, 0.58, 0.66, 0.74, 0.5, 0.58];
  for (let p = 0; p < 6; p++) E.drone(calm, at(p * 8, 0), 32, 50, droneVel[p]!);

  // Low end: whole-note bass following the 8-bar cell. Tacet in the first half of the
  // break so the return of the low D lands as an event.
  for (let bar = 0; bar < BARS; bar++) {
    const p = phraseOf(bar);
    if (p === 4 && bar < 36) continue;
    const vel = p === 3 ? 0.38 : 0.3;
    E.bass(calm, at(bar, 0), 3.6, rootAt(bar), vel);
    if (p === 3) E.bass(calm, at(bar, 2), 1.6, rootAt(bar), 0.26);
  }

  const playTheme = (startBar: number, transpose: number, vel: number): void => {
    for (const [bo, beat, dur, midi, v] of THEME) lute(calm, at(startBar + bo, beat), dur, midi + transpose, vel * v);
  };

  // A1: theme, unaccompanied but for drone and bass.
  playTheme(0, 0, 0.9);
  // A2: theme again, flute shadowing the long tones an octave up — the calm piece grows.
  playTheme(8, 0, 0.95);
  E.flute(calm, at(9, 0), 2, 84, 0.28);
  E.flute(calm, at(11, 0), 3, 74, 0.3);
  E.flute(calm, at(14, 0), 2, 79, 0.28);
  E.flute(calm, at(15, 0), 3, 74, 0.3);
  // B: lute steps back to arpeggio texture (this is the handoff), flute takes one long
  // slow line — in calm-alone this is the "opening up" middle; in the mix war's brass
  // is the figure here.
  for (let bar = 16; bar < 24; bar++) {
    const tones = ARP[rootAt(bar)]!;
    for (let k = 0; k < 8; k++) lute(calm, at(bar, k * 0.5), 0.5, tones[ARP_ORDER[k]!]!, 0.42, -0.05 + (k % 2) * 0.14);
  }
  const bLine: Ev[] = [[16, 0, 4, 74, 1], [17, 0, 4, 72, 1], [18, 0, 4, 69, 1], [19, 0, 3, 67, 1], [20, 0, 4, 72, 1], [21, 0, 4, 70, 1], [22, 0, 6, 69, 1]];
  for (const [bo, beat, dur, midi] of bLine) E.flute(calm, at(bo, beat), dur, midi, 0.4);
  // C peak: theme up an octave, lighter touch — shimmer above the war fanfare.
  playTheme(24, 12, 0.62);
  // Break: thin to fragments and air.
  const frag: Ev[] = [[32, 0, 2, 62, 0.6], [33, 2, 1, 65, 0.5], [33, 3, 1, 67, 0.5], [34, 0, 3, 69, 0.6], [36, 0, 2, 72, 0.55], [37, 0, 2, 69, 0.5], [38, 0, 3, 65, 0.55], [39, 2, 2, 67, 0.45]];
  for (const [bo, beat, dur, midi, v] of frag) lute(calm, at(bo, beat), dur, midi, v);
  E.flute(calm, at(35, 0), 4, 74, 0.26);
  // A': full statement, flute answering — wraps cleanly into bar 0.
  playTheme(40, 0, 0.9);
  E.flute(calm, at(43, 0), 2, 74, 0.28);
  E.flute(calm, at(47, 0), 3, 74, 0.3);
}

// ---- PULSE: danger nearby — the march coalesces. Grid articulation, no melody.
{
  for (let bar = 0; bar < BARS; bar++) {
    const p = phraseOf(bar);
    const brk = p === 4;
    const lift = p >= 2 && p !== 4;
    // Taiko heartbeat on 1 and 3.
    E.taiko(pulse, at(bar, 0), brk ? 0.45 : 0.6);
    if (!brk) E.taiko(pulse, at(bar, 2), 0.62);
    if (lift) E.taiko(pulse, at(bar, 3.5), 0.4, 1.2);
    // Tabor backbeat march.
    if (!brk) {
      tabor(pulse, at(bar, 1), 0.42);
      tabor(pulse, at(bar, 3), 0.48);
      if (lift) tabor(pulse, at(bar, 3.5), 0.32);
    }
    // Shaker 8ths keep the 140 grid audible even under the half-time calm.
    for (let k = 0; k < 8; k++) {
      if (brk && k % 2 === 1) continue;
      E.shaker(pulse, at(bar, k * 0.5), k % 2 === 0 ? 0.9 : 0.55);
    }
    // Short marching bass on 1 and 3 — articulates the pedal the calm bass sustains.
    if (!brk) {
      E.bass(pulse, at(bar, 0), 0.45, rootAt(bar), 0.42);
      E.bass(pulse, at(bar, 2), 0.45, rootAt(bar), 0.38);
      if (p === 3) {
        E.bass(pulse, at(bar, 1), 0.3, rootAt(bar), 0.3);
        E.bass(pulse, at(bar, 3), 0.3, rootAt(bar), 0.32);
      }
    }
  }
  E.riser(pulse, at(23, 2), 2, 0.5);
}

// ---- WAR: owns the figure. Double event density, phrygian brass theme, dissonance
// against the static bed, anvils and rolls.
{
  const intensity = [0.8, 0.9, 0.95, 1.0, 0.55, 0.95];
  for (let bar = 0; bar < BARS; bar++) {
    const p = phraseOf(bar);
    const g = intensity[p]!;
    const brk = p === 4;
    if (brk) {
      E.taiko(war, at(bar, 0), 0.7 * g + 0.3);
      E.taiko(war, at(bar, 2), 0.6 * g + 0.25);
      if (bar % 2 === 1) for (let k = 0; k < 4; k++) tabor(war, at(bar, 3 + k * 0.25), 0.2 + 0.1 * k);
      continue;
    }
    // Doubled taiko grid: 1, & of 1, 2&, 3, & of 3, 4& — twice the pulse layer's density.
    const hits: [number, number, number][] = [
      [0, 0.95, 1], [1, 0.5, 1.25], [1.5, 0.55, 1], [2, 0.9, 1], [3, 0.5, 1.25], [3.5, 0.6, 1],
    ];
    for (const [beat, v, pitch] of hits) E.taiko(war, at(bar, beat), v * g, pitch);
    // Tabor: hard backbeat plus 16th rolls into downbeats.
    tabor(war, at(bar, 1), 0.62 * g);
    tabor(war, at(bar, 3), 0.66 * g);
    if (bar % 2 === 1 || p === 3) for (let k = 0; k < 4; k++) tabor(war, at(bar, 3 + k * 0.25), (0.24 + 0.12 * k) * g);
    // Anvils: the sword-on-shield backbeat, from B onward.
    if (p >= 2) {
      anvil(war, at(bar, 1), 0.5 * g);
      anvil(war, at(bar, 3), 0.55 * g);
      if (p === 3) anvil(war, at(bar, 2.5), 0.4);
    }
  }
  // Long 16th roll out of the last bar into the loop head.
  for (let k = 0; k < 8; k++) tabor(war, at(47, 2 + k * 0.25), 0.25 + 0.07 * k);

  E.gong(war, at(0, 0), 0.55);
  E.gong(war, at(24, 0), 0.7, 61.7);
  E.riser(war, at(15, 2), 2, 0.6);
  E.riser(war, at(23, 0), 4, 0.9);
  E.riser(war, at(39, 2), 2, 0.6);

  // Low war drone (D2+A2) for body — war+calm must sound like a combat track on its own.
  for (const p of [0, 1, 2, 3, 5]) E.drone(war, at(p * 8, 0), 32, 38, 0.4);

  // Brass answers in the calm theme's rests (A phrases): the b2 sigh, then the tritone call.
  for (const start of [0, 8, 40]) {
    E.stab(war, at(start + 3, 2.5), 0.5, 51, 0.8);
    E.stab(war, at(start + 3, 3), 1, 50, 0.85);
    E.stab(war, at(start + 7, 0), 0.5, 50, 0.8);
    E.stab(war, at(start + 7, 0.5), 0.5, 53, 0.8);
    E.stab(war, at(start + 7, 1), 1.5, 56, 0.9);
    E.stab(war, at(start + 7, 3), 1, 50, 0.85);
  }
  // B: war brass takes the theme.
  for (const [bo, beat, dur, midi, v] of WAR_THEME) E.stab(war, at(16 + bo, beat), dur, midi, 0.95 * v);
  // C peak: theme in parallel fifths (organum fanfare) over an Eb+Bb drone that grinds
  // a half-step against the D bed — the substrate was chosen to carry exactly this.
  for (const [bo, beat, dur, midi, v] of WAR_THEME) {
    E.stab(war, at(24 + bo, beat), dur, midi, 1.0 * v);
    E.stab(war, at(24 + bo, beat), dur, midi + 7, 0.55 * v);
  }
  E.drone(war, at(24, 0), 32, 51, 0.5);
  // Chug engine: 8ths in A2's back half, 16ths through B and C, Eb-inflected ostinato
  // in the break's back half.
  for (let bar = 12; bar < 16; bar++) for (let k = 0; k < 8; k++) E.chug(war, at(bar, k * 0.5), 50, 0.42);
  for (let bar = 20; bar < 32; bar++) {
    for (let k = 0; k < 16; k++) {
      const midi = k === 12 ? 51 : 50;
      E.chug(war, at(bar, k * 0.25), midi, k % 4 === 0 ? 0.5 : 0.34, 0.09);
    }
  }
  const ost = [50, 50, 51, 50, 50, 53, 51, 50];
  for (let bar = 36; bar < 40; bar++) for (let k = 0; k < 8; k++) E.chug(war, at(bar, k * 0.5), ost[k]!, 0.36);
  // Break: distant horn calls keep the field dangerous.
  E.stab(war, at(33, 0), 3, 50, 0.6);
  E.stab(war, at(35, 0), 3, 51, 0.55);
  E.stab(war, at(37, 0), 2, 48, 0.6);
  // A': war restates the theme's call under the lute — the figure stays with the brass.
  for (const [bo, beat, dur, midi, v] of WAR_THEME) {
    if (bo >= 4 && bo < 7) continue; // leave the descent to the lute, rejoin for the cadence
    E.stab(war, at(40 + bo, beat), dur, midi, 0.85 * v);
  }
}

// ------------------------------------------------------------------ effects ----
// Per-stem sends into the circular 2-pass reverb; seam-continuous by construction.

function addWet(stem: Bus, send: number): void {
  const sl = new Float64Array(TOTAL);
  const sr = new Float64Array(TOTAL);
  for (let i = 0; i < TOTAL; i++) {
    sl[i] = stem.L[i]! * send;
    sr[i] = stem.R[i]! * send;
  }
  const wet = E.reverb(sl, sr);
  for (let i = 0; i < TOTAL; i++) {
    stem.L[i]! += wet.L[i]!;
    stem.R[i]! += wet.R[i]!;
  }
}

E.pingPong(calm, BEAT * 0.75, 0.32, 0.16); // dotted-8th echo on the lute/flute
addWet(calm, 0.32);
addWet(pulse, 0.1);
addWet(war, 0.14);

// ------------------------------------------------------- normalize & verify ----

const stems: [string, Bus][] = [["calm", calm], ["pulse", pulse], ["war", war]];

function subsetPeak(mask: number): number {
  let peak = 0;
  for (let i = 0; i < TOTAL; i++) {
    let l = 0;
    let r = 0;
    for (let s = 0; s < 3; s++) {
      if (!(mask & (1 << s))) continue;
      l += stems[s]![1].L[i]!;
      r += stems[s]![1].R[i]!;
    }
    const m = Math.max(Math.abs(l), Math.abs(r));
    if (m > peak) peak = m;
  }
  return peak;
}

let maxPeak = 0;
for (let mask = 1; mask < 8; mask++) maxPeak = Math.max(maxPeak, subsetPeak(mask));
const scale = 0.97 / maxPeak;
for (const [, b] of stems) {
  for (let i = 0; i < TOTAL; i++) {
    b.L[i]! *= scale;
    b.R[i]! *= scale;
  }
}
console.log(`pre-normalize max subset peak ${maxPeak.toFixed(3)} → scaled by ${scale.toFixed(3)}`);
for (let mask = 1; mask < 8; mask++) {
  const names = stems.filter((_, s) => mask & (1 << s)).map(([n]) => n).join("+");
  console.log(`  subset ${names.padEnd(15)} peak ${subsetPeak(mask).toFixed(3)}`);
}

const db = (x: number): string => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);

for (const [name, b] of stems) {
  let peak = 0;
  let sum = 0;
  let minSecRms = Infinity;
  for (let sec = 0; sec * SR < TOTAL; sec++) {
    let acc = 0;
    const n0 = sec * SR;
    const n1 = Math.min(TOTAL, n0 + SR);
    for (let i = n0; i < n1; i++) {
      const l = b.L[i]!;
      const r = b.R[i]!;
      acc += l * l + r * r;
      const m = Math.max(Math.abs(l), Math.abs(r));
      if (m > peak) peak = m;
    }
    sum += acc;
    minSecRms = Math.min(minSecRms, Math.sqrt(acc / (2 * (n1 - n0))));
  }
  const rms = Math.sqrt(sum / (2 * TOTAL));
  console.log(`stem ${name.padEnd(6)} peak ${db(peak)} dBFS  rms ${db(rms)} dBFS  quietest-second rms ${db(minSecRms)} dBFS`);
}
console.log(`duration ${(TOTAL / SR).toFixed(2)} s, ${TOTAL} samples per stem`);

// ---- character verification: calm-alone vs full mix.

function mono(mask: number): Float64Array {
  const m = new Float64Array(TOTAL);
  for (let s = 0; s < 3; s++) {
    if (!(mask & (1 << s))) continue;
    const b = stems[s]![1];
    for (let i = 0; i < TOTAL; i++) m[i]! += (b.L[i]! + b.R[i]!) * 0.5;
  }
  return m;
}

function fftMag(frame: Float64Array): Float64Array {
  const n = frame.length;
  const re = frame.slice();
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i]!, im[i]!);
  return mag;
}

function character(name: string, m: Float64Array): void {
  // RMS arc in 16 bins.
  const bins = 16;
  const arc: string[] = [];
  const binN = Math.floor(TOTAL / bins);
  for (let k = 0; k < bins; k++) {
    let acc = 0;
    for (let i = k * binN; i < (k + 1) * binN; i++) acc += m[i]! * m[i]!;
    arc.push(db(Math.sqrt(acc / binN)));
  }
  // Energy-weighted spectral centroid, 4096-sample frames.
  const F = 4096;
  let centAcc = 0;
  let eAcc = 0;
  const win = new Float64Array(F);
  for (let i = 0; i < F; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / F);
  const frame = new Float64Array(F);
  for (let n0 = 0; n0 + F <= TOTAL; n0 += F) {
    for (let i = 0; i < F; i++) frame[i] = m[n0 + i]! * win[i]!;
    const mag = fftMag(frame);
    let num = 0;
    let den = 0;
    for (let i = 1; i < mag.length; i++) {
      num += mag[i]! * ((i * SR) / F);
      den += mag[i]!;
    }
    const e = den;
    centAcc += (num / Math.max(den, 1e-9)) * e;
    eAcc += e;
  }
  // Onset density: energy-flux peaks, 512-hop, 90 ms refractory.
  const hop = 512;
  const energies: number[] = [];
  for (let n0 = 0; n0 + hop <= TOTAL; n0 += hop) {
    let e = 0;
    for (let i = n0; i < n0 + hop; i++) e += m[i]! * m[i]!;
    energies.push(e);
  }
  let onsets = 0;
  let lastOnset = -1e9;
  for (let k = 8; k < energies.length; k++) {
    const local = energies.slice(k - 8, k).reduce((a, b) => a + b, 0) / 8;
    if (energies[k]! > local * 1.9 && energies[k]! > 1e-5 && k - lastOnset > (0.09 * SR) / hop) {
      onsets++;
      lastOnset = k;
    }
  }
  console.log(`\n[${name}]`);
  console.log(`  rms arc (dBFS): ${arc.join(" ")}`);
  console.log(`  spectral centroid ${(centAcc / eAcc).toFixed(0)} Hz   onsets/min ${((onsets / (TOTAL / SR)) * 60).toFixed(0)}`);
}

character("calm alone", mono(1));
character("full mix  ", mono(7));

// -------------------------------------------------------------------- write ----

for (const [name, b] of stems) await writeWav(`${OUT_DIR}/dim-705-v2-${name}.wav`, b.L, b.R);
console.log(`\nwrote WAVs to ${OUT_DIR}`);
