import { PADDLE_SPEED } from '../constants/index';
import { reflect, timeToEdgePlane } from '../geometry/collision';
import { edgeCoordinateOf } from '../geometry/polygon';
import { clamp01, createRng, sign } from '../geometry/vector';
import { paddleHalfSpan } from '../physics/paddle';
import type { Difficulty, Edge, GameState, PlayerInput, Vec2 } from '../types/index';

export interface AIProfile {
  /** Seconds between decisions - the AI reacts to a stale ball, like a human. */
  reactionDelay: number;
  /** Aiming error as a fraction of the edge length. */
  errorRatio: number;
  /** Fraction of the shared paddle speed limit the AI is allowed to use. */
  speedFactor: number;
  /** How many wall bounces it can see ahead. */
  bounces: number;
  /** Chance per decision of simply not reacting. */
  lapseChance: number;
}

export const AI_PROFILES: Record<Difficulty, AIProfile> = {
  easy: { reactionDelay: 0.34, errorRatio: 0.22, speedFactor: 0.62, bounces: 0, lapseChance: 0.18 },
  medium: {
    reactionDelay: 0.2,
    errorRatio: 0.12,
    speedFactor: 0.82,
    bounces: 1,
    lapseChance: 0.07,
  },
  hard: { reactionDelay: 0.08, errorRatio: 0.04, speedFactor: 1, bounces: 2, lapseChance: 0.01 },
};

/** How long the duty-cycle window is when throttling AI paddle speed. */
const DUTY_PERIOD = 0.12;

export interface Prediction {
  /** Normalised coordinate (0..1) where the ball should cross this edge. */
  coordinate: number;
  /** Seconds until impact. */
  time: number;
}

/**
 * Where will the ball cross `edge`? Walks the ball forward, reflecting off
 * boundary planes, ignoring paddles. Returns null when the ball is not heading
 * for this edge within the allowed number of bounces.
 */
export function predictEdgeImpact(
  state: GameState,
  edge: Edge,
  maxBounces: number,
): Prediction | null {
  const { ball, arena } = state;
  let position: Vec2 = { x: ball.x, y: ball.y };
  let velocity: Vec2 = { x: ball.vx, y: ball.vy };
  let elapsed = 0;

  if (velocity.x === 0 && velocity.y === 0) return null;

  for (let bounce = 0; bounce <= maxBounces; bounce += 1) {
    let bestTime = Infinity;
    let bestEdge: Edge | null = null;

    for (const candidate of arena.edges) {
      const t = timeToEdgePlane(position, velocity, candidate, ball.radius);
      if (t === null || t <= 1e-4) continue;
      if (t < bestTime) {
        bestTime = t;
        bestEdge = candidate;
      }
    }
    if (!bestEdge) return null;

    const impact: Vec2 = {
      x: position.x + velocity.x * bestTime,
      y: position.y + velocity.y * bestTime,
    };
    elapsed += bestTime;

    if (bestEdge.index === edge.index) {
      return { coordinate: clamp01(edgeCoordinateOf(edge, impact)), time: elapsed };
    }

    position = impact;
    velocity = reflect(velocity, bestEdge.normal);
  }

  return null;
}

/**
 * Practice-mode opponent. Obeys exactly the same paddle speed limit and edge
 * bounds as a human: it only ever emits normalised PlayerInput.
 */
export class AIController {
  readonly playerId: string;
  readonly difficulty: Difficulty;
  private profile: AIProfile;
  private rng: () => number;
  private decisionTimer = 0;
  private dutyClock = 0;
  private target = 0.5;
  private lapsed = false;

  constructor(playerId: string, difficulty: Difficulty, seed = 1) {
    this.playerId = playerId;
    this.difficulty = difficulty;
    this.profile = AI_PROFILES[difficulty];
    this.rng = createRng(seed);
  }

  setDifficulty(difficulty: Difficulty): void {
    this.profile = AI_PROFILES[difficulty];
  }

  update(state: GameState, dt: number): PlayerInput {
    const idle: PlayerInput = { direction: 0, isPressed: false, source: 'ai' };
    const player = state.players.find((p) => p.id === this.playerId);
    if (!player || !player.alive) return idle;
    const edge = state.arena.edges[player.edgeIndex];
    if (!edge) return idle;

    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.profile.reactionDelay;
      this.lapsed = this.rng() < this.profile.lapseChance;
      this.target = this.chooseTarget(state, edge);
    }

    // Duty cycle keeps the AI at profile.speedFactor of PADDLE_SPEED.
    this.dutyClock = (this.dutyClock + dt) % DUTY_PERIOD;
    const allowedToMove = this.dutyClock <= DUTY_PERIOD * this.profile.speedFactor;
    if (this.lapsed || !allowedToMove) return idle;

    const half = paddleHalfSpan(player.paddleLength, edge.length);
    const deadZone = Math.max(0.01, half * 0.35);
    const delta = this.target - player.paddlePosition;
    if (Math.abs(delta) < deadZone) return idle;

    return { direction: sign(delta), isPressed: true, source: 'ai' };
  }

  private chooseTarget(state: GameState, edge: Edge): number {
    const prediction = predictEdgeImpact(state, edge, this.profile.bounces);
    const noise = (this.rng() * 2 - 1) * this.profile.errorRatio;

    if (!prediction) {
      // Nothing incoming: drift back toward the middle of the edge.
      return clamp01(0.5 + noise * 0.5);
    }

    // Longer flights are easier to read, so scale the error down with distance.
    const readability = clamp01(1 - prediction.time * 0.35);
    return clamp01(prediction.coordinate + noise * (0.5 + readability));
  }
}

/** Owns one controller per AI player and feeds their inputs into the engine. */
export class AIDirector {
  private controllers = new Map<string, AIController>();

  constructor(seeds: { id: string; difficulty: Difficulty }[], seed = 7) {
    seeds.forEach((entry, index) => {
      this.controllers.set(
        entry.id,
        new AIController(entry.id, entry.difficulty, seed + index * 31),
      );
    });
  }

  setDifficulty(difficulty: Difficulty): void {
    for (const controller of this.controllers.values()) controller.setDifficulty(difficulty);
  }

  /** Effective top speed of an AI paddle, for UI copy / debugging. */
  static topSpeed(difficulty: Difficulty): number {
    return PADDLE_SPEED * AI_PROFILES[difficulty].speedFactor;
  }

  update(
    state: GameState,
    dt: number,
    apply: (playerId: string, input: PlayerInput) => void,
  ): void {
    for (const controller of this.controllers.values()) {
      apply(controller.playerId, controller.update(state, dt));
    }
  }
}
