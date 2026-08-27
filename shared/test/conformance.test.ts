/**
 * Spec conformance sweep.
 *
 * The other suites unit-test each helper. This one plays whole matches for
 * every legal player count and asserts the *rules from the specification* hold
 * on every single tick: one equal-length edge per player, the ball never
 * escapes, the ball never tunnels a paddle, the speed formula is exact and the
 * arena only ever shrinks.
 *
 * Violations are collected rather than asserted per tick - a few hundred
 * thousand `expect` calls would dominate the suite's runtime.
 */
import { describe, expect, it } from 'vitest';
import {
  AIDirector,
  apothem,
  BALL_HIT_ACCEL,
  BALL_MAX_SPEED,
  BALL_START_SPEED,
  createArena,
  edgeIndexForPlayer,
  FIXED_DT,
  GameEngine,
  MAX_PLAYERS,
  MIN_PLAYERS,
  paddleShape,
  PADDLE_SPEED,
  polygonSideLength,
  SHRINK_MIN_SCALE,
  signedDistanceToEdge,
  timeAccelFor,
  type MatchConfig,
  type PlayerSeed,
} from '../src/index';

const counts = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

const configFor = (playerCount: number, seed: number): MatchConfig => {
  const players: PlayerSeed[] = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    isAI: true,
    difficulty: 'hard' as const,
    colorIndex: i,
  }));
  return { players, lives: 3, mode: 'survival', shrinkEnabled: true, seed };
};

/**
 * Play a match headlessly with hard AI on every seat, recording every tick that
 * breaks a rule. An empty result means the match was fully spec compliant.
 */
function auditMatch(playerCount: number, seed: number, maxSeconds = 240): string[] {
  const problems: string[] = [];
  const note = (message: string): void => {
    if (problems.length < 8) problems.push(message);
  };

  const config = configFor(playerCount, seed);
  const engine = new GameEngine(config);
  const ai = new AIDirector(
    config.players.map((p) => ({ id: p.id, difficulty: 'hard' as const })),
    seed,
  );

  const sideCount = engine.state.arena.sideCount;
  const expectedSide = engine.state.arena.baseRadius;
  let lastScale = engine.state.arena.scale;
  const lives = new Map(engine.state.players.map((p) => [p.id, p.lives]));
  const ticks = Math.ceil(maxSeconds / FIXED_DT);

  for (let tick = 0; tick < ticks; tick += 1) {
    const state = engine.state;
    if (state.status === 'finished') break;

    ai.update(state, FIXED_DT, (id, input) => engine.setInput(id, input));
    engine.step(FIXED_DT);
    engine.drainEvents();

    const { arena, ball } = state;
    const at = `t=${state.elapsed.toFixed(2)}s`;

    /* polygon geometry: the shape never changes, even after eliminations */
    if (arena.sideCount !== sideCount || arena.edges.length !== sideCount) {
      note(`${at}: side count changed to ${arena.sideCount}/${arena.edges.length}`);
    }

    /* equal edge lengths */
    if (arena.shape === 'polygon') {
      let min = Infinity;
      let max = -Infinity;
      for (const edge of arena.edges) {
        if (edge.length < min) min = edge.length;
        if (edge.length > max) max = edge.length;
      }
      if (max - min > 1e-9) note(`${at}: unequal edges, spread ${(max - min).toExponential(2)}`);
      const ideal = polygonSideLength(sideCount, expectedSide * arena.scale);
      if (Math.abs(min - ideal) > 1e-6) {
        note(`${at}: edge length ${min.toFixed(6)} != ideal ${ideal.toFixed(6)}`);
      }
    }

    /* arena shrinking: monotone and bounded */
    if (arena.scale > lastScale + 1e-12) {
      note(`${at}: arena grew ${lastScale} -> ${arena.scale}`);
    }
    if (arena.scale < SHRINK_MIN_SCALE - 1e-12) note(`${at}: arena scale ${arena.scale} too small`);
    lastScale = arena.scale;

    /* containment: the ball may never be outside a boundary */
    for (const edge of arena.edges) {
      const gap = signedDistanceToEdge({ x: ball.x, y: ball.y }, edge);
      if (gap <= -ball.radius) {
        note(`${at}: ball outside edge ${edge.index} by ${(-gap).toFixed(2)}`);
        break;
      }
    }

    /* ball acceleration: the exact spec formula */
    if (state.status === 'playing' && !ball.frozen) {
      const expected = Math.min(
        BALL_MAX_SPEED,
        BALL_START_SPEED +
          timeAccelFor(playerCount) * state.elapsed +
          BALL_HIT_ACCEL * ball.consecutiveHits,
      );
      if (Math.abs(ball.speed - expected) > 1e-6) {
        note(`${at}: speed ${ball.speed.toFixed(3)} != formula ${expected.toFixed(3)}`);
      }
      if (Math.abs(Math.hypot(ball.vx, ball.vy) - expected) > 1e-4) {
        note(`${at}: |v| does not match the ball speed field`);
      }
    }

    /* paddles: own edge, inside the edge, never faster than PADDLE_SPEED */
    for (const player of state.players) {
      const edge = arena.edges[player.edgeIndex];
      if (edge.ownerId !== player.id) note(`${at}: ${player.id} lost ownership of its edge`);
      const half = player.paddleLength / 2 / edge.length;
      if (player.paddlePosition < half - 1e-9 || player.paddlePosition > 1 - half + 1e-9) {
        note(`${at}: ${player.id} paddle overhangs its edge (${player.paddlePosition})`);
      }
      if (Math.abs(player.paddleVelocity) * edge.length > PADDLE_SPEED + 1e-6) {
        note(`${at}: ${player.id} paddle exceeded the speed limit`);
      }
      const previous = lives.get(player.id) ?? 0;
      if (player.lives > previous) note(`${at}: ${player.id} gained a life`);
      if (player.lives < 0) note(`${at}: ${player.id} has negative lives`);
      lives.set(player.id, player.lives);
    }

    if (problems.length >= 8) break;
  }

  return problems;
}

