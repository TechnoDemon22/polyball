import { describe, expect, it } from 'vitest';
import {
  applyArenaScale,
  arenaInradius,
  baseRadiusFor,
  createArena,
  phaseForTime,
  polygonSideLength,
  scaleForTime,
  SHRINK_MIN_SCALE,
  SHRINK_PRESSURE_END,
  SHRINK_PRESSURE_SCALE,
  SHRINK_START_SCALE,
  SHRINK_START_TIME,
  WORLD_BASE_RADIUS,
  WORLD_LARGE_RADIUS,
} from '../src/index';

describe('shrink schedule', () => {
  it('holds the arena still during the opening phase', () => {
    expect(scaleForTime(0)).toBe(SHRINK_START_SCALE);
    expect(scaleForTime(SHRINK_START_TIME)).toBe(SHRINK_START_SCALE);
    expect(scaleForTime(SHRINK_START_TIME - 0.001)).toBe(SHRINK_START_SCALE);
  });

  it('reaches the pressure target by the end of the pressure phase', () => {
    expect(scaleForTime(SHRINK_PRESSURE_END)).toBeCloseTo(SHRINK_PRESSURE_SCALE, 6);
    const mid = scaleForTime((SHRINK_START_TIME + SHRINK_PRESSURE_END) / 2);
    expect(mid).toBeLessThan(SHRINK_START_SCALE);
    expect(mid).toBeGreaterThan(SHRINK_PRESSURE_SCALE);
  });

  it('approaches but never passes the minimum scale', () => {
    expect(scaleForTime(SHRINK_PRESSURE_END + 60)).toBeCloseTo(SHRINK_MIN_SCALE, 6);
    expect(scaleForTime(100_000)).toBe(SHRINK_MIN_SCALE);
    for (let t = 0; t < 400; t += 1) {
      expect(scaleForTime(t)).toBeGreaterThanOrEqual(SHRINK_MIN_SCALE);
      expect(scaleForTime(t)).toBeLessThanOrEqual(SHRINK_START_SCALE);
    }
  });

  it('never increases and never jumps abruptly', () => {
    let previous = scaleForTime(0);
    for (let t = 0; t <= 400; t += 1 / 60) {
      const scale = scaleForTime(t);
      expect(scale).toBeLessThanOrEqual(previous + 1e-12);
      expect(previous - scale).toBeLessThan(0.002);
      previous = scale;
    }
  });

  it('can be disabled entirely (practice / no-shrink rooms)', () => {
    expect(scaleForTime(500, false)).toBe(SHRINK_START_SCALE);
  });

  it('reports the phase for a given clock', () => {
    expect(phaseForTime(0)).toBe('opening');
    expect(phaseForTime(SHRINK_START_TIME - 0.1)).toBe('opening');
    expect(phaseForTime(SHRINK_START_TIME)).toBe('pressure');
    expect(phaseForTime(SHRINK_PRESSURE_END - 0.1)).toBe('pressure');
    expect(phaseForTime(SHRINK_PRESSURE_END)).toBe('final');
    expect(phaseForTime(999)).toBe('final');
  });
});

describe('arena scaling', () => {
  it('keeps every edge equal while shrinking', () => {
    for (let players = 3; players <= 12; players += 1) {
      const arena = createArena(players);
      for (const scale of [1, 0.94, 0.82, 0.7, SHRINK_MIN_SCALE]) {
        applyArenaScale(arena, scale);
        const expected = polygonSideLength(players, arena.baseRadius * scale);
        for (const edge of arena.edges) {
          expect(edge.length).toBeCloseTo(expected, 6);
        }
      }
    }
  });

  it('shrinks symmetrically toward the centre', () => {
    const arena = createArena(8);
    const before = arenaInradius(arena);
    applyArenaScale(arena, 0.8);
    const after = arenaInradius(arena);
    expect(after / before).toBeCloseTo(0.8, 6);
    for (const edge of arena.edges) {
      expect(Math.hypot(edge.mid.x, edge.mid.y)).toBeCloseTo(after, 6);
    }
  });

  it('clamps requested scales to the legal range', () => {
    const arena = createArena(5);
    applyArenaScale(arena, 5);
    expect(arena.scale).toBe(SHRINK_START_SCALE);
    applyArenaScale(arena, 0.1);
    expect(arena.scale).toBe(SHRINK_MIN_SCALE);
  });

  it('preserves edge ownership across a rescale', () => {
    const arena = createArena(6);
    arena.edges[2].ownerId = 'player-3';
    arena.edges[2].active = true;
    arena.edges[4].ownerId = 'player-5';
    arena.edges[4].active = false;
    applyArenaScale(arena, 0.75);
    expect(arena.edges[2].ownerId).toBe('player-3');
    expect(arena.edges[2].active).toBe(true);
    expect(arena.edges[4].ownerId).toBe('player-5');
    expect(arena.edges[4].active).toBe(false);
  });

  it('keeps the same number of sides after eliminations', () => {
    const arena = createArena(7);
    applyArenaScale(arena, 0.7);
    expect(arena.edges).toHaveLength(7);
    expect(arena.sideCount).toBe(7);
  });

  it('gives crowded matches a bigger starting arena', () => {
    expect(baseRadiusFor(6)).toBe(WORLD_BASE_RADIUS);
    expect(baseRadiusFor(9)).toBe(WORLD_LARGE_RADIUS);
    expect(baseRadiusFor(12)).toBeGreaterThan(baseRadiusFor(8));
  });
});
