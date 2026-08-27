import {
  generateRoomCode,
  normalizeRoomCode,
  type ClientMessage,
  type RoomOptions,
  type ServerMessage,
} from '@polyball/shared';
import type { WebSocket } from 'ws';
import { Room } from './room';

interface SocketSession {
  roomCode: string;
  playerId?: string;
}

const sendJson = (socket: WebSocket, message: ServerMessage): void => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly socketSessions = new Map<WebSocket, SocketSession>();

  get roomCount(): number {
    return this.rooms.size;
  }

  get totalPlayerCount(): number {
    let count = 0;
    for (const room of this.rooms.values()) {
      count += room.connectedPlayerCount;
    }
    return count;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(normalizeRoomCode(code));
  }

  createRoom(hostSocket: WebSocket, hostName: string, options: Partial<RoomOptions> = {}): Room {
    // Leave previous room if already in one
    this.handleSocketDisconnect(hostSocket);

    let code = generateRoomCode();
    let attempts = 0;
    while (this.rooms.has(code) && attempts < 20) {
      code = generateRoomCode();
      attempts++;
    }

    const room = new Room(code, hostName, hostSocket, options);
    room.onEmpty = (r) => {
      this.rooms.delete(r.code);
    };

    this.rooms.set(code, room);
    this.socketSessions.set(hostSocket, {
      roomCode: code,
      playerId: room.hostId,
    });

    return room;
  }

  joinRoom(socket: WebSocket, rawCode: string, name: string, reconnectToken?: string): boolean {
    const code = normalizeRoomCode(rawCode);
    const room = this.rooms.get(code);

    if (!room) {
      sendJson(socket, {
        type: 'ERROR',
        code: 'ROOM_NOT_FOUND',
        message: `Room ${code} does not exist.`,
      });
      return false;
    }

    // Leave previous room if already in one
    this.handleSocketDisconnect(socket);

    const result = room.join(socket, name, reconnectToken);
    if (!result.ok) {
      sendJson(socket, {
        type: 'ERROR',
        code: 'ROOM_CLOSED',
        message: result.error ?? 'Could not join room.',
      });
      return false;
    }

    // Find the player id for session mapping
    let playerId: string | undefined;
    for (const player of room.players.values()) {
      if (player.socket === socket) {
        playerId = player.id;
        break;
      }
    }

    this.socketSessions.set(socket, {
      roomCode: code,
      playerId,
    });

    return true;
  }

  handleMessage(socket: WebSocket, message: ClientMessage): void {
    if (message.type === 'PING') {
      sendJson(socket, {
        type: 'PONG',
        time: message.time,
        serverTime: Date.now(),
      });
      return;
    }

    if (message.type === 'CREATE_ROOM') {
      this.createRoom(socket, message.name, message.options);
      return;
    }

    if (message.type === 'JOIN_ROOM') {
      this.joinRoom(socket, message.code, message.name, message.reconnectToken);
      return;
    }

    const session = this.socketSessions.get(socket);
    if (!session) {
      sendJson(socket, {
        type: 'ERROR',
        code: 'NOT_IN_ROOM',
        message: 'You are not in a room.',
      });
      return;
    }

    const room = this.rooms.get(session.roomCode);
    if (!room) {
      this.socketSessions.delete(socket);
      sendJson(socket, {
        type: 'ERROR',
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found.',
      });
      return;
    }

    switch (message.type) {
      case 'LEAVE_ROOM': {
        if (session.playerId) {
          room.leave(session.playerId);
        } else {
          room.handleDisconnect(socket);
        }
        this.socketSessions.delete(socket);
        break;
      }

      case 'PLAYER_READY': {
        if (session.playerId) {
          room.setReady(session.playerId, message.ready);
        }
        break;
      }

      case 'START_MATCH': {
        if (session.playerId) {
          const result = room.startMatch(session.playerId);
          if (!result.ok) {
            sendJson(socket, {
              type: 'ERROR',
              code: result.code ?? 'INVALID_MESSAGE',
              message: result.message ?? 'Cannot start match.',
            });
          }
        }
        break;
      }

      case 'PLAYER_INPUT': {
        if (session.playerId) {
          room.handleInput(session.playerId, message);
        }
        break;
      }

      case 'REQUEST_REMATCH': {
        if (session.playerId) {
          room.requestRematch(session.playerId);
        }
        break;
      }

      case 'RETURN_TO_LOBBY': {
        room.returnToLobby();
        break;
      }

      default:
        break;
    }
  }

  handleSocketDisconnect(socket: WebSocket): void {
    const session = this.socketSessions.get(socket);
    if (!session) return;

    this.socketSessions.delete(socket);
    const room = this.rooms.get(session.roomCode);
    if (room) {
      room.handleDisconnect(socket);
    }
  }
}
