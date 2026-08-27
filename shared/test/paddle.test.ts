import { describe, expect, it } from 'vitest';
import {
  buildEdges,
  clampPaddlePosition,
  PADDLE_MAX_LENGTH,
  PADDLE_MIN_LENGTH,
  PADDLE_RATIO_FEW,
  PADDLE_RATIO_MANY,
  PADDLE_RATIO_MID,
  PADDLE_SPEED,
  paddleCovers,
  paddleHalfSpan,
  paddleLengthFor,
  paddleRatioFor,
  paddleShape,
  paddleStep,
  polygonSideLength,
  regularPolygonVertices,
  WORLD_BASE_RADIUS,
  WORLD_LARGE_RADIUS,
} from '../src/index';

describe('paddle sizing', () => {
  it('scales the edge fraction with the player count', () => {
    expect(paddleRatioFor(3)).toBe(PADDLE_RATIO_FEW);
    expect(paddleRatioFor(4)).toBe(PADDLE_RATIO_FEW);
    expect(paddleRatioFor(5)).toBe(PADDLE_RATIO_MID);
    expect(paddleRatioFor(8)).toBe(PADDLE_RATIO_MID);
    expect(paddleRatioFor(9)).toBe(PADDLE_RATIO_MANY);
    expect(paddleRatioFor(12)).toBe(PADDLE_RATIO_MANY);
  });

  it('never returns a paddle outside the playable size range', () => {
    for (let players = 3; players <= 12; players += 1) {
      const radius = players >= 9 ? WORLD_LARGE_RADIUS : WORLD_BASE_RADIUS;
      for (const scale of [1, 0.82, 0.65]) {
        const edgeLength = polygonSideLength(players, radius * scale);
        const length = paddleLengthFor(players, edgeLength);
        expect(length).toBeGreaterThanOrEqual(Math.min(PADDLE_MIN_LENGTH, edgeLength * 0.55));
        expect(length).toBeLessThanOrEqual(PADDLE_MAX_LENGTH);
        expect(length).toBeLessThan(edgeLength);
      }
    }
  });

  it('stays controllable on a fully shrunk 12 player arena', () => {
    const edgeLength = polygonSideLength(12, WORLD_LARGE_RADIUS * 0.65);
    const length = paddleLengthFor(12, edgeLength);
    expect(length).toBeGreaterThanOrEqual(PADDLE_MIN_LENGTH);
    // A paddle that covers a reasonable slice of its edge remains hittable.
    expect(length / edgeLength).toBeGreaterThan(0.2);
  });
});

describe('normalised paddle coordinates', () => {
  const [edge] = buildEdges(regularPolygonVertices(6, 460));

  it('converts a paddle length into a normalised half span', () => {
    expect(paddleHalfSpan(edge.length * 0.2, edge.length)).toBeCloseTo(0.1, 9);
    expect(paddleHalfSpan(edge.length * 4, edge.length)).toBe(0.5);
  });

  it('clamps the paddle so it can never overhang its edge', () => {
    const length = 100;
    const half = paddleHalfSpan(length, edge.length);
    expect(clampPaddlePosition(-5, length, edge.length)).toBeCloseTo(half, 9);
    expect(clampPaddlePosition(9, length, edge.length)).toBeCloseTo(1 - half, 9);
    expect(clampPaddlePosition(0.5, length, edge.length)).toBe(0.5);
  });

  it('keeps a clamped paddle inside the edge endpoints in world space', () => {
    const length = 120;
    const shape = paddleShape(edge, clampPaddlePosition(0, length, edge.length), length);
    const startGap = Math.hypot(shape.start.x - edge.start.x, shape.start.y - edge.start.y);
    expect(startGap).toBeLessThan(1e-6);
    const endShape = paddleShape(edge, clampPaddlePosition(1, length, edge.length), length);
    const endGap = Math.hypot(endShape.end.x - edge.end.x, endShape.end.y - edge.end.y);
    expect(endGap).toBeLessThan(1e-6);
  });

  it('derives the step size from the edge length so every edge feels the same', () => {
    const dt = 1 / 60;
    expect(paddleStep(edge.length, dt) * edge.length).toBeCloseTo(PADDLE_SPEED * dt, 9);
    expect(paddleStep(0, dt)).toBe(0);
  });
});

describe('paddle geometry', () => {
  it('sits on its edge with the face offset inward', () => {
    for (const edge of buildEdges(regularPolygonVertices(8, 400))) {
      const shape = paddleShape(edge, 0.5, 90, 12);
      expect(Math.hypot(shape.center.x - edge.mid.x, shape.center.y - edge.mid.y)).toBeCloseTo(
        0,
        9,
      );
      expect(Math.hypot(shape.start.x - shape.end.x, shape.start.y - shape.end.y)).toBeCloseTo(
        90,
        9,
      );
      // The face is exactly one thickness closer to the centre.
      const faceDistance = Math.hypot(shape.frontCenter.x, shape.frontCenter.y);
      expect(faceDistance).toBeCloseTo(Math.hypot(edge.mid.x, edge.mid.y) - 12, 6);
    }
  });

  it('reports coverage of a contact point', () => {
    const [edge] = buildEdges(regularPolygonVertices(5, 400));
    const length = edge.length * 0.2;
    expect(paddleCovers(0.5, length, edge.length, 0.5)).toBe(true);
    expect(paddleCovers(0.5, length, edge.length, 0.58)).toBe(true);
    expect(paddleCovers(0.5, length, edge.length, 0.75)).toBe(false);
    expect(paddleCovers(0.5, length, edge.length, 0.75, 0.2)).toBe(true);
  });

  it('moves the paddle along its edge only', () => {
    const [edge] = buildEdges(regularPolygonVertices(6, 400));
    const left = paddleShape(edge, 0.2, 80);
    const right = paddleShape(edge, 0.8, 80);
    const travel = { x: right.center.x - left.center.x, y: right.center.y - left.center.y };
    const cross = travel.x * edge.normal.x + travel.y * edge.normal.y;
    expect(cross).toBeCloseTo(0, 6);
  });
});
