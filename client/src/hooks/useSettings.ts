import { useCallback, useEffect, useMemo, useState } from 'react';

export interface Settings {
  sound: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  /** Draw the player symbol next to every paddle (colour-blind friendly). */
  symbols: boolean;
  /** Rotate the arena so your own edge is always at the bottom. */
  lockCamera: boolean;
  showTouchControls: boolean;
  serverUrl: string;
}

const STORAGE_KEY = 'polyball.settings.v1';

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const coarsePointer = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: none), (pointer: coarse)').matches;

export const defaultSettings = (): Settings => ({
  sound: true,
  reducedMotion: prefersReducedMotion(),
  highContrast: false,
  symbols: true,
  lockCamera: true,
  showTouchControls: coarsePointer(),
  serverUrl: '',
});

function readStored(): Partial<Settings> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<Settings>) : {};
  } catch {
    // Private browsing or a corrupted value: fall back to defaults silently.
    return {};
  }
}

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

/**
 * Persisted accessibility, server, and audio preferences. Every value is validated on
 * read, so a hand-edited localStorage entry cannot break the game.
 */
export function useSettings(): {
  settings: Settings;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  toggle: (key: keyof Settings) => void;
} {
  const [settings, setSettings] = useState<Settings>(() => {
    const defaults = defaultSettings();
    const stored = readStored();
    return {
      sound: asBoolean(stored.sound, defaults.sound),
      reducedMotion: asBoolean(stored.reducedMotion, defaults.reducedMotion),
      highContrast: asBoolean(stored.highContrast, defaults.highContrast),
      symbols: asBoolean(stored.symbols, defaults.symbols),
      lockCamera: asBoolean(stored.lockCamera, defaults.lockCamera),
      showTouchControls: asBoolean(stored.showTouchControls, defaults.showTouchControls),
      serverUrl: asString(stored.serverUrl, defaults.serverUrl),
    };
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage is optional; the game keeps working in-memory.
    }
    document.body.dataset.reducedMotion = String(settings.reducedMotion);
    document.body.dataset.contrast = settings.highContrast ? 'high' : 'normal';
  }, [settings]);

  const setSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]): void => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const toggle = useCallback((key: keyof Settings): void => {
    setSettings((current) => {
      const val = current[key];
      if (typeof val === 'boolean') {
        return { ...current, [key]: !val };
      }
      return current;
    });
  }, []);

  return useMemo(() => ({ settings, setSetting, toggle }), [settings, setSetting, toggle]);
}
