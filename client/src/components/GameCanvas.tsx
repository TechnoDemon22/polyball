import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useElementSize, type Size } from '../hooks/useElementSize';
import { NO_INSET, type ViewInset } from '../rendering/layout';

export interface ResizableSession {
  resize: (width: number, height: number, dpr?: number, inset?: ViewInset) => void;
}

/** Tracks devicePixelRatio so the canvas stays crisp when the page is zoomed. */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let query: MediaQueryList | null = null;
    const listen = (): void => {
      const current = window.devicePixelRatio || 1;
      setDpr(current);
      query?.removeEventListener('change', listen);
      query = window.matchMedia(`(resolution: ${current}dppx)`);
      query.addEventListener('change', listen);
    };
    listen();
    return () => query?.removeEventListener('change', listen);
  }, []);

  return dpr;
}

export interface GameCanvasProps {
  session: ResizableSession | null;
  canvasRef: RefObject<HTMLCanvasElement>;
  /** Screen area covered by the on-screen controls, kept clear of the arena. */
  inset?: ViewInset;
  /** Measured stage size in CSS pixels, used to pick the control layout. */
  onResize?: (size: Size) => void;
  /** HUD and overlays, positioned on top of the canvas. */
  children?: ReactNode;
}

/**
 * The canvas plus its overlays. The stage element is measured with a
 * ResizeObserver and the session is told about every size change, which is what
 * makes the game work on rotation, split-screen and on-screen keyboards.
 */
export function GameCanvas({
  session,
  canvasRef,
  inset = NO_INSET,
  onResize,
  children,
}: GameCanvasProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(stageRef);
  const dpr = useDevicePixelRatio();

  useEffect(() => {
    if (size.width > 0 && size.height > 0) onResize?.(size);
  }, [size, onResize]);

  useEffect(() => {
    if (!session || size.width <= 0 || size.height <= 0) return;
    session.resize(size.width, size.height, dpr, inset);
  }, [session, size.width, size.height, dpr, inset]);

  return (
    <div className="game__stage" ref={stageRef}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Polyball arena. Use the arrow keys, A and D, or drag to move your paddle."
      />
      {children}
    </div>
  );
}