describe('spec conformance: every player count', () => {
  it.each(counts)('plays a rule-abiding %i player match', (playerCount) => {
    expect(auditMatch(playerCount, 0x51c0000 + playerCount)).toEqual([]);
  });

  it('builds one equal-length edge per player for 3..12 players', () => {
    for (const playerCount of counts.filter((c) => c >= 3)) {
      const arena = createArena(playerCount, 1);
      expect(arena.sideCount).toBe(playerCount);

      const seats = new Set<number>();
      for (let i = 0; i < playerCount; i += 1) seats.add(edgeIndexForPlayer(i, arena));
      expect(seats.size).toBe(playerCount);

      const lengths = arena.edges.map((edge) => edge.length);
      expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(1e-9);
      for (const edge of arena.edges) {
        // Every edge midpoint sits exactly one apothem from the centre.
        expect(Math.hypot(edge.mid.x, edge.mid.y)).toBeCloseTo(
          apothem(playerCount, arena.baseRadius),
          6,
        );
      }
      // Edge 0 faces the bottom of the screen (world angle PI/2).
      expect(Math.atan2(arena.edges[0].mid.y, arena.edges[0].mid.x)).toBeCloseTo(Math.PI / 2, 9);
    }
  });
});

describe('spec conformance: paddle interception at maximum speed', () => {
  it.each(counts)('returns a centred hit at 850 u/s with %i players', (playerCount) => {
    const engine = new GameEngine(configFor(playerCount, 7));
    const state = engine.state;
    while (state.status === 'countdown') engine.step(FIXED_DT);
    engine.drainEvents();

    const defender = state.players[0];
    const edge = state.arena.edges[defender.edgeIndex];
    const shape = paddleShape(edge, defender.paddlePosition, defender.paddleLength);

    // Fire the ball from the centre at the paddle face, at the hardest legal speed.
    const dx = shape.frontCenter.x - state.arena.center.x;
    const dy = shape.frontCenter.y - state.arena.center.y;
    const len = Math.hypot(dx, dy);
    state.ball.x = state.arena.center.x;
    state.ball.y = state.arena.center.y;
    state.ball.frozen = false;
    state.ball.consecutiveHits = 0;
    state.ball.speed = BALL_MAX_SPEED;
    state.ball.vx = (dx / len) * BALL_MAX_SPEED;
    state.ball.vy = (dy / len) * BALL_MAX_SPEED;

    let hit = false;
    let conceded = false;
    for (let i = 0; i < 240 && !hit && !conceded; i += 1) {
      engine.step(FIXED_DT);
      for (const event of engine.drainEvents()) {
        if (event.type === 'HIT' && event.playerId === defender.id) hit = true;
        if (event.type === 'DAMAGE') conceded = true;
      }
    }
    expect(conceded, 'ball tunnelled through a centred paddle').toBe(false);
    expect(hit, 'paddle never intercepted the ball').toBe(true);
  });
});
