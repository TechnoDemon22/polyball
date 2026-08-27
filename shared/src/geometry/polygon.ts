import type { ArenaShape, Edge, Vec2 } from '../types/index';
import { dot, normalize, perpendicular, sub } from './vector';

/**
 * Vertices of a regular N-gon.
 *
 *   angle_i = startAngle + 2*PI*i / sideCount
 *   x = cx + radius * cos(angle_i)
 *   y = cy + radius * sin(angle_i)
 *
 * Because every vertex sits on the same circumcircle at a constant angular
 * step, all edges are exactly the same length by construction.
 */
export function regularPolygonVertices(
  sideCount: number,
  radius: number,
  startAngle = 0,
  center: Vec2 = { x: 0, y: 0 },
): Vec2[] {
  if (!Number.isInteger(sideCount) || sideCount < 3) {
    throw new Error(`regularPolygonVertices: sideCount must be an integer >= 3 (got ${sideCount})`);
  }
  if (!(radius > 0)) throw new Error(`regularPolygonVertices: radius must be > 0 (got ${radius})`);

  const step = (Math.PI * 2) / sideCount;
  const vertices: Vec2[] = new Array(sideCount);
  for (let i = 0; i < sideCount; i += 1) {
    const angle = startAngle + step * i;
    vertices[i] = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  }
  return vertices;
}

/**
 * Rotation that places the midpoint of edge 0 at `targetAngle`.
 * Used to keep the local player's edge at the bottom of the screen
 * (targetAngle = PI/2 in y-down world space).
 */
export function startAngleForEdgeMid(sideCount: number, targetAngle: number): number {
  return targetAngle - Math.PI / sideCount;
}

/**
 * Axis-aligned rectangle vertices (two-player duel mode).
 *
 * Ordered so that edge 0 is the bottom edge (matching the polygon convention
 * where edge 0 sits at the bottom of the screen) and edge 2 is the top edge.
 * Edges 1 and 3 are the side walls.
 */
export function rectangleVertices(
  halfWidth: number,
  halfHeight: number,
  center: Vec2 = { x: 0, y: 0 },
): Vec2[] {
  return [
    { x: center.x + halfWidth, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y - halfHeight },
  ];
}

export function centroid(vertices: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const v of vertices) {
    x += v.x;
    y += v.y;
  }
  return { x: x / vertices.length, y: y / vertices.length };
}

/**
 * Build the edge list for a convex polygon.
 *
 * The inward normal is derived from the centroid rather than from the winding
 * order, so the same code is correct for clockwise and counter-clockwise input
 * and for both polygon and rectangle arenas.
 */
export function buildEdges(vertices: Vec2[], center: Vec2 = centroid(vertices)): Edge[] {
  const count = vertices.length;
  const edges: Edge[] = new Array(count);

  for (let i = 0; i < count; i += 1) {
    const start = vertices[i];
    const end = vertices[(i + 1) % count];
    const delta = sub(end, start);
    const tangent = normalize(delta);
    let normal = perpendicular(tangent);
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    // Flip the normal if it points away from the arena interior.
    if (dot(normal, sub(center, mid)) < 0) {
      normal = { x: -normal.x, y: -normal.y };
    }
    edges[i] = {
      index: i,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      mid,
      tangent,
      normal,
      length: Math.hypot(delta.x, delta.y),
      angle: Math.atan2(tangent.y, tangent.x),
      ownerId: null,
      active: false,
    };
  }
  return edges;
}

/** Distance from the centre to an edge midpoint of a regular N-gon. */
export const apothem = (sideCount: number, radius: number): number =>
  radius * Math.cos(Math.PI / sideCount);

/** Side length of a regular N-gon with the given circumradius. */
export const polygonSideLength = (sideCount: number, radius: number): number =>
  2 * radius * Math.sin(Math.PI / sideCount);

/** Arena shape used for a given player count. */
export const shapeForPlayers = (playerCount: number): ArenaShape =>
  playerCount <= 2 ? 'rect' : 'polygon';

/**
 * Signed distance from a point to an edge's infinite line, measured along the
 * inward normal. Positive = inside the arena.
 */
export const signedDistanceToEdge = (point: Vec2, edge: Edge): number =>
  dot(sub(point, edge.start), edge.normal);

/** Convex containment test using inward normals. */
export function isInsideArena(point: Vec2, edges: Edge[], margin = 0): boolean {
  for (const edge of edges) {
    if (signedDistanceToEdge(point, edge) < margin) return false;
  }
  return true;
}

/** The edge a point has travelled furthest past (most negative signed distance). */
export function deepestOutsideEdge(point: Vec2, edges: Edge[]): Edge | null {
  let worst: Edge | null = null;
  let worstDistance = 0;
  for (const edge of edges) {
    const d = signedDistanceToEdge(point, edge);
    if (d < worstDistance) {
      worstDistance = d;
      worst = edge;
    }
  }
  return worst;
}

/** World position of a normalised (0..1) coordinate along an edge. */
export const pointOnEdge = (edge: Edge, t: number): Vec2 => ({
  x: edge.start.x + edge.tangent.x * edge.length * t,
  y: edge.start.y + edge.tangent.y * edge.length * t,
});

/** Inverse of {@link pointOnEdge}: world point -> normalised edge coordinate. */
export const edgeCoordinateOf = (edge: Edge, point: Vec2): number =>
  dot(sub(point, edge.start), edge.tangent) / edge.length;
