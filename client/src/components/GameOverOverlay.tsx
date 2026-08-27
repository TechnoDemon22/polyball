import { colorForPlayer, symbolForPlayer } from '../rendering/palette';
import type { MatchSummary } from '@polyball/shared';

export interface GameOverOverlayProps {
  summary: MatchSummary;
  localPlayerId: string;
  showSymbols: boolean;
  onRematch: () => void;
  onChangeSetup: () => void;
  onHome: () => void;
}

const seconds = (value: number): string => `${value.toFixed(1)}s`;

/** End-of-match card: placement, per-player stats and the rematch controls. */
export function GameOverOverlay({
  summary,
  localPlayerId,
  showSymbols,
  onRematch,
  onChangeSetup,
  onHome,
}: GameOverOverlayProps): JSX.Element {
  const localRow = summary.ranking.find((row) => row.id === localPlayerId);
  const won = summary.winnerId === localPlayerId;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Match results">
      <div className="overlay__card">
        <h2 className="overlay__headline">
          {won ? 'You win' : `${summary.winnerName ?? 'Nobody'} wins`}
        </h2>
        <p className="hint">
          {localRow
            ? `You placed ${localRow.placement} of ${summary.ranking.length} with ${localRow.hits} hits and ${localRow.eliminations} eliminations.`
            : 'Match complete.'}{' '}
          Duration {seconds(summary.duration)}, longest rally {summary.longestRally}.
        </p>

        <table className="table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Player</th>
              <th scope="col">Hits</th>
              <th scope="col">Miss</th>
              <th scope="col">KO</th>
              <th scope="col">Rally</th>
              <th scope="col">Alive</th>
            </tr>
          </thead>
          <tbody>
            {summary.ranking.map((row) => (
              <tr key={row.id} data-you={row.id === localPlayerId}>
                <td>{row.placement}</td>
                <td style={{ color: colorForPlayer(row.colorIndex) }}>
                  {showSymbols ? `${symbolForPlayer(row.colorIndex)} ` : ''}
                  {row.name}
                </td>
                <td>{row.hits}</td>
                <td>{row.misses}</td>
                <td>{row.eliminations}</td>
                <td>{row.longestRally}</td>
                <td>{seconds(row.survivedFor)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn--primary" onClick={onRematch}>
            Rematch
          </button>
          <button type="button" className="btn btn--ghost" onClick={onChangeSetup}>
            Change setup
          </button>
          <button type="button" className="btn btn--ghost" onClick={onHome}>
            Home
          </button>
        </div>
      </div>
    </div>
  );
}
