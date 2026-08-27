import { DEFAULT_LIVES, MAX_LIVES, MIN_LIVES, PLAYER_COLORS } from '../constants/index';
import { clamp } from '../geometry/vector';
import type { MatchStatsRow, MatchSummary, PlayerSeed, PlayerState } from '../types/index';

export const clampLives = (lives: number): number =>
  Math.round(clamp(Number.isFinite(lives) ? lives : DEFAULT_LIVES, MIN_LIVES, MAX_LIVES));

/** Build match players from seeds, assigning numbers, colours and edges in order. */
export function createPlayers(seeds: PlayerSeed[], lives = DEFAULT_LIVES): PlayerState[] {
  const startingLives = clampLives(lives);
  return seeds.map((seed, index) => ({
    id: seed.id,
    name: seed.name,
    number: index + 1,
    colorIndex: seed.colorIndex ?? index % PLAYER_COLORS.length,
    edgeIndex: index,
    paddlePosition: 0.5,
    paddleLength: 0,
    paddleVelocity: 0,
    lives: startingLives,
    alive: true,
    hits: 0,
    misses: 0,
    eliminations: 0,
    longestRally: 0,
    connected: true,
    isAI: seed.isAI ?? false,
    isLocal: seed.isLocal ?? false,
    eliminatedAt: null,
    placement: null,
  }));
}

export const alivePlayers = (players: PlayerState[]): PlayerState[] =>
  players.filter((p) => p.alive);

export const findPlayer = (players: PlayerState[], id: string | null): PlayerState | undefined =>
  id === null ? undefined : players.find((p) => p.id === id);

export interface DamageResult {
  livesLeft: number;
  eliminated: boolean;
}

/** Remove one life. Returns whether that emptied the player's last life. */
export function damagePlayer(player: PlayerState, elapsed: number): DamageResult {
  if (!player.alive) return { livesLeft: player.lives, eliminated: false };
  player.misses += 1;
  player.lives = Math.max(0, player.lives - 1);
  if (player.lives === 0) {
    player.alive = false;
    player.eliminatedAt = elapsed;
    return { livesLeft: 0, eliminated: true };
  }
  return { livesLeft: player.lives, eliminated: false };
}

/**
 * Placement is assigned from the bottom up: the first player knocked out takes
 * the last place, and the survivor of a match takes 1st.
 */
export function nextPlacement(players: PlayerState[]): number {
  const assigned = players.filter((p) => p.placement !== null).length;
  return players.length - assigned;
}

/** The single surviving player, or null while two or more are still alive. */
export function findWinner(players: PlayerState[]): PlayerState | null {
  const survivors = alivePlayers(players);
  return survivors.length === 1 ? survivors[0] : null;
}

export const isMatchOver = (players: PlayerState[]): boolean => alivePlayers(players).length <= 1;

/** Finalise placements for whoever is still standing when the match ends. */
export function finalisePlacements(players: PlayerState[]): void {
  // Worst survivor first: nextPlacement() hands out the lowest remaining rank
  // (i.e. the largest number), so the strongest survivor ends up with 1st.
  const survivors = players
    .filter((p) => p.placement === null)
    .sort((a, b) => a.lives - b.lives || b.misses - a.misses || b.number - a.number);
  for (const player of survivors) {
    player.placement = nextPlacement(players);
  }
}

export function toStatsRow(player: PlayerState, duration: number): MatchStatsRow {
  return {
    id: player.id,
    name: player.name,
    number: player.number,
    colorIndex: player.colorIndex,
    placement: player.placement ?? 0,
    lives: player.lives,
    hits: player.hits,
    misses: player.misses,
    eliminations: player.eliminations,
    longestRally: player.longestRally,
    survivedFor: player.eliminatedAt ?? duration,
  };
}

export function buildSummary(
  players: PlayerState[],
  duration: number,
  longestRally: number,
): MatchSummary {
  const ranking = players
    .map((p) => toStatsRow(p, duration))
    .sort((a, b) => a.placement - b.placement);
  const winner = players.find((p) => p.placement === 1) ?? null;
  return {
    winnerId: winner?.id ?? null,
    winnerName: winner?.name ?? null,
    duration,
    longestRally,
    ranking,
  };
}
