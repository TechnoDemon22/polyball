import { useState } from 'react';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  normalizeRoomCode,
} from '@polyball/shared';
import { HowToPlay } from './HowToPlay';
import { Modal } from './Modal';
import { SettingsPanel } from './SettingsPanel';
import type { Settings } from '../hooks/useSettings';

export interface LandingPageProps {
  settings: Settings;
  toggleSetting: (key: keyof Settings) => void;
  onServerUrlChange?: (url: string) => void;
  onPractice: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  joinCode?: string;
  errorMessage?: string | null;
}

export function LandingPage({
  settings,
  toggleSetting,
  onServerUrlChange,
  onPractice,
  onCreateRoom,
  onJoinRoom,
  joinCode,
  errorMessage,
}: LandingPageProps): JSX.Element {
  const [code, setCode] = useState(() => normalizeRoomCode(joinCode ?? ''));
  const [dialog, setDialog] = useState<'none' | 'help' | 'settings'>('none');
  const codeReady = isValidRoomCode(code);

  const handleJoin = (): void => {
    if (codeReady) {
      onJoinRoom(code);
    }
  };

  return (
    <div className="screen screen--centered">
      <div className="stack">
        <header className="brand">
          <h1 className="brand__title">Polyball</h1>
          <p className="brand__tagline">
            Neon polygon Pong for {MIN_PLAYERS}-{MAX_PLAYERS} players. One edge each, one ball,
            three lives.
          </p>
        </header>

        <button type="button" className="btn btn--primary btn--block" onClick={onPractice}>
          Play Practice Match (Offline)
        </button>

        {errorMessage ? (
          <p
            className="notice"
            role="alert"
            style={{ borderColor: '#fb7185', background: 'rgba(251, 113, 133, 0.12)' }}
          >
            <strong>{errorMessage}</strong>
          </p>
        ) : null}

        {joinCode ? (
          <p className="notice" role="status">
            Invite for room <strong>{joinCode}</strong> received. Tap Join below to enter!
          </p>
        ) : null}

        <section className="panel">
          <h2 className="panel__title">
            <span>Play Online</span>
            <span className="badge" style={{ borderColor: '#22d3ee', color: '#22d3ee' }}>
              Live
            </span>
          </h2>
          <p className="hint">
            Create a private room with custom rules, or enter a 6-character room code to play with
            friends in real-time.
          </p>
          <div className="row" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn--ghost" onClick={onCreateRoom}>
              Create room
            </button>
            <input
              className="chip"
              style={{ flex: 1, minWidth: 130, minHeight: 48, textTransform: 'uppercase' }}
              value={code}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="Room code"
              aria-label="Room code"
              onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && codeReady) handleJoin();
              }}
            />
            <button
              type="button"
              className="btn btn--primary"
              disabled={!codeReady}
              onClick={handleJoin}
            >
              Join
            </button>
          </div>
        </section>

        <div className="row row--center">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => setDialog('help')}
          >
            How to play
          </button>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => setDialog('settings')}
          >
            Settings
          </button>
        </div>

        {dialog === 'help' ? (
          <Modal title="How to play" onClose={() => setDialog('none')}>
            <HowToPlay />
          </Modal>
        ) : null}

        {dialog === 'settings' ? (
          <Modal title="Settings" onClose={() => setDialog('none')}>
            <SettingsPanel
              settings={settings}
              toggle={toggleSetting}
              onServerUrlChange={onServerUrlChange}
            />
          </Modal>
        ) : null}
      </div>
    </div>
  );
}
