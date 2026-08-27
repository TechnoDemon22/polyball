import crypto from 'node:crypto';
import {
  COUNTDOWN_SECONDS,
  DEFAULT_ROOM_OPTIONS,
  FIXED_DT,
  GameEngine,
  MIN_PLAYERS,
  RECONNECT_WINDOW,
  SNAPSHOT_RATE,
  type ErrorCode,
  type GameEvent,
  type LobbyPlayer,
  type MatchConfig,
  type MatchSummary,
  type PlayerInputMessage,
  type PlayerSeed,
  type RoomOptions,
  type RoomSnapshot,
  type ServerMessage,
} from '@polyball/shared';
import type { WebSocket } from 'ws';

export interface RoomMember {
  id: string;
  name: string;
  number: number;
  colorIndex: number;
  ready: boolean;
  socket: WebSocket | null;
  reconnectToken: string;
  disconnectedAt: number | null;
  lastInputSequence: number;
  isAI: boolean;
}

const sendJson = (socket: WebSocket, message: ServerMessage): void => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

export class Room {
  readonly code: string;
  readonly createdAt = Date.now();
  hostId: string;
  options: RoomOptions;
  status: 'lobby' | 'countdown' | 'playing' | 'finished' = 'lobby';

  readonly players = new Map<string, RoomMember>();
  readonly spectators = new Set<WebSocket>();

  engine: GameEngine | null = null;
  summary: MatchSummary | null = null;

  private tickInterval: NodeJS.Timeout | null = null;
  private snapshotInterval: NodeJS.Timeout | null = null;
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private matchSeed = 0;
  private nextPlayerNumber = 1;

  onEmpty?: (room: Room) => void;

  constructor(
    code: string,
    hostName: string,
    hostSocket: WebSocket,
    options: Partial<RoomOptions> = {},
  ) {
    this.code = code;
    this.options = { ...DEFAULT_ROOM_OPTIONS, ...options };

    const hostId = `p_${crypto.randomBytes(6).toString('hex')}`;
    const reconnectToken = crypto.randomBytes(24).toString('hex');
    this.hostId = hostId;

    const hostMember: RoomMember = {
      id: hostId,
      name: hostName,
      number: this.nextPlayerNumber++,
      colorIndex: 0,
      ready: true, // Host is ready by default
      socket: hostSocket,
      reconnectToken,
      disconnectedAt: null,
      lastInputSequence: 0,
      isAI: false,
    };

    this.players.set(hostId, hostMember);

    sendJson(hostSocket, {
      type: 'ROOM_CREATED',
      room: this.getSnapshot(),
      playerId: hostId,
      reconnectToken,
    });
  }

  get playerCount(): number {
    return this.players.size;
  }

