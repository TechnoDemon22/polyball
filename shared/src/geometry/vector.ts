import type { Vec2 } from '../types/index';

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const clone = (v: Vec2): Vec2 => ({ x: v.x, y: v.y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 2D cross product (z component). */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const lengthSq = (v: Vec2): number => v.x * v.x + v.y * v.y;
export const length = (v: Vec2): number => Math.hypot(v.x, v.y);

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const distanceSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/** Rotate 90 degrees. In screen space (y down) this is the "left" normal. */
export const perpendicular = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });

export function rotate(v: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpVec = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const sign = (value: number): -1 | 0 | 1 => (value > 0 ? 1 : value < 0 ? -1 : 0);

/** Smooth ease-in-out on 0..1, used for arena shrinking. */
export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export const approximately = (a: number, b: number, epsilon = 1e-6): boolean =>
  Math.abs(a - b) <= epsilon;

/** Shortest signed angular difference from a to b, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Small deterministic PRNG (mulberry32). Deterministic seeds keep the server
 * authoritative and make physics tests reproducible.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [min, max). */
export const rngRange = (rng: () => number, min: number, max: number): number =>
  min + rng() * (max - min);

/** Uniform integer in [0, count). */
export const rngInt = (rng: () => number, count: number): number =>
  Math.min(count - 1, Math.floor(rng() * count));
