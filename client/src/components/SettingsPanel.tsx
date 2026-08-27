import type { Settings } from '../hooks/useSettings';

export interface SettingsPanelProps {
  settings: Settings;
  toggle: (key: keyof Settings) => void;
  onServerUrlChange?: (url: string) => void;
}

interface Row {
  key: keyof Settings;
  label: string;
  hint: string;
}

const ROWS: Row[] = [
  { key: 'sound', label: 'Sound effects', hint: 'Synthesised blips - no downloads.' },
  {
    key: 'reducedMotion',
    label: 'Reduced motion',
    hint: 'Turns off particles, screen shake and glow.',
  },
  { key: 'highContrast', label: 'High contrast', hint: 'Pure black background, white walls.' },
  {
    key: 'symbols',
    label: 'Player symbols',
    hint: 'Shape next to each paddle, for colour-blind play.',
  },
  {
    key: 'lockCamera',
    label: 'Keep my edge at the bottom',
    hint: 'Rotates the arena so you always defend the near side.',
  },
  {
    key: 'showTouchControls',
    label: 'On-screen controls',
    hint: 'Touch pads and drag strip during a match.',
  },
];

/** Accessibility, audio, and server preferences; persisted by useSettings. */
export function SettingsPanel({
  settings,
  toggle,
  onServerUrlChange,
}: SettingsPanelProps): JSX.Element {
  return (
    <div className="stack">
      {ROWS.map((row) => (
        <button
          key={row.key}
          type="button"
          className="toggle"
          aria-pressed={Boolean(settings[row.key])}
          onClick={() => toggle(row.key)}
        >
          <span>
            {row.label}
            <span className="toggle__hint">{row.hint}</span>
          </span>
          <span className="toggle__state">{settings[row.key] ? 'On' : 'Off'}</span>
        </button>
      ))}

      <div className="field" style={{ marginTop: 12 }}>
        <label className="field__label" htmlFor="server-url">
          <span>Multiplayer Server URL</span>
          <span className="field__value">Optional</span>
        </label>
        <input
          id="server-url"
          className="chip"
          style={{ width: '100%', minHeight: 44, fontSize: '0.85rem' }}
          value={settings.serverUrl}
          placeholder="e.g. wss://your-backend.onrender.com or auto"
          onChange={(e) => onServerUrlChange?.(e.target.value)}
        />
        <p className="hint" style={{ marginTop: 6 }}>
          Leave empty to auto-detect the game server URL automatically.
        </p>
      </div>
    </div>
  );
}
