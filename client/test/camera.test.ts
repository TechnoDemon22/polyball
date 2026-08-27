/**
 * Responsive canvas behaviour.
 *
 * The camera is the only place world units meet CSS pixels, so these tests are
 * what guarantee the arena stays fully on screen - and stays clear of the
 * on-screen controls - on every viewport the game claims to support.
 */
import { describe, expect, it } from 'vitest';
import { createArena, WORLD_VIEW_MARGIN, type ArenaGeometry } from '@polyball/shared';
import {
  createCamera,
  rotationForEdge,
  screenTangentSign,
  updateCamera,
  worldToScreen,
  screenToWorld,
} from '../src/rendering/camera';
import { insetFor, layoutForViewport, TOUCH_BOTTOM_HEIGHT } from '../src/rendering/layout';

/** Every viewport the game is expected to work on. */
const viewports = [
  { name: 'phone portrait', width: 375, height: 812 },
  { name: 'small phone portrait', width: 320, height: 568 },
  { name: 'phone landscape', width: 812, height: 375 },
  { name: 'tablet portrait', width: 768, height: 1024 },
  { name: 'tablet landscape', width: 1024, height: 768 },
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'ultrawide', width: 2560, height: 1080 },
  { name: 'tall split screen', width: 400, height: 1100 },
];

const cornersOf = (arena: ArenaGeometry): { x: number; y: number }[] =>
  arena.edges.flatMap((edge) => [edge.start, edge.end]);

