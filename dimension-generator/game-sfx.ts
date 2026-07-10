/**
 * Foley suite for the game — every SFX synthesized note-by-note from DSP primitives
 * (shaped noise, pitch envelopes, Karplus-Strong plucks, inharmonic ring-mod metal),
 * tuned to the same D-Phrygian world as the dim-706 combat track so pitched cues
 * (loot chimes, turn cue, combat sting, deny buzz) share one tonal register.
 *
 *   bun dimension-generator/game-sfx.ts <outDir>       # writes <name>.ogg per sound
 *
 * Deterministic: each sound seeds its own RNG from its name, so renders are
 * bit-identical regardless of order. Every file is DC-blocked, peak-normalized to
 * -3 dBFS, and sanity-checked (duration bounds, non-silence) before encoding.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const SR = 44100;
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const D = { d2: mtof(38), d3: mtof(50), eb3: mtof(51), f3: mtof(53), d4: mtof(62), f4: mtof(65), d5: mtof(74), f5: mtof(77), a5: mtof(81), c6: mtof(84), d6: mtof(86) };

let rngState = 1;
function rng(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function seedFrom(name: string): void {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  rngState = h | 0;
}

// ------------------------------------------------------------ primitives ----

const secs = (s: number): number => Math.round(s * SR);
const noise = (): number => rng() * 2 - 1;

/** attack/decay envelope: linear attack, exponential decay after. */
function ad(i: number, attackSec: number, tau: number): number {
  const a = attackSec * SR;
  return i < a ? i / a : Math.exp(-(i - a) / (tau * SR));
}

function onePoleLP(fc: number): (x: number) => number {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  return (x) => (y += a * (x - y));
}

function onePoleHP(fc: number): (x: number) => number {
  const lp = onePoleLP(fc);
  return (x) => x - lp(x);
}

/** Resonant state-variable bandpass; `fc` may vary per call. */
function svfBP(q: number): (x: number, fc: number) => number {
  let lp = 0;
  let bp = 0;
  return (x, fc) => {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, 16000)) / SR);
    lp += f * bp;
    const hp = x - lp - (1 / q) * bp;
    bp += f * hp;
    return bp;
  };
}

/** Karplus-Strong pluck. damp 0=ringing wire, 1=dead thunk. bright 0..1 filters the excitation. */
function ks(freq: number, durSec: number, damp: number, bright: number): Float64Array {
  const n = secs(durSec);
  const out = new Float64Array(n);
  const N = Math.max(2, Math.round(SR / freq));
  const buf = new Float64Array(N);
  const exciteLP = onePoleLP(800 + bright * 7000);
  for (let i = 0; i < N; i++) buf[i] = exciteLP(noise());
  const fb = 0.998 - damp * 0.06;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[p]!;
    out[i] = cur;
    buf[p] = (cur + buf[(p + 1) % N]!) * 0.5 * fb;
    p = (p + 1) % N;
  }
  return out;
}

/** Inharmonic partial stack with a slow ring-mod shimmer — bells and clangs. */
function metal(base: number, ratios: number[], tau: number, durSec: number, ringHz = 0): Float64Array {
  const n = secs(durSec);
  const out = new Float64Array(n);
  const phases = ratios.map(() => rng() * 6.28);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < ratios.length; k++) {
      s += (Math.sin(2 * Math.PI * base * ratios[k]! * t + phases[k]!) * Math.exp(-t / (tau / Math.pow(k + 1, 0.6)))) / (k + 1);
    }
    if (ringHz > 0) s *= 0.6 + 0.4 * Math.sin(2 * Math.PI * ringHz * t);
    out[i] = s * Math.min(1, i / (0.001 * SR));
  }
  return out;
}

/** Sine with an exponential pitch drop — thuds, plunks, booms. */
function drop(f0: number, f1: number, dropTau: number, ampTau: number, durSec: number, attack = 0.001): Float64Array {
  const n = secs(durSec);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / dropTau))) / SR;
    out[i] = Math.sin(phase) * ad(i, attack, ampTau);
  }
  return out;
}

