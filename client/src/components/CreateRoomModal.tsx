import { useState } from 'react';
import {
  DEFAULT_LIVES,
  MAX_LIVES,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_LIVES,
  MIN_PLAYERS,
  sideCountFor,
  type GameMode,
  type RoomOptions,
} from '@polyball/shared';
import { Modal } from './Modal';

export interface CreateRoomModalProps {
  name: string;
  onNameChange: (value: string) => void;
  onCreate: (options: RoomOptions) => void;
  onClose: () => void;
}

const COUNTS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

const shapeLabel = (count: number): string => {
  const sides = sideCountFor(count);
  if (count <= 2) return 'rectangle (duel across table)';
  const names: Record<number, string> = {
    3: 'triangle',
    4: 'square',
    5: 'pentagon',
    6: 'hexagon',
    7: 'heptagon',
    8: 'octagon',
    9: 'nonagon',
    10: 'decagon',
    11: 'hendecagon',
    12: 'dodecagon',
  };
  return `${names[sides] ?? `${sides}-gon`}, ${count} live edges`;
};

export function CreateRoomModal({
  name,
  onNameChange,
  onCreate,
  onClose,
}: CreateRoomModalProps): JSX.Element {
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [lives, setLives] = useState(DEFAULT_LIVES);
  const [shrinkEnabled, setShrinkEnabled] = useState(true);
  const [mode] = useState<GameMode>('survival');

  const handleCreate = (): void => {
    onCreate({
      maxPlayers,
      lives,
      mode,
      shrinkEnabled,
      powerUps: false,
      isPrivate: false,
    });
  };

  return (
    <Modal title="Create Online Room" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label className="field__label" htmlFor="create-name">
            <span>Your display name</span>
            <span>
              {name.length}/{MAX_NAME_LENGTH}
            </span>
          </label>
          <input
            id="create-name"
            className="chip"
            style={{ width: '100%', minHeight: 48 }}
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder="Your name"
            onChange={(e) => onNameChange(e.target.value)}
          />
        </div>

        <div className="field">
          <div className="field__label">
            <span>Max players</span>
            <span className="field__value">{maxPlayers}</span>
          </div>
          <div className="choices">
            {COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                className="chip"
                aria-pressed={maxPlayers === count}
                onClick={() => setMaxPlayers(count)}
              >
                {count}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {shapeLabel(maxPlayers)}.
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="create-lives">
            <span>Lives each</span>
            <span className="field__value">{lives}</span>
          </label>
          <input
            id="create-lives"
            className="slider"
            type="range"
            min={MIN_LIVES}
            max={MAX_LIVES}
            step={1}
            value={lives}
            onChange={(e) => setLives(Number(e.target.value))}
          />
        </div>

        <button
          type="button"
          className="toggle"
          aria-pressed={shrinkEnabled}
          onClick={() => setShrinkEnabled((v) => !v)}
        >
          <span>
            Shrinking arena
            <span className="toggle__hint">
              Arena closes in symmetrically after 30 seconds of play.
            </span>
          </span>
          <span className="toggle__state">{shrinkEnabled ? 'On' : 'Off'}</span>
        </button>

        <div className="row" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn--primary"
            style={{ flex: 1 }}
            onClick={handleCreate}
          >
            Create & Enter Lobby
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
