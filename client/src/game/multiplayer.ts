import {
  clamp01,
  paddleLengthFor,
  paddleStep,
  type Edge,
  type GameState,
  type MatchSummary,
  type PlayerInput,
  type PlayerState,
} from '@polyball/shared';
import type { AudioEngine } from './audio';
import type { HudPlayer, HudSnapshot } from './practice';
import type { NetworkClient } from './network';
import type { Settings } from '../hooks/useSettings';
import { InputController } from '../input/InputController';
import { createCamera, rotationForEdge, updateCamera, type Camera } from '../rendering/camera';
import { Effects } from '../rendering/effects';
import { NO_INSET, type ViewInset } from '../rendering/layout';
import { colorForPlayer, paletteFor } from '../rendering/palette';
import { Renderer } from '../rendering/renderer';

export interface MultiplayerSessionOptions {
  canvas: HTMLCanvasElement;
  network: NetworkClient;
  settings: Settings;
  audio: AudioEngine;
  onHud: (snapshot: HudSnapshot) => void;
  onFinished: (summary: MatchSummary) => void;
}

const toHudPlayer = (player: PlayerState, localId: string | null): HudPlayer => ({
  id: player.id,
  name: player.name,
  colorIndex: player.colorIndex,
  lives: player.lives,
  alive: player.alive,
  isLocal: player.id === localId,
  isAI: player.isAI,
  hits: player.hits,
  placement: player.placement,
});

export class MultiplayerSession {
  readonly network: NetworkClient;
  readonly input: InputController;
  readonly effects = new Effects();

  private readonly options: MultiplayerSessionOptions;
  private readonly renderer: Renderer;
  private readonly camera: Camera = createCamera();
  private settings: Settings;

  private latestState: GameState | null = null;
  private localPredictedPaddlePos: number | null = null;
  private lastSentInput: PlayerInput | null = null;
  private unsubscribers: (() => void)[] = [];

  private frameHandle = 0;
  private lastFrameTime = 0;
  private clock = 0;
  private hudTimer = 0;
  private running = false;
  private summary: MatchSummary | null = null;
  private width = 0;
  private height = 0;
  private inset: ViewInset = NO_INSET;

  constructor(options: MultiplayerSessionOptions) {
    this.options = options;
    this.network = options.network;
    this.settings = options.settings;
    this.renderer = new Renderer(options.canvas);
    this.effects.setEnabled(!options.settings.reducedMotion);

    this.input = new InputController({
      context: () => ({ camera: this.camera, edge: this.localEdge() }),
      onInteract: () => options.audio.unlock(),
    });
    this.input.attachKeyboard();
    this.input.attachPointer(options.canvas);

    this.setupNetworkListeners();
  }

  get state(): GameState | null {
    return this.latestState;
  }

  get localPlayerId(): string | null {
    return this.network.localPlayerId;
  }

  private localPlayer(): PlayerState | undefined {
    if (!this.latestState || !this.localPlayerId) return undefined;
    return this.latestState.players.find((p) => p.id === this.localPlayerId);
  }

  private localEdge(): Edge | undefined {
    const player = this.localPlayer();
    if (!player || !this.latestState) return undefined;
    return this.latestState.arena.edges[player.edgeIndex];
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.effects.setEnabled(!settings.reducedMotion);
    this.options.audio.setEnabled(settings.sound);
  }

  resize(
    width: number,
    height: number,
    dpr = window.devicePixelRatio || 1,
    inset: ViewInset = NO_INSET,
  ): void {
    this.width = width;
    this.height = height;
    this.inset = inset;
    this.renderer.resize(width, height, dpr);
    this.updateCameraNow();
    if (!this.running && this.latestState) this.render();
  }