/** Bandpass-noise gesture: cutoff glides f0→f1, amplitude ad(attack,tau) — whooshes. */
function whoosh(f0: number, f1: number, q: number, attackSec: number, tau: number, durSec: number): Float64Array {
  const n = secs(durSec);
  const out = new Float64Array(n);
  const bp = svfBP(q);
  for (let i = 0; i < n; i++) {
    const x01 = i / n;
    out[i] = bp(noise(), f0 * Math.pow(f1 / f0, x01)) * ad(i, attackSec, tau);
  }
  return out;
}

/** Short filtered-noise grain at `at` seconds — gravel, rustle, debris. */
function grain(out: Float64Array, atSec: number, durSec: number, fc: number, gain: number): void {
  const start = secs(atSec);
  const n = secs(durSec);
  const lp = onePoleLP(fc);
  for (let i = 0; i < n && start + i < out.length; i++) {
    out[start + i]! += lp(noise()) * ad(i, 0.0015, durSec / 4) * gain;
  }
}

function mix(durSec: number, ...layers: [Float64Array, number, number][]): Float64Array {
  const out = new Float64Array(secs(durSec));
  for (const [buf, gain, atSec] of layers) {
    const start = secs(atSec);
    for (let i = 0; i < buf.length && start + i < out.length; i++) out[start + i]! += buf[i]! * gain;
  }
  return out;
}

const drive = (buf: Float64Array, amt: number): Float64Array => buf.map((x) => Math.tanh(x * amt));

/** Fade the last `ms` to zero so no file ends on a cliff. */
function fadeOut(buf: Float64Array, ms: number): Float64Array {
  const n = Math.min(buf.length, secs(ms / 1000));
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i]! *= i / n;
  return buf;
}

// -------------------------------------------------------------- the suite ----

type Synth = () => Float64Array;
const SOUNDS: Record<string, Synth> = {};

// ---- UI: dark wood, leather, and stone — no arcade bleeps ----

SOUNDS["ui-click"] = () =>
  mix(0.07, [ks(D.d6, 0.06, 0.9, 0.35), 0.9, 0], [drop(240, 170, 0.01, 0.015, 0.05), 0.7, 0]);

SOUNDS["ui-hover"] = () => {
  const out = new Float64Array(secs(0.035));
  grain(out, 0, 0.03, 3200, 1);
  return out;
};

SOUNDS["ui-equip"] = () => {
  const snap = new Float64Array(secs(0.05));
  grain(snap, 0, 0.04, 2200, 1);
  return mix(0.12, [snap, 0.8, 0], [metal(880, [1, 1.63, 2.41], 0.05, 0.1), 0.35, 0.008], [drop(180, 90, 0.02, 0.05, 0.11), 0.9, 0.004]);
};

SOUNDS["ui-unequip"] = () => {
  const felt = new Float64Array(secs(0.06));
  grain(felt, 0, 0.05, 900, 1);
  return mix(0.1, [felt, 0.7, 0], [drop(150, 78, 0.03, 0.045, 0.1), 0.9, 0.01]);
};

SOUNDS["ui-bag-take"] = () => {
  const rustle = new Float64Array(secs(0.09));
  grain(rustle, 0, 0.035, 1600, 0.8);
  grain(rustle, 0.03, 0.05, 1100, 0.6);
  return mix(0.11, [rustle, 0.8, 0], [ks(D.d5, 0.07, 0.95, 0.25), 0.7, 0.025]);
};

SOUNDS["ui-deny"] = () => {
  // Double-knock on the phrygian b2 — reads "wrong" against the D world without buzzing.
  const knock = (): Float64Array => drive(drop(D.eb3, D.eb3 * 0.97, 0.05, 0.028, 0.055), 2.2);
  return mix(0.12, [knock(), 1, 0], [knock(), 0.85, 0.06]);
};

// ---- Loot chimes: one voice, rising craftsmanship with rarity ----

function lootArp(midis: number[], noteGap: number, damp: number, bright: number, ringSec: number, bell: number): Float64Array {
  const dur = noteGap * midis.length + ringSec;
  const layers: [Float64Array, number, number][] = [];
  midis.forEach((m, i) => {
    layers.push([ks(mtof(m), ringSec, damp, bright), 0.9 - i * 0.06, i * noteGap]);
    if (bell > 0) layers.push([metal(mtof(m) * 2, [1, 2.76, 5.4], ringSec * 0.5, ringSec), bell, i * noteGap]);
  });
  return mix(dur, ...layers);
}