describe('camera fit', () => {
  it('keeps the whole arena on screen for every player count and viewport', () => {
    for (const count of [2, 3, 6, 9, 12]) {
      const arena = createArena(count, 1);
      for (const view of viewports) {
        const camera = updateCamera(createCamera(), {
          width: view.width,
          height: view.height,
          arena,
          rotation: 0,
        });
        for (const corner of cornersOf(arena)) {
          const screen = worldToScreen(camera, corner);
          expect(
            screen.x >= 0 && screen.x <= view.width,
            `${count}p ${view.name}: x=${screen.x.toFixed(1)} outside 0..${view.width}`,
          ).toBe(true);
          expect(
            screen.y >= 0 && screen.y <= view.height,
            `${count}p ${view.name}: y=${screen.y.toFixed(1)} outside 0..${view.height}`,
          ).toBe(true);
        }
      }
    }
  });

  it('keeps the arena clear of the on-screen controls', () => {
    const arena = createArena(6, 1);
    for (const view of viewports) {
      const layout = layoutForViewport(true, view.width, view.height);
      const inset = insetFor(layout);
      const camera = updateCamera(createCamera(), {
        width: view.width,
        height: view.height,
        arena,
        rotation: 0,
        inset,
      });
      for (const corner of cornersOf(arena)) {
        const screen = worldToScreen(camera, corner);
        expect(
          screen.y <= view.height - inset.bottom + 1e-6,
          `${view.name} (${layout}): arena reaches into the pad area`,
        ).toBe(true);
        expect(screen.x).toBeGreaterThanOrEqual(inset.left - 1e-6);
        expect(screen.x).toBeLessThanOrEqual(view.width - inset.right + 1e-6);
      }
    }
  });

  it('uses the space a bottom inset leaves instead of shrinking the view twice', () => {
    const arena = createArena(6, 1);
    const bare = updateCamera(createCamera(), { width: 375, height: 812, arena, rotation: 0 });
    const withPads = updateCamera(createCamera(), {
      width: 375,
      height: 812,
      arena,
      rotation: 0,
      inset: insetFor('bottom'),
    });
    // A 375px wide portrait phone is width-limited, so reserving vertical space
    // for the pads must not cost any arena size at all.
    expect(withPads.scale).toBeCloseTo(bare.scale, 6);
    // ...but the arena is pushed up into the free area.
    expect(withPads.cy).toBeLessThan(bare.cy);
    expect(withPads.cy).toBeCloseTo((812 - TOUCH_BOTTOM_HEIGHT) / 2, 6);
  });

  it('fills a wide screen with a duel rectangle instead of fitting its diagonal', () => {
    const arena = createArena(2, 1);
    const camera = updateCamera(createCamera(), { width: 1440, height: 900, arena, rotation: 0 });
    const height = arena.halfHeight * 2 * camera.scale;
    // The rectangle is 1.36:1, the viewport 1.6:1, so height is the limit and
    // the arena should very nearly fill it.
    expect(height).toBeGreaterThan(900 * 0.7);
    expect(height).toBeLessThanOrEqual(900);
  });

  it('scales with the viewport and keeps the arena centred in the free area', () => {
    const arena = createArena(5, 1);
    const small = updateCamera(createCamera(), { width: 600, height: 600, arena, rotation: 0 });
    const large = updateCamera(createCamera(), { width: 1200, height: 1200, arena, rotation: 0 });
    expect(large.scale).toBeCloseTo(small.scale * 2, 9);
    expect(small.scale).toBeCloseTo(600 / ((arena.baseRadius + WORLD_VIEW_MARGIN) * 2), 9);
  });

  it('round-trips screen and world coordinates under rotation and inset', () => {
    const arena = createArena(7, 1);
    const camera = updateCamera(createCamera(), {
      width: 900,
      height: 500,
      arena,
      rotation: rotationForEdge(arena.edges[3], arena.center),
      inset: insetFor('side'),
    });
    for (const point of [{ x: 0, y: 0 }, arena.edges[3].mid, arena.edges[0].start]) {
      const back = screenToWorld(camera, worldToScreen(camera, point));
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });
});

describe('camera rotation', () => {
  it('puts any defended edge at the bottom of the screen', () => {
    const arena = createArena(9, 1);
    for (const edge of arena.edges) {
      const camera = updateCamera(createCamera(), {
        width: 800,
        height: 800,
        arena,
        rotation: rotationForEdge(edge, arena.center),
      });
      const mid = worldToScreen(camera, edge.mid);
      expect(mid.x).toBeCloseTo(camera.cx, 6);
      expect(mid.y).toBeGreaterThan(camera.cy);
    }
  });

  it('reports the on-screen direction of every rotated edge as "right"', () => {
    const arena = createArena(8, 1);
    for (const edge of arena.edges) {
      const camera = updateCamera(createCamera(), {
        width: 800,
        height: 800,
        arena,
        rotation: rotationForEdge(edge, arena.center),
      });
      const sign = screenTangentSign(camera, edge);
      const start = worldToScreen(camera, edge.start);
      const end = worldToScreen(camera, edge.end);
      // Moving the paddle in `sign` direction must move it right on screen.
      expect(Math.sign((end.x - start.x) * sign)).toBe(1);
    }
  });
});

describe('touch control layout', () => {
  it('is disabled when the player turns the pads off', () => {
    expect(layoutForViewport(false, 375, 812)).toBe('none');
    expect(insetFor('none')).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('stacks at the bottom on portrait phones and tablets', () => {
    expect(layoutForViewport(true, 375, 812)).toBe('bottom');
    expect(layoutForViewport(true, 320, 568)).toBe('bottom');
    expect(layoutForViewport(true, 768, 1024)).toBe('bottom');
  });

  it('moves to the sides when the viewport is too short for a bottom stack', () => {
    expect(layoutForViewport(true, 812, 375)).toBe('side');
    expect(layoutForViewport(true, 667, 375)).toBe('side');
    const inset = insetFor('side');
    expect(inset.bottom).toBe(0);
    expect(inset.left).toBeGreaterThan(0);
    expect(inset.left).toBe(inset.right);
  });

  it('leaves a landscape tablet enough room for the bottom stack', () => {
    expect(layoutForViewport(true, 1024, 768)).toBe('bottom');
  });

  it('never reserves more than half the viewport height', () => {
    for (const view of viewports) {
      const inset = insetFor(layoutForViewport(true, view.width, view.height));
      expect(inset.bottom).toBeLessThan(view.height / 2);
      expect(inset.left + inset.right).toBeLessThan(view.width / 2);
    }
  });
});
