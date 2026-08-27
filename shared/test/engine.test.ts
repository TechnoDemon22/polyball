import { describe, expect, it } from 'vitest';
import {
  AIDirector,
  BALL_MAX_SPEED,
  edgeIndexForPlayer,
  FIXED_DT,
  GameEngine,
  isInsideArena,
  paddleHalfSpan,
  pointOnEdge,
  RESET_DELAY,
  signedDistanceToEdge,
  type GameEvent,
  type MatchConfig,
  type PlayerSeed,
} from '../src/index';

const seeds = (count: number): PlayerSeed[] =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));

const config = (count: number, overrides: Partial<MatchConfig> = {}): MatchConfig => ({
  players: seeds(count),
  lives: 3,
  mode: 'survival',
  shrinkEnabled: true,
  seed: 1234,
  ...overrides,
});

/** Run the engine for `seconds`, collecting every event it emits. */
function run(engine: GameEngine, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  const ticks = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < ticks; i += 1) {
    engine.step(FIXED_DT);
    events.push(...engine.drainEvents());
  }
  return events;
}

/** Step until the match is actually in play (or finished). */
function runUntilPlaying(engine: GameEngine, limitSeconds = 10): void {
  const ticks = Math.round(limitSeconds / FIXED_DT);
  for (let i = 0; i < ticks; i += 1) {
    if (engine.state.status === 'playing' || engine.state.status === 'finished') return;
    engine.step(FIXED_DT);
    engine.drainEvents();
  }
}

/**
 * Aim a live ball at an undefended part of one player's edge and let the
 * simulation resolve it. Only the ball's position and velocity are touched, so
 * damage still has to travel through the real collision code.
 */
function forceMiss(engine: GameEngine, victimIndex: number, limitSeconds = 8): GameEvent[] {
  const collected: GameEvent[] = [];
  runUntilPlaying(engine);
  if (engine.state.status !== 'playing') return collected;

  const victim = engine.state.players[victimIndex];
  const edge = engine.state.arena.edges[victim.edgeIndex];
  const aim = pointOnEdge(edge, 0.12); // well outside a centred paddle
  const distance = Math.hypot(
    aim.x - engine.state.arena.center.x,
    aim.y - engine.state.arena.center.y,
  );
  const ball = engine.state.ball;
  const speed = 500;

  ball.x = engine.state.arena.center.x;
  ball.y = engine.state.arena.center.y;
  ball.frozen = false;
  ball.speed = speed;
  ball.vx = ((aim.x - engine.state.arena.center.x) / distance) * speed;
  ball.vy = ((aim.y - engine.state.arena.center.y) / distance) * speed;

  const missesBefore = victim.misses;
  const ticks = Math.round(limitSeconds / FIXED_DT);
  for (let i = 0; i < ticks; i += 1) {
    engine.step(FIXED_DT);
    collected.push(...engine.drainEvents());
    if (victim.misses > missesBefore) return collected;
  }
  return collected;
}

/**
 * Drive every player with a hard AI so the match keeps going. Without any
 * defenders a match ends in seconds, which would make long-running assertions
 * (shrinking, acceleration) meaningless.
 */
function defend(engine: GameEngine): AIDirector {
  return new AIDirector(
    engine.state.players.map((p) => ({ id: p.id, difficulty: 'hard' as const })),
    99,
  );
}

/** Run a defended match for `seconds`, returning the fastest ball speed seen. */
function peakSpeed(engine: GameEngine, ai: AIDirector, seconds: number): number {
  let peak = 0;
  const ticks = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < ticks; i += 1) {
    ai.update(engine.state, FIXED_DT, (id, input) => engine.setInput(id, input));
    engine.step(FIXED_DT);
    engine.drainEvents();
    if (engine.state.status === 'playing' && !engine.state.ball.frozen) {
      peak = Math.max(peak, engine.state.ball.speed);
    }
  }
  return peak;
}

describe('engine setup', () => {
  it('gives every player their own edge on an N-sided arena', () => {
    for (let count = 3; count <= 12; count += 1) {
      const engine = new GameEngine(config(count));
      const { arena, players } = engine.state;
      expect(arena.sideCount).toBe(count);
      expect(new Set(players.map((p) => p.edgeIndex)).size).toBe(count);
      for (const player of players) {
        expect(arena.edges[player.edgeIndex].ownerId).toBe(player.id);
        expect(arena.edges[player.edgeIndex].active).toBe(true);
        expect(player.paddleLength).toBeGreaterThan(0);
      }
    }
  });

  it('puts duel players on opposite rectangle edges', () => {
    const engine = new GameEngine(config(2));
    expect(engine.state.arena.shape).toBe('rect');
    expect(engine.state.players.map((p) => p.edgeIndex)).toEqual([0, 2]);
    expect(edgeIndexForPlayer(1, engine.state.arena)).toBe(2);
    // The side walls stay unowned, so they simply bounce the ball.
    expect(engine.state.arena.edges[1].active).toBe(false);
    expect(engine.state.arena.edges[3].active).toBe(false);
  });

  it('starts in a countdown with the ball parked in the centre', () => {
    const engine = new GameEngine(config(5));
    expect(engine.state.status).toBe('countdown');
    expect(engine.state.ball.frozen).toBe(true);
    expect(engine.state.ball.x).toBe(0);
    run(engine, 3.1);
    expect(engine.state.status).toBe('playing');
    expect(engine.state.ball.frozen).toBe(false);
    expect(Math.hypot(engine.state.ball.vx, engine.state.ball.vy)).toBeGreaterThan(0);
  });
});

