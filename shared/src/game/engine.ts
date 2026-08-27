import {
  BALL_MAX_SPEED,
  COLLISION_COOLDOWN,
  COLLISION_SKIN,
  COUNTDOWN_SECONDS,
  MAX_SUBSTEPS,
  RESET_DELAY,
  SHRINK_PAUSE_AFTER_DAMAGE,
  SHRINK_PREVIEW_LEAD,
  SUBSTEP_TRAVEL_RATIO,
} from '../constants/index';
import {
  ballEdgeContact,
  circleSegmentContact,
  clampAngleFromNormal,
  closestPointOnSegment,
  reflect,
  resolvePenetration,
  segmentCoordinate,
  type SegmentContact,
} from '../geometry/collision';
import { deepestOutsideEdge, isInsideArena, signedDistanceToEdge } from '../geometry/polygon';
import { clamp, clamp01, createRng, dot, normalize } from '../geometry/vector';
import { applyArenaScale, createArena, phaseForTime, scaleForTime } from '../physics/arena';
import {
  createBall,
  launchBall,
  paddleBounce,
  parkBall,
  setBallDirection,
  setBallSpeed,
  targetSpeed,
} from '../physics/ball';
import { clampPaddlePosition, paddleLengthFor, paddleShape, paddleStep } from '../physics/paddle';
import type {
  ArenaGeometry,
  Edge,
  GameEvent,
  GameState,
  MatchConfig,
  PlayerInput,
  PlayerState,
  Vec2,
} from '../types/index';
import {
  alivePlayers,
  buildSummary,
  createPlayers,
  damagePlayer,
  findPlayer,
  findWinner,
  finalisePlacements,
  isMatchOver,
  nextPlacement,
} from './rules';

/** Two-player duel mode puts the players on opposite rectangle edges. */
export const edgeIndexForPlayer = (playerIndex: number, arena: ArenaGeometry): number =>
  arena.shape === 'rect' ? (playerIndex * 2) % arena.sideCount : playerIndex % arena.sideCount;

type CollisionOutcome = 'none' | 'hit' | 'wall' | 'reset' | 'end';

/**
 * Authoritative Polyball simulation.
 *
 * The engine is pure logic: no rendering, no DOM, no network. Practice Mode
 * drives it directly in the browser and the multiplayer server drives the exact
 * same class at a fixed 60 Hz tick, which is what keeps both consistent.
 */
export class GameEngine {
  readonly config: MatchConfig;
  state: GameState;

  private events: GameEvent[] = [];
  private inputs = new Map<string, PlayerInput>();
  private rng: () => number;
  /** Seconds of shrink-eligible play (pauses after damage / during saves). */
  private shrinkClock = 0;
  private shrinkPause = 0;
  /** Per-surface collision cooldowns, keyed "p<edge>" / "e<edge>". */
  private cooldowns = new Map<string, number>();
  private lastConcederId: string | null = null;
  private lastWarningAt = -99;
  private countdownAnnounced = -1;

  constructor(config: MatchConfig) {
    this.config = {
      ...config,
      players: config.players.map((p) => ({ ...p })),
    };
    this.rng = createRng(config.seed);
    this.state = this.createInitialState();
  }

  get playerCount(): number {
    return this.config.players.length;
  }

  /** Rebuild the match from scratch (rematch / restart). */
  reset(seed = this.config.seed): void {
    this.rng = createRng(seed);
    this.events = [];
    this.inputs.clear();
    this.cooldowns.clear();
    this.shrinkClock = 0;
    this.shrinkPause = 0;
    this.lastConcederId = null;
    this.lastWarningAt = -99;
    this.countdownAnnounced = -1;
    this.state = this.createInitialState();
  }

  setInput(playerId: string, input: PlayerInput): void {
    this.inputs.set(playerId, input);
  }

  clearInput(playerId: string): void {
    this.inputs.delete(playerId);
  }

  /** Take ownership of queued events (call once per rendered frame). */
  drainEvents(): GameEvent[] {
    if (this.events.length === 0) return [];
    const drained = this.events;
    this.events = [];
    return drained;
  }

