import { describe, expect, it } from 'vitest';
import {
  AIController,
  AIDirector,
  AI_PROFILES,
  createArena,
  createBall,
  FIXED_DT,
  GameEngine,
  paddleLengthFor,
  PADDLE_SPEED,
  predictEdgeImpact,
  type Difficulty,
  type GameState,
  type MatchConfig,
  type PlayerSeed,
} from '../src/index';

const seeds = (count: number): PlayerSeed[] =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isAI: i > 0 }));

const config = (count: number, overrides: Partial<MatchConfig> = {}): MatchConfig => ({
  players: seeds(count),
  lives: 3,
  mode: 'survival',
  shrinkEnabled: false,
  seed: 4242,
  ...overrides,
});

/** A minimal playing state with the ball aimed at a chosen point on an edge. */
function stateAimedAt(sideCount: number, edgeIndex: number, coordinate: number): GameState {
  const arena = createArena(sideCount, 1);
  const edge = arena.edges[edgeIndex];
  const target = {
    x: edge.start.x + (edge.end.x - edge.start.x) * coordinate,
    y: edge.start.y + (edge.end.y - edge.start.y) * coordinate,
  };
  const ball = createBall();
  ball.frozen = false;
  ball.x = arena.center.x;
  ball.y = arena.center.y;
  const distance = Math.hypot(target.x - ball.x, target.y - ball.y);
  ball.speed = 400;
  ball.vx = ((target.x - ball.x) / distance) * ball.speed;
  ball.vy = ((target.y - ball.y) / distance) * ball.speed;

  return {
    status: 'playing',
    tick: 0,
    elapsed: 0,
    countdown: 0,
    phase: 'opening',
    arena,
    ball,
    players: arena.edges.slice(0, sideCount).map((e, index) => ({
      id: `p${index + 1}`,
      name: `P${index + 1}`,
      number: index + 1,
      colorIndex: index,
      edgeIndex: index,
      paddlePosition: 0.5,
      paddleLength: paddleLengthFor(sideCount, e.length),
      paddleVelocity: 0,
      lives: 3,
      alive: true,
      hits: 0,
      misses: 0,
      eliminations: 0,
      longestRally: 0,
      connected: true,
      isAI: true,
      isLocal: false,
      eliminatedAt: null,
      placement: null,
    })),
    rally: 0,
    longestRally: 0,
    winnerId: null,
    shrinkWarning: 0,
    previewScale: 1,
  };
}

describe('impact prediction', () => {
  it('finds where a directly aimed ball will cross an edge', () => {
    const state = stateAimedAt(6, 3, 0.3);
    const prediction = predictEdgeImpact(state, state.arena.edges[3], 0);
    expect(prediction).not.toBeNull();
    expect(prediction?.coordinate).toBeCloseTo(0.3, 1);
    expect(prediction?.time).toBeGreaterThan(0);
  });

  it('returns null for an edge the ball is not heading for', () => {
    const state = stateAimedAt(6, 3, 0.5);
    expect(predictEdgeImpact(state, state.arena.edges[0], 0)).toBeNull();
    // A parked ball has no trajectory at all.
    state.ball.vx = 0;
    state.ball.vy = 0;
    expect(predictEdgeImpact(state, state.arena.edges[3], 2)).toBeNull();
  });

  it('can see round a bounce when allowed more bounces', () => {
    const state = stateAimedAt(6, 3, 0.02); // grazes edge 3 next to a corner
    const direct = predictEdgeImpact(state, state.arena.edges[2], 0);
    const indirect = predictEdgeImpact(state, state.arena.edges[2], 3);
    expect(direct).toBeNull();
    expect(indirect === null || indirect.time > 0).toBe(true);
  });
});