SOUNDS["loot-common"] = () => mix(0.16, [ks(D.d5, 0.14, 0.85, 0.3), 1, 0]); // dull wooden knock
SOUNDS["loot-uncommon"] = () => lootArp([74, 81], 0.09, 0.5, 0.5, 0.18, 0);
SOUNDS["loot-rare"] = () => lootArp([74, 77, 81], 0.08, 0.3, 0.65, 0.28, 0.12);
SOUNDS["loot-epic"] = () => lootArp([74, 77, 81, 84], 0.075, 0.18, 0.75, 0.4, 0.2);
SOUNDS["loot-legendary"] = () => {
  const arp = lootArp([74, 77, 81, 84, 86], 0.07, 0.1, 0.85, 0.55, 0.3);
  const sparkle = whoosh(6000, 11000, 1.5, 0.15, 0.25, 0.7);
  return mix(0.85, [arp, 1, 0], [sparkle, 0.12, 0.1], [drop(D.d2 * 2, D.d2, 0.1, 0.3, 0.8, 0.05), 0.35, 0]);
};

// ---- Weapon attacks: one per TrailEffect, 3 seeded/detuned variants each ----

function slash(pitch: number): Float64Array {
  const body = whoosh(2800 * pitch, 650 * pitch, 2.2, 0.012, 0.05, 0.18);
  const edge = whoosh(9000 * pitch, 5000 * pitch, 1.2, 0.008, 0.025, 0.09);
  return mix(0.18, [body, 1, 0], [edge, 0.4, 0]);
}

function thrust(pitch: number): Float64Array {
  const jab = whoosh(900 * pitch, 3800 * pitch, 3.5, 0.006, 0.03, 0.13);
  return mix(0.14, [jab, 1, 0], [drop(300 * pitch, 180 * pitch, 0.015, 0.02, 0.06), 0.5, 0]);
}

function projectile(pitch: number): Float64Array {
  const twang = ks(D.d4 * pitch, 0.2, 0.45, 0.7);
  const air = whoosh(1600 * pitch, 380 * pitch, 2.5, 0.01, 0.06, 0.2);
  return mix(0.22, [twang, 0.8, 0], [air, 0.7, 0.012]);
}

function explosion(pitch: number): Float64Array {
  const boom = drop(130 * pitch, 38 * pitch, 0.06, 0.14, 0.45);
  const rumbleLP = onePoleLP(850 * pitch);
  const rumble = new Float64Array(secs(0.45));
  for (let i = 0; i < rumble.length; i++) rumble[i] = rumbleLP(noise()) * ad(i, 0.004, 0.11);
  const out = mix(0.45, [boom, 1.1, 0], [rumble, 0.9, 0]);
  for (let k = 0; k < 6; k++) grain(out, 0.02 + rng() * 0.15, 0.02, 2500, 0.4);
  return drive(out, 1.8);
}

function splash(pitch: number): Float64Array {
  const out = new Float64Array(secs(0.3));
  const plunk = drop(950 * pitch, 320 * pitch, 0.02, 0.03, 0.08);
  for (let i = 0; i < plunk.length; i++) out[i]! += plunk[i]! * 0.8;
  // Bubbles: short resonant blips at random watery pitches, sinking over time.
  for (let k = 0; k < 9; k++) {
    const at = 0.02 + rng() * 0.2;
    const bp = svfBP(9);
    const fc = (600 + rng() * 1600) * pitch * (1 - at);
    const start = secs(at);
    for (let i = 0; i < secs(0.045) && start + i < out.length; i++) {
      out[start + i]! += bp(noise(), fc) * ad(i, 0.002, 0.012) * 0.7;
    }
  }
  const wash = whoosh(2200 * pitch, 700 * pitch, 1.4, 0.015, 0.09, 0.3);
  for (let i = 0; i < out.length; i++) out[i]! += wash[i]! * 0.5;
  return out;
}

