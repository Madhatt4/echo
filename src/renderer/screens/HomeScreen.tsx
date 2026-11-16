import { useEffect, useState } from 'react';
import type { ActivityItem, ActivityReport, AiKeyStatus, BackupStatus, ConsentState } from '../../shared/api.ts';
import { SELFIE_POSES, VOICE_TARGET_SECONDS } from '../../shared/capture-guides.ts';
import type { Capture } from '../../shared/capture-guides.ts';
import type { BlindTestView } from '../../shared/blind-test.ts';
import type { InterviewState } from '../../shared/interview.ts';
import { usable } from '../../shared/memories.ts';
import type { MemoryStore } from '../../shared/memories.ts';
import { sheetTitle } from '../../shared/sheets.ts';
import type { SheetKind, SheetView } from '../../shared/sheets.ts';
import { TILES, nextStep, statusLabel } from '../../shared/tiles.ts';
import type { TileId } from '../../shared/tiles.ts';

/** The tiles that capture the person. None of them may be used without consent. */
const CAPTURE_TILES: readonly TileId[] = ['stories', 'face', 'voice', 'interview', 'advice', 'messages'];

function consentLabel(consent: ConsentState | null): string | undefined {
  if (consent === 'none') return 'Needs your consent first';
  if (consent === 'withdrawn') return 'Consent withdrawn';
  return undefined;
}


function describe(item: ActivityItem): string {
  switch (item.type) {
    case 'archive.created':
      return 'Archive created';
    case 'archive.unlocked': {
      const failed = Number(item.detail.failedAttemptsBefore ?? 0);
      const how = item.detail.method === 'recovery kit' ? 'Archive opened with the recovery kit' : 'Archive unlocked';
      if (failed === 0) return how;
      return `${how}, after ${failed} wrong ${failed === 1 ? 'attempt' : 'attempts'}`;
    }
    case 'recovery-kit.created':
      return item.detail.replacedEarlierKit === true ? 'New recovery kit made. The earlier kit no longer works' : 'Recovery kit made';
    case 'passphrase.changed':
      return item.detail.after === 'recovery kit' ? 'Passphrase changed after opening with the recovery kit' : 'Passphrase changed';
    case 'ai-key.saved':
      return item.detail.replacedEarlierKey === true ? 'AI key replaced' : 'AI key saved';
    case 'ai-key.removed':
      return 'AI key removed';
    case 'consent.given':
      return item.detail.replacedEarlierConsent === true ? 'Consent recorded again' : 'Consent recorded';
    case 'consent.withdrawn':
      return 'Consent withdrawn';
    case 'person.added':
      return 'Someone added to your people';
    case 'person.changed':
      return 'Someone in your people changed';
    case 'person.removed':
      return 'Someone removed from your people';
    case 'capture.added':
      return item.detail.group === 'voice' ? 'Voice recording added' : item.detail.group === 'face-video' ? 'Face video recorded' : 'Selfie taken';
    case 'capture.removed':
      return item.detail.group === 'voice' ? 'Voice recording deleted' : item.detail.group === 'face-video' ? 'Face video deleted' : 'Selfie deleted';
    case 'interview.answered':
      return item.detail.spoken === true ? 'Interview question answered by talking' : 'Interview question answered';
    case 'interview.audience-changed':
      return item.detail.forOnePerson === true ? 'An interview answer marked for one person alone' : 'An interview answer opened to everyone';
    case 'interview.topic-finished':
      return 'A part of the interview finished';
    case 'advice.added':
      return item.detail.kind === 'on-the-day' ? 'Advice added, kept for the day' : 'Advice added';
    case 'advice.changed':
      return 'Advice changed';
    case 'advice.removed':
      return 'Advice deleted';
    case 'import.added':
      return `A conversation imported: ${item.detail.mine} messages from you, ${item.detail.others} from other people`;
    case 'import.removed':
      return 'An imported conversation deleted';
    case 'blindtest.started':
      return 'Blind test started';
    case 'blindtest.echo-answered':
      return 'Your echo answered a blind test question';
    case 'blindtest.judged':
      return 'A judge finished the blind test';
    case 'blindtest.finished':
      return item.detail.passed === true ? 'Blind test passed' : 'Blind test not passed';
    case 'echo.replied':
      return item.detail.check === 'passed' ? 'Your echo replied' : item.detail.check === 'redrafted' ? 'Your echo replied, after one draft was thrown away' : 'Your echo said it had nothing, after two drafts failed the check';
    case 'character.drafted':
      return 'Character sheet drafted';
    case 'character.changed':
      return 'Character sheet changed';
    case 'style.drafted':
      return 'Style profile drafted';
    case 'style.changed':
      return 'Style profile changed';
    case 'memory.held':
      return 'Some passages are waiting for you to look at them';
    case 'memory.changed':
      return item.detail.leftOut === true ? 'A passage left out of what your echo remembers' : 'A passage your echo remembers was changed';
    case 'story.recorded':
      return 'Story recorded';
    case 'story.changed':
      return 'Story changed';
    case 'story.removed':
      return 'Story deleted';
    case 'backup.made':
      return 'Backup brought up to date';
    case 'backup.failed':
      return 'A backup was tried and did not finish';
    case 'archive.locked':
      return item.detail.reason === 'app closed' ? 'Archive locked when Echo was closed' : 'Archive locked';
    case 'door.on':
      return "Your assistant's door turned on";
    case 'door.off':
      return item.detail.reason === 'consent withdrawn' ? "Your assistant's door closed because consent was withdrawn" : "Your assistant's door turned off and its store deleted";
    case 'door.used': {
      const times = Number(item.detail.times ?? 0);
      const what =
        {
          status: 'checked the door',
          search: 'searched your words',
          read: 'read your words',
          sheets: 'read your character sheet and style profile',
          suggest: 'left something for you to look at',
          tray: 'looked at what it had left for you',
          ask: 'asked your echo a question',
          withdraw: 'took back something it had left',
        }[String(item.detail.command)] ?? 'used the door';
      return `Your assistant ${what} ${times === 1 ? 'once' : `${times} times`} on ${String(item.detail.day)}`;
    }
    case 'door.ai_key':
      return item.detail.shared ? "You let your assistant's questions use your AI key" : "You stopped your assistant's questions using your AI key";
    case 'door.tray.approved':
      return 'You approved a write-up from your assistant as your own words';
    case 'door.tray.discarded':
      return 'You threw away something your assistant left';
    case 'door.tray.opened':
      return 'You opened a file your assistant pointed out';
    case 'door.refresh_failed':
      return "The copy of your words kept for your assistant could not be brought up to date";
    default:
      return item.type;
  }
}

