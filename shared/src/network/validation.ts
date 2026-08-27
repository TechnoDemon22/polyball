import {
  MAX_LIVES,
  MAX_MESSAGE_BYTES,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_LIVES,
  MIN_NAME_LENGTH,
  POLYGON_MIN_SIDES,
} from '../constants/index';
import type { GameMode, InputSource } from '../types/index';
import {
  CLIENT_MESSAGE_TYPES,
  DEFAULT_ROOM_OPTIONS,
  isValidRoomCode,
  type ClientMessage,
  type ClientMessageType,
  type ErrorCode,
  type RoomOptions,
} from './messages';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string };

const fail = (
  code: ErrorCode,
  message: string,
): { ok: false; code: ErrorCode; message: string } => ({
  ok: false,
  code,
  message,
});

const INPUT_SOURCES: readonly InputSource[] = ['keyboard', 'mouse', 'touch', 'pen', 'ai'];
const GAME_MODES: readonly GameMode[] = ['survival', 'chaos'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Display names are user content: strip control characters, collapse
 * whitespace, cap the length. Never rendered as HTML anywhere in the client.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return Array.from(raw.normalize('NFKC'))
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      // Tabs and line breaks separate words, so they become spaces...
      if (code === 0x09 || (code >= 0x0a && code <= 0x0d)) return ' ';
      // ...while every other C0/C1 control and zero-width / bidi trick is dropped.
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return '';
      if (code >= 0x200b && code <= 0x200f) return '';
      if (code >= 0x202a && code <= 0x202e) return '';
      return char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

export function isValidName(raw: unknown): boolean {
  const name = sanitizeName(raw);
  return name.length >= MIN_NAME_LENGTH && name.length <= MAX_NAME_LENGTH;
}

/**
 * UTF-8 byte length without depending on TextEncoder, so the same guard works
 * in the browser, in Node and in a test runner.
 */
export function utf8ByteLength(raw: string): number {
  let bytes = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < raw.length) {
      const next = raw.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4; // surrogate pair = one astral code point
        i += 1;
        continue;
      }
      bytes += 3; // lone surrogate, counted as the replacement character
    } else bytes += 3;
  }
  return bytes;
}

/** Byte length guard applied before JSON.parse. */
export function isWithinSizeLimit(raw: string, limit = MAX_MESSAGE_BYTES): boolean {
  // Cheap upper bound first, exact byte count only when needed.
  if (raw.length <= limit / 4) return true;
  return utf8ByteLength(raw) <= limit;
}

export function clampRoomOptions(raw: unknown): RoomOptions {
  const source = isRecord(raw) ? raw : {};
  const maxPlayersRaw = isFiniteNumber(source.maxPlayers)
    ? Math.round(source.maxPlayers)
    : DEFAULT_ROOM_OPTIONS.maxPlayers;
  const livesRaw = isFiniteNumber(source.lives)
    ? Math.round(source.lives)
    : DEFAULT_ROOM_OPTIONS.lives;
  const mode = GAME_MODES.includes(source.mode as GameMode)
    ? (source.mode as GameMode)
    : DEFAULT_ROOM_OPTIONS.mode;

  return {
    maxPlayers: Math.min(MAX_PLAYERS, Math.max(POLYGON_MIN_SIDES, maxPlayersRaw)),
    lives: Math.min(MAX_LIVES, Math.max(MIN_LIVES, livesRaw)),
    mode,
    powerUps: source.powerUps === true,
    isPrivate: source.isPrivate === true,
    shrinkEnabled: source.shrinkEnabled !== false,
  };
}

/**
 * Validate a decoded client message.
 *
 * Every field is checked explicitly: unknown types are rejected, numbers must
 * be finite and in range, and nothing is coerced silently. The server must
 * never trust anything that has not passed through here.
 */
