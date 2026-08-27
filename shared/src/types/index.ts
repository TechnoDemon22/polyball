/** Core Polyball domain types shared by client and server. */

export interface Vec2 {
  x: number;
  y: number;
}

export type ArenaShape = 'polygon' | 'rect';
export type MatchPhase = 'opening' | 'pressure' | 'final';
/** countdown -> playing <-> reset -> finished */
export type MatchStatus = 'countdown' | 'playing' | 'reset' | 'finished';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type GameMode = 'survival' | 'chaos';
export type InputSource = 'keyboard' | 'mouse' | 'touch' | 'pen' | 'ai';

/** One side of the arena. Owned edges are defended by a player. */
export interface Edge {
  index: number;
  start: Vec2;
  end: Vec2;
  mid: Vec2;
  /** Unit vector pointing start -> end. */
  tangent: Vec2;
  /** Unit vector pointing from the edge toward the arena centre. */
  normal: Vec2;
  length: number;
  /** atan2(tangent.y, tangent.x) */
  angle: number;
  ownerId: string | null;
  /** false once the owner is eliminated (edge then behaves as a solid wall). */
  active: boolean;
}

export interface ArenaGeometry {
  shape: ArenaShape;
  sideCount: number;
  /** Circumradius at scale 1. */
  baseRadius: number;
  /** Current shrink factor, 1 -> SHRINK_MIN_SCALE. */
  scale: number;
  /** Rotation of the first vertex, radians. */
  startAngle: number;
  center: Vec2;
  edges: Edge[];
  /** Rect mode only: half-extents at scale 1. */
  halfWidth: number;
  halfHeight: number;
}

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  radius: number;
  /** Player that last hit the ball (used for elimination credit). */
  lastHitterId: string | null;
  /** Successful hits since the last reset - drives hit acceleration. */
  consecutiveHits: number;
  /** True while parked in the centre during a countdown / reset. */
  frozen: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  /** 1-based display number. */
  number: number;
  colorIndex: number;
  edgeIndex: number;
  /** Paddle centre in normalised edge coordinates, 0..1. */
  paddlePosition: number;
  /** Paddle length in world units (recomputed as the arena shrinks). */
  paddleLength: number;
  /** Signed normalised-units-per-second, used for spin on impact. */
  paddleVelocity: number;
  lives: number;
  alive: boolean;
  hits: number;
  misses: number;
  /** Balls this player struck that knocked out somebody else. */
  eliminations: number;
  longestRally: number;
  connected: boolean;
  isAI: boolean;
  isLocal: boolean;
  /** Match time (seconds) at elimination, null while alive. */
  eliminatedAt: number | null;
  /** 1 = winner. Assigned on elimination / match end. */
  placement: number | null;
}

export interface GameState {
  status: MatchStatus;
  tick: number;
  /** Seconds of active play. */
  elapsed: number;
  /** Seconds left in the current countdown / reset pause. */
  countdown: number;
  phase: MatchPhase;
  arena: ArenaGeometry;
  ball: BallState;
  players: PlayerState[];
  /** Hits in the current rally. */
  rally: number;
  longestRally: number;
  winnerId: string | null;
  /** 0..1 shrink pressure indicator for HUD + effects. */
  shrinkWarning: number;
  /** Arena scale a few seconds from now (drives the preview outline). */
  previewScale: number;
}

/** Normalised input - every device converges on this shape. */
export interface PlayerInput {
  /** -1 = toward edge start, 0 = idle, +1 = toward edge end. */
  direction: -1 | 0 | 1;
  isPressed: boolean;
  source: InputSource;
  /** Optional absolute target (0..1) for sliders / drag control. */
  absolute?: number;
  /** Client-side ordering, validated by the server. */
  sequence?: number;
}

export interface PlayerSeed {
  id: string;
  name: string;
  isAI?: boolean;
  isLocal?: boolean;
  difficulty?: Difficulty;
  colorIndex?: number;
}

export interface MatchConfig {
  players: PlayerSeed[];
  lives: number;
  mode: GameMode;
  shrinkEnabled: boolean;
  /** Deterministic RNG seed (server-authoritative in online play). */
  seed: number;
}

export interface MatchStatsRow {
  id: string;
  name: string;
  number: number;
  colorIndex: number;
  placement: number;
  lives: number;
  hits: number;
  misses: number;
  eliminations: number;
  longestRally: number;
  survivedFor: number;
}

export interface MatchSummary {
  winnerId: string | null;
  winnerName: string | null;
  duration: number;
  longestRally: number;
  ranking: MatchStatsRow[];
}

export type GameEvent =
  | { type: 'COUNTDOWN'; value: number }
  | { type: 'MATCH_START' }
  | { type: 'HIT'; playerId: string; x: number; y: number; power: number; perfect: boolean }
  | { type: 'WALL_BOUNCE'; x: number; y: number; edgeIndex: number }
  | { type: 'DAMAGE'; playerId: string; livesLeft: number; x: number; y: number }
  | { type: 'ELIMINATED'; playerId: string; placement: number; byPlayerId: string | null }
  | { type: 'PHASE_CHANGED'; phase: MatchPhase }
  | { type: 'ARENA_WARNING'; targetScale: number }
  | { type: 'MATCH_ENDED'; summary: MatchSummary };