describe('paddle control', () => {
  it('moves a paddle only while input is pressed and clamps it to the edge', () => {
    const engine = new GameEngine(config(4));
    const player = engine.state.players[0];
    const edge = engine.state.arena.edges[player.edgeIndex];
    const half = paddleHalfSpan(player.paddleLength, edge.length);

    engine.setInput('p1', { direction: 1, isPressed: true, source: 'keyboard' });
    run(engine, 0.5);
    expect(player.paddlePosition).toBeGreaterThan(0.5);

    engine.setInput('p1', { direction: 1, isPressed: false, source: 'keyboard' });
    const held = player.paddlePosition;
    run(engine, 0.5);
    expect(player.paddlePosition).toBeCloseTo(held, 9);

    engine.setInput('p1', { direction: 1, isPressed: true, source: 'keyboard' });
    run(engine, 6);
    expect(player.paddlePosition).toBeCloseTo(1 - half, 6);
  });

  it('respects the speed limit for absolute (slider / drag) input', () => {
    const engine = new GameEngine(config(4));
    const player = engine.state.players[0];
    engine.setInput('p1', { direction: 0, isPressed: true, source: 'touch', absolute: 1 });
    engine.step(FIXED_DT);
    expect(player.paddlePosition).toBeGreaterThan(0.5);
    expect(player.paddlePosition).toBeLessThan(0.56);
  });
});

describe('simulation integrity', () => {
  it('keeps the ball inside the arena for a long match', () => {
    const engine = new GameEngine(config(6));
    const ticks = Math.round(150 / FIXED_DT);
    for (let i = 0; i < ticks; i += 1) {
      engine.step(FIXED_DT);
      engine.drainEvents();
      const { ball, arena } = engine.state;
      expect(isInsideArena({ x: ball.x, y: ball.y }, arena.edges, -ball.radius * 2)).toBe(true);
      expect(Number.isFinite(ball.x) && Number.isFinite(ball.y)).toBe(true);
      expect(ball.speed).toBeLessThanOrEqual(BALL_MAX_SPEED + 1e-9);
    }
  });

  it('never tunnels through a defending paddle at maximum speed', () => {
    const engine = new GameEngine(config(3, { shrinkEnabled: false }));
    runUntilPlaying(engine);
    // Worst case: a maximum-speed ball fired straight at a centred paddle.
    const state = engine.state;
    const defender = state.players[0];
    const edge = state.arena.edges[defender.edgeIndex];
    state.ball.x = state.arena.center.x;
    state.ball.y = state.arena.center.y;
    state.ball.frozen = false;
    state.ball.speed = BALL_MAX_SPEED;
    state.ball.vx = -edge.normal.x * BALL_MAX_SPEED;
    state.ball.vy = -edge.normal.y * BALL_MAX_SPEED;
    const missesBefore = defender.misses;

    for (let i = 0; i < 120; i += 1) {
      engine.step(FIXED_DT);
      engine.drainEvents();
      if (defender.hits > 0) break;
    }
    expect(defender.hits).toBeGreaterThan(0);
    expect(defender.misses).toBe(missesBefore);
  });

  it('shrinks the arena during the pressure phase but keeps edges equal', () => {
    const engine = new GameEngine(config(8, { lives: 9 }));
    const ai = defend(engine);
    peakSpeed(engine, ai, 70);
    const { arena } = engine.state;
    expect(engine.state.status).not.toBe('finished');
    expect(arena.scale).toBeLessThan(1);
    const first = arena.edges[0].length;
    for (const edge of arena.edges) expect(edge.length).toBeCloseTo(first, 6);
    expect(engine.state.phase).toBe('pressure');
  });

  it('accelerates the ball over time', () => {
    const engine = new GameEngine(config(4, { shrinkEnabled: false, lives: 9 }));
    const ai = defend(engine);
    const early = peakSpeed(engine, ai, 8);
    const later = peakSpeed(engine, ai, 40);
    expect(engine.state.status).not.toBe('finished');
    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(early);
    expect(later).toBeLessThanOrEqual(BALL_MAX_SPEED + 1e-9);
  });
});

