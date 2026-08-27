import {
  LARGE_MATCH_THRESHOLD,
  SHRINK_FINAL_RAMP,
  SHRINK_MIN_SCALE,
  SHRINK_PRESSURE_END,
  SHRINK_PRESSURE_SCALE,
  SHRINK_START_SCALE,
  SHRINK_START_TIME,
  WORLD_BASE_RADIUS,
  WORLD_LARGE_RADIUS,
} from '../constants/index';
import {
  buildEdges,
  rectangleVertices,
  regularPolygonVertices,
  startAngleForEdgeMid,
} from '../geometry/polygon';
import { clamp, clamp01, lerp, smoothstep } from '../geometry/vector';
import type { ArenaGeometry, MatchPhase, Vec2 } from '../types/index';

/** Crowded matches start on a bigger arena so edges stay defendable. */
export const baseRadiusFor = (playerCount: number): number =>
  playerCount >= LARGE_MATCH_THRESHOLD ? WORLD_LARGE_RADIUS : WORLD_BASE_RADIUS;

/** Number of arena sides for a player count (2 players -> rectangle). */
export const sideCountFor = (playerCount: number): number =>
  playerCount <= 2 ? 4 : Math.round(playerCount);

/**
 * Create the arena for a match.
 * Edge 0's midpoint sits at world angle PI/2 (bottom of the screen) so the
 * local player can always be rotated to the familiar "my paddle is down here"
 * position by the renderer.
 */
export function createArena(playerCount: number, scale = 1): ArenaGeometry {
  const shape = playerCount <= 2 ? 'rect' : 'polygon';
  const sideCount = sideCountFor(playerCount);
  const baseRadius = baseRadiusFor(playerCount);
  const startAngle = startAngleForEdgeMid(sideCount, Math.PI / 2);

  const arena: ArenaGeometry = {
    shape,
    sideCount,
    baseRadius,
    scale: 1,
    startAngle,
    center: { x: 0, y: 0 },
    edges: [],
    halfWidth: baseRadius * 0.98,
    halfHeight: baseRadius * 0.72,
  };
  applyArenaScale(arena, scale);
  return arena;
}

/**
 * Rebuild every vertex from a single scale factor. Regenerating from scratch
 * (instead of nudging vertices) guarantees the polygon stays regular and every
 * edge keeps exactly the same length while shrinking.
 */
export function applyArenaScale(arena: ArenaGeometry, scale: number): ArenaGeometry {
  const next = clamp(scale, SHRINK_MIN_SCALE, SHRINK_START_SCALE);
  const previous = arena.edges;
  const vertices =
    arena.shape === 'rect'
      ? rectangleVertices(arena.halfWidth * next, arena.halfHeight * next, arena.center)
      : regularPolygonVertices(
          arena.sideCount,
          arena.baseRadius * next,
          arena.startAngle,
          arena.center,
        );

  const edges = buildEdges(vertices, arena.center);
  // Preserve ownership / active flags across a rescale.
  for (let i = 0; i < edges.length; i += 1) {
    const old = previous[i];
    if (old) {
      edges[i].ownerId = old.ownerId;
      edges[i].active = old.active;
    }
  }
  arena.edges = edges;
  arena.scale = next;
  return arena;
}

/** Distance from centre to the closest boundary at the current scale. */
export function arenaInradius(arena: ArenaGeometry): number {
  let min = Infinity;
  for (const edge of arena.edges) {
    const signed =
      (arena.center.x - edge.start.x) * edge.normal.x +
      (arena.center.y - edge.start.y) * edge.normal.y;
    if (signed < min) min = signed;
  }
  return min === Infinity ? 0 : min;
}

/** Radius needed to keep the whole arena on screen at scale 1. */
export const arenaViewRadius = (arena: ArenaGeometry): number =>
  arena.shape === 'rect' ? Math.hypot(arena.halfWidth, arena.halfHeight) : arena.baseRadius;

/**
 * Half-extents of the arena's bounding box at scale 1, measured in the camera's
 * orientation. Fitting a viewport to these instead of to a single radius lets a
 * wide screen use its width: a duel rectangle is much wider than it is tall, and
 * its diagonal is not what has to fit on screen.
 *
 * A polygon reports its circumradius on both axes on purpose. That is rotation
 * invariant, so every seat in a match gets exactly the same zoom level even
 * though each player's camera is rotated differently.
 */
export function arenaViewExtent(arena: ArenaGeometry, rotation = 0): Vec2 {
  if (arena.shape !== 'rect') return { x: arena.baseRadius, y: arena.baseRadius };
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  return {
    x: arena.halfWidth * cos + arena.halfHeight * sin,
    y: arena.halfWidth * sin + arena.halfHeight * cos,
  };
}

/**
 * Arena scale for a given shrink clock (seconds of *un-paused* play).
 *
 *  0..30s      -> 1.00            (opening)
 *  30..120s    -> 1.00 -> 0.82    (pressure, eased)
 *  120s+       -> 0.82 -> 0.65    (final, faster)
 */
export function scaleForTime(shrinkClock: number, enabled = true): number {
  if (!enabled) return SHRINK_START_SCALE;
  if (shrinkClock <= SHRINK_START_TIME) return SHRINK_START_SCALE;

  if (shrinkClock < SHRINK_PRESSURE_END) {
    const t = (shrinkClock - SHRINK_START_TIME) / (SHRINK_PRESSURE_END - SHRINK_START_TIME);
    return lerp(SHRINK_START_SCALE, SHRINK_PRESSURE_SCALE, smoothstep(t));
  }

  const t = clamp01((shrinkClock - SHRINK_PRESSURE_END) / SHRINK_FINAL_RAMP);
  return lerp(SHRINK_PRESSURE_SCALE, SHRINK_MIN_SCALE, smoothstep(t));
}

export function phaseForTime(shrinkClock: number): MatchPhase {
  if (shrinkClock < SHRINK_START_TIME) return 'opening';
  if (shrinkClock < SHRINK_PRESSURE_END) return 'pressure';
  return 'final';
}
