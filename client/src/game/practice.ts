import {
  AIDirector,
  FIXED_DT,
  MAX_FRAME_DT,
  clampLives,
  createArena,
  edgeIndexForPlayer,
  GameEngine,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Difficulty,
  type Edge,
  type GameEvent,
  type GameState,
  type MatchConfig,
  type MatchSummary,
  type PlayerSeed,
  type PlayerState,
} from '@polyball/shared';
import { InputController } from '../input/InputController';
import { createCamera, rotationForEdge, updateCamera, type Camera } from '../rendering/camera';
import { Effects } from '../rendering/effects';
import { NO_INSET, type ViewInset } from '../rendering/layout';
import { colorForPlayer, paletteFor } from '../rendering/palette';
import { Renderer } from '../rendering/renderer';
import type { Settings } from '../hooks/useSettings';
import type { AudioEngine } from './audio';

/** The local human always keeps this id, so "am I this player?" is trivial. */
export const LOCAL_PLAYER_ID = 'local';

export interface PracticeOptions {
  playerCount: number;
  difficulty: Difficulty;
  lives: number;
  shrinkEnabled: boolean;
  playerName: string;
  seed?: number;
}

const AI_NAMES = [
  'Vega',
  'Nova',
  'Orion',
  'Lyra',
  'Atlas',
  'Rigel',
  'Juno',
  'Mira',
  'Kepler',
  'Zephyr',
  'Cygnus',
];

/** Build a valid MatchConfig for Practice Mode; every field is clamped. */
export function createPracticeConfig(options: PracticeOptions): MatchConfig {
  const count = Math.round(
    Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, options.playerCount || MIN_PLAYERS)),
  );
  const name = options.playerName.trim().slice(0, 16) || 'You';

  const players: PlayerSeed[] = [
    { id: LOCAL_PLAYER_ID, name, isLocal: true, isAI: false, colorIndex: 0 },
  ];
  for (let i = 1; i < count; i += 1) {
    players.push({
      id: `ai-${i}`,
      name: AI_NAMES[(i - 1) % AI_NAMES.length],
      isAI: true,
      difficulty: options.difficulty,
      colorIndex: i,
    });
  }

  return {
    players,
    lives: clampLives(options.lives),
    mode: 'survival',
    shrinkEnabled: options.shrinkEnabled,
    seed: options.seed ?? Date.now() & 0x7fffffff,
  };
}

/** Which arena edge the local player will defend (used before a match starts). */
export function localEdgeIndex(playerCount: number): number {
  return edgeIndexForPlayer(0, createArena(playerCount, 1));
}

export interface HudPlayer {
  id: string;
  name: string;
  colorIndex: number;
  lives: number;
  alive: boolean;
  isLocal: boolean;
  isAI: boolean;
  hits: number;
  placement: number | null;
}

/** Everything the React HUD needs, published a few times a second. */
export interface HudSnapshot {
  status: GameState['status'];
  phase: GameState['phase'];
  countdown: number;
  elapsed: number;
  rally: number;
  longestRally: number;
  shrinkWarning: number;
  arenaScale: number;
  ballSpeed: number;
  paused: boolean;
  localAlive: boolean;
  localLives: number;
  aliveCount: number;
  players: HudPlayer[];
  summary: MatchSummary | null;
}

const toHudPlayer = (player: PlayerState): HudPlayer => ({
  id: player.id,
  name: player.name,
  colorIndex: player.colorIndex,
  lives: player.lives,
  alive: player.alive,
  isLocal: player.isLocal,
  isAI: player.isAI,
  hits: player.hits,
  placement: player.placement,
});

export interface PracticeSessionOptions {
  canvas: HTMLCanvasElement;
  config: MatchConfig;
  difficulty: Difficulty;
  settings: Settings;
  audio: AudioEngine;
  /** Throttled HUD updates (never once per frame - React would thrash). */
  onHud: (snapshot: HudSnapshot) => void;
  onFinished: (summary: MatchSummary) => void;
}

/**
 * Owns one browser-only practice match: simulation, AI, rendering, input and
 * audio. React mounts it once and then only listens for HUD snapshots, so no
 * component re-renders during a rally.
 */
export class PracticeSession {
  readonly engine: GameEngine;
  readonly input: InputController;
  readonly effects = new Effects();

