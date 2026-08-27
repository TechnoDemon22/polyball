import { colorForPlayer, symbolForPlayer } from '../rendering/palette';
import type { HudPlayer } from '../game/practice';

export interface PlayerListProps {
  players: HudPlayer[];
  showSymbols: boolean;
}

/** Roster used in the practice setup screen and in the pause dialog. */
export function PlayerList({ players, showSymbols }: PlayerListProps): JSX.Element {
  return (
    <ul className="players">
      {players.map((player) => (
        <li className="players__item" key={player.id} data-out={!player.alive}>
          <span
            className="players__dot"
            style={{ background: colorForPlayer(player.colorIndex) }}
            aria-hidden="true"
          />
          {showSymbols ? (
            <span aria-hidden="true">{symbolForPlayer(player.colorIndex)}</span>
          ) : null}
          <span className="players__name">
            {player.name}
            {player.isLocal ? ' (you)' : ''}
          </span>
          <span className="players__lives">
            {player.alive ? `${player.lives} ${player.lives === 1 ? 'life' : 'lives'}` : 'out'}
          </span>
        </li>
      ))}
    </ul>
  );
}
