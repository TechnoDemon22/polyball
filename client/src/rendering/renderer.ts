import {
  BALL_MAX_SPEED,
  HOT_STREAK,
  PADDLE_THICKNESS,
  paddleShape,
  type Edge,
  type GameState,
  type PlayerState,
  type Vec2,
} from '@polyball/shared';
import { worldToScreen, worldToScreenLength, type Camera } from './camera';
import type { Effects } from './effects';
import { colorForPlayer, symbolForPlayer, withAlpha, type Palette } from './palette';

/**
 * Canvas renderer for a Polyball match.
 *
 * The pipeline runs in a fixed order every frame:
 *   1. clear the backing store (device pixels, DPR aware)
 *   2. background wash + vignette
 *   3. arena floor and grid
 *   4. shrink preview outline
 *   5. boundary edges (live edges tinted by owner, dead edges as solid walls)
 *   6. ball trail
 *   7. paddles
 *   8. player symbols and life pips
 *   9. ball and glow
 *  10. particles and rings
 *  11. pressure flash / centre marker
 *
 * The renderer is stateless with respect to gameplay: it only reads GameState,
 * so the same code draws a practice match and (later) a server snapshot.
 */
export interface Frame {
  state: GameState;
  camera: Camera;
  effects: Effects;
  palette: Palette;
  localPlayerId: string | null;
  showSymbols: boolean;
  reducedMotion: boolean;
  /** Seconds since the loop started; drives subtle pulses. */
  time: number;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser does not provide a 2D canvas context.');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /**
   * Match the backing store to the device pixel ratio while keeping the CSS box
   * in logical pixels. Without this the game looks blurry on phones and Retina
   * laptops.
   */
  resize(width: number, height: number, devicePixelRatio = 1): void {
    const ratio = Math.min(3, Math.max(1, devicePixelRatio));
    const deviceWidth = Math.max(1, Math.round(width * ratio));
    const deviceHeight = Math.max(1, Math.round(height * ratio));
    if (this.canvas.width !== deviceWidth) this.canvas.width = deviceWidth;
    if (this.canvas.height !== deviceHeight) this.canvas.height = deviceHeight;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.dpr = ratio;
    this.width = width;
    this.height = height;
  }

  draw(frame: Frame): void {
    const { ctx } = this;
    if (this.width <= 0 || this.height <= 0) return;

    // 1 - clear
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // 2 - background
    this.drawBackground(frame);

    ctx.save();
    const shake = this.shakeOffset(frame);
    ctx.translate(shake.x, shake.y);

    this.drawFloor(frame); // 3
    this.drawPreview(frame); // 4
    this.drawBoundary(frame); // 5
    this.drawTrail(frame); // 6
    this.drawPaddles(frame); // 7
    this.drawLabels(frame); // 8
    this.drawBall(frame); // 9
    this.drawEffects(frame); // 10
    ctx.restore();

    this.drawPressure(frame); // 11
  }

  /** Screen-space camera jitter, in CSS pixels. Disabled by reduced motion. */
  private shakeOffset(frame: Frame): Vec2 {
    if (frame.reducedMotion || frame.effects.shake <= 0.01) return { x: 0, y: 0 };
    const amount = worldToScreenLength(frame.camera, frame.effects.shake);
    const angle = frame.time * 47.3;
    return { x: Math.sin(angle) * amount, y: Math.cos(angle * 1.37) * amount };
  }

