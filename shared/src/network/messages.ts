import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../constants/index';
import type {
  Difficulty,
  GameMode,
  GameState,
  InputSource,
  MatchPhase,
  MatchSummary,
} from '../types/index';

/* ----------------------------------------------------------- client -> server */

export interface RoomOptions {
  maxPlayers: number;
  mode: GameMode;
  lives: number;
  powerUps: boolean;
  isPrivate: boolean;
  shrinkEnabled: boolean;
}

export interface CreateRoomMessage {
  type: 'CREATE_ROOM';
  name: string;
  options: RoomOptions;
}
export interface JoinRoomMessage {
  type: 'JOIN_ROOM';
  code: string;
  name: string;
  /** Token from a previous session, used to reclaim a seat after a drop. */
  reconnectToken?: string;
}
export interface LeaveRoomMessage {
  type: 'LEAVE_ROOM';
}
export interface PlayerReadyMessage {
  type: 'PLAYER_READY';
  ready: boolean;
}
export interface StartMatchMessage {
  type: 'START_MATCH';
}
export interface PlayerInputMessage {
  type: 'PLAYER_INPUT';
  sequence: number;
  direction: -1 | 0 | 1;
  isPressed: boolean;
  source: InputSource;
  absolute?: number;
}
export interface RequestRematchMessage {
  type: 'REQUEST_REMATCH';
}
export interface ReturnToLobbyMessage {
  type: 'RETURN_TO_LOBBY';
}
export interface PingMessage {
  type: 'PING';
  time: number;
}

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | PlayerReadyMessage
  | StartMatchMessage
  | PlayerInputMessage
  | RequestRematchMessage
  | ReturnToLobbyMessage
  | PingMessage;

export type ClientMessageType = ClientMessage['type'];

export const CLIENT_MESSAGE_TYPES: readonly ClientMessageType[] = [
  'CREATE_ROOM',
  'JOIN_ROOM',
  'LEAVE_ROOM',
  'PLAYER_READY',
  'START_MATCH',
  'PLAYER_INPUT',
  'REQUEST_REMATCH',
  'RETURN_TO_LOBBY',
  'PING',
];

/* ----------------------------------------------------------- server -> client */

export interface LobbyPlayer {
  id: string;
  name: string;
  number: number;
  colorIndex: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  isAI: boolean;
}

export interface RoomSnapshot {
  code: string;
  status: 'lobby' | 'countdown' | 'playing' | 'finished';
  hostId: string;
  options: RoomOptions;
  players: LobbyPlayer[];
}

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_CLOSED'
  | 'ALREADY_STARTED'
  | 'INVALID_MESSAGE'
  | 'INVALID_NAME'
  | 'INVALID_CODE'
  | 'NOT_HOST'
  | 'NOT_IN_ROOM'
  | 'NOT_ENOUGH_PLAYERS'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR';

export type ServerMessage =
  | { type: 'ROOM_CREATED'; room: RoomSnapshot; playerId: string; reconnectToken: string }
  | { type: 'ROOM_JOINED'; room: RoomSnapshot; playerId: string; reconnectToken: string }
  | { type: 'ROOM_STATE'; room: RoomSnapshot }
  | { type: 'PLAYER_JOINED'; player: LobbyPlayer }
  | { type: 'PLAYER_LEFT'; playerId: string; reason: 'left' | 'disconnected' | 'kicked' }
  | { type: 'MATCH_STARTING'; countdown: number; seed: number }
  | { type: 'GAME_STATE'; serverTick: number; state: GameState }
  | { type: 'PLAYER_HIT'; playerId: string; x: number; y: number; perfect: boolean }
  | { type: 'PLAYER_DAMAGED'; playerId: string; livesLeft: number; x: number; y: number }
  | { type: 'PLAYER_ELIMINATED'; playerId: string; placement: number; byPlayerId: string | null }
  | { type: 'ARENA_WARNING'; targetScale: number }
  | { type: 'PHASE_CHANGED'; phase: MatchPhase }
  | { type: 'MATCH_ENDED'; summary: MatchSummary }
  | { type: 'ERROR'; code: ErrorCode; message: string }
  | { type: 'PONG'; time: number; serverTime: number };

export type ServerMessageType = ServerMessage['type'];

/* ------------------------------------------------------------------ helpers */

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  maxPlayers: 6,
  mode: 'survival',
  lives: 3,
  powerUps: false,
  isPrivate: false,
  shrinkEnabled: true,
};

export const DEFAULT_DIFFICULTY: Difficulty = 'medium';

/** Uppercase and strip anything that is not in the room-code alphabet. */
export function normalizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[ILO]/g, (c) => (c === 'I' ? '1' : c === 'L' ? '1' : '0'))
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const code = raw.toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const char of code) {
    if (!ROOM_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

/**
 * Room code from an injected random source. 31^6 ~= 887 million combinations,
 * which makes guessing a live private room impractical.
 */
export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const index = Math.min(
      ROOM_CODE_ALPHABET.length - 1,
      Math.floor(random() * ROOM_CODE_ALPHABET.length),
    );
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}