export function validateClientMessage(raw: unknown): ValidationResult<ClientMessage> {
  if (!isRecord(raw)) return fail('INVALID_MESSAGE', 'Message must be a JSON object.');

  const type = raw.type;
  if (typeof type !== 'string' || !CLIENT_MESSAGE_TYPES.includes(type as ClientMessageType)) {
    return fail('INVALID_MESSAGE', 'Unknown message type.');
  }

  switch (type as ClientMessageType) {
    case 'CREATE_ROOM': {
      if (!isValidName(raw.name)) return fail('INVALID_NAME', 'Display name is required.');
      return {
        ok: true,
        value: {
          type: 'CREATE_ROOM',
          name: sanitizeName(raw.name),
          options: clampRoomOptions(raw.options),
        },
      };
    }

    case 'JOIN_ROOM': {
      if (!isValidRoomCode(raw.code)) return fail('INVALID_CODE', 'Room code is not valid.');
      if (!isValidName(raw.name)) return fail('INVALID_NAME', 'Display name is required.');
      const token =
        typeof raw.reconnectToken === 'string' ? raw.reconnectToken.slice(0, 64) : undefined;
      return {
        ok: true,
        value: {
          type: 'JOIN_ROOM',
          code: String(raw.code).toUpperCase(),
          name: sanitizeName(raw.name),
          ...(token ? { reconnectToken: token } : {}),
        },
      };
    }

    case 'PLAYER_READY': {
      if (typeof raw.ready !== 'boolean')
        return fail('INVALID_MESSAGE', 'ready must be a boolean.');
      return { ok: true, value: { type: 'PLAYER_READY', ready: raw.ready } };
    }

    case 'PLAYER_INPUT': {
      if (
        !isFiniteNumber(raw.sequence) ||
        raw.sequence < 0 ||
        raw.sequence > Number.MAX_SAFE_INTEGER
      ) {
        return fail('INVALID_MESSAGE', 'sequence must be a positive number.');
      }
      if (raw.direction !== -1 && raw.direction !== 0 && raw.direction !== 1) {
        return fail('INVALID_MESSAGE', 'direction must be -1, 0 or 1.');
      }
      if (typeof raw.isPressed !== 'boolean') {
        return fail('INVALID_MESSAGE', 'isPressed must be a boolean.');
      }
      const source = INPUT_SOURCES.includes(raw.source as InputSource)
        ? (raw.source as InputSource)
        : 'keyboard';
      let absolute: number | undefined;
      if (raw.absolute !== undefined) {
        if (!isFiniteNumber(raw.absolute) || raw.absolute < 0 || raw.absolute > 1) {
          return fail('INVALID_MESSAGE', 'absolute must be between 0 and 1.');
        }
        absolute = raw.absolute;
      }
      return {
        ok: true,
        value: {
          type: 'PLAYER_INPUT',
          sequence: Math.floor(raw.sequence),
          direction: raw.direction,
          isPressed: raw.isPressed,
          source: source === 'ai' ? 'keyboard' : source,
          ...(absolute === undefined ? {} : { absolute }),
        },
      };
    }

    case 'PING': {
      const time = isFiniteNumber(raw.time) ? raw.time : 0;
      return { ok: true, value: { type: 'PING', time } };
    }

    case 'LEAVE_ROOM':
    case 'START_MATCH':
    case 'REQUEST_REMATCH':
    case 'RETURN_TO_LOBBY':
      return { ok: true, value: { type } as ClientMessage };

    default:
      return fail('INVALID_MESSAGE', 'Unsupported message.');
  }
}

/** Parse + validate a raw WebSocket frame. Never throws. */
export function parseClientMessage(raw: string): ValidationResult<ClientMessage> {
  if (!isWithinSizeLimit(raw)) return fail('INVALID_MESSAGE', 'Message too large.');
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return fail('INVALID_MESSAGE', 'Malformed JSON.');
  }
  return validateClientMessage(decoded);
}

/** Simple token-bucket limiter used per connection. */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.lastRefill = now;
  }

  tryConsume(now = Date.now(), cost = 1): boolean {
    const elapsed = Math.max(0, now - this.lastRefill) / 1000;
    this.lastRefill = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
