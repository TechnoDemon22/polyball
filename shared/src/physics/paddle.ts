import {
  LARGE_MATCH_THRESHOLD,
  PADDLE_MAX_EDGE_FRACTION,
  PADDLE_MAX_LENGTH,
  PADDLE_MIN_LENGTH,
  PADDLE_RATIO_FEW,
  PADDLE_RATIO_MANY,
  PADDLE_RATIO_MID,
  PADDLE_SPEED,
  PADDLE_THICKNESS,
} from '../constants/index';
import { pointOnEdge } from '../geometry/polygon';
import { clamp } from '../geometry/vector';
import type { Edge, Vec2 } from '../types/index';

/** Edge-length fraction used for a paddle, by player count. */
export function paddleRatioFor(playerCount: number): number {
  if (playerCount <= 4) return PADDLE_RATIO_FEW;
  if (playerCount < LARGE_MATCH_THRESHOLD) return PADDLE_RATIO_MID;
  return PADDLE_RATIO_MANY;
}

/**
 * Paddle length in world units.
 *
 * Clamped to [PADDLE_MIN_LENGTH, PADDLE_MAX_LENGTH] so a paddle never becomes
 * too small to hit on a phone, and never so large it covers the whole edge.
 */
export function paddleLengthFor(playerCount: number, edgeLength: number): number {
  const raw = edgeLength * paddleRatioFor(playerCount);
  const maxByEdge = Math.max(PADDLE_MIN_LENGTH * 0.5, edgeLength * PADDLE_MAX_EDGE_FRACTION);
  return Math.min(clamp(raw, PADDLE_MIN_LENGTH, PADDLE_MAX_LENGTH), maxByEdge);
}

/** Half the paddle expressed in normalised edge coordinates. */
export const paddleHalfSpan = (paddleLength: number, edgeLength: number): number =>
  edgeLength > 0 ? Math.min(0.5, paddleLength / 2 / edgeLength) : 0.5;

/** Keep the paddle fully inside its edge (position is the paddle centre). */
export function clampPaddlePosition(
  position: number,
  paddleLength: number,
  edgeLength: number,
): number {
  const half = paddleHalfSpan(paddleLength, edgeLength);
  return clamp(position, half, 1 - half);
}

/** Normalised distance a paddle travels in `dt` seconds on this edge. */
export const paddleStep = (edgeLength: number, dt: number, speed = PADDLE_SPEED): number =>
  edgeLength > 0 ? (speed * dt) / edgeLength : 0;

export interface PaddleShape {
  /** Paddle centre, on the edge line. */
  center: Vec2;
  /** Endpoints on the edge line. */
  start: Vec2;
  end: Vec2;
  /** Front (arena-facing) face, offset inward by the paddle thickness. */
  frontStart: Vec2;
  frontEnd: Vec2;
  /** Front face centre - the reference point for rebound angles. */
  frontCenter: Vec2;
  length: number;
  thickness: number;
}

/**
 * World-space paddle geometry, derived from the *current* edge. Paddle state is
 * stored in normalised edge coordinates so paddles stay attached correctly when
 * the arena shrinks.
 */
export function paddleShape(
  edge: Edge,
  position: number,
  paddleLength: number,
  thickness = PADDLE_THICKNESS,
): PaddleShape {
  const half = paddleLength / 2;
  const center = pointOnEdge(edge, position);
  const start = {
    x: center.x - edge.tangent.x * half,
    y: center.y - edge.tangent.y * half,
  };
  const end = {
    x: center.x + edge.tangent.x * half,
    y: center.y + edge.tangent.y * half,
  };
  const offX = edge.normal.x * thickness;
  const offY = edge.normal.y * thickness;
  return {
    center,
    start,
    end,
    frontStart: { x: start.x + offX, y: start.y + offY },
    frontEnd: { x: end.x + offX, y: end.y + offY },
    frontCenter: { x: center.x + offX, y: center.y + offY },
    length: paddleLength,
    thickness,
  };
}

/**
 * Does the paddle cover a normalised edge coordinate?
 * `tolerance` is expressed in normalised edge units (usually the ball radius).
 */
export function paddleCovers(
  position: number,
  paddleLength: number,
  edgeLength: number,
  coordinate: number,
  tolerance = 0,
): boolean {
  const half = paddleHalfSpan(paddleLength, edgeLength);
  return Math.abs(coordinate - position) <= half + tolerance;
}
