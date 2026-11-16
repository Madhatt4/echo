import { useCallback, useEffect, useState } from 'react';
import type { ArchiveStatus } from '../shared/api.ts';
import { AdviceScreen } from './screens/AdviceScreen.tsx';
import { BlindTestScreen } from './screens/BlindTestScreen.tsx';
import { ChatScreen } from './screens/ChatScreen.tsx';
import { HomeScreen } from './screens/HomeScreen.tsx';
import { InterviewScreen } from './screens/InterviewScreen.tsx';
import { MemoryScreen } from './screens/MemoryScreen.tsx';
import { MessagesScreen } from './screens/MessagesScreen.tsx';
import { LettersScreen } from './screens/LettersScreen.tsx';
import { TrayScreen } from './screens/TrayScreen.tsx';
import type { TrayService } from '../shared/door.ts';
import { SheetScreen } from './screens/SheetScreen.tsx';
import { LockScreen } from './screens/LockScreen.tsx';
import { MissingScreen } from './screens/MissingScreen.tsx';
import { NewPassphraseScreen } from './screens/NewPassphraseScreen.tsx';
import { PeopleScreen } from './screens/PeopleScreen.tsx';
import { RecoveryKitScreen } from './screens/RecoveryKitScreen.tsx';
import { ConsentScreen } from './screens/ConsentScreen.tsx';
import { CreateArchiveScreen } from './screens/CreateArchiveScreen.tsx';
import { FaceScreen } from './screens/FaceScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { StoriesScreen } from './screens/StoriesScreen.tsx';
import { VoiceScreen } from './screens/VoiceScreen.tsx';

export function App() {
  const [status, setStatus] = useState<ArchiveStatus | null>(null);
  const [version, setVersion] = useState('');
  // Which screen is showing once the archive is open and the recovery kit exists.
  const [view, setView] = useState<'home' | 'settings' | 'new-kit' | 'consent' | 'people' | 'stories' | 'face' | 'voice' | 'interview' | 'advice' | 'memories' | 'character' | 'style' | 'chat' | 'blind-test' | 'messages' | 'letters' | 'tray'>('home');
  /** A file from the assistant's tray that the Messages screen should open as soon as it appears. */
  const [fromTray, setFromTray] = useState<{ id: string; service: TrayService } | null>(null);

  const refresh = useCallback(async () => {
    const latest = await window.echo.archive.status();
    if (latest.state !== 'unlocked') setView('home');
    setStatus(latest);
  }, []);

  useEffect(() => {
    void refresh();
    void window.echo.version().then(setVersion);
  }, [refresh]);

  return (
    <div className="page">
      <header className="masthead no-print">
        <h1>Echo</h1>
        <p className="lede">
          Capture yourself while you are alive, so your family can keep talking to an AI echo of you
          afterwards.
        </p>
      </header>

      <main>
        {status?.state === 'none' && <CreateArchiveScreen onDone={refresh} />}
        {status?.state === 'missing' && <MissingScreen archivePath={status.archivePath ?? ''} onDone={refresh} />}
        {status?.state === 'locked' && (
          <LockScreen archivePath={status.archivePath ?? ''} hasRecoveryKit={status.recoveryKit} onDone={refresh} />
        )}
        {status?.state === 'unlocked' && status.needsNewPassphrase && <NewPassphraseScreen onDone={refresh} />}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && !status.recoveryKit && (
          <RecoveryKitScreen onDone={refresh} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'home' && (
          <HomeScreen
            archivePath={status.archivePath ?? ''}
            onLocked={refresh}
            onOpenSetup={() => setView('settings')}
            onOpenConsent={() => setView('consent')}
            onOpenPeople={() => setView('people')}
            onOpenStories={() => setView('stories')}
            onOpenFace={() => setView('face')}
            onOpenVoice={() => setView('voice')}
            onOpenInterview={() => setView('interview')}
            onOpenAdvice={() => setView('advice')}
            onOpenMemories={() => setView('memories')}
            onOpenSheet={(kind) => setView(kind)}
            onOpenChat={() => setView('chat')}
            onOpenBlindTest={() => setView('blind-test')}
            onOpenMessages={() => setView('messages')}
            onOpenTray={() => setView('tray')}
          />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'messages' && (
          <MessagesScreen
            onBack={() => setView('home')}
            onOpenStyle={() => setView('style')}
            onOpenLetters={() => setView('letters')}
            fromTray={fromTray}
            onTrayOpened={() => setFromTray(null)}
          />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'tray' && (
          <TrayScreen
            onBack={() => setView('home')}
            onOpenFile={(id, service) => {
              setFromTray({ id, service });
              setView('messages');
            }}
          />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'letters' && (
          <LettersScreen onBack={() => setView('messages')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'blind-test' && (
          <BlindTestScreen onBack={() => setView('home')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'chat' && (
          <ChatScreen onBack={() => setView('home')} onOpenSetup={() => setView('settings')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && (view === 'character' || view === 'style') && (
          <SheetScreen key={view} kind={view} onBack={() => setView('home')} onOpenSetup={() => setView('settings')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'memories' && (
          <MemoryScreen onBack={() => setView('home')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'advice' && (
          <AdviceScreen onBack={() => setView('home')} onOpenPeople={() => setView('people')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'interview' && (
          <InterviewScreen onBack={() => setView('home')} onOpenSetup={() => setView('settings')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'face' && (
          <FaceScreen onBack={() => setView('home')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'voice' && (
          <VoiceScreen onBack={() => setView('home')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'stories' && (
          <StoriesScreen onBack={() => setView('home')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'people' && (
          <PeopleScreen onBack={() => setView('home')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'consent' && (
          <ConsentScreen onBack={() => setView('home')} />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'settings' && (
          <SettingsScreen
            archivePath={status.archivePath ?? ''}
            onBack={() => setView('home')}
            onNewKit={() => setView('new-kit')}
            onDeleted={async () => {
              setView('home');
              await refresh();
            }}
          />
        )}
        {status?.state === 'unlocked' && !status.needsNewPassphrase && status.recoveryKit && view === 'new-kit' && (
          <RecoveryKitScreen
            onDone={async () => {
              setView('settings');
              await refresh();
            }}
            onCancel={() => setView('settings')}
          />
        )}
      </main>

      <footer className="foot no-print">
        <span>Everything you capture stays on this computer.</span>
        <span>{version ? `Version ${version}` : ''}</span>
      </footer>
    </div>
  );
}