  private updateCameraNow(): void {
    if (!this.latestState) return;
    const edge = this.localEdge();
    const isPlayer = !!edge && (this.localPlayer()?.alive ?? false);

    // If player is playing, lock rotation so their paddle is at bottom.
    // If spectating, maintain stable view.
    const rotation =
      this.settings.lockCamera && isPlayer
        ? rotationForEdge(edge, this.latestState.arena.center)
        : 0;

    updateCamera(this.camera, {
      width: this.width,
      height: this.height,
      arena: this.latestState.arena,
      rotation,
      inset: this.inset,
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.publishHud(true);
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  dispose(): void {
    this.stop();
    this.input.dispose();
    this.effects.clear();
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  private setupNetworkListeners(): void {
    const { network, options } = this;
    const { audio } = options;

    this.unsubscribers.push(
      network.on('gameState', (_serverTick, state: GameState) => {
        this.latestState = state;
        const local = this.localPlayer();
        if (local) {
          // Reconcile local prediction smoothly
          if (this.localPredictedPaddlePos === null) {
            this.localPredictedPaddlePos = local.paddlePosition;
          } else {
            // Blend lightly towards server
            this.localPredictedPaddlePos =
              this.localPredictedPaddlePos * 0.7 + local.paddlePosition * 0.3;
          }
        }
      }),

      network.on('playerHit', (playerId, x, y, perfect) => {
        const player = this.latestState?.players.find((p) => p.id === playerId);
        const color = colorForPlayer(player?.colorIndex ?? 0);
        this.effects.burst({ x, y }, color, perfect ? 16 : 10, 260);
        this.effects.ring({ x, y }, color, 6, 360, 2.5, 0.35);
        this.effects.kick(3);
        audio.hit(0.7, perfect);
      }),

      network.on('playerDamaged', (playerId, _livesLeft, x, y) => {
        const player = this.latestState?.players.find((p) => p.id === playerId);
        const color = colorForPlayer(player?.colorIndex ?? 0);
        this.effects.burst({ x, y }, color, 18, 260);
        this.effects.ring({ x, y }, '#fb7185', 8, 520, 4, 0.6);
        this.effects.kick(9);
        audio.damage();
      }),

      network.on('playerEliminated', (playerId) => {
        const player = this.latestState?.players.find((p) => p.id === playerId);
        const edge =
          player && this.latestState ? this.latestState.arena.edges[player.edgeIndex] : undefined;
        if (edge) {
          this.effects.burst(edge.mid, colorForPlayer(player?.colorIndex ?? 0), 30, 320);
          this.effects.ring(edge.mid, '#fb7185', 14, 620, 5, 0.8);
        }
        this.effects.kick(15);
        audio.eliminate();
      }),

      network.on('arenaWarning', () => {
        if (this.latestState) {
          this.effects.ring(this.latestState.arena.center, '#fb7185', 40, 900, 3, 0.7);
        }
        audio.warning();
      }),

      network.on('matchStarting', (countdown) => {
        this.summary = null;
        if (countdown > 0) audio.countdown(countdown);
        else audio.matchStart();
      }),

      network.on('matchEnded', (summary) => {
        this.summary = summary;
        this.effects.kick(12);
        if (summary.winnerId === this.localPlayerId) {
          audio.victory();
        } else {
          audio.defeat();
        }
        this.publishHud(true);
        options.onFinished(summary);
      }),
    );
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.tick);

    const frameDt = Math.min(0.25, Math.max(0, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    this.clock += frameDt;
    this.effects.update(frameDt);

    this.processLocalInput(frameDt);
    this.updateCameraNow();

    if (
      this.latestState &&
      !this.latestState.ball.frozen &&
      this.latestState.status === 'playing'
    ) {
      this.effects.pushTrail({ x: this.latestState.ball.x, y: this.latestState.ball.y });
    }

    this.hudTimer += frameDt;
    if (this.hudTimer >= 0.1) this.publishHud(false);

    this.render();
  };

  private processLocalInput(dt: number): void {
    if (!this.latestState || this.latestState.status === 'finished') return;
    const local = this.localPlayer();
    if (!local || !local.alive) return;

    const input = this.input.read();

    // Client-side prediction for local paddle position
    const edge = this.localEdge();
    if (edge && this.localPredictedPaddlePos !== null) {
      const maxStep = paddleStep(edge.length, dt);
      let target = this.localPredictedPaddlePos;

      if (typeof input.absolute === 'number' && Number.isFinite(input.absolute)) {
        const desired = clamp01(input.absolute);
        const diff = desired - this.localPredictedPaddlePos;
        target = this.localPredictedPaddlePos + Math.max(-maxStep, Math.min(maxStep, diff));
      } else if (input.isPressed && input.direction !== 0) {
        target = this.localPredictedPaddlePos + input.direction * maxStep;
      }

      const pLen = paddleLengthFor(this.latestState.players.length, edge.length);
      const halfFrac = pLen / (2 * edge.length);
      const clamped = Math.max(halfFrac, Math.min(1 - halfFrac, target));
      this.localPredictedPaddlePos = clamped;
    }

    // Stream inputs to server if changed or on regular heartbeat
    const last = this.lastSentInput;
    const changed =
      !last ||
      last.direction !== input.direction ||
      last.isPressed !== input.isPressed ||
      last.absolute !== input.absolute;

    if (changed) {
      this.lastSentInput = input;
      this.network.sendInput(input);
    }
  }

  private publishHud(force: boolean): void {
    if (!force && this.hudTimer < 0.1) return;
    this.hudTimer = 0;

    const state = this.latestState;
    const local = this.localPlayer();
    const players = state ? state.players.map((p) => toHudPlayer(p, this.localPlayerId)) : [];

    this.options.onHud({
      status: state ? state.status : 'countdown',
      phase: state ? state.phase : 'opening',
      countdown: state ? state.countdown : 0,
      elapsed: state ? state.elapsed : 0,
      rally: state ? state.rally : 0,
      longestRally: state ? state.longestRally : 0,
      shrinkWarning: state ? state.shrinkWarning : 0,
      arenaScale: state ? state.arena.scale : 1,
      ballSpeed: state ? state.ball.speed : 0,
      paused: false,
      localAlive: local ? local.alive : false,
      localLives: local ? local.lives : 0,
      aliveCount: state ? state.players.filter((p) => p.alive).length : 0,
      players,
      summary: this.summary,
    });
  }

  private render(): void {
    if (this.width <= 0 || this.height <= 0 || !this.latestState) return;

    // Use predicted paddle position for local player when drawing to eliminate visual lag
    let drawState = this.latestState;
    if (this.localPredictedPaddlePos !== null && this.localPlayerId) {
      drawState = {
        ...this.latestState,
        players: this.latestState.players.map((p) =>
          p.id === this.localPlayerId && this.localPredictedPaddlePos !== null
            ? { ...p, paddlePosition: this.localPredictedPaddlePos }
            : p,
        ),
      };
    }

    this.renderer.draw({
      state: drawState,
      camera: this.camera,
      effects: this.effects,
      palette: paletteFor(this.settings.highContrast),
      localPlayerId: this.localPlayerId,
      showSymbols: this.settings.symbols,
      reducedMotion: this.settings.reducedMotion,
      time: this.clock,
    });
  }
}
