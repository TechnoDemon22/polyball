import {
  HEARTBEAT_INTERVAL,
  type ClientMessage,
  type ErrorCode,
  type GameState,
  type LobbyPlayer,
  type MatchPhase,
  type MatchSummary,
  type PlayerInput,
  type RoomOptions,
  type RoomSnapshot,
  type ServerMessage,
} from '@polyball/shared';

const SESSION_STORAGE_KEY = 'polyball.session.v1';

export interface NetworkSessionData {
  roomCode: string;
  reconnectToken: string;
  playerName: string;
}

let memorySession: NetworkSessionData | null = null;

export function saveSession(data: NetworkSessionData): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
      return;
    }
  } catch {
    // Ignore in private browsing
  }
  memorySession = data;
}

export function loadSession(): NetworkSessionData | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as NetworkSessionData;
    }
  } catch {
    // Ignore
  }
  return memorySession;
}

export function clearSession(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
  memorySession = null;
}

export function resolveWsUrl(customOverride?: string): string {
  if (customOverride && customOverride.trim() !== '') {
    return customOverride.trim();
  }

  try {
    const saved =
      typeof window !== 'undefined' ? window.localStorage.getItem('polyball.serverUrl') : null;
    if (saved && saved.trim() !== '') {
      return saved.trim();
    }
  } catch {
    // Ignore
  }

  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() !== '') {
    return envUrl.trim();
  }

  if (typeof window === 'undefined') return 'ws://localhost:8080';

  const isHttps = window.location.protocol === 'https:';
  const proto = isHttps ? 'wss:' : 'ws:';
  const host = window.location.hostname;

  // In development on localhost with Vite on port 5173, backend defaults to 8080
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${proto}//${host}:8080`;
  }

  // Otherwise, use same host with appropriate port or default
  const port = window.location.port ? `:${window.location.port}` : '';
  return `${proto}//${host}${port}`;
}

export type NetworkEventMap = {
  connected: () => void;
  disconnected: (reason?: string) => void;
  reconnecting: () => void;
  roomCreated: (room: RoomSnapshot, playerId: string, reconnectToken: string) => void;
  roomJoined: (room: RoomSnapshot, playerId: string, reconnectToken: string) => void;
  roomState: (room: RoomSnapshot) => void;
  playerJoined: (player: LobbyPlayer) => void;
  playerLeft: (playerId: string, reason: string) => void;
  matchStarting: (countdown: number, seed: number) => void;
  gameState: (serverTick: number, state: GameState) => void;
  playerHit: (playerId: string, x: number, y: number, perfect: boolean) => void;
  playerDamaged: (playerId: string, livesLeft: number, x: number, y: number) => void;
  playerEliminated: (playerId: string, placement: number, byPlayerId: string | null) => void;
  arenaWarning: (targetScale: number) => void;
  phaseChanged: (phase: MatchPhase) => void;
  matchEnded: (summary: MatchSummary) => void;
  error: (code: ErrorCode | 'SERVER_UNREACHABLE', message: string) => void;
  ping: (pingMs: number) => void;
};

type Listener<K extends keyof NetworkEventMap> = NetworkEventMap[K];
type AnyListener = (...args: never[]) => void;

export class NetworkClient {
  private socket: WebSocket | null = null;
  private url: string;
  private listeners = new Map<keyof NetworkEventMap, Set<AnyListener>>();
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectTimeout: NodeJS.Timeout | null = null;
  private shouldReconnect = false;
  private pendingRoomAction: (() => void) | null = null;
  private lastPingSent = 0;
  private currentPingMs = 0;
  private lastPlayerName = 'Player';

  activeRoom: RoomSnapshot | null = null;
  localPlayerId: string | null = null;
  reconnectToken: string | null = null;

  constructor(url = resolveWsUrl()) {
    this.url = url;
  }

  updateUrl(url: string): void {
    if (url && url !== this.url) {
      this.url = url;
      if (this.socket) {
        this.disconnect();
      }
    }
  }

  get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  get pingMs(): number {
    return this.currentPingMs;
  }

