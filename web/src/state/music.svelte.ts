/**
 * Game audio: combat music loops, adaptive multi-stem music, and one-shot SFX. Web Audio (not <audio>) so tracks loop
 * sample-exactly — the 706 track's tail is composed to flow into its head. The context starts
 * suspended under autoplay rules; the first user gesture resumes it, and anything requested
 * before that gesture stays silent until then.
 */
import { assetUrl } from "../lib/urls.js";

const COMBAT_TRACKS: Record<number, string> = {
  706: assetUrl("audio/dim-706-combat.ogg"),
};

/**
 * Adaptive dimensions: one composition rendered as sample-aligned stems
 * (dimension-generator/dim-<id>-adaptive-music.ts). All stems loop in lockstep and intensity is
 * a pure gain move — combat rises mid-bar without restarting the piece. Stem order matters:
 * intensity N plays stems 0..N at full gain.
 */
const ADAPTIVE_TRACKS: Record<number, string[]> = {
  705: ["calm", "pulse", "war"].map((stem) => assetUrl(`audio/dim-705-v2-${stem}.ogg`)),
  706: ["calm", "pulse", "war"].map((stem) => assetUrl(`audio/dim-706-${stem}.ogg`)),
  707: ["calm", "pulse", "war"].map((stem) => assetUrl(`audio/dim-707-${stem}.ogg`)),
};

export type MusicIntensity = "calm" | "pulse" | "war";
const INTENSITY_STEMS: Record<MusicIntensity, number> = { calm: 1, pulse: 2, war: 3 };

// Stems are normalized so no subset clips when summed, which leaves the full sum ~2.7dB below
// the single mastered combat mix; the group gain makes up the difference (float graph, no clip).
const ADAPTIVE_GAIN = 1.35;
const RISE_SEC = 0.8;
const RELEASE_TC = 0.9; // setTargetAtTime constant: lazy ~2.7s settle back down

/** The foley suite (dimension-generator/game-sfx.ts). `variants` names files `<name>-1..n.ogg`. */
const SFX = {
  "ui-click": { gain: 0.45 },
  "ui-hover": { gain: 0.25 },
  "ui-equip": { gain: 0.55 },
  "ui-unequip": { gain: 0.5 },
  "ui-bag-take": { gain: 0.55 },
  "ui-deny": { gain: 0.5 },
  "loot-common": { gain: 0.55 },
  "loot-uncommon": { gain: 0.6 },
  "loot-rare": { gain: 0.65 },
  "loot-epic": { gain: 0.7 },
  "loot-legendary": { gain: 0.75 },
  slash: { variants: 3, gain: 0.7 },
  thrust: { variants: 3, gain: 0.7 },
  projectile: { variants: 3, gain: 0.7 },
  explosion: { variants: 3, gain: 0.75 },
  splash: { variants: 3, gain: 0.7 },
  "hit-flesh": { gain: 0.75 },
  "hit-block": { gain: 0.7 },
  "wall-slam": { gain: 0.8 },
  "knockback-whoosh": { gain: 0.6 },
  "step-skitter": { variants: 2, gain: 0.4 },
  "step-stomp": { variants: 2, gain: 0.55 },
  "turn-start": { gain: 0.5 },
  "combat-enter": { gain: 0.7 },
  "death-fall": { gain: 0.7 },
} satisfies Record<string, { variants?: number; gain: number }>;

export type SfxName = keyof typeof SFX;

const MUSIC_VOLUME = 0.55;
const MUTED_KEY = "musicMuted";

export const music = $state({ muted: localStorage.getItem(MUTED_KEY) === "1" });

export function toggleMusicMuted(): void {
  music.muted = !music.muted;
  localStorage.setItem(MUTED_KEY, music.muted ? "1" : "0");
  if (masterGain) masterGain.gain.value = music.muted ? 0 : 1;
}

export function hasCombatTrack(dimensionId: number): boolean {
  return dimensionId in COMBAT_TRACKS;
}

export function hasAdaptiveTrack(dimensionId: number): boolean {
  return dimensionId in ADAPTIVE_TRACKS;
}

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let source: AudioBufferSourceNode | null = null;
let sourceGain: GainNode | null = null;
let currentUrl: string | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

function ensureContext(): AudioContext {
  if (ctx) return ctx;
  ctx = new AudioContext();
  masterGain = ctx.createGain(); // the mute gate: everything (music + sfx) routes through it
  masterGain.gain.value = music.muted ? 0 : 1;
  masterGain.connect(ctx.destination);
  const resume = (): void => {
    void ctx!.resume();
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
  };
  if (ctx.state === "suspended") {
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
  }
  return ctx;
}

/** Start (or stop, with `null`) the combat loop for a dimension. Idempotent per track. */
export function setCombatMusic(dimensionId: number | null): void {
  const url = dimensionId !== null ? (COMBAT_TRACKS[dimensionId] ?? null) : null;
  if (url === currentUrl) return;
  currentUrl = url;
  stopSource();
  if (url) void startLoop(url);
}

