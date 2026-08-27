import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MatchSummary } from '@polyball/shared';
import type { AudioEngine } from '../game/audio';
import { MultiplayerSession } from '../game/multiplayer';
import type { NetworkClient } from '../game/network';
import type { HudSnapshot } from '../game/practice';
import type { Size } from '../hooks/useElementSize';
import type { Settings } from '../hooks/useSettings';
import { insetFor, layoutForViewport, touchLayoutStyle } from '../rendering/layout';
import { GameCanvas } from './GameCanvas';
import { GameOverOverlay } from './GameOverOverlay';
import { HowToPlay } from './HowToPlay';
import { Hud } from './Hud';
import { Modal } from './Modal';
import { PlayerList } from './PlayerList';
import { SettingsPanel } from './SettingsPanel';
import { TouchControls } from './TouchControls';

export interface MultiplayerScreenProps {
  network: NetworkClient;
  settings: Settings;
  toggleSetting: (key: keyof Settings) => void;
  audio: AudioEngine;
  onReturnToLobby: () => void;
  onLeaveRoom: () => void;
}

type Dialog = 'none' | 'menu' | 'settings' | 'help';

const requestFullscreen = (): void => {
  const element = document.documentElement;
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  void element.requestFullscreen?.().catch(() => undefined);
};

export function MultiplayerScreen({
  network,
  settings,
  toggleSetting,
  audio,
  onReturnToLobby,
  onLeaveRoom,
}: MultiplayerScreenProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [session, setSession] = useState<MultiplayerSession | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [dialog, setDialog] = useState<Dialog>('none');
  const [isReconnecting, setIsReconnecting] = useState(!network.isConnected);

  useEffect(() => {
    const unsubReconnecting = network.on('reconnecting', () => setIsReconnecting(true));
    const unsubConnected = network.on('connected', () => setIsReconnecting(false));
    const unsubDisconnected = network.on('disconnected', () => setIsReconnecting(true));

    return () => {
      unsubReconnecting();
      unsubConnected();
      unsubDisconnected();
    };
  }, [network]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const created = new MultiplayerSession({
      canvas,
      network,
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
  }, [network, audio]);

  useEffect(() => {
    session?.setSettings(settings);
  }, [session, settings]);

  const handleRematch = useCallback((): void => {
    setSummary(null);
    setDialog('none');
    network.requestRematch();
  }, [network]);

  const handleReturnToLobby = useCallback((): void => {
    setSummary(null);
    setDialog('none');
    network.returnToLobby();
    onReturnToLobby();
  }, [network, onReturnToLobby]);

  const handleLeave = useCallback((): void => {
    network.leaveRoom();
    onLeaveRoom();
  }, [network, onLeaveRoom]);

  const players = hud?.players ?? [];
  const showTouch = settings.showTouchControls && !summary;

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
            onTogglePause={() => setDialog(dialog === 'none' ? 'menu' : 'none')}
            onToggleSound={() => toggleSetting('sound')}
            onToggleFullscreen={requestFullscreen}
            onOpenSettings={() => setDialog('settings')}
            onQuit={handleLeave}
          />
        ) : null}

        {isReconnecting ? (
          <div
            className="hud__banner"
            style={{
              position: 'absolute',
              top: 54,
              left: '50%',
              transform: 'translateX(-50%)',
              borderColor: '#fb7185',
              background: 'rgba(251, 113, 133, 0.2)',
              zIndex: 30,
            }}
          >
            Reconnecting to server...
          </div>
        ) : null}

        {showTouch && session ? <TouchControls input={session.input} layout={layout} /> : null}

        {summary ? (
          <GameOverOverlay
            summary={summary}
            localPlayerId={network.localPlayerId ?? ''}
            showSymbols={settings.symbols}
            onRematch={handleRematch}
            onChangeSetup={handleReturnToLobby}
            onHome={handleLeave}
          />
        ) : null}
      </GameCanvas>

      {dialog === 'menu' && !summary ? (
        <Modal title="Match Menu" onClose={() => setDialog('none')}>
          <PlayerList players={players} showSymbols={settings.symbols} />
          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn--primary" onClick={() => setDialog('none')}>
              Resume
            </button>
            <button type="button" className="btn btn--ghost" onClick={handleReturnToLobby}>
              Return to Lobby
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setDialog('help')}>
              How to play
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setDialog('settings')}>
              Settings
            </button>
            <button type="button" className="btn btn--danger" onClick={handleLeave}>
              Leave Room
            </button>
          </div>
        </Modal>
      ) : null}

      {dialog === 'settings' ? (
        <Modal title="Settings" onClose={() => setDialog('none')}>
          <SettingsPanel settings={settings} toggle={toggleSetting} />
        </Modal>
      ) : null}

      {dialog === 'help' ? (
        <Modal title="How to play" onClose={() => setDialog('none')}>
          <HowToPlay />
        </Modal>
      ) : null}
    </div>
  );
}
