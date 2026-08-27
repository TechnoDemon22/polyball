import {
  arenaViewExtent,
  WORLD_VIEW_MARGIN,
  type ArenaGeometry,
  type Edge,
  type Vec2,
} from '@polyball/shared';
import { NO_INSET, type ViewInset } from './layout';

/**
 * World space is in world units with +y pointing up and the arena centred on
 * the origin. Screen space is CSS pixels with +y pointing down. The camera is
 * the only place the two meet, which keeps the simulation resolution- and
 * orientation-independent.
 */
export interface Camera {
  /** Canvas centre in CSS pixels. */
  cx: number;
  cy: number;
  /** CSS pixels per world unit. */
  scale: number;
  /** Rotation applied to world space before projection. */
  rotation: number;
  cos: number;
  sin: number;
  width: number;
  height: number;
}

export const createCamera = (): Camera => ({
  cx: 0,
  cy: 0,
  scale: 1,
  rotation: 0,
  cos: 1,
  sin: 0,
  width: 0,
  height: 0,
});

/**
 * Rotation that puts `edge`'s midpoint at the bottom of the screen, so a player
 * always defends the near side no matter which polygon edge they own.
 */
export function rotationForEdge(edge: Edge | undefined, center: Vec2): number {
  if (!edge) return 0;
  const angle = Math.atan2(edge.mid.y - center.y, edge.mid.x - center.x);
  return -Math.PI / 2 - angle;
}

export interface CameraTarget {
  width: number;
  height: number;
  arena: ArenaGeometry;
  rotation: number;
  /** Screen area covered by overlays (touch pads); the arena avoids it. */
  inset?: ViewInset;
}

/**
 * Fit the whole arena (at scale 1, so the view never zooms while the arena
 * shrinks) into the part of the viewport that is not covered by controls, and
 * centre it there. Both axes are used, so a wide screen stops wasting its width
 * and a landscape phone no longer hides the player's own edge behind a pad.
 */
export function updateCamera(camera: Camera, target: CameraTarget): Camera {
  const { width, height, arena, rotation } = target;
  const inset = target.inset ?? NO_INSET;

  const boxWidth = Math.max(1, width - inset.left - inset.right);
  const boxHeight = Math.max(1, height - inset.top - inset.bottom);
  const extent = arenaViewExtent(arena, rotation);
  const spanX = (extent.x + WORLD_VIEW_MARGIN) * 2;
  const spanY = (extent.y + WORLD_VIEW_MARGIN) * 2;

  camera.width = width;
  camera.height = height;
  camera.cx = inset.left + boxWidth / 2;
  camera.cy = inset.top + boxHeight / 2;
  camera.scale = Math.max(1e-6, Math.min(boxWidth / spanX, boxHeight / spanY));
  camera.rotation = rotation;
  camera.cos = Math.cos(rotation);
  camera.sin = Math.sin(rotation);
  return camera;
}

export function worldToScreen(camera: Camera, point: Vec2): Vec2 {
  const rx = point.x * camera.cos - point.y * camera.sin;
  const ry = point.x * camera.sin + point.y * camera.cos;
  return { x: camera.cx + rx * camera.scale, y: camera.cy - ry * camera.scale };
}

export function screenToWorld(camera: Camera, point: Vec2): Vec2 {
  const rx = (point.x - camera.cx) / camera.scale;
  const ry = -(point.y - camera.cy) / camera.scale;
  return { x: rx * camera.cos + ry * camera.sin, y: -rx * camera.sin + ry * camera.cos };
}

/** World length -> screen length. */
export const worldToScreenLength = (camera: Camera, length: number): number =>
  length * camera.scale;

/**
 * Which way is "screen right" along this edge?
 *
 * The polygon is generated with the spec's vertex formula, so an edge's tangent
 * can point either way on screen once the camera has rotated the world. Input
 * needs the sign to make "right" always move the paddle right.
 */
export function screenTangentSign(camera: Camera, edge: Edge | undefined): 1 | -1 {
  if (!edge) return 1;
  const x = edge.tangent.x * camera.cos - edge.tangent.y * camera.sin;
  return x >= 0 ? 1 : -1;
}
