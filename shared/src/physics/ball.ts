import {
  BALL_HIT_ACCEL,
  BALL_LARGE_MATCH_ACCEL_FACTOR,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BALL_START_SPEED,
  BALL_TIME_ACCEL,
  BOUNCE_JITTER,
  LARGE_MATCH_THRESHOLD,
  MAX_ANGLE_FROM_NORMAL,
  MAX_BOUNCE_ANGLE,
  PADDLE_SPEED,
  PADDLE_SPIN_INFLUENCE,
  PADDLE_SPIN_RETREAT,
} from '../constants/index';
import { clampAngleFromNormal } from '../geometry/collision';
import { clamp, dot, normalize, sign, sub } from '../geometry/vector';
import type { BallState, Edge, Vec2 } from '../types/index';

export function createBall(): BallState {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: BALL_START_SPEED,
    radius: BALL_RADIUS,
    lastHitterId: null,
    consecutiveHits: 0,
    frozen: true,
  };
}

/** Time acceleration is softened in crowded matches to keep them playable. */
export const timeAccelFor = (playerCount: number): number =>
  playerCount >= LARGE_MATCH_THRESHOLD
    ? BALL_TIME_ACCEL * BALL_LARGE_MATCH_ACCEL_FACTOR
    : BALL_TIME_ACCEL;

/**
 * speed = min(max, start + timeAccel * elapsed + hitAccel * consecutiveHits)
 */
export function targetSpeed(elapsed: number, consecutiveHits: number, playerCount: number): number {
  const raw =
    BALL_START_SPEED + timeAccelFor(playerCount) * elapsed + BALL_HIT_ACCEL * consecutiveHits;
  return Math.min(BALL_MAX_SPEED, raw);
}

/** Set the ball speed while preserving its direction of travel. */
export function setBallSpeed(ball: BallState, speed: number): void {
  const next = Math.min(speed, BALL_MAX_SPEED);
  const dir = normalize({ x: ball.vx, y: ball.vy });
  ball.speed = next;
  if (dir.x === 0 && dir.y === 0) {
    ball.vx = 0;
    ball.vy = 0;
    return;
  }
  ball.vx = dir.x * next;
  ball.vy = dir.y * next;
}

export function setBallDirection(ball: BallState, direction: Vec2): void {
  const dir = normalize(direction);
  ball.vx = dir.x * ball.speed;
  ball.vy = dir.y * ball.speed;
}

/** Park the ball in the centre and clear rally state. */
export function parkBall(ball: BallState, center: Vec2): void {
  ball.x = center.x;
  ball.y = center.y;
  ball.vx = 0;
  ball.vy = 0;
  ball.speed = BALL_START_SPEED;
  ball.consecutiveHits = 0;
  ball.lastHitterId = null;
  ball.frozen = true;
}

/**
 * Launch the ball from the centre toward a target edge, aimed at a random point
 * on the defended half of that edge (never dead-centre, never at a corner).
 */
export function launchBall(
  ball: BallState,
  center: Vec2,
  targetEdge: Edge,
  rng: () => number,
): void {
  const spread = 0.3; // stay away from the corners
  const t = 0.5 + (rng() * 2 - 1) * spread;
  const aim: Vec2 = {
    x: targetEdge.start.x + targetEdge.tangent.x * targetEdge.length * t,
    y: targetEdge.start.y + targetEdge.tangent.y * targetEdge.length * t,
  };
  ball.x = center.x;
  ball.y = center.y;
  ball.speed = BALL_START_SPEED;
  ball.consecutiveHits = 0;
  ball.frozen = false;
  setBallDirection(ball, sub(aim, center));
}

export interface PaddleBounceInput {
  edge: Edge;
  /** Impact point on the paddle face. */
  contact: Vec2;
  /** Centre of the paddle face. */
  paddleCenter: Vec2;
  paddleLength: number;
  /** Paddle velocity in normalised edge units per second (signed). */
  paddleVelocity: number;
  rng: () => number;
}

export interface PaddleBounceResult {
  direction: Vec2;
  /** -1..1 impact offset from the paddle centre. */
  offset: number;
  /** True for a clean, controlled centre hit. */
  perfect: boolean;
}

/**
 * Pong-style angular control: where you hit the paddle decides where the ball
 * goes. Centre hits rebound close to the edge normal, hits near the tip fly off
 * at up to MAX_BOUNCE_ANGLE, and a paddle sweeping into the ball adds spin.
 */
export function paddleBounce(input: PaddleBounceInput): PaddleBounceResult {
  const { edge, contact, paddleCenter, paddleLength, paddleVelocity, rng } = input;
  const half = Math.max(paddleLength / 2, 1e-3);
  const along = dot(sub(contact, paddleCenter), edge.tangent);
  const offset = clamp(along / half, -1, 1);

  let angle = offset * MAX_BOUNCE_ANGLE;

  // Tangential paddle speed in world units, normalised against the paddle's own
  // maximum speed so spin never dominates the angle the player aimed for.
  const tangentialSpeed = paddleVelocity * edge.length;
  const spinRatio = clamp(tangentialSpeed / PADDLE_SPEED, -1, 1);
  const offsetSign = sign(offset);
  const spinSign = sign(spinRatio);
  // "Toward the ball" = the paddle is sweeping in the direction of the impact.
  const towardBall = offsetSign === 0 || spinSign === 0 || spinSign === offsetSign;
  const spinWeight = towardBall
    ? PADDLE_SPIN_INFLUENCE
    : PADDLE_SPIN_INFLUENCE * PADDLE_SPIN_RETREAT;
  angle += spinRatio * spinWeight * MAX_BOUNCE_ANGLE;

  // Tiny bounded jitter: breaks perfectly repeating trajectories without
  // turning rallies into a lottery.
  angle += (rng() * 2 - 1) * BOUNCE_JITTER;
  angle = clamp(angle, -MAX_ANGLE_FROM_NORMAL, MAX_ANGLE_FROM_NORMAL);

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const direction = normalize({
    x: edge.normal.x * cos + edge.tangent.x * sin,
    y: edge.normal.y * cos + edge.tangent.y * sin,
  });

  // Safety net: never leave the surface almost parallel to it.
  const safe = clampAngleFromNormal(direction, edge.normal, MAX_ANGLE_FROM_NORMAL);

  return { direction: safe, offset, perfect: Math.abs(offset) < 0.25 };
}
