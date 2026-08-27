import { describe, expect, it } from 'vitest';
import {
  BALL_HIT_ACCEL,
  BALL_MAX_SPEED,
  BALL_START_SPEED,
  BALL_TIME_ACCEL,
  buildEdges,
  createBall,
  createRng,
  dot,
  launchBall,
  paddleBounce,
  paddleShape,
  parkBall,
  regularPolygonVertices,
  setBallSpeed,
  targetSpeed,
  timeAccelFor,
} from '../src/index';

describe('ball acceleration', () => {
  it('uses start + time * accel + hits * accel', () => {
    expect(targetSpeed(0, 0, 6)).toBe(BALL_START_SPEED);
    expect(targetSpeed(10, 0, 6)).toBeCloseTo(BALL_START_SPEED + BALL_TIME_ACCEL * 10, 9);
    expect(targetSpeed(0, 4, 6)).toBeCloseTo(BALL_START_SPEED + BALL_HIT_ACCEL * 4, 9);
    expect(targetSpeed(5, 3, 6)).toBeCloseTo(
      BALL_START_SPEED + BALL_TIME_ACCEL * 5 + BALL_HIT_ACCEL * 3,
      9,
    );
  });

  it('never exceeds the maximum speed', () => {
    expect(targetSpeed(10_000, 10_000, 6)).toBe(BALL_MAX_SPEED);
    expect(targetSpeed(300, 0, 12)).toBeLessThanOrEqual(BALL_MAX_SPEED);
  });

  it('increases monotonically with time and hits', () => {
    let previous = 0;
    for (let t = 0; t < 200; t += 5) {
      const speed = targetSpeed(t, 0, 6);
      expect(speed).toBeGreaterThanOrEqual(previous);
      previous = speed;
    }
  });

  it('softens time acceleration for crowded matches', () => {
    expect(timeAccelFor(8)).toBe(BALL_TIME_ACCEL);
    expect(timeAccelFor(9)).toBeLessThan(BALL_TIME_ACCEL);
    expect(targetSpeed(60, 0, 12)).toBeLessThan(targetSpeed(60, 0, 6));
  });
});

describe('speed changes preserve direction', () => {
  it('keeps the unit direction and applies the new magnitude', () => {
    const ball = createBall();
    ball.vx = 300;
    ball.vy = -400;
    ball.frozen = false;
    setBallSpeed(ball, 700);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(700, 6);
    expect(ball.vx / ball.vy).toBeCloseTo(300 / -400, 6);
    expect(ball.speed).toBe(700);
  });

  it('clamps to the maximum speed', () => {
    const ball = createBall();
    ball.vx = 1;
    ball.vy = 0;
    setBallSpeed(ball, 99_999);
    expect(ball.speed).toBe(BALL_MAX_SPEED);
    expect(ball.vx).toBeCloseTo(BALL_MAX_SPEED, 6);
  });

  it('is safe for a parked ball', () => {
    const ball = createBall();
    parkBall(ball, { x: 0, y: 0 });
    setBallSpeed(ball, 500);
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBe(0);
  });
});

describe('ball launch and reset', () => {
  const edges = buildEdges(regularPolygonVertices(6, 460));
  const rng = createRng(11);

  it('launches from the centre toward the target edge', () => {
    const ball = createBall();
    launchBall(ball, { x: 0, y: 0 }, edges[2], rng);
    expect(ball.x).toBe(0);
    expect(ball.y).toBe(0);
    expect(ball.frozen).toBe(false);
    expect(ball.speed).toBe(BALL_START_SPEED);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(BALL_START_SPEED, 6);
    // Travelling toward edge 2 means closing on that edge's plane.
    expect(dot({ x: ball.vx, y: ball.vy }, edges[2].normal)).toBeLessThan(0);
  });

  it('clears rally state on reset', () => {
    const ball = createBall();
    launchBall(ball, { x: 0, y: 0 }, edges[0], rng);
    ball.consecutiveHits = 7;
    ball.lastHitterId = 'p1';
    parkBall(ball, { x: 0, y: 0 });
    expect(ball.consecutiveHits).toBe(0);
    expect(ball.lastHitterId).toBeNull();
    expect(ball.speed).toBe(BALL_START_SPEED);
    expect(ball.frozen).toBe(true);
  });
});

describe('paddle rebound angles', () => {
  const edges = buildEdges(regularPolygonVertices(6, 460));
  const edge = edges[0];
  const shape = paddleShape(edge, 0.5, 100);
  const rng = createRng(5);

  const bounceAt = (offsetUnits: number, paddleVelocity = 0) =>
    paddleBounce({
      edge,
      contact: {
        x: shape.frontCenter.x + edge.tangent.x * offsetUnits,
        y: shape.frontCenter.y + edge.tangent.y * offsetUnits,
      },
      paddleCenter: shape.frontCenter,
      paddleLength: 100,
      paddleVelocity,
      rng,
    });

  it('sends every rebound back into the arena', () => {
    for (const offset of [-50, -25, 0, 25, 50]) {
      const result = bounceAt(offset);
      expect(dot(result.direction, edge.normal)).toBeGreaterThan(0);
      expect(Math.hypot(result.direction.x, result.direction.y)).toBeCloseTo(1, 6);
    }
  });

  it('returns a centre hit close to the edge normal', () => {
    const result = bounceAt(0);
    expect(result.offset).toBeCloseTo(0, 6);
    expect(result.perfect).toBe(true);
    const angle = Math.acos(dot(result.direction, edge.normal));
    expect(angle).toBeLessThan(0.1);
  });

  it('gives a sharper angle the closer to the paddle tip you hit', () => {
    const centre = Math.acos(dot(bounceAt(5).direction, edge.normal));
    const middle = Math.acos(dot(bounceAt(25).direction, edge.normal));
    const tip = Math.acos(dot(bounceAt(50).direction, edge.normal));
    expect(middle).toBeGreaterThan(centre);
    expect(tip).toBeGreaterThan(middle);
    expect(tip).toBeLessThan(Math.PI / 2);
  });

  it('mirrors the deflection direction around the paddle centre', () => {
    const left = bounceAt(-40);
    const right = bounceAt(40);
    expect(left.offset).toBeCloseTo(-0.8, 6);
    expect(right.offset).toBeCloseTo(0.8, 6);
    expect(dot(left.direction, edge.tangent)).toBeLessThan(0);
    expect(dot(right.direction, edge.tangent)).toBeGreaterThan(0);
  });

  it('adds spin when the paddle sweeps into the ball', () => {
    const still = dot(bounceAt(10, 0).direction, edge.tangent);
    const sweeping = dot(bounceAt(10, 1.2).direction, edge.tangent);
    expect(sweeping).toBeGreaterThan(still);
  });

  it('never produces a trajectory that runs along the edge', () => {
    for (let offsetUnits = -50; offsetUnits <= 50; offsetUnits += 2) {
      for (const paddleVelocity of [-2, 0, 2]) {
        const result = bounceAt(offsetUnits, paddleVelocity);
        expect(dot(result.direction, edge.normal)).toBeGreaterThan(0.05);
      }
    }
  });
});