describe('damage, elimination and victory', () => {
  it('takes exactly one life, pauses and relaunches when a paddle is beaten', () => {
    const engine = new GameEngine(config(3, { shrinkEnabled: false }));
    const victim = engine.state.players[1];
    const events = forceMiss(engine, 1);

    const damage = events.find((e) => e.type === 'DAMAGE');
    expect(damage).toBeDefined();
    expect(damage).toMatchObject({ playerId: victim.id, livesLeft: 2 });
    expect(victim.lives).toBe(2);
    expect(victim.misses).toBe(1);
    expect(victim.alive).toBe(true);
    expect(engine.state.status).toBe('reset');
    expect(engine.state.ball.frozen).toBe(true);
    expect(engine.state.countdown).toBeCloseTo(RESET_DELAY, 3);
    expect(engine.state.rally).toBe(0);

    // The ball comes back into play on its own.
    run(engine, RESET_DELAY + 0.2);
    expect(engine.state.status).toBe('playing');
    expect(engine.state.ball.frozen).toBe(false);
  });

  it('turns an eliminated player edge into a wall and keeps the polygon intact', () => {
    const engine = new GameEngine(config(4, { lives: 1, shrinkEnabled: false }));
    const victim = engine.state.players[2];
    const events = forceMiss(engine, 2);

    expect(victim.alive).toBe(false);
    expect(victim.lives).toBe(0);
    expect(victim.placement).toBe(4);
    expect(events.some((e) => e.type === 'ELIMINATED')).toBe(true);

    // Geometry is untouched: the edge just stops being defended.
    expect(engine.state.arena.edges).toHaveLength(4);
    expect(engine.state.arena.sideCount).toBe(4);
    expect(engine.state.arena.edges[victim.edgeIndex].active).toBe(false);
    expect(engine.state.arena.edges[victim.edgeIndex].ownerId).toBe(victim.id);
    expect(engine.state.status).not.toBe('finished');

    // The dead edge now bounces instead of dealing damage.
    const wallEvents = forceMiss(engine, 2, 4);
    expect(victim.lives).toBe(0);
    expect(wallEvents.some((e) => e.type === 'WALL_BOUNCE')).toBe(true);
  });

  it('ends the match with a winner when only one player survives', () => {
    const engine = new GameEngine(config(3, { lives: 1, shrinkEnabled: false }));
    const first = forceMiss(engine, 0);
    expect(first.some((e) => e.type === 'ELIMINATED')).toBe(true);
    expect(engine.state.status).toBe('reset');

    const second = forceMiss(engine, 2);
    const ended = second.find((e) => e.type === 'MATCH_ENDED');
    expect(ended).toBeDefined();
    expect(engine.state.status).toBe('finished');
    expect(engine.state.winnerId).toBe('p2');
    expect(engine.state.players[1].placement).toBe(1);
    expect(engine.state.players[0].placement).toBe(3);
    expect(engine.state.players[2].placement).toBe(2);
    if (ended?.type === 'MATCH_ENDED') {
      expect(ended.summary.winnerId).toBe('p2');
      expect(ended.summary.ranking.map((r) => r.placement)).toEqual([1, 2, 3]);
    }

    // A finished match ignores further steps.
    const tick = engine.state.tick;
    engine.step(FIXED_DT);
    expect(engine.state.tick).toBe(tick);
  });

  it('credits an elimination to the player who hit the ball last', () => {
    const engine = new GameEngine(config(3, { lives: 1, shrinkEnabled: false }));
    runUntilPlaying(engine);
    engine.state.ball.lastHitterId = 'p1';
    const events = forceMiss(engine, 1);
    const eliminated = events.find((e) => e.type === 'ELIMINATED');
    expect(eliminated).toBeDefined();
    if (eliminated?.type === 'ELIMINATED') {
      expect(eliminated.byPlayerId).toBe('p1');
    }
    expect(engine.state.players[0].eliminations).toBe(1);
  });

  it('resets cleanly for a rematch', () => {
    const engine = new GameEngine(config(5));
    run(engine, 20);
    engine.reset();
    expect(engine.state.status).toBe('countdown');
    expect(engine.state.elapsed).toBe(0);
    expect(engine.state.tick).toBe(0);
    expect(engine.state.arena.scale).toBe(1);
    for (const player of engine.state.players) {
      expect(player.lives).toBe(3);
      expect(player.alive).toBe(true);
      expect(player.hits).toBe(0);
    }
  });
});

describe('spectator safety', () => {
  it('never reports a signed distance that means the ball left the arena', () => {
    const engine = new GameEngine(config(12));
    const ticks = Math.round(60 / FIXED_DT);
    for (let i = 0; i < ticks; i += 1) {
      engine.step(FIXED_DT);
      engine.drainEvents();
      const { ball, arena } = engine.state;
      for (const edge of arena.edges) {
        expect(signedDistanceToEdge({ x: ball.x, y: ball.y }, edge)).toBeGreaterThan(
          -ball.radius * 3,
        );
      }
    }
  });
});
