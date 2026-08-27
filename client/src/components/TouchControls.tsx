import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { TouchLayout } from '../rendering/layout';
import type { InputController } from '../input/InputController';

export interface TouchControlsProps {
  input: InputController;
  /** `bottom` stacks the strip over two wide pads; `side` uses tall side pads. */
  layout: TouchLayout;
}

/**
 * On-screen controls for phones and tablets. They produce exactly the same
 * normalised input as a keyboard: the left/right pads hold a direction, and the
 * strip requests an absolute position (still speed-limited by the engine).
 *
 * A landscape phone has no room for a bottom stack without covering the
 * player's own edge, so the pads move to the sides and the strip is dropped -
 * dragging directly on the arena already gives absolute aiming there.
 */
export function TouchControls({ input, layout }: TouchControlsProps): JSX.Element | null {
  const [held, setHeld] = useState<-1 | 0 | 1>(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  if (layout === 'none') return null;

  const press =
    (direction: -1 | 1) =>
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setHeld(direction);
      input.pad(direction, event.pointerType === 'pen' ? 'pen' : 'touch');
    };

  const release = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setHeld(0);
    input.pad(0);
  };

  const stripMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    const element = stripRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    input.strip((event.clientX - rect.left) / Math.max(1, rect.width));
  };

  const endStrip = (): void => {
    dragging.current = false;
    input.strip(null);
  };

  return (
    <div className="touch" data-layout={layout}>
      {layout === 'bottom' ? (
        <div
          className="touch__strip"
          ref={stripRef}
          role="slider"
          aria-label="Paddle position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={50}
          tabIndex={-1}
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            stripMove(event);
          }}
          onPointerMove={stripMove}
          onPointerUp={endStrip}
          onPointerCancel={endStrip}
          onLostPointerCapture={endStrip}
        >
          Drag to aim
        </div>
      ) : null}

      <div className="touch__pads">
        <button
          type="button"
          className="touch__pad"
          data-active={held === -1}
          aria-label="Move paddle left"
          onPointerDown={press(-1)}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
        >
          ◀
        </button>
        <button
          type="button"
          className="touch__pad"
          data-active={held === 1}
          aria-label="Move paddle right"
          onPointerDown={press(1)}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
        >
          ▶
        </button>
      </div>
    </div>
  );
}
