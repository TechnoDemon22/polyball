import {
  BALL_MAX_SPEED,
  BALL_START_SPEED,
  DEFAULT_LIVES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SHRINK_START_TIME,
} from '@polyball/shared';

/** Rules explainer, shown from the landing page and the pause dialog. */
export function HowToPlay(): JSX.Element {
  return (
    <div>
      <p>
        You defend one edge of a polygon arena. Every player gets exactly one edge, and one ball is
        shared by everybody. Miss the ball and you lose a life.
      </p>
      <h3>Controls</h3>
      <ul>
        <li>
          <span className="kbd">A</span> / <span className="kbd">D</span> or{' '}
          <span className="kbd">←</span> / <span className="kbd">→</span> to slide your paddle.
        </li>
        <li>Mouse, touch or pen: press and drag anywhere - your paddle follows along its edge.</li>
        <li>On a phone, use the two pads at the bottom or the drag strip above them.</li>
        <li>
          <span className="kbd">Esc</span> or <span className="kbd">P</span> pauses.
        </li>
      </ul>
      <h3>Rules</h3>
      <ul>
        <li>
          {MIN_PLAYERS} to {MAX_PLAYERS} players, {DEFAULT_LIVES} lives each by default.
        </li>
        <li>
          Lose all your lives and your edge turns into a solid wall - the ball bounces off it.
        </li>
        <li>
          The ball starts at {BALL_START_SPEED} units/s and accelerates with time and with every
          hit, up to {BALL_MAX_SPEED}.
        </li>
        <li>
          After {SHRINK_START_TIME} seconds the arena starts shrinking, so rallies get tighter. A
          dashed outline previews the next boundary.
        </li>
        <li>Last player standing wins.</li>
      </ul>
      <h3>Tips</h3>
      <ul>
        <li>Hit the ball with the edge of your paddle to angle it away from you.</li>
        <li>Move while you hit: paddle motion adds spin.</li>
        <li>
          Eliminated players become walls, which makes late rallies faster and less predictable.
        </li>
      </ul>
    </div>
  );
}