function loadBuffer(audio: AudioContext, url: string): Promise<AudioBuffer> {
  let pending = buffers.get(url);
  if (!pending) {
    pending = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`audio fetch ${url}: HTTP ${res.status}`);
      return audio.decodeAudioData(await res.arrayBuffer());
    });
    buffers.set(url, pending);
  }
  return pending;
}

/** Fire-and-forget one-shot; multi-variant names pick a random take. Honors the mute toggle. */
export function playSfx(name: SfxName): void {
  const def: { variants?: number; gain: number } = SFX[name];
  // eslint-disable-next-line no-restricted-syntax -- presentation-only variant pick, never touches game state
  const file = def.variants ? `${name}-${1 + Math.floor(Math.random() * def.variants)}` : name;
  const audio = ensureContext();
  void loadBuffer(audio, assetUrl(`audio/sfx/${file}.ogg`)).then((buffer) => {
    const g = audio.createGain();
    g.gain.value = def.gain;
    g.connect(masterGain!);
    const src = audio.createBufferSource();
    src.buffer = buffer;
    src.connect(g);
    src.start();
  });
}

async function startLoop(url: string): Promise<void> {
  const audio = ensureContext();
  const buffer = await loadBuffer(audio, url);
  if (currentUrl !== url) return; // combat ended while decoding
  sourceGain = audio.createGain();
  sourceGain.gain.value = MUSIC_VOLUME;
  sourceGain.connect(masterGain!);
  source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(sourceGain);
  source.start();
}

function stopSource(): void {
  if (!source || !sourceGain || !ctx) return;
  const s = source;
  const g = sourceGain;
  source = null;
  sourceGain = null;
  g.gain.setValueAtTime(MUSIC_VOLUME, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
  s.stop(ctx.currentTime + 0.3);
}

// ------------------------------------------------------------ adaptive stems ----

interface AdaptiveGroup {
  sources: AudioBufferSourceNode[];
  stemGains: GainNode[];
  groupGain: GainNode;
}

let adaptiveDim: number | null = null;
let adaptiveGroup: AdaptiveGroup | null = null;
let intensity: MusicIntensity = "calm";

/**
 * Run (or stop, with `null`) the adaptive stem set for a dimension. Idempotent per dimension —
 * intensity changes never restart playback, they only ramp stem gains.
 */
export function setAdaptiveMusic(dimensionId: number | null): void {
  if (dimensionId === adaptiveDim) return;
  adaptiveDim = dimensionId;
  stopAdaptive();
  if (dimensionId !== null) {
    intensity = "calm";
    void startAdaptive(dimensionId, ADAPTIVE_TRACKS[dimensionId]!);
  }
}

/** Ramp stem gains: quick rise into combat, lazy release back toward calm. */
export function setMusicIntensity(level: MusicIntensity): void {
  intensity = level;
  if (!adaptiveGroup || !ctx) return;
  const now = ctx.currentTime;
  const active = INTENSITY_STEMS[level];
  adaptiveGroup.stemGains.forEach((g, i) => {
    const target = i < active ? 1 : 0;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    if (target > g.gain.value) g.gain.linearRampToValueAtTime(target, now + RISE_SEC);
    else g.gain.setTargetAtTime(target, now, RELEASE_TC);
  });
}

async function startAdaptive(dimensionId: number, urls: string[]): Promise<void> {
  const audio = ensureContext();
  const stems = await Promise.all(urls.map((url) => loadBuffer(audio, url)));
  if (adaptiveDim !== dimensionId || adaptiveGroup) return; // left the dimension while decoding
  const groupGain = audio.createGain();
  groupGain.gain.value = MUSIC_VOLUME * ADAPTIVE_GAIN;
  groupGain.connect(masterGain!);
  const active = INTENSITY_STEMS[intensity];
  const startAt = audio.currentTime + 0.05;
  const sources: AudioBufferSourceNode[] = [];
  const stemGains: GainNode[] = [];
  stems.forEach((buffer, i) => {
    const g = audio.createGain();
    g.gain.value = i < active ? 1 : 0;
    g.connect(groupGain);
    const src = audio.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(g);
    src.start(startAt); // one shared start time: the stems stay sample-locked forever
    sources.push(src);
    stemGains.push(g);
  });
  adaptiveGroup = { sources, stemGains, groupGain };
}

function stopAdaptive(): void {
  if (!adaptiveGroup || !ctx) return;
  const { sources, groupGain } = adaptiveGroup;
  adaptiveGroup = null;
  groupGain.gain.setValueAtTime(groupGain.gain.value, ctx.currentTime);
  groupGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
  for (const s of sources) s.stop(ctx.currentTime + 0.3);
}