  /** Screen path around the arena, optionally rescaled about the centre. */
  private tracePolygon(frame: Frame, factor = 1): void {
    const { ctx } = this;
    const { camera, state } = frame;
    const { center, edges } = state.arena;
    ctx.beginPath();
    edges.forEach((edge, index) => {
      const point = worldToScreen(camera, {
        x: center.x + (edge.start.x - center.x) * factor,
        y: center.y + (edge.start.y - center.y) * factor,
      });
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
  }

  private drawBackground(frame: Frame): void {
    const { ctx } = this;
    const { palette } = frame;
    const gradient = ctx.createRadialGradient(
      this.width / 2,
      this.height * 0.42,
      Math.min(this.width, this.height) * 0.1,
      this.width / 2,
      this.height * 0.5,
      Math.max(this.width, this.height) * 0.78,
    );
    gradient.addColorStop(0, palette.background);
    gradient.addColorStop(1, palette.backgroundEdge);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /** Arena interior plus a polar grid that makes the shrink readable. */
  private drawFloor(frame: Frame): void {
    const { ctx } = this;
    const { camera, palette, state } = frame;

    this.tracePolygon(frame);
    ctx.fillStyle = 'rgba(10, 18, 42, 0.55)';
    ctx.fill();

    ctx.save();
    this.tracePolygon(frame);
    ctx.clip();

    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    for (const factor of [0.25, 0.5, 0.75]) {
      this.tracePolygon(frame, factor);
      ctx.stroke();
    }

    const center = worldToScreen(camera, state.arena.center);
    ctx.beginPath();
    for (const edge of state.arena.edges) {
      const vertex = worldToScreen(camera, edge.start);
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(vertex.x, vertex.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Dashed outline showing where the boundary will be in a few seconds. */
  private drawPreview(frame: Frame): void {
    const { state } = frame;
    if (state.previewScale >= state.arena.scale - 1e-4) return;
    const { ctx } = this;
    const factor = state.previewScale / state.arena.scale;

    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = frame.palette.preview;
    this.tracePolygon(frame, factor);
    ctx.stroke();
    ctx.restore();
  }

  private ownerOf(state: GameState, edge: Edge): PlayerState | undefined {
    return edge.ownerId === null
      ? undefined
      : state.players.find((player) => player.id === edge.ownerId);
  }

  /**
   * Boundary edges. A live player's edge is tinted with their colour (that is
   * the line they must defend); an eliminated player's edge is drawn as a solid
   * neutral wall, which is exactly how it now behaves in the simulation.
   */
  private drawBoundary(frame: Frame): void {
    const { ctx } = this;
    const { camera, palette, state, localPlayerId } = frame;

    for (const edge of state.arena.edges) {
      const owner = this.ownerOf(state, edge);
      const live = edge.active && owner !== undefined && owner.alive;
      const start = worldToScreen(camera, edge.start);
      const end = worldToScreen(camera, edge.end);

      if (live && owner) {
        const color = colorForPlayer(owner.colorIndex);
        const mine = owner.id === localPlayerId;
        ctx.lineWidth = Math.max(2, worldToScreenLength(camera, mine ? 5 : 3.5));
        ctx.strokeStyle = withAlpha(color, mine ? 0.95 : 0.6);
        if (!frame.reducedMotion) {
          ctx.shadowColor = withAlpha(color, 0.75);
          ctx.shadowBlur = mine ? 18 : 10;
        }
      } else {
        ctx.lineWidth = Math.max(2, worldToScreenLength(camera, 4));
        ctx.strokeStyle = owner ? palette.wallDead : palette.wall;
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  private drawTrail(frame: Frame): void {
    const { effects, camera, state, palette } = frame;
    if (effects.trail.length < 2) return;
    const { ctx } = this;
    const hot = state.rally >= HOT_STREAK;

    ctx.lineCap = 'round';
    for (let i = 1; i < effects.trail.length; i += 1) {
      const previous = worldToScreen(camera, effects.trail[i - 1]);
      const current = worldToScreen(camera, effects.trail[i]);
      const strength = i / effects.trail.length;
      ctx.strokeStyle = withAlpha(hot ? '#fbbf24' : palette.ball, 0.06 + strength * 0.34);
      ctx.lineWidth = Math.max(1, worldToScreenLength(camera, state.ball.radius * strength * 1.4));
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(current.x, current.y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  private drawPaddles(frame: Frame): void {
    const { ctx } = this;
    const { camera, state, localPlayerId } = frame;

    for (const player of state.players) {
      const edge = state.arena.edges[player.edgeIndex];
      if (!edge) continue;
      const shape = paddleShape(edge, player.paddlePosition, player.paddleLength, PADDLE_THICKNESS);
      const color = colorForPlayer(player.colorIndex);
      const mine = player.id === localPlayerId;

      const corners = [shape.start, shape.frontStart, shape.frontEnd, shape.end].map((point) =>
        worldToScreen(camera, point),
      );

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();

      if (!player.alive) {
        ctx.fillStyle = withAlpha(color, 0.16);
        ctx.fill();
        continue;
      }

      if (!frame.reducedMotion) {
        ctx.shadowColor = withAlpha(color, 0.9);
        ctx.shadowBlur = mine ? 22 : 12;
      }
      ctx.fillStyle = withAlpha(color, mine ? 1 : 0.85);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (mine) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  /**
   * Symbols and life pips, drawn just inside each edge. Symbols are the
   * colour-blind fallback: every player is identifiable without relying on hue.
   */
  private drawLabels(frame: Frame): void {
    const { ctx } = this;
    const { camera, state, palette } = frame;
    const size = Math.round(Math.max(11, Math.min(20, worldToScreenLength(camera, 26))));

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${size}px ${'ui-monospace, monospace'}`;

    for (const player of state.players) {
      const edge = state.arena.edges[player.edgeIndex];
      if (!edge) continue;
      const inset = PADDLE_THICKNESS + 30;
      const anchor = worldToScreen(camera, {
        x: edge.mid.x + edge.normal.x * inset,
        y: edge.mid.y + edge.normal.y * inset,
      });
      const color = colorForPlayer(player.colorIndex);

      if (frame.showSymbols) {
        ctx.fillStyle = player.alive ? withAlpha(color, 0.95) : palette.wallDead;
        ctx.fillText(symbolForPlayer(player.colorIndex), anchor.x, anchor.y);
      }

      const pipRadius = Math.max(1.5, size * 0.14);
      const gap = pipRadius * 3;
      const row = anchor.y + size * 0.85;
      const start = anchor.x - ((player.lives - 1) * gap) / 2;
      ctx.fillStyle = player.alive ? withAlpha(color, 0.85) : palette.wallDead;
      for (let i = 0; i < player.lives; i += 1) {
        ctx.beginPath();
        ctx.arc(start + i * gap, row, pipRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawBall(frame: Frame): void {
    const { ctx } = this;
    const { camera, palette, state } = frame;
    const ball = state.ball;
    const at = worldToScreen(camera, { x: ball.x, y: ball.y });
    const radius = Math.max(2.5, worldToScreenLength(camera, ball.radius));
    const heat = Math.min(1, ball.speed / BALL_MAX_SPEED);

    if (!frame.reducedMotion) {
      const glow = ctx.createRadialGradient(at.x, at.y, radius * 0.2, at.x, at.y, radius * 4);
      glow.addColorStop(0, withAlpha('#ffffff', 0.55 + heat * 0.35));
      glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(at.x, at.y, radius * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = palette.ball;
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = palette.ballGlow;
    ctx.lineWidth = Math.max(1, radius * 0.35);
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius * 1.35, 0, Math.PI * 2);
    ctx.stroke();

    // Frozen ball: a pulsing ring makes it obvious play has not started yet.
    if (ball.frozen && !frame.reducedMotion) {
      const pulse = 1.6 + Math.sin(frame.time * 6) * 0.45;
      ctx.strokeStyle = withAlpha('#ffffff', 0.3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x, at.y, radius * (2.4 + pulse), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawEffects(frame: Frame): void {
    const { ctx } = this;
    const { camera, effects } = frame;

    for (const particle of effects.particles) {
      if (!particle.active) continue;
      const at = worldToScreen(camera, particle);
      const alpha = Math.max(0, particle.life / particle.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      const size = Math.max(1, worldToScreenLength(camera, particle.size));
      ctx.fillRect(at.x - size / 2, at.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    for (const ring of effects.rings) {
      if (!ring.active) continue;
      const at = worldToScreen(camera, ring);
      const alpha = Math.max(0, ring.life / ring.maxLife);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = Math.max(1, worldToScreenLength(camera, ring.width));
      ctx.beginPath();
      ctx.arc(at.x, at.y, Math.max(1, worldToScreenLength(camera, ring.radius)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Red edge bloom while the boundary is closing in. */
  private drawPressure(frame: Frame): void {
    const warning = frame.state.shrinkWarning;
    if (warning <= 0.01) return;
    const { ctx } = this;
    const radius = Math.max(this.width, this.height) * 0.75;
    const gradient = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      radius * 0.55,
      this.width / 2,
      this.height / 2,
      radius,
    );
    gradient.addColorStop(0, 'rgba(251, 113, 133, 0)');
    gradient.addColorStop(1, `rgba(251, 113, 133, ${(warning * 0.22).toFixed(3)})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
  }
}
