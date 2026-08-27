import { colorForPlayer, symbolForPlayer } from '../rendering/palette';
import type { HudSnapshot } from '../game/practice';

export interface HudProps {
  hud: HudSnapshot;
  showSymbols: boolean;
  soundOn: boolean;
  onTogglePause: () => void;
  onToggleSound: () => void;
  onToggleFullscreen: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

const formatTime = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
};

/** Non-interactive status layer plus the small cluster of match buttons. */
export function Hud({
  hud,
  showSymbols,
  soundOn,
  onTogglePause,
  onToggleSound,
  onToggleFullscreen,
  onOpenSettings,
  onQuit,
}: HudProps): JSX.Element {
  const countdownVisible =
    (hud.status === 'countdown' || hud.status === 'reset') && hud.countdown > 0;

  return (
    <div className="hud">
      <div className="hud__top">
        <div className="hud__cluster">
          {hud.players.map((player) => (
            <span
              className="hud__chip"
              key={player.id}
              style={{
                borderColor: player.alive ? colorForPlayer(player.colorIndex) : undefined,
                opacity: player.alive ? 1 : 0.45,
              }}
            >
              {showSymbols ? (
                <span className="hud__symbol" aria-hidden="true">
                  {symbolForPlayer(player.colorIndex)}{' '}
                </span>
              ) : null}
              {player.name}
              {player.isLocal ? ' (you)' : ''} {player.alive ? '♥'.repeat(player.lives) : '✕'}
            </span>
          ))}
        </div>
        <div className="hud__buttons">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={onTogglePause}
            aria-label={hud.paused ? 'Resume match' : 'Pause match'}
          >
            {hud.paused ? '▶' : '❚❚'}
          </button>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={onToggleSound}
            aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
          >
            {soundOn ? '🔊' : '🔇'}
          </button>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={onToggleFullscreen}
            aria-label="Toggle fullscreen"
          >
            ⛶
          </button>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            ⚙
          </button>
          <button type="button" className="btn btn--small btn--danger" onClick={onQuit}>
            Quit
          </button>
        </div>
      </div>

      {countdownVisible ? (
        <div className="hud__countdown" aria-live="polite">
          {Math.ceil(hud.countdown)}
        </div>
      ) : null}

      {!hud.localAlive && hud.status !== 'finished' ? (
        <div className="hud__banner">Spectating - you are out</div>
      ) : null}

      <div className="hud__bottom">
        <div className="hud__cluster">
          <span className="hud__chip">⏱ {formatTime(hud.elapsed)}</span>
          <span className="hud__chip">Rally {hud.rally}</span>
          <span className="hud__chip">Alive {hud.aliveCount}</span>
          <span className="hud__chip">{Math.round(hud.ballSpeed)} u/s</span>
          {hud.shrinkWarning > 0.2 ? (
            <span className="hud__chip hud__chip--warn">Arena closing in</span>
          ) : (
            <span className="hud__chip">{hud.phase}</span>
          )}
        </div>
      </div>
    </div>
  );
}