  get connectedPlayerCount(): number {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.socket && player.socket.readyState === player.socket.OPEN) {
        count += 1;
      }
    }
    return count;
  }

  getSnapshot(): RoomSnapshot {
    const playerSnapshots: LobbyPlayer[] = Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      number: p.number,
      colorIndex: p.colorIndex,
      ready: p.ready,
      connected: p.socket !== null && p.socket.readyState === p.socket.OPEN,
      isHost: p.id === this.hostId,
      isAI: p.isAI,
    }));

    return {
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      options: { ...this.options },
      players: playerSnapshots,
    };
  }

  /**
   * Broadcast message to all room players and spectators.
   */
  broadcast(message: ServerMessage, excludeSocket?: WebSocket): void {
    const payload = JSON.stringify(message);

    for (const player of this.players.values()) {
      if (
        player.socket &&
        player.socket !== excludeSocket &&
        player.socket.readyState === player.socket.OPEN
      ) {
        player.socket.send(payload);
      }
    }

    for (const spectator of this.spectators) {
      if (spectator !== excludeSocket && spectator.readyState === spectator.OPEN) {
        spectator.send(payload);
      }
    }
  }

  /**
   * Add or reconnect a player to this room.
   */
  join(socket: WebSocket, name: string, reconnectToken?: string): { ok: boolean; error?: string } {
    // 1. Check if this is a reconnection with a valid token
    if (reconnectToken) {
      for (const player of this.players.values()) {
        if (player.reconnectToken === reconnectToken) {
          // Clear any pending disconnect grace timer
          const existingTimer = this.reconnectTimers.get(player.id);
          if (existingTimer) {
            clearTimeout(existingTimer);
            this.reconnectTimers.delete(player.id);
          }

          player.socket = socket;
          player.disconnectedAt = null;
          player.name = name || player.name;

          sendJson(socket, {
            type: 'ROOM_JOINED',
            room: this.getSnapshot(),
            playerId: player.id,
            reconnectToken: player.reconnectToken,
          });

          // If a match is active, send latest game state snapshot immediately
          if (this.engine) {
            sendJson(socket, {
              type: 'GAME_STATE',
              serverTick: this.engine.state.tick,
              state: this.engine.state,
            });
          }

          this.broadcast(
            {
              type: 'ROOM_STATE',
              room: this.getSnapshot(),
            },
            socket,
          );

          return { ok: true };
        }
      }
    }

    // 2. If match is active or room is full, join as spectator
    if (this.status !== 'lobby' || this.players.size >= this.options.maxPlayers) {
      this.spectators.add(socket);

      const spectatorId = `spec_${crypto.randomBytes(4).toString('hex')}`;
      const dummyToken = crypto.randomBytes(16).toString('hex');

      sendJson(socket, {
        type: 'ROOM_JOINED',
        room: this.getSnapshot(),
        playerId: spectatorId,
        reconnectToken: dummyToken,
      });

      if (this.engine) {
        sendJson(socket, {
          type: 'GAME_STATE',
          serverTick: this.engine.state.tick,
          state: this.engine.state,
        });
      }

      return { ok: true };
    }

    // 3. New player joining lobby
    const playerId = `p_${crypto.randomBytes(6).toString('hex')}`;
    const token = crypto.randomBytes(24).toString('hex');

    // Pick next available color index (0..11)
    const usedColors = new Set(Array.from(this.players.values()).map((p) => p.colorIndex));
    let colorIndex = 0;
    for (let i = 0; i < 12; i++) {
      if (!usedColors.has(i)) {
        colorIndex = i;
        break;
      }
    }

    const newMember: RoomMember = {
      id: playerId,
      name,
      number: this.nextPlayerNumber++,
      colorIndex,
      ready: false,
      socket,
      reconnectToken: token,
      disconnectedAt: null,
      lastInputSequence: 0,
      isAI: false,
    };

    this.players.set(playerId, newMember);

    sendJson(socket, {
      type: 'ROOM_JOINED',
      room: this.getSnapshot(),
      playerId,
      reconnectToken: token,
    });

    const lobbyPlayer: LobbyPlayer = {
      id: newMember.id,
      name: newMember.name,
      number: newMember.number,
      colorIndex: newMember.colorIndex,
      ready: newMember.ready,
      connected: true,
      isHost: false,
      isAI: false,
    };

    this.broadcast({ type: 'PLAYER_JOINED', player: lobbyPlayer }, socket);
    this.broadcast({ type: 'ROOM_STATE', room: this.getSnapshot() });

    return { ok: true };
  }

  /**
   * Handle socket disconnection.
   */
  handleDisconnect(socket: WebSocket): void {
    // Check if spectator
    if (this.spectators.has(socket)) {
      this.spectators.delete(socket);
      return;
    }

    // Find player by socket
    let leavingPlayer: RoomMember | null = null;
    for (const player of this.players.values()) {
      if (player.socket === socket) {
        leavingPlayer = player;
        break;
      }
    }

    if (!leavingPlayer) return;

    if (this.status === 'lobby') {
      // In lobby, immediately remove player
      this.players.delete(leavingPlayer.id);

      this.broadcast({
        type: 'PLAYER_LEFT',
        playerId: leavingPlayer.id,
        reason: 'left',
      });

      // If host left, reassign host or close room
      if (leavingPlayer.id === this.hostId) {
        const remaining = Array.from(this.players.values());
        if (remaining.length > 0) {
          this.hostId = remaining[0].id;
          remaining[0].ready = true;
        }
      }

      this.broadcast({ type: 'ROOM_STATE', room: this.getSnapshot() });

      if (this.players.size === 0) {
        this.destroy();
      }
    } else {
      // In match or finished, give grace period for reconnection
      leavingPlayer.socket = null;
      leavingPlayer.disconnectedAt = Date.now();

      this.broadcast({
        type: 'PLAYER_LEFT',
        playerId: leavingPlayer.id,
        reason: 'disconnected',
      });

      this.broadcast({ type: 'ROOM_STATE', room: this.getSnapshot() });

      const timer = setTimeout(() => {
        this.reconnectTimers.delete(leavingPlayer.id);
        if (leavingPlayer.socket === null) {
          // Dropped completely
          if (this.connectedPlayerCount === 0) {
            this.destroy();
          }
        }
      }, RECONNECT_WINDOW);

      this.reconnectTimers.set(leavingPlayer.id, timer);
    }
  }

  /**
   * Handle explicit leave from a player.
   */
  leave(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    const timer = this.reconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(playerId);
    }

    this.players.delete(playerId);

    this.broadcast({
      type: 'PLAYER_LEFT',
      playerId,
      reason: 'left',
    });

    if (playerId === this.hostId) {
      const remaining = Array.from(this.players.values());
      if (remaining.length > 0) {
        this.hostId = remaining[0].id;
        remaining[0].ready = true;
      }
    }

    this.broadcast({ type: 'ROOM_STATE', room: this.getSnapshot() });

    if (this.players.size === 0) {
      this.destroy();
    }
  }

  setReady(playerId: string, ready: boolean): void {
    if (this.status !== 'lobby') return;
    const player = this.players.get(playerId);
    if (!player) return;

    player.ready = ready;
    this.broadcast({ type: 'ROOM_STATE', room: this.getSnapshot() });
  }

  startMatch(callerId: string): { ok: boolean; code?: ErrorCode; message?: string } {
    if (this.status !== 'lobby') {
      return { ok: false, code: 'ALREADY_STARTED', message: 'Match already in progress.' };
    }

    if (callerId !== this.hostId) {
      return { ok: false, code: 'NOT_HOST', message: 'Only the host can start the match.' };
    }

    if (this.players.size < MIN_PLAYERS) {
      return {
        ok: false,
        code: 'NOT_ENOUGH_PLAYERS',
        message: `At least ${MIN_PLAYERS} players are required to start.`,
      };
    }

    // Check ready state: all non-host players must be ready
    for (const player of this.players.values()) {
      if (player.id !== this.hostId && !player.ready) {
        return {
          ok: false,
          code: 'INVALID_MESSAGE',
          message: 'All players must be ready before starting.',
        };
      }
    }

    this.status = 'countdown';
    this.matchSeed = (Date.now() & 0x7fffffff) >>> 0;
    this.summary = null;

    const playerSeeds: PlayerSeed[] = Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      colorIndex: p.colorIndex,
      isLocal: false,
      isAI: p.isAI,
    }));

    const config: MatchConfig = {
      players: playerSeeds,
      lives: this.options.lives,
      mode: this.options.mode,
      shrinkEnabled: this.options.shrinkEnabled,
      seed: this.matchSeed,
    };

    this.engine = new GameEngine(config);

    this.broadcast({
      type: 'MATCH_STARTING',
      countdown: COUNTDOWN_SECONDS,
      seed: this.matchSeed,
    });

    this.broadcast({ type: 'ROOM_STATE', room: this.getSnapshot() });

    this.startLoops();

    return { ok: true };
  }

  handleInput(playerId: string, inputMsg: PlayerInputMessage): void {
    if (!this.engine) return;
    const player = this.players.get(playerId);
    if (!player) return;

    if (inputMsg.sequence >= player.lastInputSequence) {
      player.lastInputSequence = inputMsg.sequence;
      this.engine.setInput(playerId, {
        direction: inputMsg.direction,
        isPressed: inputMsg.isPressed,
        source: inputMsg.source,
        absolute: inputMsg.absolute,
        sequence: inputMsg.sequence,
      });
    }
  }

  requestRematch(_playerId: string): void {
    if (this.status !== 'finished') return;

    // Reset engine with new seed and start countdown
    this.matchSeed = (Date.now() & 0x7fffffff) >>> 0;
    this.status = 'countdown';
    this.summary = null;

    if (this.engine) {
      this.engine.reset(this.matchSeed);
    }

    this.broadcast({
      type: 'MATCH_STARTING',
      countdown: COUNTDOWN_SECONDS,
      seed: this.matchSeed,
    });

    this.broadcast({ type: 'ROOM_STATE', room: this.getSnapshot() });
    this.startLoops();
  }

  returnToLobby(): void {
    this.stopLoops();
    this.engine = null;
    this.summary = null;
    this.status = 'lobby';

    for (const player of this.players.values()) {
      player.ready = player.id === this.hostId;
    }

    this.broadcast({ type: 'ROOM_STATE', room: this.getSnapshot() });
  }

  private startLoops(): void {
    this.stopLoops();

    // 60 Hz simulation loop
    this.tickInterval = setInterval(
      () => {
        this.simulationStep(FIXED_DT);
      },
      Math.round(FIXED_DT * 1000),
    );

    // 25 Hz snapshot broadcast loop
    this.snapshotInterval = setInterval(
      () => {
        if (this.engine) {
          this.broadcast({
            type: 'GAME_STATE',
            serverTick: this.engine.state.tick,
            state: this.engine.state,
          });
        }
      },
      Math.round(1000 / SNAPSHOT_RATE),
    );
  }

  private stopLoops(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
  }

  private simulationStep(dt: number): void {
    if (!this.engine) return;

    this.engine.step(dt);
    this.status = this.engine.state.status === 'reset' ? 'playing' : this.engine.state.status;

    const events = this.engine.drainEvents();
    for (const event of events) {
      this.handleGameEvent(event);
    }

    if (this.status === 'finished') {
      this.stopLoops();
      // Send one final snapshot
      this.broadcast({
        type: 'GAME_STATE',
        serverTick: this.engine.state.tick,
        state: this.engine.state,
      });
    }
  }

  private handleGameEvent(event: GameEvent): void {
    switch (event.type) {
      case 'HIT':
        this.broadcast({
          type: 'PLAYER_HIT',
          playerId: event.playerId,
          x: event.x,
          y: event.y,
          perfect: event.perfect,
        });
        break;

      case 'DAMAGE':
        this.broadcast({
          type: 'PLAYER_DAMAGED',
          playerId: event.playerId,
          livesLeft: event.livesLeft,
          x: event.x,
          y: event.y,
        });
        break;

      case 'ELIMINATED':
        this.broadcast({
          type: 'PLAYER_ELIMINATED',
          playerId: event.playerId,
          placement: event.placement,
          byPlayerId: event.byPlayerId,
        });
        break;

      case 'ARENA_WARNING':
        this.broadcast({
          type: 'ARENA_WARNING',
          targetScale: event.targetScale,
        });
        break;

      case 'PHASE_CHANGED':
        this.broadcast({
          type: 'PHASE_CHANGED',
          phase: event.phase,
        });
        break;

      case 'MATCH_ENDED':
        this.summary = event.summary;
        this.broadcast({
          type: 'MATCH_ENDED',
          summary: event.summary,
        });
        this.broadcast({ type: 'ROOM_STATE', room: this.getSnapshot() });
        break;

      default:
        break;
    }
  }

  destroy(): void {
    this.stopLoops();

    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    this.onEmpty?.(this);
  }
}
