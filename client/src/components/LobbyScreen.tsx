import { useState } from 'react';
import { MIN_PLAYERS, type RoomSnapshot } from '@polyball/shared';
import { colorForPlayer, symbolForPlayer } from '../rendering/palette';

export interface LobbyScreenProps {
  room: RoomSnapshot;
  localPlayerId: string | null;
  showSymbols: boolean;
  onToggleReady: () => void;
  onStartMatch: () => void;
  onLeave: () => void;
}

export function LobbyScreen({
  room,
  localPlayerId,
  showSymbols,
  onToggleReady,
  onStartMatch,
  onLeave,
}: LobbyScreenProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const localPlayer = room.players.find((p) => p.id === localPlayerId);
  const isHost = localPlayer?.isHost ?? false;
  const isReady = localPlayer?.ready ?? false;

  const nonHostPlayers = room.players.filter((p) => !p.isHost);
  const allGuestsReady = nonHostPlayers.length > 0 && nonHostPlayers.every((p) => p.ready);
  const canStart = isHost && room.players.length >= MIN_PLAYERS && allGuestsReady;

  const copyInviteLink = (): void => {
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}/join/${room.code}`
        : `/join/${room.code}`;

    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div className="screen screen--centered">
      <div className="stack">
        <header className="brand" style={{ margin: '10px 0 0' }}>
          <h1 className="brand__title" style={{ fontSize: 'clamp(2rem, 8vw, 3.2rem)' }}>
            Lobby
          </h1>
          <p className="brand__tagline">
            Gather your friends. One edge each, one ball, survival to the end.
          </p>
        </header>

        {/* Room Code Card */}
        <section className="panel" style={{ textAlign: 'center' }}>
          <div className="field__label" style={{ justifyContent: 'center', marginBottom: 6 }}>
            Room Code
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'clamp(2.2rem, 8vw, 3.4rem)',
              fontWeight: 800,
              letterSpacing: '0.2em',
              color: 'var(--accent)',
              textShadow: '0 0 20px rgba(34, 211, 238, 0.5)',
              marginBottom: 14,
            }}
          >
            {room.code}
          </div>
          <div className="row row--center">
            <button type="button" className="btn btn--small btn--ghost" onClick={copyInviteLink}>
              {copied ? '✓ Link Copied!' : '📋 Copy Invite Link'}
            </button>
          </div>
        </section>

        {/* Players List */}
        <section className="panel">
          <h2 className="panel__title">
            <span>Players</span>
            <span className="field__value">
              {room.players.length} / {room.options.maxPlayers}
            </span>
          </h2>

          <ul className="players">
            {room.players.map((player) => {
              const color = colorForPlayer(player.colorIndex);
              const isYou = player.id === localPlayerId;

              return (
                <li
                  key={player.id}
                  className="players__item"
                  style={{
                    borderColor: isYou ? 'var(--accent)' : undefined,
                    background: isYou ? 'rgba(34, 211, 238, 0.08)' : undefined,
                  }}
                >
                  <div
                    className="players__dot"
                    style={{
                      background: color,
                      boxShadow: `0 0 10px ${color}`,
                    }}
                  />
                  {showSymbols ? (
                    <span style={{ color, fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>
                      {symbolForPlayer(player.colorIndex)}
                    </span>
                  ) : null}
                  <span className="players__name" style={{ fontWeight: isYou ? 700 : 500 }}>
                    {player.name}
                    {isYou ? ' (You)' : ''}
                  </span>

                  {player.isHost ? (
                    <span className="badge" style={{ borderColor: '#fbbf24', color: '#fbbf24' }}>
                      Host
                    </span>
                  ) : null}

                  {!player.connected ? (
                    <span className="badge" style={{ borderColor: '#fb7185', color: '#fb7185' }}>
                      Offline
                    </span>
                  ) : player.isHost ? (
                    <span className="badge" style={{ borderColor: '#a3e635', color: '#a3e635' }}>
                      Ready
                    </span>
                  ) : player.ready ? (
                    <span className="badge" style={{ borderColor: '#a3e635', color: '#a3e635' }}>
                      ✓ Ready
                    </span>
                  ) : (
                    <span className="badge">Waiting...</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Room Settings Summary */}
        <section className="panel">
          <h2 className="panel__title">
            <span>Match Rules</span>
          </h2>
          <div
            className="row row--between"
            style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}
          >
            <span>
              Lives per player:{' '}
              <strong style={{ color: 'var(--text)' }}>{room.options.lives}</strong>
            </span>
            <span>
              Arena shrinking:{' '}
              <strong style={{ color: 'var(--text)' }}>
                {room.options.shrinkEnabled ? 'On' : 'Off'}
              </strong>
            </span>
            <span>
              Mode:{' '}
              <strong style={{ color: 'var(--text)', textTransform: 'capitalize' }}>
                {room.options.mode}
              </strong>
            </span>
          </div>
        </section>

        {/* Action Controls */}
        <div className="stack" style={{ gap: 10, marginTop: 4 }}>
          {isHost ? (
            <div>
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={!canStart}
                onClick={onStartMatch}
              >
                Start Match
              </button>
              {!canStart ? (
                <p className="hint" style={{ textAlign: 'center', marginTop: 8 }}>
                  {room.players.length < MIN_PLAYERS
                    ? `Waiting for at least ${MIN_PLAYERS} players to join...`
                    : 'Waiting for all guests to click Ready...'}
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className={isReady ? 'btn btn--ghost btn--block' : 'btn btn--primary btn--block'}
              onClick={onToggleReady}
            >
              {isReady ? 'Cancel Ready' : 'Ready Up'}
            </button>
          )}

          <button type="button" className="btn btn--danger btn--block" onClick={onLeave}>
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}
