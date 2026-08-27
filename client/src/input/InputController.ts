import {
  clamp01,
  edgeCoordinateOf,
  type Edge,
  type InputSource,
  type PlayerInput,
} from '@polyball/shared';
import { screenToWorld, screenTangentSign, type Camera } from '../rendering/camera';

/**
 * Every device funnels into one normalised PlayerInput
 * ({ direction, isPressed, source }), so the simulation never has to care
 * whether a human used a keyboard, a mouse, a finger or a stylus.
 *
 * Pointer Events are used directly (not touch + mouse), which is what makes
 * mouse, touch and pen work from a single code path.
 */
export interface InputContext {
  camera: Camera;
  /** The local player's edge, used to project a pointer onto paddle space. */
  edge: Edge | undefined;
}

export interface InputControllerOptions {
  /** Refreshed by the game loop; null while no match is running. */
  context: () => InputContext | null;
  /** First genuine interaction - the moment audio may legally start. */
  onInteract?: () => void;
  onPauseToggle?: () => void;
}

export class InputController {
  private readonly options: InputControllerOptions;
  private keyLeft = false;
  private keyRight = false;
  /** Held direction coming from an on-screen button, in screen space. */
  private padDirection: -1 | 0 | 1 = 0;
  /** Absolute target (0..1 in edge space) while a pointer is dragging. */
  private absolute: number | null = null;
  private source: InputSource = 'keyboard';
  private sequence = 0;
  private detachers: (() => void)[] = [];

  constructor(options: InputControllerOptions) {
    this.options = options;
  }

  /**
   * Current normalised input. Screen-space intent is converted to edge space
   * here: `screenTangentSign` guarantees "right" always moves the paddle right
   * on screen, whichever way the arena happens to be rotated.
   */
  read(): PlayerInput {
    const context = this.options.context();
    const sign = context ? screenTangentSign(context.camera, context.edge) : 1;
    this.sequence += 1;

    if (this.absolute !== null) {
      return {
        direction: 0,
        isPressed: true,
        source: this.source,
        absolute: this.absolute,
        sequence: this.sequence,
      };
    }

    const screenDirection =
      this.padDirection !== 0
        ? this.padDirection
        : (this.keyRight ? 1 : 0) + (this.keyLeft ? -1 : 0);
    const direction = Math.sign(screenDirection * sign) as -1 | 0 | 1;

    return {
      direction,
      isPressed: direction !== 0,
      source: this.source,
      sequence: this.sequence,
    };
  }

  /** Drop every held key / pointer (used when the game is paused or unmounted). */
  reset(): void {
    this.keyLeft = false;
    this.keyRight = false;
    this.padDirection = 0;
    this.absolute = null;
  }

  /** On-screen button press (React calls this from the touch pads). */
  pad(direction: -1 | 0 | 1, source: InputSource = 'touch'): void {
    if (direction !== 0) {
      this.source = source;
      this.absolute = null;
      this.options.onInteract?.();
    }
    this.padDirection = direction;
  }

  /** Absolute drag control from the touch strip (0..1 in *screen* space). */
  strip(fraction: number | null, source: InputSource = 'touch'): void {
    if (fraction === null) {
      this.absolute = null;
      return;
    }
    const context = this.options.context();
    const sign = context ? screenTangentSign(context.camera, context.edge) : 1;
    const value = clamp01(fraction);
    this.source = source;
    this.padDirection = 0;
    this.absolute = sign === 1 ? value : 1 - value;
    this.options.onInteract?.();
  }

  attachKeyboard(target: Window = window): void {
    const down = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (this.handleKey(event.key, true)) {
        this.source = 'keyboard';
        this.absolute = null;
        this.options.onInteract?.();
        event.preventDefault();
      }
    };
    const up = (event: KeyboardEvent): void => {
      if (this.handleKey(event.key, false)) event.preventDefault();
    };
    const blur = (): void => this.reset();

    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    this.detachers.push(() => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    });
  }

  /** Returns true when the key was one we own (so the caller can preventDefault). */
  private handleKey(key: string, pressed: boolean): boolean {
    switch (key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
      case 'q':
      case 'Q':
        this.keyLeft = pressed;
        return true;
      case 'ArrowRight':
      case 'd':
      case 'D':
        this.keyRight = pressed;
        return true;
      case 'Escape':
      case 'p':
      case 'P':
        if (pressed) this.options.onPauseToggle?.();
        return true;
      default:
        return false;
    }
  }

  /**
   * Pointer control on the canvas: press (or drag) anywhere and the paddle
   * travels toward that spot along its own edge. The engine still clamps the
   * paddle to PADDLE_SPEED, so dragging is never faster than a keyboard.
   */
  attachPointer(element: HTMLElement): void {
    let activeId: number | null = null;

    const project = (event: PointerEvent): void => {
      const context = this.options.context();
      if (!context?.edge) return;
      const rect = element.getBoundingClientRect();
      const world = screenToWorld(context.camera, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      this.absolute = clamp01(edgeCoordinateOf(context.edge, world));
      this.padDirection = 0;
    };

    const sourceOf = (event: PointerEvent): InputSource => {
      if (event.pointerType === 'touch') return 'touch';
      if (event.pointerType === 'pen') return 'pen';
      return 'mouse';
    };

    const down = (event: PointerEvent): void => {
      if (activeId !== null) return;
      activeId = event.pointerId;
      this.source = sourceOf(event);
      element.setPointerCapture?.(event.pointerId);
      this.options.onInteract?.();
      project(event);
      event.preventDefault();
    };

    const move = (event: PointerEvent): void => {
      if (activeId !== event.pointerId) return;
      project(event);
      event.preventDefault();
    };

    const end = (event: PointerEvent): void => {
      if (activeId !== event.pointerId) return;
      activeId = null;
      this.absolute = null;
      if (element.hasPointerCapture?.(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };

    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', end);
    this.detachers.push(() => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      element.removeEventListener('lostpointercapture', end);
    });
  }

  dispose(): void {
    for (const detach of this.detachers) detach();
    this.detachers = [];
    this.reset();
  }
}
