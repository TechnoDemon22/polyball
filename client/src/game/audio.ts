/**
 * Tiny synthesised sound engine.
 *
 * There are no audio assets: every effect is an oscillator plus a gain envelope,
 * which keeps the download small and avoids a loading screen. The AudioContext
 * is created lazily on the first user gesture, because browsers refuse to start
 * audio before one (and correctly so).
 */

type OscillatorKind = 'sine' | 'square' | 'triangle' | 'sawtooth';

interface BlipOptions {
  frequency: number;
  duration: number;
  type?: OscillatorKind;
  gain?: number;
  /** Optional glide target, in Hz. */
  sweepTo?: number;
  delay?: number;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private unlocked = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(enabled ? 0.28 : 0, this.context.currentTime, 0.02);
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Must be called from inside a real user gesture (click, key press, touch).
   * Safe to call repeatedly.
   */
  unlock(): void {
    if (this.unlocked) {
      void this.context?.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      typeof window === 'undefined'
        ? undefined
        : (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;

    try {
      const context = new Ctor();
      const master = context.createGain();
      master.gain.value = this.enabled ? 0.28 : 0;
      master.connect(context.destination);
      this.context = context;
      this.master = master;
      this.unlocked = true;
      void context.resume();
    } catch {
      // Audio is a nice-to-have; the game stays fully playable without it.
      this.context = null;
      this.master = null;
    }
  }

  private blip(options: BlipOptions): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.enabled) return;

    const now = context.currentTime + (options.delay ?? 0);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = options.type ?? 'sine';
    oscillator.frequency.setValueAtTime(options.frequency, now);
    if (options.sweepTo !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.sweepTo),
        now + options.duration,
      );
    }

    const peak = options.gain ?? 0.5;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);

    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + options.duration + 0.02);
  }

  /** Short filtered noise burst - used for impacts that should feel physical. */
  private noise(duration: number, gainValue = 0.35, frequency = 900): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.enabled) return;

    const frames = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.value = gainValue;

    source.connect(filter).connect(gain).connect(master);
    source.start();
  }

  /** `power` is 0..1 (ball speed as a fraction of the maximum). */
  hit(power: number, perfect = false): void {
    const base = 320 + power * 420;
    this.blip({ frequency: base, duration: 0.09, type: 'square', gain: 0.32, sweepTo: base * 1.5 });
    if (perfect) {
      this.blip({ frequency: base * 2, duration: 0.12, type: 'sine', gain: 0.18, delay: 0.03 });
    }
  }

  wall(): void {
    this.blip({ frequency: 190, duration: 0.07, type: 'triangle', gain: 0.16 });
  }

  damage(): void {
    this.noise(0.22, 0.4, 520);
    this.blip({ frequency: 260, duration: 0.3, type: 'sawtooth', gain: 0.22, sweepTo: 90 });
  }

  eliminate(): void {
    this.noise(0.32, 0.34, 380);
    this.blip({ frequency: 420, duration: 0.5, type: 'square', gain: 0.2, sweepTo: 70 });
  }

  countdown(value: number): void {
    this.blip({ frequency: value <= 1 ? 720 : 440, duration: 0.12, type: 'sine', gain: 0.22 });
  }

  matchStart(): void {
    this.blip({ frequency: 520, duration: 0.14, type: 'triangle', gain: 0.24 });
    this.blip({ frequency: 780, duration: 0.18, type: 'triangle', gain: 0.22, delay: 0.12 });
  }

  warning(): void {
    this.blip({ frequency: 300, duration: 0.18, type: 'sawtooth', gain: 0.14, sweepTo: 220 });
  }

  victory(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((frequency, index) => {
      this.blip({ frequency, duration: 0.22, type: 'triangle', gain: 0.24, delay: index * 0.12 });
    });
  }

  defeat(): void {
    const notes = [392, 330, 262];
    notes.forEach((frequency, index) => {
      this.blip({ frequency, duration: 0.3, type: 'sine', gain: 0.22, delay: index * 0.16 });
    });
  }

  dispose(): void {
    const context = this.context;
    this.context = null;
    this.master = null;
    this.unlocked = false;
    void context?.close().catch(() => undefined);
  }
}
