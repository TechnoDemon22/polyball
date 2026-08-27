/**
 * Polyball tunable constants.
 *
 * All distances are in WORLD UNITS (never pixels). The renderer converts world
 * units to screen pixels, so gameplay is identical on a phone and a 4K monitor.
 */

/* ------------------------------------------------------------------ timing */
export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;
/** How often the server broadcasts snapshots (Hz). */
export const SNAPSHOT_RATE = 25;
/** Guard against catastrophic frame spikes (seconds of simulation per frame). */
export const MAX_FRAME_DT = 0.25;

/* ----------------------------------------------------------------- players */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
/** Matches with >= this many players use a true regular polygon. */
export const POLYGON_MIN_SIDES = 3;
/** Matches with >= this many players get a bigger arena + gentler acceleration. */
export const LARGE_MATCH_THRESHOLD = 9;

export const DEFAULT_LIVES = 3;
export const MIN_LIVES = 1;
export const MAX_LIVES = 9;

export const MAX_NAME_LENGTH = 16;
export const MIN_NAME_LENGTH = 1;

/* ------------------------------------------------------------------- arena */
export const WORLD_BASE_RADIUS = 460;
export const WORLD_LARGE_RADIUS = 520;
/** Extra world padding kept visible around the arena. */
export const WORLD_VIEW_MARGIN = 70;

/* ----------------------------------------------------------------- paddles */
export const PADDLE_THICKNESS = 12;
export const PADDLE_MIN_LENGTH = 45;
export const PADDLE_MAX_LENGTH = 140;
/** Paddle travel speed along its edge, world units per second. */
export const PADDLE_SPEED = 520;
/** Fraction of the edge a paddle may never exceed (keeps the game winnable). */
export const PADDLE_MAX_EDGE_FRACTION = 0.55;
export const PADDLE_RATIO_FEW = 0.16; // 3-4 players
export const PADDLE_RATIO_MID = 0.18; // 5-8 players
export const PADDLE_RATIO_MANY = 0.21; // 9-12 players
/** How strongly paddle movement drags the ball sideways (0..1). */
export const PADDLE_SPIN_INFLUENCE = 0.35;
/** Influence multiplier when the paddle moves away from the impact point. */
export const PADDLE_SPIN_RETREAT = 0.35;

/* -------------------------------------------------------------------- ball */
export const BALL_RADIUS = 9;
export const BALL_START_SPEED = 300;
export const BALL_MAX_SPEED = 850;
/** Speed gained per second of match time (world units / s^2). */
export const BALL_TIME_ACCEL = 8;
/** Speed gained per consecutive successful hit (world units / s). */
export const BALL_HIT_ACCEL = 10;
/** Time acceleration multiplier for crowded matches. */
export const BALL_LARGE_MATCH_ACCEL_FACTOR = 0.7;
/** Max deflection away from the edge normal on a paddle hit (radians, ~65deg). */
export const MAX_BOUNCE_ANGLE = 1.134;
/** Hard cap so the ball never travels almost parallel to an edge (~74deg). */
export const MAX_ANGLE_FROM_NORMAL = 1.295;
/** Small deterministic-jitter budget that breaks perfectly repeating rallies. */
export const BOUNCE_JITTER = 0.035;
/** Seconds an individual surface is ignored after resolving a collision. */
export const COLLISION_COOLDOWN = 0.035;
/** Push-out distance applied after a collision to avoid re-triggering. */
export const COLLISION_SKIN = 0.6;
/** Upper bound on ball substeps per tick (swept-collision reliability). */
export const MAX_SUBSTEPS = 10;
/** Substep target: never move more than this fraction of the ball radius. */
export const SUBSTEP_TRAVEL_RATIO = 0.6;

/* ---------------------------------------------------------------- shrinking */
export const SHRINK_START_SCALE = 1;
export const SHRINK_PRESSURE_SCALE = 0.82;
export const SHRINK_MIN_SCALE = 0.65;
export const SHRINK_START_TIME = 30;
export const SHRINK_PRESSURE_END = 120;
/** Seconds to go from pressure scale to minimum scale in the final phase. */
export const SHRINK_FINAL_RAMP = 60;
/** Shrinking pauses briefly after someone loses a life. */
export const SHRINK_PAUSE_AFTER_DAMAGE = 2;
/** Look-ahead used to render the upcoming boundary preview. */
export const SHRINK_PREVIEW_LEAD = 6;

/* -------------------------------------------------------------- match flow */
export const COUNTDOWN_SECONDS = 3;
/** Pause after a life is lost before the ball launches again. */
export const RESET_DELAY = 1.2;
/** Rallies longer than this count as "on fire" for effects. */
export const HOT_STREAK = 6;

/* ------------------------------------------------------------ presentation */
/** Colour-blind friendly neon ramp; index === player colour index. */
export const PLAYER_COLORS: readonly string[] = [
  '#22d3ee',
  '#f472b6',
  '#a3e635',
  '#fbbf24',
  '#a78bfa',
  '#fb7185',
  '#34d399',
  '#60a5fa',
  '#f97316',
  '#e879f9',
  '#facc15',
  '#2dd4bf',
];

/** Shape glyphs so players are identifiable without relying on colour. */
export const PLAYER_SYMBOLS: readonly string[] = [
  '●',
  '■',
  '▲',
  '◆',
  '★',
  '▼',
  '⬟',
  '✚',
  '◗',
  '⬢',
  '✦',
  '◍',
];

/* ------------------------------------------------------------------ rooms */
/** No I, L, O, 0 or 1 - unambiguous when read aloud or typed on a phone. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
/** Hard cap on a single inbound WebSocket message. */
export const MAX_MESSAGE_BYTES = 4096;
/** Client input messages accepted per second, per connection. */
export const INPUT_RATE_LIMIT = 40;
/** Any-message rate limit per second, per connection. */
export const MESSAGE_RATE_LIMIT = 90;
export const HEARTBEAT_INTERVAL = 5000;
export const HEARTBEAT_TIMEOUT = 15000;
/** Grace period for a dropped player to reconnect (ms). */
export const RECONNECT_WINDOW = 20000;
