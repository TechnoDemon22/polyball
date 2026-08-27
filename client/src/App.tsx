import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RoomOptions, RoomSnapshot } from '@polyball/shared';
import { CreateRoomModal } from './components/CreateRoomModal';
import { LandingPage } from './components/LandingPage';
import { LobbyScreen } from './components/LobbyScreen';
import { MultiplayerScreen } from './components/MultiplayerScreen';
import { PracticeScreen } from './components/PracticeScreen';
import { PracticeSetup } from './components/PracticeSetup';
import { AudioEngine } from './game/audio';
import { NetworkClient, loadSession } from './game/network';
import type { PracticeOptions } from './game/practice';
import { usePlayerName } from './hooks/usePlayerName';
import { useSettings } from './hooks/useSettings';
import { useRoute } from './router';

/**
 * Screen switch for the whole app.
 *
 * Manages routing between Landing, Practice Setup / Live Practice Match,
 * Online Lobby, and Online Real-Time Multiplayer Match.
 */
export function App(): JSX.Element {
  const { route, go } = useRoute();
  const { settings, toggle } = useSettings();
  const [name, setName] = usePlayerName();
  const [practiceOptions, setPracticeOptions] = useState<PracticeOptions | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [networkRoom, setNetworkRoom] = useState<RoomSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const audio = useMemo(() => new AudioEngine(), []);
  useEffect(() => () => audio.dispose(), [audio]);
  useEffect(() => audio.setEnabled(settings.sound), [audio, settings.sound]);

  const network = useMemo(() => new NetworkClient(), []);
  useEffect(() => () => network.disconnect(), [network]);

  // Hook network events to React state
  useEffect(() => {
    const unsubCreated = network.on('roomCreated', (room) => {
      setNetworkRoom(room);
      setErrorMessage(null);
      go(`/room/${room.code}`);
    });

    const unsubJoined = network.on('roomJoined', (room) => {
      setNetworkRoom(room);
      setErrorMessage(null);
      go(`/room/${room.code}`);
    });

    const unsubState = network.on('roomState', (room) => {
      setNetworkRoom(room);
    });

    const unsubError = network.on('error', (_code, msg) => {
      setErrorMessage(msg);
    });

    return () => {
      unsubCreated();
      unsubJoined();
      unsubState();
      unsubError();
    };
  }, [network, go]);

  // Handle route changes
  useEffect(() => {
    if (route.name !== 'practice') setPracticeOptions(null);

    // If navigating to /room/:code directly or via refresh, attempt to join / reconnect
    if (route.name === 'room') {
      if (!network.activeRoom || network.activeRoom.code !== route.code) {
        const session = loadSession();
        const token = session?.roomCode === route.code ? session.reconnectToken : undefined;
        network.joinRoom(route.code, name || 'Player', token);
      }
    }
  }, [route, network, name]);

  const openPractice = useCallback((): void => {
    audio.unlock();
    go('/practice');
  }, [audio, go]);

  const startPracticeMatch = useCallback(
    (next: PracticeOptions): void => {
      audio.unlock();
      setPracticeOptions(next);
    },
    [audio],
  );

  const goHome = useCallback((): void => {
    setPracticeOptions(null);
    if (network.activeRoom) {
      network.leaveRoom();
    }
    setNetworkRoom(null);
    setErrorMessage(null);
    go('/');
  }, [go, network]);

  const handleCreateRoom = useCallback(
    (options: RoomOptions): void => {
      audio.unlock();
      setCreateModalOpen(false);
      network.createRoom(name || 'Host', options);
    },
    [audio, network, name],
  );

  const handleJoinRoom = useCallback(
    (code: string): void => {
      audio.unlock();
      const session = loadSession();
      const token = session?.roomCode === code ? session.reconnectToken : undefined;
      network.joinRoom(code, name || 'Guest', token);
    },
    [audio, network, name],
  );

  const handleLeaveRoom = useCallback((): void => {
    network.leaveRoom();
    setNetworkRoom(null);
    go('/');
  }, [network, go]);

  // Render Practice Mode
  if (route.name === 'practice') {
    if (practiceOptions) {
      return (
        <PracticeScreen
          options={practiceOptions}
          settings={settings}
          toggleSetting={toggle}
          audio={audio}
          onExit={() => setPracticeOptions(null)}
          onHome={goHome}
        />
      );
    }
    return (
      <PracticeSetup
        name={name}
        onNameChange={setName}
        onStart={startPracticeMatch}
        onBack={goHome}
      />
    );
  }

  // Render Online Room (Lobby or In-Game)
  if (route.name === 'room' && networkRoom) {
    const isPlaying =
      networkRoom.status === 'countdown' ||
      networkRoom.status === 'playing' ||
      networkRoom.status === 'finished';

    if (isPlaying) {
      return (
        <MultiplayerScreen
          network={network}
          settings={settings}
          toggleSetting={toggle}
          audio={audio}
          onReturnToLobby={() => {
            network.returnToLobby();
          }}
          onLeaveRoom={handleLeaveRoom}
        />
      );
    }

    return (
      <LobbyScreen
        room={networkRoom}
        localPlayerId={network.localPlayerId}
        showSymbols={settings.symbols}
        onToggleReady={() => {
          const me = networkRoom.players.find((p) => p.id === network.localPlayerId);
          network.setReady(!me?.ready);
        }}
        onStartMatch={() => {
          network.startMatch();
        }}
        onLeave={handleLeaveRoom}
      />
    );
  }

  // Render Landing Page
  return (
    <>
      <LandingPage
        settings={settings}
        toggleSetting={toggle}
        onPractice={openPractice}
        onCreateRoom={() => {
          audio.unlock();
          setCreateModalOpen(true);
        }}
        onJoinRoom={handleJoinRoom}
        joinCode={route.name === 'join' ? route.code : undefined}
        errorMessage={errorMessage}
      />

      {createModalOpen ? (
        <CreateRoomModal
          name={name}
          onNameChange={setName}
          onCreate={handleCreateRoom}
          onClose={() => setCreateModalOpen(false)}
        />
      ) : null}
    </>
  );
}
