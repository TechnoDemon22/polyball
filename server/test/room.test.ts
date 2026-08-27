import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { Room } from '../src/room';
import { RoomManager } from '../src/room-manager';
import type { ServerMessage } from '@polyball/shared';

interface MockWebSocket extends WebSocket {
  _sent: ServerMessage[];
}

function createMockSocket(): MockWebSocket {
  const sent: ServerMessage[] = [];
  const socket = {
    readyState: 1, // OPEN
    OPEN: 1,
    CLOSED: 3,
    send: vi.fn((data: string) => {
      sent.push(JSON.parse(data) as ServerMessage);
    }),
    close: vi.fn(),
    terminate: vi.fn(),
    _sent: sent,
  } as unknown as MockWebSocket;
  return socket;
}

const getSent = (socket: WebSocket): ServerMessage[] => (socket as MockWebSocket)._sent;

describe('Room Management', () => {
  it('creates a room with a host and default options', () => {
    const hostSocket = createMockSocket();
    const room = new Room('TEST01', 'HostPlayer', hostSocket, { lives: 3 });

    expect(room.code).toBe('TEST01');
    expect(room.playerCount).toBe(1);
    expect(room.status).toBe('lobby');

    const sent = getSent(hostSocket);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0].type).toBe('ROOM_CREATED');
    if (sent[0].type === 'ROOM_CREATED') {
      expect(sent[0].room.code).toBe('TEST01');
      expect(sent[0].room.players.length).toBe(1);
      expect(sent[0].room.players[0].name).toBe('HostPlayer');
      expect(sent[0].room.players[0].isHost).toBe(true);
      expect(sent[0].playerId).toBeDefined();
      expect(sent[0].reconnectToken).toBeDefined();
    }
  });

  it('allows a second player to join and ready up', () => {
    const hostSocket = createMockSocket();
    const guestSocket = createMockSocket();
    const room = new Room('TEST02', 'Host', hostSocket);

    const joinResult = room.join(guestSocket, 'Guest');
    expect(joinResult.ok).toBe(true);
    expect(room.playerCount).toBe(2);

    const guestSent = getSent(guestSocket);
    expect(guestSent.some((m) => m.type === 'ROOM_JOINED')).toBe(true);

    const guestId = Array.from(room.players.values()).find((p) => p.name === 'Guest')!.id;
    room.setReady(guestId, true);

    const snapshot = room.getSnapshot();
    const guestPlayer = snapshot.players.find((p) => p.id === guestId);
    expect(guestPlayer?.ready).toBe(true);
  });

  it('validates start match requirements and starts simulation loop', () => {
    const hostSocket = createMockSocket();
    const guestSocket = createMockSocket();
    const room = new Room('TEST03', 'Host', hostSocket);

    // Host cannot start match alone
    const soloStart = room.startMatch(room.hostId);
    expect(soloStart.ok).toBe(false);

    room.join(guestSocket, 'Guest');
    const guestId = Array.from(room.players.values()).find((p) => p.name === 'Guest')!.id;

    // Cannot start if guest is not ready
    const notReadyStart = room.startMatch(room.hostId);
    expect(notReadyStart.ok).toBe(false);

    // Guest readies up
    room.setReady(guestId, true);

    // Guest cannot trigger start match (only host)
    const guestTrigger = room.startMatch(guestId);
    expect(guestTrigger.ok).toBe(false);
    expect(guestTrigger.code).toBe('NOT_HOST');

    // Host starts match
    const validStart = room.startMatch(room.hostId);
    expect(validStart.ok).toBe(true);
    expect(room.status).toBe('countdown');
    expect(room.engine).toBeDefined();

    // Check broadcast of MATCH_STARTING
    const hostSent = getSent(hostSocket);
    expect(hostSent.some((m) => m.type === 'MATCH_STARTING')).toBe(true);

    room.destroy();
  });

  it('supports reconnection via reconnectToken', () => {
    const hostSocket = createMockSocket();
    const room = new Room('TEST04', 'Host', hostSocket);

    const hostToken = Array.from(room.players.values())[0].reconnectToken;

    // Simulate drop
    room.handleDisconnect(hostSocket);

    // New socket reconnects
    const newSocket = createMockSocket();
    const reconnectResult = room.join(newSocket, 'Host', hostToken);

    expect(reconnectResult.ok).toBe(true);
    expect(room.connectedPlayerCount).toBe(1);

    const sent = getSent(newSocket);
    expect(sent.some((m) => m.type === 'ROOM_JOINED')).toBe(true);

    room.destroy();
  });

  it('adds late joiners as spectators during an active match', () => {
    const hostSocket = createMockSocket();
    const guestSocket = createMockSocket();
    const room = new Room('TEST05', 'Host', hostSocket);
    room.join(guestSocket, 'Guest');

    const guestId = Array.from(room.players.values()).find((p) => p.name === 'Guest')!.id;
    room.setReady(guestId, true);
    room.startMatch(room.hostId);

    const lateSocket = createMockSocket();
    const lateJoin = room.join(lateSocket, 'LateSpectator');

    expect(lateJoin.ok).toBe(true);
    expect(room.spectators.has(lateSocket)).toBe(true);

    const sent = getSent(lateSocket);
    expect(sent.some((m) => m.type === 'ROOM_JOINED')).toBe(true);
    expect(sent.some((m) => m.type === 'GAME_STATE')).toBe(true);

    room.destroy();
  });

  it('processes player inputs into the simulation engine', () => {
    const hostSocket = createMockSocket();
    const guestSocket = createMockSocket();
    const room = new Room('TEST06', 'Host', hostSocket);
    room.join(guestSocket, 'Guest');

    const guestId = Array.from(room.players.values()).find((p) => p.name === 'Guest')!.id;
    room.setReady(guestId, true);
    room.startMatch(room.hostId);

    room.handleInput(room.hostId, {
      type: 'PLAYER_INPUT',
      sequence: 1,
      direction: 1,
      isPressed: true,
      source: 'keyboard',
    });

    expect(room.engine).toBeDefined();
    // Simulate one step
    room.engine?.step(0.016);

    const hostPlayerState = room.engine?.state.players.find((p) => p.id === room.hostId);
    expect(hostPlayerState).toBeDefined();

    room.destroy();
  });
});

describe('RoomManager', () => {
  it('creates and joins rooms via client messages', () => {
    const manager = new RoomManager();
    const hostSocket = createMockSocket();
    const guestSocket = createMockSocket();

    manager.handleMessage(hostSocket, {
      type: 'CREATE_ROOM',
      name: 'Alice',
      options: {
        maxPlayers: 4,
        mode: 'survival',
        lives: 3,
        powerUps: false,
        isPrivate: false,
        shrinkEnabled: true,
      },
    });

    expect(manager.roomCount).toBe(1);
    const room = Array.from(manager.rooms.values())[0];
    expect(room).toBeDefined();

    manager.handleMessage(guestSocket, {
      type: 'JOIN_ROOM',
      code: room.code,
      name: 'Bob',
    });

    expect(room.playerCount).toBe(2);

    room.destroy();
  });
});