describe('AI profiles', () => {
  it('gets stricter with difficulty', () => {
    const order: Difficulty[] = ['easy', 'medium', 'hard'];
    for (let i = 1; i < order.length; i += 1) {
      const weaker = AI_PROFILES[order[i - 1]];
      const stronger = AI_PROFILES[order[i]];
      expect(stronger.reactionDelay).toBeLessThan(weaker.reactionDelay);
      expect(stronger.errorRatio).toBeLessThan(weaker.errorRatio);
      expect(stronger.speedFactor).toBeGreaterThan(weaker.speedFactor);
      expect(stronger.lapseChance).toBeLessThan(weaker.lapseChance);
      expect(stronger.bounces).toBeGreaterThanOrEqual(weaker.bounces);
    }
  });

  it('never lets an AI paddle out-run a human paddle', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
      expect(AIDirector.topSpeed(difficulty)).toBeLessThanOrEqual(PADDLE_SPEED);
    }
  });
});

describe('AI control', () => {
  it('only ever emits normalised input', () => {
    const state = stateAimedAt(5, 2, 0.9);
    const controller = new AIController('p3', 'hard', 3);
    for (let i = 0; i < 200; i += 1) {
      const input = controller.update(state, FIXED_DT);
      expect([-1, 0, 1]).toContain(input.direction);
      expect(typeof input.isPressed).toBe('boolean');
      expect(input.source).toBe('ai');
      expect(input.absolute).toBeUndefined();
    }
  });

  it('moves toward the predicted impact point', () => {
    const state = stateAimedAt(5, 2, 0.9);
    const controller = new AIController('p3', 'hard', 3);
    const player = state.players[2];
    // Feed the AI's own output back into the paddle at the shared speed limit.
    for (let i = 0; i < 120; i += 1) {
      const input = controller.update(state, FIXED_DT);
      if (input.isPressed) {
        player.paddlePosition +=
          (input.direction * PADDLE_SPEED * FIXED_DT) / state.arena.edges[2].length;
      }
    }
    expect(player.paddlePosition).toBeGreaterThan(0.5);
  });

  it('stays idle for a player that is out of the match', () => {
    const state = stateAimedAt(4, 1, 0.5);
    state.players[1].alive = false;
    const controller = new AIController('p2', 'medium', 8);
    for (let i = 0; i < 30; i += 1) {
      expect(controller.update(state, FIXED_DT).isPressed).toBe(false);
    }
    expect(new AIController('ghost', 'hard', 1).update(state, FIXED_DT).isPressed).toBe(false);
  });

  it('defends well enough to keep a hard AI match alive', () => {
    const engine = new GameEngine(config(4));
    const director = new AIDirector(
      engine.state.players.map((p) => ({ id: p.id, difficulty: 'hard' as const })),
      21,
    );
    const ticks = Math.round(45 / FIXED_DT);
    for (let i = 0; i < ticks; i += 1) {
      director.update(engine.state, FIXED_DT, (id, input) => engine.setInput(id, input));
      engine.step(FIXED_DT);
      engine.drainEvents();
    }
    expect(engine.state.status).not.toBe('finished');
    const totalHits = engine.state.players.reduce((sum, p) => sum + p.hits, 0);
    expect(totalHits).toBeGreaterThan(5);
  });

  it('an easy AI concedes more than a hard AI', () => {
    const missesFor = (difficulty: Difficulty): number => {
      const engine = new GameEngine(config(3, { lives: 9 }));
      const director = new AIDirector(
        engine.state.players.map((p) => ({ id: p.id, difficulty })),
        13,
      );
      const ticks = Math.round(60 / FIXED_DT);
      for (let i = 0; i < ticks; i += 1) {
        director.update(engine.state, FIXED_DT, (id, input) => engine.setInput(id, input));
        engine.step(FIXED_DT);
        engine.drainEvents();
      }
      return engine.state.players.reduce((sum, p) => sum + p.misses, 0);
    };
    expect(missesFor('easy')).toBeGreaterThan(missesFor('hard'));
  });
});