function faceProgress(captures: readonly Capture[]): string {
  const poses = new Set(captures.filter((c) => c.group === 'face-photo').map((c) => c.label)).size;
  const video = captures.some((c) => c.group === 'face-video');
  return `${poses} of ${SELFIE_POSES.length} photos · ${video ? 'video done' : 'no video yet'}`;
}

function voiceProgress(captures: readonly Capture[]): string {
  const seconds = captures.filter((c) => c.group === 'voice').reduce((sum, c) => sum + c.seconds, 0);
  return `${Math.floor(seconds / 60)} of ${VOICE_TARGET_SECONDS / 60} minutes`;
}

function interviewProgress(interview: InterviewState): string {
  const finished = interview.topics.filter((topic) => topic.done).length;
  const answers = interview.topics.reduce((sum, topic) => sum + topic.exchanges.length, 0);
  if (answers === 0) return 'Not started';
  return `${finished} of ${interview.topics.length} parts finished`;
}

function blindStatus(blind: BlindTestView): string {
  if (blind.stage === 'none') return 'Not started';
  if (blind.stage === 'writing') return 'Waiting for your own answers';
  if (blind.stage === 'echo') return `Your echo has answered ${blind.echoAnswered} of ${blind.of}`;
  if (blind.result?.passed === true) return 'Passed';
  if (blind.result?.passed === false) return 'Not passed yet';
  return 'Waiting for the judges';
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function HomeScreen({
  archivePath,
  onLocked,
  onOpenSetup,
  onOpenConsent,
  onOpenPeople,
  onOpenStories,
  onOpenFace,
  onOpenVoice,
  onOpenInterview,
  onOpenAdvice,
  onOpenMemories,
  onOpenSheet,
  onOpenChat,
  onOpenBlindTest,
  onOpenMessages,
  onOpenTray,
}: {
  archivePath: string;
  onLocked: () => Promise<void>;
  onOpenSetup: () => void;
  onOpenConsent: () => void;
  onOpenPeople: () => void;
  onOpenStories: () => void;
  onOpenFace: () => void;
  onOpenVoice: () => void;
  onOpenInterview: () => void;
  onOpenAdvice: () => void;
  onOpenMemories: () => void;
  onOpenSheet: (kind: SheetKind) => void;
  onOpenChat: () => void;
  onOpenBlindTest: () => void;
  onOpenMessages: () => void;
  onOpenTray: () => void;
}) {
  const [activity, setActivity] = useState<ActivityReport | null>(null);
  const [aiKey, setAiKey] = useState<AiKeyStatus | null>(null);
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [peopleCount, setPeopleCount] = useState<number | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [storyCount, setStoryCount] = useState<number | null>(null);
  const [captures, setCaptures] = useState<Capture[] | null>(null);
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [adviceCount, setAdviceCount] = useState<number | null>(null);
  const [memories, setMemories] = useState<MemoryStore | null>(null);
  const [trayWaiting, setTrayWaiting] = useState(0);
  const [keptNotes, setKeptNotes] = useState(0);
  const [askedSessions, setAskedSessions] = useState(0);
  const [sheets, setSheets] = useState<SheetView[]>([]);
  const [blind, setBlind] = useState<BlindTestView | null>(null);
  const [importCount, setImportCount] = useState<number | null>(null);

  useEffect(() => {
    void window.echo.archive.recentActivity().then(setActivity);
    void window.echo.settings.aiKeyStatus().then(setAiKey);
    void window.echo.consent.status().then((status) => setConsent(status.state));
    void window.echo.people.list().then((people) => setPeopleCount(people.length));
    void window.echo.backup.status().then(setBackup);
    void window.echo.stories.list().then((stories) => setStoryCount(stories.length));
    void window.echo.captures.list().then(setCaptures);
    void window.echo.interview.state().then(setInterview);
    void window.echo.advice.list().then((advice) => setAdviceCount(advice.length));
    void window.echo.memories.list().then(setMemories);
    void window.echo.door.tray().then((tray) => setTrayWaiting(tray.length));
    void window.echo.door.notes().then((notes) => setKeptNotes(notes.length));
    void window.echo.door.conversations().then((sessions) => setAskedSessions(sessions.length));
    void Promise.all([window.echo.sheets.get('character'), window.echo.sheets.get('style')]).then(setSheets);
    void window.echo.blindTest.view().then(setBlind);
    void window.echo.imports.list().then((imports) => setImportCount(imports.length));
  }, []);

  async function lock() {
    await window.echo.archive.lock();
    await onLocked();
  }

  return (
    <div data-screen="home">
      <section className="archive-bar">
        <div>
          <span className="label">Your archive is open</span>
          <code>{archivePath}</code>
        </div>
        <button type="button" className="button-quiet" data-action="lock" onClick={lock}>
          Lock now
        </button>
      </section>

      {backup && !backup.configured && (
        <p className="warning backup-line" data-home-backup="none">
          <strong>You have no backup.</strong> If this computer breaks, everything you capture is
          lost. Open Setup and choose a folder on an external drive.
        </p>
      )}
      {backup?.configured && (backup.problem || !backup.reachable) && (
        <p className="warning backup-line" data-home-backup="problem">
          <strong>Your backup is not up to date.</strong>{' '}
          {backup.reachable ? backup.problem : 'The backup drive is not plugged in.'}
          {backup.lastAt ? ` Last backed up ${when(backup.lastAt)}.` : ''}
        </p>
      )}
      {backup?.configured && !backup.problem && backup.reachable && backup.lastAt && (
        <p className="hint backup-line" data-home-backup="ok">
          Backed up {when(backup.lastAt)} to <code>{backup.folder}</code>
        </p>
      )}

      {consent !== null && aiKey !== null && memories !== null &&
        (() => {
          const next = nextStep({ consent, aiKeySaved: aiKey.saved, passages: memories.memories.length });
          const open = { consent: onOpenConsent, setup: onOpenSetup, interview: onOpenInterview, chat: onOpenChat }[next.opens as 'consent' | 'setup' | 'interview' | 'chat'];
          return (
            <section className="panel next-step" data-next-step={next.id}>
              <h2>{next.title}</h2>
              <p>{next.why}</p>
              <div className="actions">
                <button type="button" className="button" data-action="next-step" onClick={open}>
                  {next.button}
                </button>
              </div>
            </section>
          );
        })()}

      {trayWaiting > 0 && (
        <section className="panel next-step" data-tray-waiting={trayWaiting}>
          <h2>From your assistant</h2>
          <p>
            Your assistant has left {trayWaiting === 1 ? 'one thing' : `${trayWaiting} things`} for you to look at. Nothing it leaves is part of
            your echo unless you approve it.
          </p>
          <div className="actions">
            <button type="button" className="button" data-action="open-tray" onClick={onOpenTray}>
              Look at {trayWaiting === 1 ? 'it' : 'them'}
            </button>
          </div>
        </section>
      )}
      {trayWaiting === 0 && (keptNotes > 0 || askedSessions > 0) && (
        <p className="hint" data-kept-notes={keptNotes} data-asked-sessions={askedSessions}>
          {keptNotes > 0 && `You have kept ${keptNotes === 1 ? 'one write-up' : `${keptNotes} write-ups`} from your assistant as your own words. `}
          {askedSessions > 0 && `Your assistant has had ${askedSessions === 1 ? 'one conversation' : `${askedSessions} conversations`} with your echo. `}
          <button type="button" className="button-quiet" data-action="open-tray" onClick={onOpenTray}>
            See what your assistant has done
          </button>
        </p>
      )}

      <ul className="tiles">
        {TILES.map((tile) => (
          <li
            key={tile.id}
            className={tile.ready ? 'tile tile-ready' : 'tile tile-waiting'}
            data-tile={tile.id}
            aria-disabled={!tile.ready}
          >
            <h2>{tile.title}</h2>
            <p>{tile.description}</p>
            {tile.id === 'setup' ? (
              <div className="tile-foot">
                <button type="button" className="button" data-action="open-setup" onClick={onOpenSetup}>
                  Open
                </button>
                <span className="status" data-setup-status>
                  {statusLabel(tile, aiKey && !aiKey.saved ? 'AI key not added yet' : undefined)}
                </span>
              </div>
            ) : tile.id === 'consent' ? (
              <div className="tile-foot">
                <button type="button" className="button" data-action="open-consent" onClick={onOpenConsent}>
                  Open
                </button>
                <span className="status" data-consent-status={consent ?? ''}>
                  {consent === 'given' ? 'Recorded' : consent === 'withdrawn' ? 'Withdrawn' : 'Not recorded yet'}
                </span>
              </div>
            ) : tile.id === 'people' ? (
              <div className="tile-foot">
                <button type="button" className="button" data-action="open-people" onClick={onOpenPeople}>
                  Open
                </button>
                <span className="status" data-people-status={peopleCount ?? ''}>
                  {peopleCount === null ? '' : peopleCount === 0 ? 'Nobody added yet' : peopleCount === 1 ? '1 person' : `${peopleCount} people`}
                </span>
              </div>
            ) : tile.id === 'stories' ? (
              <div className="tile-foot">
                <button type="button" className="button" data-action="open-stories" onClick={onOpenStories} disabled={consent !== 'given'}>
                  Open
                </button>
                <span className="status" data-tile-status data-stories-status={storyCount ?? ''}>
                  {consentLabel(consent) ??
                    (storyCount === null ? '' : storyCount === 0 ? 'No stories yet' : storyCount === 1 ? '1 story' : `${storyCount} stories`)}
                </span>
              </div>
            ) : tile.id === 'face' ? (
              <div className="tile-foot">
                <button type="button" className="button" data-action="open-face" onClick={onOpenFace} disabled={consent !== 'given'}>
                  Open
                </button>
                <span className="status" data-tile-status data-face-status={captures ? 'loaded' : ''}>
                  {consentLabel(consent) ?? (captures ? faceProgress(captures) : '')}
                </span>
              </div>
            ) : tile.id === 'voice' ? (
              <div className="tile-foot">
                <button type="button" className="button" data-action="open-voice" onClick={onOpenVoice} disabled={consent !== 'given'}>
                  Open
                </button>
                <span className="status" data-tile-status data-voice-status={captures ? 'loaded' : ''}>
                  {consentLabel(consent) ?? (captures ? voiceProgress(captures) : '')}
                </span>
              </div>
            ) : tile.id === 'interview' ? (
              <div className="tile-foot">
                <button type="button" className="button" data-action="open-interview" onClick={onOpenInterview} disabled={consent !== 'given'}>
                  Open
                </button>
                <span
                  className="status"
                  data-tile-status
                  data-interview-status={interview ? interview.topics.reduce((sum, topic) => sum + topic.exchanges.length, 0) : ''}
                >
                  {consentLabel(consent) ?? (interview ? interviewProgress(interview) : '')}
                </span>
              </div>
            ) : tile.id === 'messages' ? (
              <div className="tile-foot">
                <button type="button" className="button" data-action="open-messages" onClick={onOpenMessages} disabled={consent !== 'given'}>
                  Open
                </button>
                <span className="status" data-tile-status data-messages-status={importCount ?? ''}>
                  {consentLabel(consent) ??
                    (importCount === null ? '' : importCount === 0 ? 'Nothing imported yet' : importCount === 1 ? '1 conversation' : `${importCount} conversations`)}
                </span>
              </div>
            ) : tile.id === 'chat' ? (
              <div className="tile-foot">
                <button type="button" className="button" data-action="open-chat" onClick={onOpenChat} disabled={consent !== 'given'}>
                  Open
                </button>
                <span className="status" data-tile-status>
                  {consentLabel(consent) ?? 'Ready'}
                </span>
              </div>
            ) : tile.id === 'advice' ? (
              <div className="tile-foot">
                <button type="button" className="button" data-action="open-advice" onClick={onOpenAdvice} disabled={consent !== 'given'}>
                  Open
                </button>
                <span className="status" data-tile-status data-advice-status={adviceCount ?? ''}>
                  {consentLabel(consent) ??
                    (adviceCount === null ? '' : adviceCount === 0 ? 'No advice yet' : adviceCount === 1 ? '1 piece of advice' : `${adviceCount} pieces of advice`)}
                </span>
              </div>
            ) : (
              <span className="status" data-tile-status>
                {statusLabel(tile, CAPTURE_TILES.includes(tile.id) ? consentLabel(consent) : undefined)}
              </span>
            )}
          </li>
        ))}
      </ul>

      <section className="built" data-section="built">
        <h2>What your echo is made from</h2>
        <p className="hint">Built on this computer from what you have captured. You can read and correct all of it.</p>
        <ul className="built-list">
          <li>
            <div>
              <strong>What it remembers</strong>
              <span className="status" data-built-memories={memories ? memories.memories.length : ''}>
                {memories === null
                  ? ''
                  : memories.memories.length === 0
                    ? 'Nothing yet'
                    : `${memories.memories.filter(usable).length} of ${memories.memories.length} passages in use`}
                {memories && memories.memories.some((memory) => memory.held) ? ' · some are waiting for you' : ''}
              </span>
            </div>
            <button type="button" className="button" data-action="open-memories" onClick={onOpenMemories}>
              Open
            </button>
          </li>
          {sheets.map((sheet) => {
            const unchecked = sheet.lines.filter((line) => !line.checked).length;
            return (
              <li key={sheet.kind}>
                <div>
                  <strong>{sheetTitle(sheet.kind)}</strong>
                  <span className="status" data-built-sheet={sheet.kind} data-built-lines={sheet.lines.length}>
                    {sheet.lines.length === 0
                      ? 'Not drafted yet'
                      : `${sheet.lines.length === 1 ? '1 line' : `${sheet.lines.length} lines`}${unchecked > 0 ? ` · ${unchecked} not checked by you` : ' · all checked by you'}`}
                  </span>
                </div>
                <button type="button" className="button" data-action={`open-${sheet.kind}`} onClick={() => onOpenSheet(sheet.kind)}>
                  Open
                </button>
              </li>
            );
          })}
          {blind && (
            <li>
              <div>
                <strong>Does it sound like me? The blind test</strong>
                <span className="status" data-built-blind={blind.stage} data-built-blind-passed={blind.result?.passed === null || blind.result?.passed === undefined ? '' : String(blind.result.passed)}>
                  {blindStatus(blind)}
                </span>
              </div>
              <button type="button" className="button" data-action="open-blind-test" onClick={onOpenBlindTest} disabled={consent !== 'given'}>
                Open
              </button>
            </li>
          )}
        </ul>
      </section>

      <section className="activity">
        <h2>Recent activity</h2>
        <p className="hint">
          Echo keeps a record of everything that happens to your archive. The record is encrypted
          and kept inside the archive.
        </p>
        {activity && !activity.intact && (
          <p className="problems" role="alert" data-activity-broken>
            This record has been changed or damaged since Echo wrote it. The entries below are the
            ones that could still be trusted.
          </p>
        )}
        <ol className="activity-list">
          {activity?.items.map((item, index) => (
            <li key={`${index}-${item.at}`} data-activity-item>
              <span>{describe(item)}</span>
              <time dateTime={item.at}>{when(item.at)}</time>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
