import { describe, expect, it } from 'vitest';
import {
  apothem,
  buildEdges,
  centroid,
  createArena,
  edgeCoordinateOf,
  isInsideArena,
  pointOnEdge,
  polygonSideLength,
  rectangleVertices,
  regularPolygonVertices,
  shapeForPlayers,
  signedDistanceToEdge,
  startAngleForEdgeMid,
} from '../src/index';

const SIDES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe('regular polygon generation', () => {
  it('rejects degenerate polygons', () => {
    expect(() => regularPolygonVertices(2, 100)).toThrow();
    expect(() => regularPolygonVertices(3.5, 100)).toThrow();
    expect(() => regularPolygonVertices(6, 0)).toThrow();
  });

  it('creates one vertex per side', () => {
    for (const sides of SIDES) {
      expect(regularPolygonVertices(sides, 400)).toHaveLength(sides);
    }
  });

  it('places every vertex on the circumcircle', () => {
    for (const sides of SIDES) {
      for (const v of regularPolygonVertices(sides, 400)) {
        expect(Math.hypot(v.x, v.y)).toBeCloseTo(400, 6);
      }
    }
  });

  it('produces edges of exactly equal length', () => {
    for (const sides of SIDES) {
      const edges = buildEdges(regularPolygonVertices(sides, 460, 0.37));
      const expected = polygonSideLength(sides, 460);
      for (const edge of edges) {
        expect(edge.length).toBeCloseTo(expected, 6);
      }
    }
  });

  it('is centred on the origin', () => {
    for (const sides of SIDES) {
      const c = centroid(regularPolygonVertices(sides, 300));
      expect(c.x).toBeCloseTo(0, 6);
      expect(c.y).toBeCloseTo(0, 6);
    }
  });
});

describe('edge frames', () => {
  it('has unit tangents and unit inward normals', () => {
    for (const sides of SIDES) {
      for (const edge of buildEdges(regularPolygonVertices(sides, 420))) {
        expect(Math.hypot(edge.tangent.x, edge.tangent.y)).toBeCloseTo(1, 9);
        expect(Math.hypot(edge.normal.x, edge.normal.y)).toBeCloseTo(1, 9);
      }
    }
  });

  it('points normals toward the centre', () => {
    for (const sides of SIDES) {
      for (const edge of buildEdges(regularPolygonVertices(sides, 420))) {
        // Walking inward from the midpoint must reduce the distance to centre.
        const inward = {
          x: edge.mid.x + edge.normal.x * 10,
          y: edge.mid.y + edge.normal.y * 10,
        };
        expect(Math.hypot(inward.x, inward.y)).toBeLessThan(Math.hypot(edge.mid.x, edge.mid.y));
      }
    }
  });

  it('keeps tangent and normal perpendicular', () => {
    for (const edge of buildEdges(regularPolygonVertices(7, 420))) {
      expect(edge.tangent.x * edge.normal.x + edge.tangent.y * edge.normal.y).toBeCloseTo(0, 9);
    }
  });

  it('reports the midpoint distance as the apothem', () => {
    for (const sides of SIDES) {
      for (const edge of buildEdges(regularPolygonVertices(sides, 500))) {
        expect(Math.hypot(edge.mid.x, edge.mid.y)).toBeCloseTo(apothem(sides, 500), 6);
      }
    }
  });

  it('stores the edge angle as atan2 of the tangent', () => {
    for (const edge of buildEdges(regularPolygonVertices(5, 300))) {
      expect(edge.angle).toBeCloseTo(Math.atan2(edge.tangent.y, edge.tangent.x), 9);
    }
  });
});

describe('edge coordinates', () => {
  it('round-trips normalised positions', () => {
    const [edge] = buildEdges(regularPolygonVertices(6, 400));
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(edgeCoordinateOf(edge, pointOnEdge(edge, t))).toBeCloseTo(t, 9);
    }
  });

  it('maps 0 and 1 to the endpoints and 0.5 to the midpoint', () => {
    const [edge] = buildEdges(regularPolygonVertices(9, 400));
    expect(pointOnEdge(edge, 0).x).toBeCloseTo(edge.start.x, 9);
    expect(pointOnEdge(edge, 1).y).toBeCloseTo(edge.end.y, 9);
    expect(pointOnEdge(edge, 0.5).x).toBeCloseTo(edge.mid.x, 9);
  });
});

describe('containment', () => {
  it('accepts interior points and rejects exterior points', () => {
    const edges = buildEdges(regularPolygonVertices(8, 400));
    expect(isInsideArena({ x: 0, y: 0 }, edges)).toBe(true);
    expect(isInsideArena({ x: 0, y: 900 }, edges)).toBe(false);
    for (const edge of edges) {
      expect(signedDistanceToEdge({ x: 0, y: 0 }, edge)).toBeGreaterThan(0);
    }
  });
});

describe('arena layout', () => {
  it('puts edge 0 at the bottom of the screen', () => {
    for (const sides of SIDES) {
      const startAngle = startAngleForEdgeMid(sides, Math.PI / 2);
      const [edge] = buildEdges(regularPolygonVertices(sides, 400, startAngle));
      expect(Math.atan2(edge.mid.y, edge.mid.x)).toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it('uses a rectangle for two players and a polygon from three up', () => {
    expect(shapeForPlayers(2)).toBe('rect');
    expect(shapeForPlayers(3)).toBe('polygon');
    expect(createArena(2).shape).toBe('rect');
    expect(createArena(2).sideCount).toBe(4);
    expect(createArena(7).sideCount).toBe(7);
  });

  it('builds a rectangle with opposite horizontal edges', () => {
    const edges = buildEdges(rectangleVertices(400, 250));
    expect(edges).toHaveLength(4);
    // Edge 0 (bottom) and edge 2 (top) are the defended sides.
    expect(edges[0].length).toBeCloseTo(800, 9);
    expect(edges[2].length).toBeCloseTo(800, 9);
    expect(edges[0].mid.y).toBeGreaterThan(0);
    expect(edges[2].mid.y).toBeLessThan(0);
  });
});
