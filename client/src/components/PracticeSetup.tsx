import { useState } from 'react';
import {
  AIDirector,
  DEFAULT_LIVES,
  MAX_LIVES,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_LIVES,
  MIN_PLAYERS,
  PADDLE_SPEED,
  sideCountFor,
  type Difficulty,
} from '@polyball/shared';
import type { PracticeOptions } from '../game/practice';

export interface PracticeSetupProps {
  name: string;
  onNameChange: (value: string) => void;
  onStart: (options: PracticeOptions) => void;
  onBack: () => void;
}

const COUNTS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const shapeLabel = (count: number): string => {
  const sides = sideCountFor(count);
  if (count <= 2) return 'rectangle, players face each other';
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
  return `${names[sides] ?? `${sides}-gon`}, one edge each`;
};

/** Practice Mode configuration: player count, AI difficulty, lives, shrinking. */
export function PracticeSetup({
  name,
  onNameChange,
  onStart,
  onBack,
}: PracticeSetupProps): JSX.Element {
  const [playerCount, setPlayerCount] = useState(6);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [lives, setLives] = useState(DEFAULT_LIVES);
  const [shrinkEnabled, setShrinkEnabled] = useState(true);

  return (
    <div className="screen screen--centered">
      <div className="stack">
        <div className="row row--between">
          <button type="button" className="btn btn--small btn--ghost" onClick={onBack}>
            ← Back
          </button>
          <span className="hint">Practice runs entirely in your browser.</span>
        </div>

        <section className="panel">
          <h2 className="panel__title">
            <span>Your name</span>
            <span>
              {name.length}/{MAX_NAME_LENGTH}
            </span>
          </h2>
          <input
            className="chip"
            style={{ width: '100%', minHeight: 48 }}
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder="You"
            aria-label="Display name"
            onChange={(event) => onNameChange(event.target.value)}
          />
        </section>

        <section className="panel">
          <h2 className="panel__title">
            <span>Players</span>
            <span className="field__value">{playerCount}</span>
          </h2>
          <div className="choices">
            {COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                className="chip"
                aria-pressed={playerCount === count}
                onClick={() => setPlayerCount(count)}
              >
                {count}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            {shapeLabel(playerCount)}. You play against {playerCount - 1} AI opponent
            {playerCount - 1 === 1 ? '' : 's'}.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel__title">
            <span>AI difficulty</span>
            <span className="field__value">
              {Math.round(AIDirector.topSpeed(difficulty))} / {PADDLE_SPEED} u/s
            </span>
          </h2>
          <div className="choices">
            {DIFFICULTIES.map((level) => (
              <button
                key={level}
                type="button"
                className="chip"
                style={{ textTransform: 'capitalize', flex: 1 }}
                aria-pressed={difficulty === level}
                onClick={() => setDifficulty(level)}
              >
                {level}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            The AI obeys the same paddle speed limit as you - it just reacts sooner and aims better.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel__title">
            <span>Match</span>
          </h2>
          <div className="field">
            <label className="field__label" htmlFor="lives">
              <span>Lives each</span>
              <span className="field__value">{lives}</span>
            </label>
            <input
              id="lives"
              className="slider"
              type="range"
              min={MIN_LIVES}
              max={MAX_LIVES}
              step={1}
              value={lives}
              onChange={(event) => setLives(Number(event.target.value))}
            />
          </div>
          <button
            type="button"
            className="toggle"
            aria-pressed={shrinkEnabled}
            onClick={() => setShrinkEnabled((value) => !value)}
          >
            <span>
              Shrinking arena
              <span className="toggle__hint">
                The polygon closes in after 30 seconds, keeping every edge equal.
              </span>
            </span>
            <span className="toggle__state">{shrinkEnabled ? 'On' : 'Off'}</span>
          </button>
        </section>

        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() =>
            onStart({ playerCount, difficulty, lives, shrinkEnabled, playerName: name })
          }
        >
          Start practice match
        </button>
      </div>
    </div>
  );
}