  on<K extends keyof NetworkEventMap>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const erased = listener as unknown as AnyListener;
    set.add(erased);
    return () => set?.delete(erased);
  }

  private emit<K extends keyof NetworkEventMap>(
    event: K,
    ...args: Parameters<NetworkEventMap[K]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        (listener as (...a: unknown[]) => void)(...args);
      } catch (err) {
        console.error(`Error in NetworkClient listener for ${event}:`, err);
      }
    }
  }

  connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.shouldReconnect = true;
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
    }

    // Set connection timeout for pending room actions
    this.connectTimeout = setTimeout(() => {
      if (!this.isConnected && this.pendingRoomAction) {
        this.pendingRoomAction = null;
        this.emit(
          'error',
          'SERVER_UNREACHABLE',
          'Cannot connect to multiplayer server. If playing on GitHub Pages, set a Server URL in Settings.',
        );
      }
    }, 4500);

    try {
      const ws = new WebSocket(this.url);
      this.socket = ws;

      ws.onopen = () => {
        if (this.connectTimeout) {
          clearTimeout(this.connectTimeout);
          this.connectTimeout = null;
        }
        this.emit('connected');
        this.startHeartbeat();
        if (this.pendingRoomAction) {
          const action = this.pendingRoomAction;
          this.pendingRoomAction = null;
          action();
        }
      };

      ws.onmessage = (event) => {
        this.handleRawMessage(event.data);
      };

      ws.onclose = () => {
        this.stopHeartbeat();
        this.emit('disconnected');
        if (this.pendingRoomAction) {
          this.pendingRoomAction = null;
          this.emit(
            'error',
            'SERVER_UNREACHABLE',
            'Cannot connect to multiplayer server. Please check your network or server URL.',
          );
        }
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      ws.onerror = () => {
        if (this.pendingRoomAction) {
          this.pendingRoomAction = null;
          this.emit(
            'error',
            'SERVER_UNREACHABLE',
            'Multiplayer server unreachable. Ensure the backend server is running.',
          );
        }
      };
    } catch {
      if (this.pendingRoomAction) {
        this.pendingRoomAction = null;
        this.emit('error', 'SERVER_UNREACHABLE', 'Invalid WebSocket server URL.');
      }
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.activeRoom = null;
    this.localPlayerId = null;
    this.reconnectToken = null;
    clearSession();
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimeout) return;
    this.emit('reconnecting');
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.shouldReconnect) {
        this.connect();
      }
    }, 2000);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.isConnected) {
        this.lastPingSent = performance.now();
        this.send({ type: 'PING', time: this.lastPingSent });
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  send(message: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  createRoom(name: string, options: RoomOptions): void {
    this.lastPlayerName = name;
    const action = () => {
      this.send({
        type: 'CREATE_ROOM',
        name,
        options,
      });
    };

    if (this.isConnected) {
      action();
    } else {
      this.pendingRoomAction = action;
      this.connect();
    }
  }

  joinRoom(code: string, name: string, reconnectToken?: string): void {
    this.lastPlayerName = name;
    const action = () => {
      this.send({
        type: 'JOIN_ROOM',
        code,
        name,
        ...(reconnectToken ? { reconnectToken } : {}),
      });
    };

    if (this.isConnected) {
      action();
    } else {
      this.pendingRoomAction = action;
      this.connect();
    }
  }

  leaveRoom(): void {
    this.send({ type: 'LEAVE_ROOM' });
    this.activeRoom = null;
    this.localPlayerId = null;
    this.reconnectToken = null;
    clearSession();
  }

  setReady(ready: boolean): void {
    this.send({ type: 'PLAYER_READY', ready });
  }

  startMatch(): void {
    this.send({ type: 'START_MATCH' });
  }

  sendInput(input: PlayerInput): void {
    this.send({
      type: 'PLAYER_INPUT',
      sequence: input.sequence ?? 0,
      direction: input.direction,
      isPressed: input.isPressed,
      source: input.source,
      ...(input.absolute !== undefined ? { absolute: input.absolute } : {}),
    });
  }

  requestRematch(): void {
    this.send({ type: 'REQUEST_REMATCH' });
  }

  returnToLobby(): void {
    this.send({ type: 'RETURN_TO_LOBBY' });
  }

  private handleRawMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    try {
      const msg: ServerMessage = JSON.parse(raw);
      this.handleServerMessage(msg);
    } catch (err) {
      console.error('Failed to parse server message:', err);
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'PONG': {
        if (this.lastPingSent > 0) {
          this.currentPingMs = Math.max(0, Math.round(performance.now() - this.lastPingSent));
          this.emit('ping', this.currentPingMs);
        }
        break;
      }

      case 'ROOM_CREATED': {
        this.activeRoom = msg.room;
        this.localPlayerId = msg.playerId;
        this.reconnectToken = msg.reconnectToken;
        saveSession({
          roomCode: msg.room.code,
          reconnectToken: msg.reconnectToken,
          playerName: this.lastPlayerName,
        });
        this.emit('roomCreated', msg.room, msg.playerId, msg.reconnectToken);
        break;
      }

      case 'ROOM_JOINED': {
        this.activeRoom = msg.room;
        this.localPlayerId = msg.playerId;
        this.reconnectToken = msg.reconnectToken;
        saveSession({
          roomCode: msg.room.code,
          reconnectToken: msg.reconnectToken,
          playerName: this.lastPlayerName,
        });
        this.emit('roomJoined', msg.room, msg.playerId, msg.reconnectToken);
        break;
      }

      case 'ROOM_STATE': {
        this.activeRoom = msg.room;
        this.emit('roomState', msg.room);
        break;
      }

      case 'PLAYER_JOINED': {
        if (this.activeRoom) {
          const idx = this.activeRoom.players.findIndex((p) => p.id === msg.player.id);
          if (idx >= 0) this.activeRoom.players[idx] = msg.player;
          else this.activeRoom.players.push(msg.player);
        }
        this.emit('playerJoined', msg.player);
        break;
      }

      case 'PLAYER_LEFT': {
        if (this.activeRoom) {
          this.activeRoom.players = this.activeRoom.players.filter((p) => p.id !== msg.playerId);
        }
        this.emit('playerLeft', msg.playerId, msg.reason);
        break;
      }

      case 'MATCH_STARTING': {
        if (this.activeRoom) {
          this.activeRoom.status = 'countdown';
        }
        this.emit('matchStarting', msg.countdown, msg.seed);
        break;
      }

      case 'GAME_STATE': {
        this.emit('gameState', msg.serverTick, msg.state);
        break;
      }

      case 'PLAYER_HIT': {
        this.emit('playerHit', msg.playerId, msg.x, msg.y, msg.perfect);
        break;
      }

      case 'PLAYER_DAMAGED': {
        this.emit('playerDamaged', msg.playerId, msg.livesLeft, msg.x, msg.y);
        break;
      }

      case 'PLAYER_ELIMINATED': {
        this.emit('playerEliminated', msg.playerId, msg.placement, msg.byPlayerId);
        break;
      }

      case 'ARENA_WARNING': {
        this.emit('arenaWarning', msg.targetScale);
        break;
      }

      case 'PHASE_CHANGED': {
        this.emit('phaseChanged', msg.phase);
        break;
      }

      case 'MATCH_ENDED': {
        this.emit('matchEnded', msg.summary);
        break;
      }

      case 'ERROR': {
        this.emit('error', msg.code, msg.message);
        break;
      }
    }
  }
}