const TRAILS: Record<string, (p: number) => Float64Array> = { slash, thrust, projectile, explosion, splash };
for (const [name, fn] of Object.entries(TRAILS)) {
  [1, 1.07, 0.93].forEach((pitch, i) => {
    SOUNDS[`${name}-${i + 1}`] = () => fn(pitch);
  });
}

// ---- Impacts ----

SOUNDS["hit-flesh"] = () => {
  const smack = new Float64Array(secs(0.06));
  const bp = svfBP(1.8);
  for (let i = 0; i < smack.length; i++) smack[i] = bp(noise(), 900) * ad(i, 0.002, 0.018);
  return drive(mix(0.16, [drop(185, 68, 0.025, 0.055, 0.15), 1.1, 0], [smack, 1, 0]), 1.6);
};

SOUNDS["hit-block"] = () => {
  const clang = metal(520, [1, 1.51, 2.26, 3.09, 4.17], 0.14, 0.32, 173);
  const strike = new Float64Array(secs(0.03));
  grain(strike, 0, 0.02, 6000, 1);
  return mix(0.32, [clang, 0.9, 0], [strike, 0.8, 0], [drop(160, 90, 0.015, 0.03, 0.08), 0.6, 0]);
};

SOUNDS["wall-slam"] = () => {
  const out = mix(0.38, [drop(95, 42, 0.05, 0.11, 0.38), 1.2, 0]);
  for (let k = 0; k < 8; k++) grain(out, rng() * 0.12, 0.015 + rng() * 0.02, 1200, 0.65);
  grain(out, 0.15, 0.18, 500, 0.25); // dust tail
  return drive(out, 1.7);
};

SOUNDS["knockback-whoosh"] = () => {
  const n = secs(0.25);
  const out = new Float64Array(n);
  const bp = svfBP(1.6);
  for (let i = 0; i < n; i++) {
    const x01 = i / n;
    const fc = 400 + 1400 * Math.sin(Math.PI * Math.min(1, x01 * 1.3)); // swell up then duck
    out[i] = bp(noise(), fc) * Math.sin(Math.PI * x01) ** 1.5;
  }
  return out;
};

// ---- Enemy movement: stone constructs — claw skitters and mason stomps ----

function skitter(): Float64Array {
  const out = new Float64Array(secs(0.09));
  let at = 0;
  for (let k = 0; k < 4; k++) {
    grain(out, at, 0.008, 4500, 0.8 + rng() * 0.3);
    const tick = ks(2000 + rng() * 1500, 0.02, 0.98, 0.4);
    const start = secs(at);
    for (let i = 0; i < tick.length && start + i < out.length; i++) out[start + i]! += tick[i]! * 0.5;
    at += 0.012 + rng() * 0.014;
  }
  return out;
}

function stomp(): Float64Array {
  const out = mix(0.25, [drop(80 + rng() * 12, 45, 0.03, 0.07, 0.25), 1.2, 0]);
  for (let k = 0; k < 5; k++) grain(out, rng() * 0.07, 0.012 + rng() * 0.015, 1400, 0.5);
  return drive(out, 1.5);
}

SOUNDS["step-skitter-1"] = skitter;
SOUNDS["step-skitter-2"] = skitter;
SOUNDS["step-stomp-1"] = stomp;
SOUNDS["step-stomp-2"] = stomp;

// ---- Misc cues (D-Phrygian, kin to the dim-706 track) ----

/** Soft brass-ish tone: detuned saws through a gentle LP with a pitch scoop, like the music's stabs. */
function hornTone(freq: number, durSec: number, cutoff: number): Float64Array {
  const n = secs(durSec + 0.06);
  const out = new Float64Array(n);
  const lp = onePoleLP(cutoff);
  const saws = [-7, 0, 6].map(() => rng());
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const scoop = Math.pow(2, (-50 * Math.exp(-t / 0.04)) / 1200);
    let s = 0;
    [-7, 0, 6].forEach((det, k) => {
      saws[k] = saws[k]! + (freq * scoop * Math.pow(2, det / 1200)) / SR;
      s += 2 * (saws[k]! - Math.floor(saws[k]! + 0.5));
    });
    const rel = t < durSec ? 1 : Math.max(0, 1 - (t - durSec) / 0.05);
    out[i] = lp(s / 3) * Math.min(1, t / 0.02) * rel;
  }
  return out;
}