  private readonly options: PracticeSessionOptions;
  private readonly renderer: Renderer;
  private readonly camera: Camera = createCamera();
  private ai: AIDirector;
  private settings: Settings;

  private frameHandle = 0;
  private lastFrameTime = 0;
  private accumulator = 0;
  private clock = 0;
  private hudTimer = 0;
  private paused = false;
  private running = false;
  private summary: MatchSummary | null = null;
  private width = 0;
  private height = 0;
  /** Screen area covered by the on-screen controls. */
  private inset: ViewInset = NO_INSET;

  constructor(options: PracticeSessionOptions) {
    this.options = options;
    this.settings = options.settings;
    this.engine = new GameEngine(options.config);
    this.ai = this.createDirector(options.config, options.difficulty);
    this.renderer = new Renderer(options.canvas);
    this.effects.setEnabled(!options.settings.reducedMotion);

    this.input = new InputController({
      context: () => ({ camera: this.camera, edge: this.localEdge() }),
      onInteract: () => options.audio.unlock(),
      onPauseToggle: () => this.togglePause(),
    });
    this.input.attachKeyboard();
    this.input.attachPointer(options.canvas);
  }

  private createDirector(config: MatchConfig, difficulty: Difficulty): AIDirector {
    const seeds = config.players
      .filter((player) => player.isAI)
      .map((player) => ({ id: player.id, difficulty: player.difficulty ?? difficulty }));
    return new AIDirector(seeds, config.seed);
  }

  private localPlayer(): PlayerState | undefined {
    return this.engine.state.players.find((player) => player.id === LOCAL_PLAYER_ID);
  }

  private localEdge(): Edge | undefined {
    const player = this.localPlayer();
    if (!player) return undefined;
    return this.engine.state.arena.edges[player.edgeIndex];
  }

  get state(): GameState {
    return this.engine.state;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.effects.setEnabled(!settings.reducedMotion);
    this.options.audio.setEnabled(settings.sound);
  }

  setDifficulty(difficulty: Difficulty): void {
    this.ai.setDifficulty(difficulty);
  }

