import { PLAYER_COLORS, PLAYER_SYMBOLS } from '@polyball/shared';

export interface Palette {
  background: string;
  backgroundEdge: string;
  grid: string;
  wall: string;
  wallDead: string;
  preview: string;
  ball: string;
  ballGlow: string;
  text: string;
  textDim: string;
}

export const NEON: Palette = {
  background: '#080c1c',
  backgroundEdge: '#02030a',
  grid: 'rgba(90, 150, 220, 0.10)',
  wall: 'rgba(140, 200, 255, 0.55)',
  wallDead: 'rgba(120, 140, 175, 0.30)',
  preview: 'rgba(251, 113, 133, 0.55)',
  ball: '#ffffff',
  ballGlow: 'rgba(180, 235, 255, 0.85)',
  text: '#e8f1ff',
  textDim: '#93a4c8',
};

export const HIGH_CONTRAST: Palette = {
  background: '#000000',
  backgroundEdge: '#000000',
  grid: 'rgba(255, 255, 255, 0.16)',
  wall: '#ffffff',
  wallDead: 'rgba(255, 255, 255, 0.4)',
  preview: '#ff5d7a',
  ball: '#ffffff',
  ballGlow: '#ffffff',
  text: '#ffffff',
  textDim: '#dbe7ff',
};

export const paletteFor = (highContrast: boolean): Palette => (highContrast ? HIGH_CONTRAST : NEON);

export const colorForPlayer = (colorIndex: number): string =>
  PLAYER_COLORS[
    ((colorIndex % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length
  ];

export const symbolForPlayer = (colorIndex: number): string =>
  PLAYER_SYMBOLS[
    ((colorIndex % PLAYER_SYMBOLS.length) + PLAYER_SYMBOLS.length) % PLAYER_SYMBOLS.length
  ];

/** `#rrggbb` plus an alpha, without pulling in a colour library. */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
