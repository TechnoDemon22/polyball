import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MatchSummary } from '@polyball/shared';
import { GameCanvas } from './GameCanvas';
import { GameOverOverlay } from './GameOverOverlay';
import { HowToPlay } from './HowToPlay';
import { Hud } from './Hud';
import { Modal } from './Modal';
import { PlayerList } from './PlayerList';
import { SettingsPanel } from './SettingsPanel';
import { TouchControls } from './TouchControls';
import {
  createPracticeConfig,
  LOCAL_PLAYER_ID,
  PracticeSession,
  type HudSnapshot,
  type PracticeOptions,
} from '../game/practice';
import { insetFor, layoutForViewport, touchLayoutStyle } from '../rendering/layout';
import type { Size } from '../hooks/useElementSize';
import type { AudioEngine } from '../game/audio';
import type { Settings } from '../hooks/useSettings';

export interface PracticeScreenProps {
  options: PracticeOptions;
  settings: Settings;
  toggleSetting: (key: keyof Settings) => void;
  audio: AudioEngine;
  /** Back to the practice setup screen. */
  onExit: () => void;
  onHome: () => void;
}

type Dialog = 'none' | 'paused' | 'settings' | 'help';

const requestFullscreen = (): void => {
  const element = document.documentElement;
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  void element.requestFullscreen?.().catch(() => undefined);
};

/**
 * Practice Mode. The PracticeSession owns the 60 Hz loop and the canvas; React
 * only renders the HUD from throttled snapshots, so no component re-renders in
 * the middle of a rally.
 */
export function PracticeScreen({
  options,
  settings,
  toggleSetting,
  audio,
  onExit,
  onHome,
}: PracticeScreenProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [session, setSession] = useState<PracticeSession | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [dialog, setDialog] = useState<Dialog>('none');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const created = new PracticeSession({
      canvas,
      config: createPracticeConfig(options),
      difficulty: options.difficulty,
      settings: settingsRef.current,
      audio,
      onHud: setHud,
      onFinished: setSummary,
    });
    setSession(created);
    created.start();

    return () => {
      created.dispose();
      setSession(null);
      setHud(null);
      setSummary(null);
    };
  }, [options, audio]);

  useEffect(() => {
    session?.setSettings(settings);
  }, [session, settings]);

  // Losing focus (tab switch, phone call, app switch) must never cost a life.
  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') session?.pause();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [session]);

  const openDialog = useCallback(
    (next: Dialog): void => {
      if (next !== 'none') session?.pause();
      setDialog(next);
    },
    [session],
  );

  const closeDialog = useCallback((): void => {
    setDialog('none');
    if (!summary) session?.resume();
  }, [session, summary]);

  const togglePause = useCallback((): void => {
    if (!session) return;
    if (session.isPaused) {
      setDialog('none');
      session.resume();
    } else {
      session.pause();
      setDialog('paused');
    }
  }, [session]);

  const restart = useCallback((): void => {
    setSummary(null);
    setDialog('none');
    session?.restart();
  }, [session]);

  // The Escape / P shortcut pauses inside the session, so mirror that in React.
  const paused = hud?.paused ?? false;
  useEffect(() => {
    if (paused && dialog === 'none' && !summary) setDialog('paused');
  }, [paused, dialog, summary]);

  const players = hud?.players ?? [];
  const showTouch = settings.showTouchControls && !summary;

  // The control layout decides how much of the viewport the pads cover, which
  // the camera needs so the arena is never drawn underneath them.
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const layout = layoutForViewport(showTouch, stage.width, stage.height);
  const inset = useMemo(() => insetFor(layout), [layout]);

  return (
    <div className="game" data-touch={showTouch} style={touchLayoutStyle(layout)}>
      <GameCanvas session={session} canvasRef={canvasRef} inset={inset} onResize={setStage}>
        {hud ? (
          <Hud
            hud={hud}
            showSymbols={settings.symbols}
            soundOn={settings.sound}
            onTogglePause={togglePause}
            onToggleSound={() => toggleSetting('sound')}
            onToggleFullscreen={requestFullscreen}
            onOpenSettings={() => openDialog('settings')}
            onQuit={onExit}
          />
        ) : null}

        {showTouch && session ? <TouchControls input={session.input} layout={layout} /> : null}

        {summary ? (
          <GameOverOverlay
            summary={summary}
            localPlayerId={LOCAL_PLAYER_ID}
            showSymbols={settings.symbols}
            onRematch={restart}
            onChangeSetup={onExit}
            onHome={onHome}
          />
        ) : null}
      </GameCanvas>

      {dialog === 'paused' && !summary ? (
        <Modal title="Paused" onClose={closeDialog}>
          <PlayerList players={players} showSymbols={settings.symbols} />
          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn--primary" onClick={closeDialog}>
              Resume
            </button>
            <button type="button" className="btn btn--ghost" onClick={restart}>
              Restart
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setDialog('help')}>
              How to play
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setDialog('settings')}>
              Settings
            </button>
            <button type="button" className="btn btn--danger" onClick={onExit}>
              Quit match
            </button>
          </div>
        </Modal>
      ) : null}

      {dialog === 'settings' ? (
        <Modal title="Settings" onClose={closeDialog}>
          <SettingsPanel settings={settings} toggle={toggleSetting} />
        </Modal>
      ) : null}

      {dialog === 'help' ? (
        <Modal title="How to play" onClose={closeDialog}>
          <HowToPlay />
        </Modal>
      ) : null}
    </div>
  );
}