SOUNDS["turn-start"] = () => mix(0.36, [hornTone(D.d4, 0.12, 1400), 0.9, 0], [hornTone(D.f4, 0.16, 1600), 0.9, 0.14]);

SOUNDS["combat-enter"] = () => {
  // The patrol notices you: gong hit (music's partials), low D bloom, Eb sting above.
  const gongHit = metal(73.4, [1, 1.48, 2.05, 2.74, 3.52], 0.55, 1.35);
  const bloom = drop(D.d2 * 2, D.d2, 0.12, 0.45, 1.3, 0.02);
  const stingArr = hornTone(D.eb3, 0.5, 1100);
  return mix(1.4, [gongHit, 0.9, 0], [bloom, 0.7, 0], [stingArr, 0.5, 0.25]);
};

SOUNDS["death-fall"] = () => {
  const groanLP = onePoleLP(600);
  const n = secs(0.4);
  const groan = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 150 * Math.pow(60 / 150, t / 0.4);
    phase += f / SR;
    groan[i] = groanLP(2 * (phase - Math.floor(phase + 0.5))) * ad(i, 0.01, 0.3);
  }
  const out = mix(0.6, [groan, 0.7, 0], [drop(110, 48, 0.03, 0.08, 0.25), 1.1, 0.32]);
  for (let k = 0; k < 4; k++) grain(out, 0.34 + rng() * 0.12, 0.015, 1600, 0.45);
  return out;
};

// ------------------------------------------------------------ render+check ----

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: bun game-sfx.ts <outDir>");
mkdirSync(outDir, { recursive: true });
const tmpDir = mkdtempSync(`${tmpdir()}/game-sfx-`);

function writeWav(path: string, mono: Float64Array): void {
  const data = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) data[i] = Math.round(Math.max(-1, Math.min(1, mono[i]!)) * 32767);
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  v.setUint32(0, 0x52494646, false);
  v.setUint32(4, 36 + data.byteLength, true);
  v.setUint32(8, 0x57415645, false);
  v.setUint32(12, 0x666d7420, false);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  v.setUint32(36, 0x64617461, false);
  v.setUint32(40, data.byteLength, true);
  const bytes = new Uint8Array(44 + data.byteLength);
  bytes.set(new Uint8Array(header), 0);
  bytes.set(new Uint8Array(data.buffer), 44);
  writeFileSync(path, bytes);
}

const report: string[] = [];
for (const [name, synth] of Object.entries(SOUNDS)) {
  seedFrom(name);
  let buf = synth();
  // DC-block, then peak-normalize to -3 dBFS.
  const dcHP = onePoleHP(18);
  buf = buf.map((x) => dcHP(x));
  fadeOut(buf, 6);
  let peak = 0;
  let sum = 0;
  for (const x of buf) {
    peak = Math.max(peak, Math.abs(x));
    sum += x;
  }
  if (peak < 1e-4) throw new Error(`${name}: rendered silence`);
  const g = 0.708 / peak;
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) {
    buf[i] = buf[i]! * g;
    sumSq += buf[i]! * buf[i]!;
  }
  const durMs = (buf.length / SR) * 1000;
  const rmsDb = 10 * Math.log10(sumSq / buf.length);
  const dc = (sum / buf.length) * g;
  if (durMs < 20 || durMs > 1600) throw new Error(`${name}: duration ${durMs.toFixed(0)}ms out of bounds`);
  if (Math.abs(dc) > 0.01) throw new Error(`${name}: DC offset ${dc.toFixed(4)}`);
  const wav = `${tmpDir}/${name}.wav`;
  writeWav(wav, buf);
  const ff = Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "4", `${outDir}/${name}.ogg`]);
  if (ff.exitCode !== 0) throw new Error(`${name}: ffmpeg failed: ${ff.stderr.toString()}`);
  report.push(`${name.padEnd(20)} ${durMs.toFixed(0).padStart(5)}ms  rms ${rmsDb.toFixed(1)}dB`);
}
rmSync(tmpDir, { recursive: true });
console.log(report.join("\n"));
console.log(`${report.length} sounds -> ${outDir}`);