  private createInitialState(): GameState {
    const players = createPlayers(this.config.players, this.config.lives);
    const arena = createArena(players.length, 1);
    players.forEach((player, index) => {
      const edgeIndex = edgeIndexForPlayer(index, arena);
      player.edgeIndex = edgeIndex;
      const edge = arena.edges[edgeIndex];
      edge.ownerId = player.id;
      edge.active = true;
      player.paddleLength = paddleLengthFor(players.length, edge.length);
      player.paddlePosition = 0.5;
    });

    const ball = createBall();
    parkBall(ball, arena.center);

    return {
      status: 'countdown',
      tick: 0,
      elapsed: 0,
      countdown: COUNTDOWN_SECONDS,
      phase: 'opening',
      arena,
      ball,
      players,
      rally: 0,
      longestRally: 0,
      winnerId: null,
      shrinkWarning: 0,
      previewScale: 1,
    };
  }

  /**
   * Advance the simulation by one fixed timestep.
   * Callers must use a fixed accumulator (see FIXED_DT) so behaviour is
   * identical on a 60 Hz laptop and a 144 Hz desktop.
   */
  step(dt: number): void {
    const state = this.state;
    if (state.status === 'finished') return;

    state.tick += 1;
    this.decayCooldowns(dt);

    if (state.status === 'countdown' || state.status === 'reset') {
      state.countdown = Math.max(0, state.countdown - dt);
      const whole = Math.ceil(state.countdown);
      if (whole !== this.countdownAnnounced) {
        this.countdownAnnounced = whole;
        this.events.push({ type: 'COUNTDOWN', value: whole });
      }
      this.updatePaddles(dt);
      if (state.countdown <= 0) this.startPlay();
      this.updateIndicators();
      return;
    }

    state.elapsed += dt;
    this.updatePaddles(dt);
    this.updateShrink(dt);
    setBallSpeed(
      state.ball,
      targetSpeed(state.elapsed, state.ball.consecutiveHits, this.playerCount),
    );
    this.moveBall(dt);
    this.updateIndicators();
  }

  private startPlay(): void {
    const state = this.state;
    const wasCountdown = state.status === 'countdown';
    state.status = 'playing';
    state.countdown = 0;
    this.countdownAnnounced = -1;
    this.cooldowns.clear();
    const target = this.pickLaunchTarget();
    if (target) {
      launchBall(state.ball, state.arena.center, target, this.rng);
      // launchBall parks the speed back at BALL_START_SPEED. Re-apply the speed
      // formula immediately so a relaunch at 90 seconds does not spend a frame
      // at 300 u/s and then jump to the time-accelerated speed on the next tick.
      setBallSpeed(state.ball, targetSpeed(state.elapsed, 0, this.playerCount));
    }
    if (wasCountdown) this.events.push({ type: 'MATCH_START' });
  }

