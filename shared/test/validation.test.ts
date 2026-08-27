import { describe, expect, it } from 'vitest';
import {
  clampRoomOptions,
  createRng,
  DEFAULT_ROOM_OPTIONS,
  generateRoomCode,
  isValidName,
  isValidRoomCode,
  isWithinSizeLimit,
  MAX_LIVES,
  MAX_MESSAGE_BYTES,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  normalizeRoomCode,
  parseClientMessage,
  POLYGON_MIN_SIDES,
  RateLimiter,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  sanitizeName,
  utf8ByteLength,
  validateClientMessage,
} from '../src/index';

/** Build a string containing an exact code point without embedding it here. */
const ch = (code: number): string => String.fromCharCode(code);

describe('display names', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(sanitizeName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    expect(sanitizeName('a'.repeat(60))).toHaveLength(MAX_NAME_LENGTH);
    expect(sanitizeName('Tab\tSeparated')).toBe('Tab Separated');
  });

  it('strips control characters, zero-width joiners and bidi overrides', () => {
    expect(sanitizeName(`Ne${ch(0x200d)}o`)).toBe('Neo');
    expect(sanitizeName(`Ze${ch(0x200b)}ro`)).toBe('Zero');
    expect(sanitizeName(`${ch(0x202e)}evil`)).toBe('evil');
    expect(sanitizeName(`${ch(0x0007)}bell`)).toBe('bell');
    expect(sanitizeName(`c1${ch(0x009f)}control`)).toBe('c1control');
    expect(sanitizeName('line\nbreak')).toBe('line break');
  });

  it('rejects anything that is not a usable string', () => {
    expect(sanitizeName(undefined)).toBe('');
    expect(sanitizeName(42)).toBe('');
    expect(sanitizeName({ name: 'x' })).toBe('');
    expect(isValidName('   ')).toBe(false);
    expect(isValidName('')).toBe(false);
    expect(isValidName(null)).toBe(false);
    expect(isValidName('Kai')).toBe(true);
  });

  it('keeps markup-looking characters as literal text', () => {
    // Nothing is executed or interpreted; the characters simply survive.
    expect(sanitizeName('<b>hi</b>')).toBe('<b>hi</b>');
  });
});
describe('room codes', () => {
  it('accepts only codes built from the unambiguous alphabet', () => {
    expect(isValidRoomCode('ABCDEF')).toBe(true);
    expect(isValidRoomCode('abcdef')).toBe(true);
    expect(isValidRoomCode('ABCDE')).toBe(false);
    expect(isValidRoomCode('ABCDEFG')).toBe(false);
    expect(isValidRoomCode('ABCDE!')).toBe(false);
    expect(isValidRoomCode('ABCDEI')).toBe(false); // I is not in the alphabet
    expect(isValidRoomCode('ABCDEO')).toBe(false); // O is not in the alphabet
    expect(isValidRoomCode(123456)).toBe(false);
    expect(isValidRoomCode(null)).toBe(false);
    expect(isValidRoomCode(undefined)).toBe(false);
  });

  it('normalises typed input to something the server can look up', () => {
    expect(normalizeRoomCode('ab-cd ef')).toBe('ABCDEF');
    // Ambiguous glyphs map onto the digits they look like.
    expect(normalizeRoomCode('IL0OK9')).toBe('1100K9');
    expect(normalizeRoomCode('ABCDEFGHJK')).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('generates valid codes from an injected random source', () => {
    const rng = createRng(2026);
    for (let i = 0; i < 200; i += 1) {
      const code = generateRoomCode(rng);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
    }
    // A degenerate random source must still stay inside the alphabet.
    expect(generateRoomCode(() => 1)).toBe(
      ROOM_CODE_ALPHABET[ROOM_CODE_ALPHABET.length - 1].repeat(ROOM_CODE_LENGTH),
    );
    expect(generateRoomCode(() => 0)).toBe(ROOM_CODE_ALPHABET[0].repeat(ROOM_CODE_LENGTH));
  });
});

describe('room options', () => {
  it('falls back to defaults for missing or nonsense values', () => {
    expect(clampRoomOptions(undefined)).toEqual(DEFAULT_ROOM_OPTIONS);
    expect(clampRoomOptions('nope')).toEqual(DEFAULT_ROOM_OPTIONS);
    expect(clampRoomOptions({ maxPlayers: 'lots', lives: null, mode: 'hacked' })).toEqual(
      DEFAULT_ROOM_OPTIONS,
    );
  });

  it('clamps player counts and lives into the legal range', () => {
    expect(clampRoomOptions({ maxPlayers: 99 }).maxPlayers).toBe(MAX_PLAYERS);
    expect(clampRoomOptions({ maxPlayers: 1 }).maxPlayers).toBe(POLYGON_MIN_SIDES);
    expect(clampRoomOptions({ maxPlayers: 7.6 }).maxPlayers).toBe(8);
    expect(clampRoomOptions({ lives: 500 }).lives).toBe(MAX_LIVES);
    expect(clampRoomOptions({ lives: -3 }).lives).toBe(1);
    expect(clampRoomOptions({ maxPlayers: Number.POSITIVE_INFINITY }).maxPlayers).toBe(
      DEFAULT_ROOM_OPTIONS.maxPlayers,
    );
    expect(clampRoomOptions({ lives: Number.NaN }).lives).toBe(DEFAULT_ROOM_OPTIONS.lives);
  });

  it('treats flags strictly and keeps shrink on unless explicitly disabled', () => {
    expect(clampRoomOptions({ powerUps: 'yes' }).powerUps).toBe(false);
    expect(clampRoomOptions({ powerUps: true }).powerUps).toBe(true);
    expect(clampRoomOptions({ isPrivate: 1 }).isPrivate).toBe(false);
    expect(clampRoomOptions({}).shrinkEnabled).toBe(true);
    expect(clampRoomOptions({ shrinkEnabled: false }).shrinkEnabled).toBe(false);
    expect(clampRoomOptions({ shrinkEnabled: 'false' }).shrinkEnabled).toBe(true);
    expect(clampRoomOptions({ mode: 'chaos' }).mode).toBe('chaos');
  });
});
describe('message size limits', () => {
  it('accepts ordinary frames and rejects oversized ones', () => {
    expect(isWithinSizeLimit('{"type":"PING","time":1}')).toBe(true);
    expect(isWithinSizeLimit('x'.repeat(MAX_MESSAGE_BYTES))).toBe(true);
    expect(isWithinSizeLimit('x'.repeat(MAX_MESSAGE_BYTES + 1))).toBe(false);
    expect(isWithinSizeLimit('xxxxx', 4)).toBe(false);
  });

  it('counts bytes, not characters, for multi-byte payloads', () => {
    // Four bytes per astral character, so a quarter of the limit is the edge.
    const emoji = ch(0xd83c) + ch(0xdfae); // one game-controller code point
    const filled = emoji.repeat(MAX_MESSAGE_BYTES / 4);
    expect(isWithinSizeLimit(filled)).toBe(true);
    expect(isWithinSizeLimit(filled + emoji)).toBe(false);
  });

  it('measures UTF-8 length the way a WebSocket frame does', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength(ch(0x00e9))).toBe(2); // e-acute
    expect(utf8ByteLength(ch(0x20ac))).toBe(3); // euro sign
    expect(utf8ByteLength(ch(0xd83c) + ch(0xdfae))).toBe(4);
    expect(utf8ByteLength(ch(0xd83c))).toBe(3); // lone surrogate
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('client message validation', () => {
  it('rejects non-objects and unknown types', () => {
    for (const bad of [null, 42, 'PING', [], [{ type: 'PING' }], true]) {
      const result = validateClientMessage(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('INVALID_MESSAGE');
    }
    expect(validateClientMessage({ type: 'DELETE_EVERYTHING' }).ok).toBe(false);
    expect(validateClientMessage({ type: 42 }).ok).toBe(false);
    expect(validateClientMessage({}).ok).toBe(false);
  });

  it('validates CREATE_ROOM and sanitises what it keeps', () => {
    const result = validateClientMessage({
      type: 'CREATE_ROOM',
      name: `  Nova${ch(0x200b)}  `,
      options: { maxPlayers: 50, lives: 0, mode: 'chaos' },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'CREATE_ROOM') {
      expect(result.value.name).toBe('Nova');
      expect(result.value.options.maxPlayers).toBe(MAX_PLAYERS);
      expect(result.value.options.lives).toBe(1);
      expect(result.value.options.mode).toBe('chaos');
    }

    const noName = validateClientMessage({ type: 'CREATE_ROOM', name: '  ' });
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.code).toBe('INVALID_NAME');
  });

  it('validates JOIN_ROOM code, name and reconnect token', () => {
    const ok = validateClientMessage({
      type: 'JOIN_ROOM',
      code: 'abcd23',
      name: 'Zed',
      reconnectToken: 't'.repeat(200),
    });
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.value.type === 'JOIN_ROOM') {
      expect(ok.value.code).toBe('ABCD23');
      expect(ok.value.reconnectToken).toHaveLength(64);
    }

    const badCode = validateClientMessage({ type: 'JOIN_ROOM', code: 'OOPS', name: 'Zed' });
    expect(badCode.ok).toBe(false);
    if (!badCode.ok) expect(badCode.code).toBe('INVALID_CODE');

    const badName = validateClientMessage({ type: 'JOIN_ROOM', code: 'ABCD23', name: 7 });
    expect(badName.ok).toBe(false);
    if (!badName.ok) expect(badName.code).toBe('INVALID_NAME');

    const noToken = validateClientMessage({ type: 'JOIN_ROOM', code: 'ABCD23', name: 'Zed' });
    if (noToken.ok && noToken.value.type === 'JOIN_ROOM') {
      expect(noToken.value.reconnectToken).toBeUndefined();
    }
  });

  it('requires a real boolean for PLAYER_READY', () => {
    expect(validateClientMessage({ type: 'PLAYER_READY', ready: true }).ok).toBe(true);
    expect(validateClientMessage({ type: 'PLAYER_READY', ready: 'true' }).ok).toBe(false);
    expect(validateClientMessage({ type: 'PLAYER_READY', ready: 1 }).ok).toBe(false);
    expect(validateClientMessage({ type: 'PLAYER_READY' }).ok).toBe(false);
  });
});
describe('player input validation', () => {
  it('accepts in-range input and floors the sequence number', () => {
    const ok = validateClientMessage({
      type: 'PLAYER_INPUT',
      sequence: 12.7,
      direction: -1,
      isPressed: true,
      source: 'touch',
      absolute: 0.25,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.value.type === 'PLAYER_INPUT') {
      expect(ok.value.sequence).toBe(12);
      expect(ok.value.direction).toBe(-1);
      expect(ok.value.source).toBe('touch');
      expect(ok.value.absolute).toBe(0.25);
    }
  });

  it('never coerces an out-of-range or wrongly typed field', () => {
    const rejected = [
      { type: 'PLAYER_INPUT', sequence: -1, direction: 0, isPressed: false },
      { type: 'PLAYER_INPUT', sequence: Number.NaN, direction: 0, isPressed: false },
      { type: 'PLAYER_INPUT', sequence: Number.POSITIVE_INFINITY, direction: 0, isPressed: false },
      { type: 'PLAYER_INPUT', sequence: '4', direction: 0, isPressed: false },
      { type: 'PLAYER_INPUT', sequence: 1, direction: 5, isPressed: false },
      { type: 'PLAYER_INPUT', sequence: 1, direction: -2, isPressed: false },
      { type: 'PLAYER_INPUT', sequence: 1, direction: '1', isPressed: false },
      { type: 'PLAYER_INPUT', sequence: 1, direction: 0, isPressed: 'yes' },
      { type: 'PLAYER_INPUT', sequence: 1, direction: 0, isPressed: true, absolute: 1.4 },
      { type: 'PLAYER_INPUT', sequence: 1, direction: 0, isPressed: true, absolute: -0.1 },
      { type: 'PLAYER_INPUT', sequence: 1, direction: 0, isPressed: true, absolute: 'half' },
      { type: 'PLAYER_INPUT', sequence: 1, direction: 0, isPressed: true, absolute: Number.NaN },
    ];
    for (const message of rejected) {
      const result = validateClientMessage(message);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('INVALID_MESSAGE');
    }
  });

  it('never lets a client claim the AI input source', () => {
    const result = validateClientMessage({
      type: 'PLAYER_INPUT',
      sequence: 1,
      direction: 1,
      isPressed: true,
      source: 'ai',
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'PLAYER_INPUT') {
      expect(result.value.source).toBe('keyboard');
    }
  });

  it('falls back to a safe source, and to 0 for a bad ping time', () => {
    const input = validateClientMessage({
      type: 'PLAYER_INPUT',
      sequence: 1,
      direction: 0,
      isPressed: false,
      source: 'telepathy',
    });
    expect(input.ok).toBe(true);
    if (input.ok && input.value.type === 'PLAYER_INPUT') {
      expect(input.value.source).toBe('keyboard');
      expect(input.value.absolute).toBeUndefined();
    }
    const ping = validateClientMessage({ type: 'PING', time: 'now' });
    expect(ping.ok).toBe(true);
    if (ping.ok && ping.value.type === 'PING') expect(ping.value.time).toBe(0);
  });

  it('passes the parameterless messages through untouched', () => {
    for (const type of ['LEAVE_ROOM', 'START_MATCH', 'REQUEST_REMATCH', 'RETURN_TO_LOBBY']) {
      const result = validateClientMessage({ type, extra: 'ignored' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ type });
    }
  });
});
describe('frame parsing', () => {
  it('never throws on hostile input', () => {
    expect(parseClientMessage('').ok).toBe(false);
    expect(parseClientMessage('{').ok).toBe(false);
    expect(parseClientMessage('undefined').ok).toBe(false);
    expect(parseClientMessage('{"type":').ok).toBe(false);
    expect(parseClientMessage('[1,2,3]').ok).toBe(false);
    const tooBig = parseClientMessage(JSON.stringify({ type: 'PING', pad: 'x'.repeat(9000) }));
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.message).toBe('Message too large.');
  });

  it('parses a well-formed frame', () => {
    const result = parseClientMessage('{"type":"PING","time":123}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ type: 'PING', time: 123 });
  });
});

describe('rate limiting', () => {
  it('allows a burst up to the bucket capacity then refuses', () => {
    const limiter = new RateLimiter(5, 5, 0);
    for (let i = 0; i < 5; i += 1) expect(limiter.tryConsume(0)).toBe(true);
    expect(limiter.tryConsume(0)).toBe(false);
  });

  it('refills over time without ever banking more than the capacity', () => {
    const limiter = new RateLimiter(4, 4, 0);
    for (let i = 0; i < 4; i += 1) limiter.tryConsume(0);
    expect(limiter.tryConsume(250)).toBe(true); // one token back after 250 ms
    expect(limiter.tryConsume(250)).toBe(false);
    expect(limiter.tryConsume(60_000, 4)).toBe(true); // a long idle caps at 4
    expect(limiter.tryConsume(60_000, 1)).toBe(false);
  });

  it('ignores clocks that move backwards', () => {
    const limiter = new RateLimiter(2, 10, 1000);
    expect(limiter.tryConsume(1000)).toBe(true);
    expect(limiter.tryConsume(0)).toBe(true);
    expect(limiter.tryConsume(0)).toBe(false);
  });

  it('supports a cost greater than one', () => {
    const limiter = new RateLimiter(10, 1, 0);
    expect(limiter.tryConsume(0, 10)).toBe(true);
    expect(limiter.tryConsume(0, 1)).toBe(false);
  });
});
