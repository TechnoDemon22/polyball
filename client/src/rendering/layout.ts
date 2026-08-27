/**
 * Screen-space layout constants for the match view.
 *
 * The on-screen controls sit on top of the canvas, so the camera has to know
 * how much of the viewport they cover - otherwise the arena is centred behind
 * the pads and, on a landscape phone, the player's own edge ends up underneath
 * them. These numbers are the single source of truth: the CSS reads them back
 * as custom properties set by PracticeScreen.
 */

/** Height of one on-screen direction pad. */
export const TOUCH_PAD_HEIGHT = 84;
/** Height of the absolute-position drag strip. */
export const TOUCH_STRIP_HEIGHT = 54;
/** Gap between the strip, the pads and the viewport edge. */
export const TOUCH_GAP = 10;
/** Width of one side pad in the landscape layout. */
export const TOUCH_SIDE_WIDTH = 88;

/** Total height the bottom control stack occupies (excluding safe-area inset). */
export const TOUCH_BOTTOM_HEIGHT = TOUCH_STRIP_HEIGHT + TOUCH_PAD_HEIGHT + TOUCH_GAP * 3;

/**
 * Layout the on-screen controls use.
 *  - `none`   : no touch controls (mouse / keyboard)
 *  - `bottom` : drag strip above two wide pads, the phone-portrait default
 *  - `side`   : one tall pad on each side, used when the viewport is too short
 *               for a bottom stack (landscape phones)
 */
export type TouchLayout = 'none' | 'bottom' | 'side';

/** Screen area, in CSS pixels, that overlays cover on each side. */
export interface ViewInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSET: ViewInset = { top: 0, right: 0, bottom: 0, left: 0 };

export const insetFor = (layout: TouchLayout): ViewInset => {
  if (layout === 'bottom') return { ...NO_INSET, bottom: TOUCH_BOTTOM_HEIGHT };
  if (layout === 'side') {
    return { ...NO_INSET, left: TOUCH_SIDE_WIDTH, right: TOUCH_SIDE_WIDTH };
  }
  return NO_INSET;
};

/**
 * A bottom stack needs roughly half the viewport height to stay playable; below
 * that (landscape phones, split screen) the pads move to the sides instead.
 */
export const layoutForViewport = (enabled: boolean, width: number, height: number): TouchLayout => {
  if (!enabled) return 'none';
  if (height < TOUCH_BOTTOM_HEIGHT * 2.4 && width > height) return 'side';
  return 'bottom';
};

/** CSS custom properties so the stylesheet uses the same numbers. */
export const touchLayoutStyle = (layout: TouchLayout): Record<string, string> => ({
  '--touch-pad-h': `${TOUCH_PAD_HEIGHT}px`,
  '--touch-strip-h': `${TOUCH_STRIP_HEIGHT}px`,
  '--touch-gap': `${TOUCH_GAP}px`,
  '--touch-side-w': `${TOUCH_SIDE_WIDTH}px`,
  '--touch-bottom-h': layout === 'bottom' ? `${TOUCH_BOTTOM_HEIGHT}px` : '0px',
  '--touch-inset-x': layout === 'side' ? `${TOUCH_SIDE_WIDTH}px` : '0px',
});
