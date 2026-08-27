import { describe, expect, it, beforeEach } from 'vitest';
import { parseRoute } from '../src/router';
import {
  clearSession,
  loadSession,
  resolveWsUrl,
  saveSession,
  type NetworkSessionData,
} from '../src/game/network';

describe('Router', () => {
  it('parses room routes accurately', () => {
    expect(parseRoute('/room/ABC234')).toEqual({ name: 'room', code: 'ABC234' });
    expect(parseRoute('/join/XYZ789')).toEqual({ name: 'join', code: 'XYZ789' });
    expect(parseRoute('/practice')).toEqual({ name: 'practice' });
    expect(parseRoute('/')).toEqual({ name: 'landing' });
  });

  it('rejects invalid room codes and falls back to landing', () => {
    expect(parseRoute('/join/INVALID_CODE_TOO_LONG_12345')).toEqual({ name: 'landing' });
    expect(parseRoute('/room/1')).toEqual({ name: 'landing' });
  });
});

describe('Network Session Persistence', () => {
  beforeEach(() => {
    clearSession();
  });

  it('saves, loads and clears session storage data', () => {
    const data: NetworkSessionData = {
      roomCode: 'PLAY99',
      reconnectToken: 'token_abc_123',
      playerName: 'Alice',
    };

    saveSession(data);
    const loaded = loadSession();
    expect(loaded).toEqual(data);

    clearSession();
    expect(loadSession()).toBeNull();
  });
});

describe('Network URL Resolver', () => {
  it('returns valid websocket url', () => {
    const url = resolveWsUrl();
    expect(url.startsWith('ws://') || url.startsWith('wss://')).toBe(true);
  });
});
