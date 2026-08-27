import type { Edge, Vec2 } from '../types/index';
import { clamp01, dot, normalize, rotate, sub } from './vector';

export interface SegmentContact {
  /** Closest point on the finite segment. */
  point: Vec2;
  /** Unit vector from the segment toward the circle centre. */
  normal: Vec2;
  distance: number;
  /** How far the circle overlaps the segment (>= 0 when touching). */
  penetration: number;
  /** Normalised position of the contact along the segment (0..1). */
  t: number;
}

/** Closest point on the finite segment ab to p. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-12) return { x: a.x, y: a.y };
  const t = clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq);
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Normalised projection of p onto segment ab, clamped to 0..1. */
export function segmentCoordinate(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-12) return 0;
  return clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq);
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const cp = closestPointOnSegment(p, a, b);
  return Math.hypot(p.x - cp.x, p.y - cp.y);
}

/**
 * Circle vs finite segment (capsule) test.
 * Returns null when there is no overlap.
 */
export function circleSegmentContact(
  center: Vec2,
  radius: number,
  a: Vec2,
  b: Vec2,
  fallbackNormal?: Vec2,
): SegmentContact | null {
  const point = closestPointOnSegment(center, a, b);
  const dx = center.x - point.x;
  const dy = center.y - point.y;
  const distance = Math.hypot(dx, dy);
  if (distance > radius) return null;

  let normal: Vec2;
  if (distance > 1e-6) {
    normal = { x: dx / distance, y: dy / distance };
  } else if (fallbackNormal) {
    normal = fallbackNormal;
  } else {
    normal = normalize({ x: -(b.y - a.y), y: b.x - a.x });
  }

  return {
    point,
    normal,
    distance,
    penetration: radius - distance,
    t: segmentCoordinate(point, a, b),
  };
}

/** Ball vs one arena edge, using the edge's own inward normal as the fallback. */
export function ballEdgeContact(center: Vec2, radius: number, edge: Edge): SegmentContact | null {
  return circleSegmentContact(center, radius, edge.start, edge.end, edge.normal);
}

/** reflected = v - 2 * dot(v, n) * n  (n must be a unit vector). */
export function reflect(v: Vec2, n: Vec2): Vec2 {
  const d = 2 * dot(v, n);
  return { x: v.x - d * n.x, y: v.y - d * n.y };
}

/** True when the velocity has a component moving out through the edge. */
export const isApproachingEdge = (velocity: Vec2, edge: Edge): boolean =>
  dot(velocity, edge.normal) < 0;

/**
 * Keep a direction from becoming almost parallel to a surface, which would
 * otherwise cause endless grazing bounces along an edge.
 *
 * @param direction unit direction of travel
 * @param normal    inward unit normal of the surface just hit
 * @param maxAngle  maximum allowed angle between direction and normal
 */
export function clampAngleFromNormal(direction: Vec2, normal: Vec2, maxAngle: number): Vec2 {
  const d = normalize(direction);
  const cosLimit = Math.cos(maxAngle);
  const alignment = dot(d, normal);
  if (alignment >= cosLimit) return d;

  // Rotate the normal by +/- maxAngle, keeping the original tangential side.
  const tangentialSign = dot(d, { x: -normal.y, y: normal.x }) >= 0 ? 1 : -1;
  return rotate(normal, maxAngle * tangentialSign);
}

/**
 * Position a circle so it rests exactly outside the surface it sank into.
 * `contact.normal` points from the surface toward the circle centre.
 */
export function resolvePenetration(contact: SegmentContact, radius: number, skin: number): Vec2 {
  const target = radius + skin;
  return {
    x: contact.point.x + contact.normal.x * target,
    y: contact.point.y + contact.normal.y * target,
  };
}

/** Time (seconds) until a point travelling at constant velocity reaches an edge plane. */
export function timeToEdgePlane(
  position: Vec2,
  velocity: Vec2,
  edge: Edge,
  offset = 0,
): number | null {
  const closing = -dot(velocity, edge.normal);
  if (closing <= 1e-6) return null;
  const gap = dot(sub(position, edge.start), edge.normal) - offset;
  if (gap < 0) return 0;
  return gap / closing;
}