  /** Canvas box size in CSS pixels (called by the ResizeObserver hook). */
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
    if (!this.running) this.render();
  }

  private updateCameraNow(): void {
    const rotation = this.settings.lockCamera
      ? rotationForEdge(this.localEdge(), this.engine.state.arena.center)
      : 0;
    updateCamera(this.camera, {
      width: this.width,
      height: this.height,
      arena: this.engine.state.arena,
      rotation,
      inset: this.inset,
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.accumulator = 0;
    // Publish once up front so the HUD has a roster even if the very first
    // frame arrives paused (a hidden tab pauses before any tick runs).
    this.publishHud(true);
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.input.reset();
    this.publishHud(true);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastFrameTime = performance.now();
    this.accumulator = 0;
    this.publishHud(true);
  }

  togglePause(): void {
    if (this.engine.state.status === 'finished') return;
    if (this.paused) this.resume();
    else this.pause();
  }

  restart(seed = Date.now() & 0x7fffffff): void {
    this.engine.reset(seed);
    this.ai = this.createDirector(this.engine.config, this.options.difficulty);
    this.effects.clear();
    this.summary = null;
    this.paused = false;
    this.accumulator = 0;
    this.clock = 0;
    this.lastFrameTime = performance.now();
    this.input.reset();
    this.updateCameraNow();
    this.publishHud(true);
    this.start();
  }

  dispose(): void {
    this.stop();
    this.input.dispose();
    this.effects.clear();
  }

  /**
   * Fixed-timestep accumulator: the simulation always advances in whole
   * FIXED_DT ticks, so a 144 Hz monitor and a throttled background tab produce
   * identical physics. Long stalls are clamped to MAX_FRAME_DT instead of
   * fast-forwarding the match.
   */
  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.tick);

    const frameDt = Math.min(MAX_FRAME_DT, Math.max(0, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    if (this.paused) {
      this.render();
      return;
    }

    this.clock += frameDt;
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 8) {
      this.simulate(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps === 8) this.accumulator = 0;

    this.effects.update(frameDt);
    this.hudTimer += frameDt;
    if (this.hudTimer >= 0.1) this.publishHud(false);
    this.render();
  };

  private simulate(dt: number): void {
    const state = this.engine.state;
    if (state.status === 'finished') return;

    // AI first so every paddle sees the same world this tick.
    this.ai.update(state, dt, (id, input) => this.engine.setInput(id, input));
    this.engine.setInput(LOCAL_PLAYER_ID, this.input.read());
    this.engine.step(dt);

    if (!state.ball.frozen && state.status === 'playing') {
      this.effects.pushTrail({ x: state.ball.x, y: state.ball.y });
    }

    this.updateCameraNow();
    const events = this.engine.drainEvents();
    for (const event of events) this.handleEvent(event);
  }

  private handleEvent(event: GameEvent): void {
    const { audio } = this.options;
    const state = this.engine.state;

    switch (event.type) {
      case 'COUNTDOWN':
        if (event.value > 0) audio.countdown(event.value);
        break;
      case 'MATCH_START':
        audio.matchStart();
        break;
      case 'HIT': {
        const player = state.players.find((entry) => entry.id === event.playerId);
        const color = colorForPlayer(player?.colorIndex ?? 0);
        this.effects.burst(
          { x: event.x, y: event.y },
          color,
          event.perfect ? 16 : 10,
          200 + event.power * 320,
        );
        this.effects.ring({ x: event.x, y: event.y }, color, 6, 360, 2.5, 0.35);
        this.effects.kick(2 + event.power * 5);
        audio.hit(event.power, event.perfect);
        break;
      }
      case 'WALL_BOUNCE':
        this.effects.burst(
          { x: event.x, y: event.y },
          paletteFor(this.settings.highContrast).wall,
          5,
          140,
        );
        audio.wall();
        break;

      case 'DAMAGE': {
        const player = state.players.find((entry) => entry.id === event.playerId);
        const color = colorForPlayer(player?.colorIndex ?? 0);
        this.effects.burst({ x: event.x, y: event.y }, color, 18, 260);
        this.effects.ring({ x: event.x, y: event.y }, '#fb7185', 8, 520, 4, 0.6);
        this.effects.kick(9);
        audio.damage();
        break;
      }
      case 'ELIMINATED': {
        const player = state.players.find((entry) => entry.id === event.playerId);
        const edge = player ? state.arena.edges[player.edgeIndex] : undefined;
        if (edge) {
          this.effects.burst(edge.mid, colorForPlayer(player?.colorIndex ?? 0), 30, 320);
          this.effects.ring(edge.mid, '#fb7185', 14, 620, 5, 0.8);
        }
        this.effects.kick(15);
        audio.eliminate();
        break;
      }
      case 'ARENA_WARNING':
        this.effects.ring(state.arena.center, '#fb7185', 40, 900, 3, 0.7);
        audio.warning();
        break;
      case 'MATCH_ENDED': {
        this.summary = event.summary;
        this.effects.kick(12);
        if (event.summary.winnerId === LOCAL_PLAYER_ID) audio.victory();
        else audio.defeat();
        this.publishHud(true);
        this.options.onFinished(event.summary);
        break;
      }
      case 'PHASE_CHANGED':
        // The HUD reads state.phase directly; nothing extra to do here.
        break;
      default:
        break;
    }
  }

  private publishHud(force: boolean): void {
    if (!force && this.hudTimer < 0.1) return;
    this.hudTimer = 0;
    const state = this.engine.state;
    const local = this.localPlayer();
    this.options.onHud({
      status: state.status,
      phase: state.phase,
      countdown: state.countdown,
      elapsed: state.elapsed,
      rally: state.rally,
      longestRally: state.longestRally,
      shrinkWarning: state.shrinkWarning,
      arenaScale: state.arena.scale,
      ballSpeed: state.ball.speed,
      paused: this.paused,
      localAlive: local?.alive ?? false,
      localLives: local?.lives ?? 0,
      aliveCount: state.players.filter((player) => player.alive).length,
      players: state.players.map(toHudPlayer),
      summary: this.summary,
    });
  }

  private render(): void {
    if (this.width <= 0 || this.height <= 0) return;
    this.renderer.draw({
      state: this.engine.state,
      camera: this.camera,
      effects: this.effects,
      palette: paletteFor(this.settings.highContrast),
      localPlayerId: LOCAL_PLAYER_ID,
      showSymbols: this.settings.symbols,
      reducedMotion: this.settings.reducedMotion,
      time: this.clock,
    });
  }
}