  /** Aim at a living player, preferring somebody other than the last conceder. */
  private pickLaunchTarget(): Edge | null {
    const living = alivePlayers(this.state.players);
    if (living.length === 0) return null;
    const preferred = living.filter((p) => p.id !== this.lastConcederId);
    const pool = preferred.length > 0 ? preferred : living;
    const pick = pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))];
    return this.state.arena.edges[pick.edgeIndex] ?? null;
  }

  /**
   * Paddle movement. Positions live in normalised edge coordinates, so a paddle
   * keeps its relative place on its edge when the arena shrinks; the world
   * position is recomputed from the current edge every frame.
   */
  private updatePaddles(dt: number): void {
    const { players, arena } = this.state;
    for (const player of players) {
      const edge = arena.edges[player.edgeIndex];
      if (!edge) continue;
      player.paddleLength = paddleLengthFor(players.length, edge.length);

      if (!player.alive) {
        player.paddleVelocity = 0;
        player.paddlePosition = clampPaddlePosition(
          player.paddlePosition,
          player.paddleLength,
          edge.length,
        );
        continue;
      }

      const input = this.inputs.get(player.id);
      const maxStep = paddleStep(edge.length, dt);
      let target = player.paddlePosition;

      if (input) {
        if (typeof input.absolute === 'number' && Number.isFinite(input.absolute)) {
          // Slider / drag control: move toward the requested spot, but never
          // faster than the shared paddle speed limit.
          const desired = clamp01(input.absolute);
          target =
            player.paddlePosition + clamp(desired - player.paddlePosition, -maxStep, maxStep);
        } else if (input.isPressed && input.direction !== 0) {
          target = player.paddlePosition + input.direction * maxStep;
        }
      }

      const clamped = clampPaddlePosition(target, player.paddleLength, edge.length);
      player.paddleVelocity = dt > 0 ? (clamped - player.paddlePosition) / dt : 0;
      player.paddlePosition = clamped;
    }
  }

  /**
   * Shrink the arena symmetrically. The clock only advances when shrinking is
   * fair: not right after somebody lost a life, and not while the ball is
   * pressed against a paddle (which could teleport a wall onto the ball).
   */
  private updateShrink(dt: number): void {
    if (!this.config.shrinkEnabled) return;
    const state = this.state;

    if (this.shrinkPause > 0) {
      this.shrinkPause = Math.max(0, this.shrinkPause - dt);
    } else if (!this.ballTouchingPaddle()) {
      this.shrinkClock += dt;
    }

    const scale = scaleForTime(this.shrinkClock, true);
    if (Math.abs(scale - state.arena.scale) > 1e-6) {
      applyArenaScale(state.arena, scale);
      // Edges are shorter now, so paddle sizes and normalised positions have to
      // be re-fitted in the same tick. Skipping this leaves a paddle hanging
      // past its own vertex until the next frame, which the collision pass
      // further down this very tick would treat as real geometry.
      this.refitPaddles();
      this.keepBallInside();
    }
  }

  /**
   * Re-derive paddle length from the current edge length and pull the stored
   * normalised position back inside the edge. Called after any change to the
   * arena geometry.
   */
  private refitPaddles(): void {
    const { players, arena } = this.state;
    for (const player of players) {
      const edge = arena.edges[player.edgeIndex];
      if (!edge) continue;
      player.paddleLength = paddleLengthFor(players.length, edge.length);
      player.paddlePosition = clampPaddlePosition(
        player.paddlePosition,
        player.paddleLength,
        edge.length,
      );
    }
  }

  /** True when the ball is close enough to a paddle that a shrink would be unfair. */
  private ballTouchingPaddle(): boolean {
    const { ball, arena, players } = this.state;
    if (ball.frozen) return false;
    const position: Vec2 = { x: ball.x, y: ball.y };
    for (const player of players) {
      if (!player.alive) continue;
      const edge = arena.edges[player.edgeIndex];
      if (!edge) continue;
      if (signedDistanceToEdge(position, edge) > ball.radius * 6) continue;
      const shape = paddleShape(edge, player.paddlePosition, player.paddleLength);
      const contact = circleSegmentContact(
        position,
        ball.radius + shape.thickness * 1.5,
        shape.frontStart,
        shape.frontEnd,
        edge.normal,
      );
      if (contact) return true;
    }
    return false;
  }

  /** Nudge the ball back inside after a shrink; never costs a life. */
  private keepBallInside(): void {
    const { ball, arena } = this.state;
    for (let pass = 0; pass < 3; pass += 1) {
      let corrected = false;
      for (const edge of arena.edges) {
        const gap = signedDistanceToEdge({ x: ball.x, y: ball.y }, edge) - ball.radius;
        if (gap < 0) {
          ball.x += edge.normal.x * -gap;
          ball.y += edge.normal.y * -gap;
          corrected = true;
        }
      }
      if (!corrected) break;
    }
  }

  private decayCooldowns(dt: number): void {
    if (this.cooldowns.size === 0) return;
    for (const [key, remaining] of this.cooldowns) {
      const next = remaining - dt;
      if (next <= 0) this.cooldowns.delete(key);
      else this.cooldowns.set(key, next);
    }
  }

  private onCooldown(key: string): boolean {
    return this.cooldowns.has(key);
  }

  private startCooldown(key: string): void {
    this.cooldowns.set(key, COLLISION_COOLDOWN);
  }

  /**
   * Swept ball movement: the step is split so the ball never travels more than
   * a fraction of its own radius per substep. That is what stops an 850 u/s ball
   * from tunnelling straight through a 12 unit thick paddle.
   */
  private moveBall(dt: number): void {
    const ball = this.state.ball;
    if (ball.frozen) return;

    const travel = Math.hypot(ball.vx, ball.vy) * dt;
    const budget = Math.max(1e-3, ball.radius * SUBSTEP_TRAVEL_RATIO);
    const steps = clamp(Math.ceil(travel / budget), 1, MAX_SUBSTEPS);
    const subDt = dt / steps;

    for (let i = 0; i < steps; i += 1) {
      ball.x += ball.vx * subDt;
      ball.y += ball.vy * subDt;
      const outcome = this.resolveCollisions();
      if (outcome === 'reset' || outcome === 'end') return;
    }
  }

  /**
   * One collision pass over the arena.
   *
   * Paddles are tested first because they sit one thickness inward of their
   * edge, so a defended ball always meets the paddle before the boundary.
   */
  private resolveCollisions(): CollisionOutcome {
    const { ball, arena, players } = this.state;
    const position: Vec2 = { x: ball.x, y: ball.y };
    const velocity: Vec2 = { x: ball.vx, y: ball.vy };

    for (const player of players) {
      if (!player.alive) continue;
      const edge = arena.edges[player.edgeIndex];
      if (!edge || !edge.active) continue;
      const key = `p${edge.index}`;
      if (this.onCooldown(key)) continue;

      const shape = paddleShape(edge, player.paddlePosition, player.paddleLength);
      const contact = circleSegmentContact(
        position,
        ball.radius,
        shape.frontStart,
        shape.frontEnd,
        edge.normal,
      );
      if (!contact) continue;
      // Ignore contacts we are already moving away from (prevents double hits).
      if (dot(velocity, contact.normal) >= 0) continue;

      this.handlePaddleHit(player, edge, shape.frontCenter, contact);
      return 'hit';
    }

    for (const edge of arena.edges) {
      const key = `e${edge.index}`;
      if (this.onCooldown(key)) continue;
      const contact = ballEdgeContact(position, ball.radius, edge);
      if (!contact) continue;
      if (dot(velocity, contact.normal) >= 0) continue;

      const owner = findPlayer(players, edge.ownerId);
      if (edge.active && owner && owner.alive) return this.handleMiss(owner, edge, contact);
      this.handleWall(edge, contact);
      return 'wall';
    }

    return this.enforceContainment();
  }

  /** Last-resort guard so a ball can never escape the arena unnoticed. */
  private enforceContainment(): CollisionOutcome {
    const { ball, arena, players } = this.state;
    const position: Vec2 = { x: ball.x, y: ball.y };
    if (isInsideArena(position, arena.edges, -ball.radius)) return 'none';

    const edge = deepestOutsideEdge(position, arena.edges);
    if (!edge) return 'none';

    const point = closestPointOnSegment(position, edge.start, edge.end);
    const contact: SegmentContact = {
      point,
      normal: edge.normal,
      distance: 0,
      penetration: ball.radius,
      t: segmentCoordinate(point, edge.start, edge.end),
    };

    const owner = findPlayer(players, edge.ownerId);
    if (edge.active && owner && owner.alive) return this.handleMiss(owner, edge, contact);
    this.handleWall(edge, contact);
    return 'wall';
  }

  /** Solid boundary (arena wall or an eliminated player's edge). */
  private handleWall(edge: Edge, contact: SegmentContact): void {
    const ball = this.state.ball;
    const reflected = normalize(reflect({ x: ball.vx, y: ball.vy }, contact.normal));
    const safe = clampAngleFromNormal(reflected, contact.normal, Math.PI / 2 - 0.14);
    const resolved = resolvePenetration(contact, ball.radius, COLLISION_SKIN);
    ball.x = resolved.x;
    ball.y = resolved.y;
    setBallDirection(ball, safe);
    this.startCooldown(`e${edge.index}`);
    this.events.push({
      type: 'WALL_BOUNCE',
      x: contact.point.x,
      y: contact.point.y,
      edgeIndex: edge.index,
    });
  }

  private handlePaddleHit(
    player: PlayerState,
    edge: Edge,
    paddleFaceCenter: Vec2,
    contact: SegmentContact,
  ): void {
    const state = this.state;
    const ball = state.ball;

    const resolved = resolvePenetration(contact, ball.radius, COLLISION_SKIN);
    ball.x = resolved.x;
    ball.y = resolved.y;

    const bounce = paddleBounce({
      edge,
      contact: contact.point,
      paddleCenter: paddleFaceCenter,
      paddleLength: player.paddleLength,
      paddleVelocity: player.paddleVelocity,
      rng: this.rng,
    });

    ball.consecutiveHits += 1;
    ball.lastHitterId = player.id;
    player.hits += 1;
    state.rally += 1;
    if (state.rally > state.longestRally) state.longestRally = state.rally;
    if (state.rally > player.longestRally) player.longestRally = state.rally;

    setBallDirection(ball, bounce.direction);
    setBallSpeed(ball, targetSpeed(state.elapsed, ball.consecutiveHits, this.playerCount));
    this.startCooldown(`p${edge.index}`);

    this.events.push({
      type: 'HIT',
      playerId: player.id,
      x: contact.point.x,
      y: contact.point.y,
      power: clamp01(ball.speed / BALL_MAX_SPEED),
      perfect: bounce.perfect,
    });
  }

  /** The ball reached a defended edge without being intercepted. */
  private handleMiss(owner: PlayerState, edge: Edge, contact: SegmentContact): CollisionOutcome {
    const state = this.state;
    const killerId = state.ball.lastHitterId;
    const result = damagePlayer(owner, state.elapsed);

    this.events.push({
      type: 'DAMAGE',
      playerId: owner.id,
      livesLeft: result.livesLeft,
      x: contact.point.x,
      y: contact.point.y,
    });

    if (result.eliminated) {
      owner.placement = nextPlacement(state.players);
      // The polygon keeps its shape: the edge simply becomes a solid wall.
      edge.active = false;
      const killer = findPlayer(state.players, killerId);
      if (killer && killer.id !== owner.id) killer.eliminations += 1;
      this.events.push({
        type: 'ELIMINATED',
        playerId: owner.id,
        placement: owner.placement,
        byPlayerId: killer && killer.id !== owner.id ? killer.id : null,
      });
    }

    state.rally = 0;
    this.lastConcederId = owner.id;
    this.shrinkPause = SHRINK_PAUSE_AFTER_DAMAGE;

    if (isMatchOver(state.players)) return this.endMatch();
    return this.beginReset();
  }

  private beginReset(): CollisionOutcome {
    const state = this.state;
    state.status = 'reset';
    state.countdown = RESET_DELAY;
    this.countdownAnnounced = -1;
    this.cooldowns.clear();
    parkBall(state.ball, state.arena.center);
    return 'reset';
  }

  private endMatch(): CollisionOutcome {
    const state = this.state;
    finalisePlacements(state.players);
    const winner = findWinner(state.players) ?? state.players.find((p) => p.placement === 1);
    state.winnerId = winner?.id ?? null;
    state.status = 'finished';
    state.countdown = 0;
    parkBall(state.ball, state.arena.center);
    this.events.push({
      type: 'MATCH_ENDED',
      summary: buildSummary(state.players, state.elapsed, state.longestRally),
    });
    return 'end';
  }

  /** HUD indicators: phase transitions, shrink preview and warning intensity. */
  private updateIndicators(): void {
    const state = this.state;
    const phase = phaseForTime(this.shrinkClock);
    if (phase !== state.phase) {
      state.phase = phase;
      this.events.push({ type: 'PHASE_CHANGED', phase });
    }

    state.previewScale = this.config.shrinkEnabled
      ? scaleForTime(this.shrinkClock + SHRINK_PREVIEW_LEAD, true)
      : state.arena.scale;

    const delta = state.arena.scale - state.previewScale;
    state.shrinkWarning = clamp01(delta / 0.02);

    if (state.shrinkWarning > 0.55 && state.elapsed - this.lastWarningAt > 8) {
      this.lastWarningAt = state.elapsed;
      this.events.push({ type: 'ARENA_WARNING', targetScale: state.previewScale });
    }
  }
}
