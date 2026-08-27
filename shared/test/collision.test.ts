import { describe, expect, it } from 'vitest';
import {
  ballEdgeContact,
  buildEdges,
  circleSegmentContact,
  clampAngleFromNormal,
  closestPointOnSegment,
  distanceToSegment,
  dot,
  reflect,
  regularPolygonVertices,
  resolvePenetration,
  segmentCoordinate,
  timeToEdgePlane,
} from '../src/index';

const a = { x: -100, y: 0 };
const b = { x: 100, y: 0 };

describe('closest point on a finite segment', () => {
  it('projects points that fall inside the span', () => {
    expect(closestPointOnSegment({ x: 20, y: 50 }, a, b)).toEqual({ x: 20, y: 0 });
  });

  it('clamps to the endpoints instead of using the infinite line', () => {
    expect(closestPointOnSegment({ x: -500, y: 20 }, a, b)).toEqual({ x: -100, y: 0 });
    expect(closestPointOnSegment({ x: 500, y: -20 }, a, b)).toEqual({ x: 100, y: 0 });
  });

  it('handles degenerate segments', () => {
    expect(closestPointOnSegment({ x: 5, y: 5 }, a, a)).toEqual(a);
  });

  it('measures distance to the segment, not the line', () => {
    expect(distanceToSegment({ x: 0, y: 30 }, a, b)).toBeCloseTo(30, 9);
    expect(distanceToSegment({ x: 200, y: 0 }, a, b)).toBeCloseTo(100, 9);
  });

  it('reports the normalised position along the segment', () => {
    expect(segmentCoordinate({ x: 0, y: 10 }, a, b)).toBeCloseTo(0.5, 9);
    expect(segmentCoordinate({ x: -100, y: 0 }, a, b)).toBeCloseTo(0, 9);
  });
});

describe('circle vs segment', () => {
  it('detects overlap and reports penetration', () => {
    const contact = circleSegmentContact({ x: 0, y: 8 }, 10, a, b);
    expect(contact).not.toBeNull();
    expect(contact!.distance).toBeCloseTo(8, 9);
    expect(contact!.penetration).toBeCloseTo(2, 9);
    expect(contact!.normal.y).toBeCloseTo(1, 9);
  });

  it('returns null when the circle is clear of the segment', () => {
    expect(circleSegmentContact({ x: 0, y: 11 }, 10, a, b)).toBeNull();
    expect(circleSegmentContact({ x: 130, y: 0 }, 10, a, b)).toBeNull();
  });

  it('detects contact past the end of the segment (rounded cap)', () => {
    expect(circleSegmentContact({ x: 105, y: 3 }, 10, a, b)).not.toBeNull();
  });

  it('falls back to the supplied normal for a centred degenerate contact', () => {
    const contact = circleSegmentContact({ x: 0, y: 0 }, 10, a, b, { x: 0, y: -1 });
    expect(contact!.normal).toEqual({ x: 0, y: -1 });
  });

  it('resolves penetration to exactly radius + skin from the surface', () => {
    const contact = circleSegmentContact({ x: 0, y: 4 }, 10, a, b)!;
    const resolved = resolvePenetration(contact, 10, 0.5);
    expect(resolved.y).toBeCloseTo(10.5, 9);
  });
});

describe('reflection', () => {
  it('mirrors velocity about a unit normal', () => {
    expect(reflect({ x: 5, y: -5 }, { x: 0, y: 1 })).toEqual({ x: 5, y: 5 });
  });

  it('preserves speed', () => {
    const v = { x: 137, y: -412 };
    const n = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const r = reflect(v, n);
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(Math.hypot(v.x, v.y), 6);
  });

  it('inverts a head-on impact', () => {
    const r = reflect({ x: 0, y: -300 }, { x: 0, y: 1 });
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(300, 9);
  });

  it('reflects correctly off every edge of a polygon', () => {
    for (const edge of buildEdges(regularPolygonVertices(7, 400))) {
      const outward = { x: -edge.normal.x * 500, y: -edge.normal.y * 500 };
      const bounced = reflect(outward, edge.normal);
      // After bouncing, the ball must travel back into the arena.
      expect(dot(bounced, edge.normal)).toBeGreaterThan(0);
    }
  });
});

describe('shallow angle clamping', () => {
  const normal = { x: 0, y: 1 };

  it('leaves safe directions untouched', () => {
    const d = { x: 0.3, y: 0.95 };
    const clamped = clampAngleFromNormal(d, normal, 1.2);
    expect(Math.atan2(clamped.x, clamped.y)).toBeCloseTo(Math.atan2(d.x, d.y), 2);
  });

  it('lifts near-parallel directions away from the surface', () => {
    const clamped = clampAngleFromNormal({ x: 1, y: 0.02 }, normal, 1.2);
    expect(dot(clamped, normal)).toBeGreaterThanOrEqual(Math.cos(1.2) - 1e-9);
    expect(clamped.x).toBeGreaterThan(0);
  });

  it('keeps the tangential side of the original direction', () => {
    const clamped = clampAngleFromNormal({ x: -1, y: 0.01 }, normal, 1.2);
    expect(clamped.x).toBeLessThan(0);
  });
});

describe('time to an edge plane', () => {
  const [edge] = buildEdges(regularPolygonVertices(4, 400, Math.PI / 4));

  it('returns null when moving away from the edge', () => {
    const away = { x: -edge.normal.x * -100, y: -edge.normal.y * -100 };
    expect(timeToEdgePlane({ x: 0, y: 0 }, away, edge)).toBeNull();
  });

  it('predicts arrival time for a ball heading at the edge', () => {
    const speed = 200;
    const velocity = { x: -edge.normal.x * speed, y: -edge.normal.y * speed };
    const distance = dot({ x: 0 - edge.start.x, y: 0 - edge.start.y }, edge.normal);
    expect(timeToEdgePlane({ x: 0, y: 0 }, velocity, edge)).toBeCloseTo(distance / speed, 6);
  });

  it('accounts for the ball radius offset', () => {
    const velocity = { x: -edge.normal.x * 100, y: -edge.normal.y * 100 };
    const plain = timeToEdgePlane({ x: 0, y: 0 }, velocity, edge)!;
    const offset = timeToEdgePlane({ x: 0, y: 0 }, velocity, edge, 9)!;
    expect(offset).toBeLessThan(plain);
    expect(plain - offset).toBeCloseTo(9 / 100, 6);
  });
});

describe('ball vs arena edge', () => {
  it('uses the edge normal as the contact fallback', () => {
    const [edge] = buildEdges(regularPolygonVertices(6, 300));
    const contact = ballEdgeContact(edge.mid, 9, edge);
    expect(contact).not.toBeNull();
    expect(contact!.normal.x).toBeCloseTo(edge.normal.x, 9);
  });
});
