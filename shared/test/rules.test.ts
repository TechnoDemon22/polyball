import { describe, expect, it } from 'vitest';
import {
  alivePlayers,
  buildSummary,
  clampLives,
  createPlayers,
  damagePlayer,
  DEFAULT_LIVES,
  finalisePlacements,
  findPlayer,
  findWinner,
  isMatchOver,
  MAX_LIVES,
  nextPlacement,
  PLAYER_COLORS,
  type PlayerSeed,
} from '../src/index';

const seeds = (count: number): PlayerSeed[] =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

describe('player creation', () => {
  it('numbers players from one and gives each a distinct colour', () => {
    const players = createPlayers(seeds(12));
    expect(players.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(players.map((p) => p.colorIndex)).size).toBe(12);
    expect(players.every((p) => p.colorIndex < PLAYER_COLORS.length)).toBe(true);
  });

  it('starts everyone alive with three lives and a centred paddle', () => {
    for (const player of createPlayers(seeds(6))) {
      expect(player.lives).toBe(DEFAULT_LIVES);
      expect(player.alive).toBe(true);
      expect(player.paddlePosition).toBe(0.5);
      expect(player.placement).toBeNull();
    }
  });

  it('clamps unreasonable life counts', () => {
    expect(clampLives(0)).toBe(1);
    expect(clampLives(99)).toBe(MAX_LIVES);
    expect(clampLives(Number.NaN)).toBe(DEFAULT_LIVES);
    expect(createPlayers(seeds(3), 5)[0].lives).toBe(5);
  });
});

describe('life reduction', () => {
  it('removes exactly one life per miss and counts the miss', () => {
    const [player] = createPlayers(seeds(1));
    expect(damagePlayer(player, 10)).toEqual({ livesLeft: 2, eliminated: false });
    expect(player.misses).toBe(1);
    expect(player.lives).toBe(2);
    expect(player.alive).toBe(true);
  });

  it('eliminates a player when their last life is taken', () => {
    const [player] = createPlayers(seeds(1));
    damagePlayer(player, 1);
    damagePlayer(player, 2);
    const result = damagePlayer(player, 42.5);
    expect(result).toEqual({ livesLeft: 0, eliminated: true });
    expect(player.alive).toBe(false);
    expect(player.lives).toBe(0);
    expect(player.eliminatedAt).toBe(42.5);
  });

  it('cannot take a life from an eliminated player', () => {
    const [player] = createPlayers(seeds(1), 1);
    damagePlayer(player, 1);
    const misses = player.misses;
    expect(damagePlayer(player, 2)).toEqual({ livesLeft: 0, eliminated: false });
    expect(player.misses).toBe(misses);
    expect(player.lives).toBe(0);
  });
});

describe('placements and winner selection', () => {
  it('assigns last place to the first player knocked out', () => {
    const players = createPlayers(seeds(4), 1);
    expect(nextPlacement(players)).toBe(4);
    damagePlayer(players[1], 5);
    players[1].placement = nextPlacement(players);
    expect(players[1].placement).toBe(4);
    damagePlayer(players[3], 9);
    players[3].placement = nextPlacement(players);
    expect(players[3].placement).toBe(3);
  });

  it('reports no winner while two players are still alive', () => {
    const players = createPlayers(seeds(3), 1);
    damagePlayer(players[0], 1);
    expect(findWinner(players)).toBeNull();
    expect(isMatchOver(players)).toBe(false);
  });

  it('selects the last player standing', () => {
    const players = createPlayers(seeds(3), 1);
    damagePlayer(players[0], 1);
    damagePlayer(players[2], 2);
    expect(isMatchOver(players)).toBe(true);
    expect(findWinner(players)?.id).toBe('p2');
    expect(alivePlayers(players)).toHaveLength(1);
  });

  it('gives the survivor first place when the match ends', () => {
    const players = createPlayers(seeds(3), 1);
    damagePlayer(players[0], 1);
    players[0].placement = nextPlacement(players);
    damagePlayer(players[2], 2);
    players[2].placement = nextPlacement(players);
    finalisePlacements(players);
    expect(players[1].placement).toBe(1);
  });

  it('ranks survivors of a draw-free match by lives then misses', () => {
    const players = createPlayers(seeds(3), 3);
    players[0].lives = 1;
    players[1].lives = 3;
    players[2].lives = 2;
    finalisePlacements(players);
    expect(players[1].placement).toBe(1);
    expect(players[2].placement).toBe(2);
    expect(players[0].placement).toBe(3);
  });
});

describe('match summary', () => {
  it('sorts the ranking and reports the winner', () => {
    const players = createPlayers(seeds(3), 1);
    players[0].hits = 12;
    players[0].longestRally = 5;
    damagePlayer(players[1], 8);
    players[1].placement = nextPlacement(players);
    damagePlayer(players[2], 20);
    players[2].placement = nextPlacement(players);
    finalisePlacements(players);

    const summary = buildSummary(players, 61.5, 9);
    expect(summary.winnerId).toBe('p1');
    expect(summary.winnerName).toBe('Player 1');
    expect(summary.duration).toBe(61.5);
    expect(summary.longestRally).toBe(9);
    expect(summary.ranking.map((r) => r.placement)).toEqual([1, 2, 3]);
    expect(summary.ranking[0].hits).toBe(12);
    // Eliminated players keep the time they went out; survivors get the duration.
    expect(summary.ranking[0].survivedFor).toBe(61.5);
    expect(summary.ranking.find((r) => r.id === 'p2')?.survivedFor).toBe(8);
  });

  it('finds players by id and ignores nulls', () => {
    const players = createPlayers(seeds(2));
    expect(findPlayer(players, 'p2')?.name).toBe('Player 2');
    expect(findPlayer(players, null)).toBeUndefined();
    expect(findPlayer(players, 'nope')).toBeUndefined();
  });
});
