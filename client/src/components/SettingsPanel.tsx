import type { Settings } from '../hooks/useSettings';

export interface SettingsPanelProps {
  settings: Settings;
  toggle: (key: keyof Settings) => void;
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

/** Accessibility and audio preferences; persisted by useSettings. */
export function SettingsPanel({ settings, toggle }: SettingsPanelProps): JSX.Element {
  return (
    <div className="stack">
      {ROWS.map((row) => (
        <button
          key={row.key}
          type="button"
          className="toggle"
          aria-pressed={settings[row.key]}
          onClick={() => toggle(row.key)}
        >
          <span>
            {row.label}
            <span className="toggle__hint">{row.hint}</span>
          </span>
          <span className="toggle__state">{settings[row.key] ? 'On' : 'Off'}</span>
        </button>
      ))}
    </div>
  );
}
