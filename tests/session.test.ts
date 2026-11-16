import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ARCHIVE_FOLDER_NAME, ArchiveSession } from '../src/main/archive-session.ts';
import { attributedBody, makeEncryptedIphoneBackup, makeIphoneBackup } from './helpers/iphone-backup.ts';
import { makeZip } from './helpers/zip.ts';
import { mailbox } from './helpers/mailbox.ts';
import { readDoorStore } from '../src/core/door.ts';
import { runDoorCommand, suggestFile, suggestWords } from '../src/core/door-commands.ts';
import { askTheEcho, readDoorConversations } from '../src/core/door-ask.ts';
import { readSealedFile } from '../src/core/sealed.ts';
import { makeLinkKeys, makePairingToken, readPairingCode, receiptChecks, sealPairRequest, sealRecording } from '../src/core/phone-link.ts';
import type { ClaudeAnswer, ClaudeRequest, KeyCheck } from '../src/core/anthropic.ts';

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASSPHRASE = 'correct horse battery staple';
const GOOD_KEY = 'sk-ant-test-key-ending-WXYZ';

const checkKey = async (key: string): Promise<KeyCheck> =>
  key === GOOD_KEY ? { ok: true } : { ok: false, problem: 'Anthropic did not accept this key.' };

/** What the stand-in for Claude was last asked, and what it should say next. Each test sets `interviewer`. */
const asked: { key: string; request: ClaudeRequest }[] = [];
let interviewer: (key: string, request: ClaudeRequest) => Promise<ClaudeAnswer> = async () => ({ ok: false, problem: 'no interviewer set' });
const says = (text: string) => async (key: string, request: ClaudeRequest): Promise<ClaudeAnswer> => {
  asked.push({ key, request });
  return { ok: true, text, model: 'test' };
};

/** Stands in for chance when the blind test shuffles. The same numbers every time. */
let chanceState = 7;
const chance = () => {
  chanceState = (chanceState * 1103515245 + 12345) % 2147483648;
  return chanceState / 2147483648;
};

async function openSession(): Promise<{ session: ArchiveSession; home: string; archive: string }> {
  const home = mkdtempSync(path.join(tmpdir(), 'echo-session-'));
  const session = new ArchiveSession(path.join(home, 'settings', 'config.json'), { checkKey, kdf: FAST, minConsentSeconds: 10, allowBackupOnSameDrive: true, minFaceVideoSeconds: 120, ask: (key, request) => interviewer(key, request), random: () => chance(), backupRoots: [path.join(home, 'MobileSync', 'Backup')] });
  assert.deepEqual((await session.create(home, PASSPHRASE, PASSPHRASE)).problems, []);
  return { session, home, archive: path.join(home, ARCHIVE_FOLDER_NAME) };
}

function everythingOnDisk(dir: string): string {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(path.join(entry.parentPath, entry.name), 'latin1'))
    .join('\n');
}

test('a new computer has no archive; creating one leaves it unlocked with no recovery kit', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'echo-session-'));
  const session = new ArchiveSession(path.join(home, 'config.json'), { checkKey, kdf: FAST });
  assert.equal(session.status().state, 'none');
  assert.equal((await session.create(home, 'short', 'short')).ok, false);
  assert.equal(session.status().state, 'none');
  assert.equal((await session.create(home, PASSPHRASE, PASSPHRASE)).ok, true);
  const status = session.status();
  assert.equal(status.state, 'unlocked');
  assert.equal(status.recoveryKit, false);
  assert.equal(status.archivePath, path.join(home, ARCHIVE_FOLDER_NAME));
});

test('lock, wrong passphrase, right passphrase', async () => {
  const { session } = await openSession();
  session.lock();
  assert.equal(session.status().state, 'locked');
  assert.equal((await session.unlock('not the passphrase at all')).ok, false);
  assert.equal(session.status().state, 'locked');
  assert.equal((await session.unlock(PASSPHRASE)).ok, true);
  assert.equal(session.status().state, 'unlocked');
});

test('the recovery kit must be proven before its code opens anything', async () => {
  const { session } = await openSession();
  const kit = session.beginRecoveryKit();
  assert.ok(kit);
  const code = kit.groups.join('-');
  const [a, b] = kit.challenge;
  assert.ok(a !== b && a >= 1 && b <= 6);

  assert.equal((await session.confirmRecoveryKit('ZZZZ', 'YYYY')).ok, false);
  assert.equal(session.status().recoveryKit, false);

  assert.equal((await session.confirmRecoveryKit(kit.groups[a - 1]!, kit.groups[b - 1]!)).ok, true);
  assert.equal(session.status().recoveryKit, true);

  session.lock();
  assert.equal((await session.unlockWithRecoveryCode(code)).ok, true);
  assert.equal(session.status().needsNewPassphrase, true);
});

test('an unproven kit is forgotten when the archive is locked', async () => {
  const { session } = await openSession();
  const kit = session.beginRecoveryKit();
  assert.ok(kit);
  session.lock();
  assert.equal((await session.unlockWithRecoveryCode(kit.groups.join(''))).ok, false);
  await session.unlock(PASSPHRASE);
  const [a, b] = kit.challenge;
  assert.equal((await session.confirmRecoveryKit(kit.groups[a - 1]!, kit.groups[b - 1]!)).ok, false);
});

test('opening with the kit forces a new passphrase and retires the old one', async () => {
  const { session } = await openSession();
  const kit = session.beginRecoveryKit()!;
  await session.confirmRecoveryKit(kit.groups[kit.challenge[0] - 1]!, kit.groups[kit.challenge[1] - 1]!);
  session.lock();
  await session.unlockWithRecoveryCode(kit.groups.join(' '));
  assert.equal((await session.setNewPassphrase('a brand new passphrase', 'a brand new passphrase')).ok, true);
  assert.equal(session.status().needsNewPassphrase, false);
  session.lock();
  assert.equal((await session.unlock(PASSPHRASE)).ok, false);
  assert.equal((await session.unlock('a brand new passphrase')).ok, true);
});

test('changing the passphrase needs the current one', async () => {
  const { session } = await openSession();
  assert.equal((await session.changePassphrase('wrong current one', 'a brand new passphrase', 'a brand new passphrase')).ok, false);
  assert.equal((await session.changePassphrase(PASSPHRASE, PASSPHRASE, PASSPHRASE)).ok, false);
  assert.equal((await session.changePassphrase(PASSPHRASE, 'a brand new passphrase', 'a brand new passphrase')).ok, true);
  session.lock();
  assert.equal((await session.unlock(PASSPHRASE)).ok, false);
  assert.equal((await session.unlock('a brand new passphrase')).ok, true);
});

test('a key Anthropic rejects is not saved; a good one is, and survives lock and unlock', async () => {
  const { session } = await openSession();
  assert.deepEqual(session.aiKeyStatus(), { saved: false, ending: null, testedAt: null });
  assert.equal((await session.testAndSaveAiKey('sk-ant-bad')).ok, false);
  assert.equal(session.aiKeyStatus().saved, false);

  assert.equal((await session.testAndSaveAiKey(`  ${GOOD_KEY}  `)).ok, true);
  assert.equal(session.aiKeyStatus().saved, true);
  assert.equal(session.aiKeyStatus().ending, 'WXYZ');
  assert.equal(session.aiKey(), GOOD_KEY);

  session.lock();
  assert.equal(session.aiKeyStatus().saved, false); // nothing is readable while locked
  assert.equal(session.aiKey(), null);
  await session.unlock(PASSPHRASE);
  assert.equal(session.aiKey(), GOOD_KEY);

  session.removeAiKey();
  assert.equal(session.aiKeyStatus().saved, false);
});

test('the AI key, the passphrase and the recovery code never reach the disk in the clear', async () => {
  const { session, home } = await openSession();
  const kit = session.beginRecoveryKit()!;
  await session.confirmRecoveryKit(kit.groups[kit.challenge[0] - 1]!, kit.groups[kit.challenge[1] - 1]!);
  await session.testAndSaveAiKey(GOOD_KEY);
  session.lock();
  const disk = everythingOnDisk(home);
  assert.ok(!disk.includes(GOOD_KEY));
  assert.ok(!disk.includes(PASSPHRASE));
  assert.ok(!disk.includes(kit.groups.join('')));
  assert.ok(!disk.includes(kit.groups.join('-')));
});

test('the audit trail records each of these, in order, and stays intact', async () => {
  const { session } = await openSession();
  const kit = session.beginRecoveryKit()!;
  await session.confirmRecoveryKit(kit.groups[kit.challenge[0] - 1]!, kit.groups[kit.challenge[1] - 1]!);
  await session.testAndSaveAiKey(GOOD_KEY);
  await session.changePassphrase(PASSPHRASE, 'a brand new passphrase', 'a brand new passphrase');
  session.removeAiKey();
  const report = session.recentActivity();
  assert.equal(report.intact, true);
  assert.deepEqual(
    report.items.map((item) => item.type).reverse(),
    ['archive.created', 'recovery-kit.created', 'ai-key.saved', 'passphrase.changed', 'ai-key.removed'],
  );
  assert.ok(!JSON.stringify(report).includes(GOOD_KEY));
});

const VIDEO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from('a recognisable consent recording')]);

test('nothing may be captured until consent is recorded', async () => {
  const { session } = await openSession();
  assert.equal(session.consentStatus().state, 'none');
  assert.equal(session.captureAllowed(), false);
  assert.equal(session.consentVideo(), null);
});

test('consent needs a name, a recording, and a recording long enough to be the statement', async () => {
  const { session } = await openSession();
  assert.equal(session.giveConsent('', VIDEO, 'video/webm', 25).ok, false);
  assert.equal(session.giveConsent('Ada Lovelace', new Uint8Array(0), 'video/webm', 25).ok, false);
  assert.equal(session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 3).ok, false);
  assert.equal(session.giveConsent('Ada Lovelace', VIDEO, 'text/plain', 25).ok, false);
  assert.equal(session.captureAllowed(), false);
});

test('recorded consent allows capture, keeps the exact wording, and plays back', async () => {
  const { session } = await openSession();
  assert.equal(session.giveConsent(' Ada Lovelace ', VIDEO, 'video/webm;codecs=vp9,opus', 24.6).ok, true);
  const status = session.consentStatus();
  assert.equal(status.state, 'given');
  assert.equal(status.fullName, 'Ada Lovelace');
  assert.equal(status.seconds, 25);
  assert.ok(status.wording?.startsWith('I, Ada Lovelace, on '));
  assert.equal(session.captureAllowed(), true);
  const video = session.consentVideo();
  assert.ok(video && Buffer.from(video.bytes).equals(Buffer.from(VIDEO)));
  assert.equal(video?.mimeType, 'video/webm;codecs=vp9,opus');
});

test('withdrawing consent stops capture at once; giving it again restores it', async () => {
  const { session } = await openSession();
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  session.withdrawConsent();
  assert.equal(session.consentStatus().state, 'withdrawn');
  assert.ok(session.consentStatus().withdrawnAt);
  assert.equal(session.captureAllowed(), false);
  assert.equal(session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25).ok, true);
  assert.equal(session.consentStatus().state, 'given');
  assert.equal(session.consentStatus().withdrawnAt, null);
  assert.equal(session.captureAllowed(), true);
});

test('consent is unreadable while locked, survives lock and unlock, and is never on disk in the clear', async () => {
  const { session, home } = await openSession();
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  session.lock();
  assert.equal(session.captureAllowed(), false);
  assert.equal(session.consentStatus().state, 'none');
  const disk = everythingOnDisk(home);
  assert.ok(!disk.includes('Ada Lovelace'));
  assert.ok(!disk.includes('recognisable consent recording'));
  await session.unlock(PASSPHRASE);
  assert.equal(session.captureAllowed(), true);
});

test('giving and withdrawing consent are both in the audit trail', async () => {
  const { session } = await openSession();
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  session.withdrawConsent();
  const types = session.recentActivity().items.map((item) => item.type).reverse();
  assert.deepEqual(types, ['archive.created', 'consent.given', 'consent.withdrawn']);
});

const DAUGHTER = { name: 'Ada', relationship: 'daughter', callsMe: 'Dad', mayTalkToEcho: true };

test('people are added, changed and removed through the session, with no names in the audit trail', async () => {
  const { session } = await openSession();
  assert.deepEqual(session.people(), []);
  assert.equal(session.addPerson({ ...DAUGHTER, name: '  ' }).ok, false);
  assert.equal(session.addPerson(DAUGHTER).ok, true);
  assert.equal(session.addPerson(DAUGHTER).ok, false); // same name twice
  assert.equal(session.addPerson({ ...DAUGHTER, name: 'Ben', relationship: 'son' }).ok, true);

  const [ada, ben] = session.people();
  assert.equal(session.changePerson(ada!.id, { ...DAUGHTER, callsMe: 'Pops' }).ok, true); // keeping her own name is fine
  assert.equal(session.changePerson(ada!.id, { ...DAUGHTER, name: 'Ben' }).ok, false); // taking someone else's is not
  assert.equal(session.people()[0]!.callsMe, 'Pops');

  session.removePerson(ben!.id);
  assert.deepEqual(session.people().map((p) => p.name), ['Ada']);

  const trail = JSON.stringify(session.recentActivity());
  assert.ok(trail.includes('person.added') && trail.includes('person.changed') && trail.includes('person.removed'));
  assert.ok(!trail.includes('Ada') && !trail.includes('Ben'));
});

test('people are unreadable while locked and come back after unlocking', async () => {
  const { session, home } = await openSession();
  session.addPerson({ ...DAUGHTER, name: 'Recognisable Person' });
  session.lock();
  assert.deepEqual(session.people(), []);
  assert.ok(!everythingOnDisk(home).includes('Recognisable Person'));
  await session.unlock(PASSPHRASE);
  assert.deepEqual(session.people().map((p) => p.name), ['Recognisable Person']);
});

function drive(home: string): string {
  const folder = path.join(home, 'usb-drive');
  mkdirSync(folder, { recursive: true });
  return folder;
}

test('no backup is set up at first, and nothing is claimed', async () => {
  const { session } = await openSession();
  assert.deepEqual(session.backupStatus(), { configured: false, folder: null, reachable: false, lastAt: null, lastFiles: null, problem: null });
  assert.equal((await session.backUpNow()).ok, false);
  assert.equal((await session.checkBackup()).ok, false);
});

test('choosing a backup folder makes the first backup, and the backup checks out afterwards', async () => {
  const { session, home } = await openSession();
  session.addPerson(DAUGHTER);
  assert.equal((await session.setBackupLocation(path.join(home, 'no-such-drive'))).ok, false);
  assert.equal(session.backupStatus().configured, false);

  const result = await session.setBackupLocation(drive(home));
  assert.equal(result.ok, true);
  const status = session.backupStatus();
  assert.equal(status.configured, true);
  assert.equal(status.folder, path.join(home, 'usb-drive', 'Echo Backup'));
  assert.equal(status.reachable, true);
  assert.ok(status.lastAt);
  assert.equal(status.problem, null);
  assert.equal((await session.checkBackup()).ok, true); // complete, including the record that it was made
});

test('locking brings the backup up to date; an unplugged drive never stops Echo locking or opening', async () => {
  const { session, home, archive } = await openSession();
  await session.setBackupLocation(drive(home));
  session.addPerson(DAUGHTER);
  assert.equal((await session.checkBackup()).ok, false); // the new person is not backed up yet
  await session.lockAfterBackup();
  assert.equal(session.status().state, 'locked');
  assert.equal(
    readFileSync(path.join(home, 'usb-drive', 'Echo Backup', 'people.sealed'), 'utf8'),
    readFileSync(path.join(archive, 'people.sealed'), 'utf8'),
  );

  renameSync(path.join(home, 'usb-drive'), path.join(home, 'usb-drive-unplugged'));
  assert.equal((await session.unlock(PASSPHRASE)).ok, true);
  const status = session.backupStatus();
  assert.equal(status.reachable, false);
  assert.ok(status.problem);
  assert.ok(status.lastAt); // the last good backup time is kept
  await session.lockAfterBackup();
  assert.equal(session.status().state, 'locked');
});

test('a lost archive is restored from the backup and opens with the same passphrase', async () => {
  const { session, home, archive } = await openSession();
  session.addPerson(DAUGHTER);
  await session.setBackupLocation(drive(home));
  await session.lockAfterBackup();

  rmSync(archive, { recursive: true });
  assert.equal(session.status().state, 'missing');
  assert.equal((await session.restoreFromBackup(path.join(home, 'nothing'), home)).ok, false);
  const restored = await session.restoreFromBackup(path.join(home, 'usb-drive'), home);
  assert.equal(restored.ok, true);
  assert.equal(session.status().state, 'locked');
  assert.ok(existsSync(path.join(archive, 'vault.json')));
  assert.equal((await session.unlock(PASSPHRASE)).ok, true);
  assert.deepEqual(session.people().map((p) => p.name), ['Ada']);
  assert.equal(session.recentActivity().intact, true);
});

test('restoring never overwrites an archive that is already there', async () => {
  const { session, home } = await openSession();
  await session.setBackupLocation(drive(home));
  await session.lockAfterBackup();
  const result = await session.restoreFromBackup(path.join(home, 'usb-drive'), home);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0]!.includes('already has files'));
});

const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from('a recognisable story recording')]);
const STORY = { title: 'The caravan', prompt: '', audience: { kind: 'everyone' as const }, text: '' };

test('a story cannot be recorded or changed without consent, but can always be removed', async () => {
  const { session } = await openSession();
  assert.equal(session.addStory(STORY, AUDIO, 'audio/webm', 30).ok, false);
  assert.deepEqual(session.stories(), []);

  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  assert.equal(session.addStory(STORY, AUDIO, 'audio/webm', 30).ok, true);
  const [story] = session.stories();
  session.withdrawConsent();
  assert.equal(session.addStory(STORY, AUDIO, 'audio/webm', 30).ok, false);
  assert.equal(session.changeStory(story!.id, { ...STORY, text: 'changed' }).ok, false);
  session.removeStory(story!.id);
  assert.deepEqual(session.stories(), []);
});

test('a story keeps its sound, its words and who it is for; removing it removes the sound', async () => {
  const { session, archive } = await openSession();
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  session.addPerson(DAUGHTER);
  const ada = session.people()[0]!;

  assert.equal(session.addStory({ ...STORY, title: '' }, AUDIO, 'audio/webm', 30).ok, false);
  assert.equal(session.addStory(STORY, new Uint8Array(0), 'audio/webm', 30).ok, false);
  assert.equal(session.addStory(STORY, AUDIO, 'audio/webm', 0.2).ok, false);
  assert.equal(session.addStory({ ...STORY, audience: { kind: 'person', personId: 'nobody' } }, AUDIO, 'audio/webm', 30).ok, false);

  assert.equal(session.addStory({ ...STORY, audience: { kind: 'person', personId: ada.id } }, AUDIO, 'audio/webm;codecs=opus', 30).ok, true);
  const story = session.stories()[0]!;
  assert.equal(story.title, 'The caravan');
  assert.deepEqual(story.audience, { kind: 'person', personId: ada.id });
  assert.ok(!('mediaId' in story)); // where the sound is kept is not the screen's business
  const audio = session.storyAudio(story.id);
  assert.ok(audio && Buffer.from(audio.bytes).equals(Buffer.from(AUDIO)));

  assert.equal(session.changeStory(story.id, { ...STORY, title: 'The caravan in Wales', text: 'It rained all week.' }).ok, true);
  assert.equal(session.stories()[0]!.text, 'It rained all week.');
  assert.ok(session.storyAudio(story.id)); // changing the words keeps the sound

  const recordingsBefore = readdirSync(path.join(archive, 'media')).length;
  session.removeStory(story.id);
  assert.equal(readdirSync(path.join(archive, 'media')).length, recordingsBefore - 1);
  assert.equal(session.storyAudio(story.id), null);
});

test('stories are unreadable while locked and never on disk in the clear', async () => {
  const { session, home } = await openSession();
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  session.addStory({ ...STORY, title: 'Recognisable story title', text: 'recognisable story words' }, AUDIO, 'audio/webm', 30);
  session.lock();
  assert.deepEqual(session.stories(), []);
  const disk = everythingOnDisk(home);
  assert.ok(!disk.includes('Recognisable story title'));
  assert.ok(!disk.includes('recognisable story words'));
  assert.ok(!disk.includes('recognisable story recording'));
});

const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, ...Buffer.from('a recognisable photo')]);

test('face and voice masters cannot be captured without consent, but can always be removed', async () => {
  const { session } = await openSession();
  assert.equal(session.addCapture('face-photo', 'front-neutral', PHOTO, 'image/jpeg', 0).ok, false);
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  assert.equal(session.addCapture('face-photo', 'front-neutral', PHOTO, 'image/jpeg', 0).ok, true);
  session.withdrawConsent();
  assert.equal(session.addCapture('voice', 'read-plain', AUDIO, 'audio/webm', 60).ok, false);
  const [photo] = session.captures();
  session.removeCapture(photo!.id);
  assert.deepEqual(session.captures(), []);
});

test('each kind of master is checked for what it is', async () => {
  const { session } = await openSession();
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  assert.equal(session.addCapture('face-photo', 'no-such-pose', PHOTO, 'image/jpeg', 0).ok, false);
  assert.equal(session.addCapture('face-photo', 'front-neutral', PHOTO, 'video/webm', 0).ok, false);
  assert.equal(session.addCapture('face-photo', 'front-neutral', new Uint8Array(0), 'image/jpeg', 0).ok, false);
  assert.equal(session.addCapture('face-video', '', VIDEO, 'video/webm', 119).ok, false); // under two minutes
  assert.equal(session.addCapture('face-video', '', VIDEO, 'audio/webm', 130).ok, false);
  assert.equal(session.addCapture('voice', 'no-such-passage', AUDIO, 'audio/webm', 60).ok, false);
  assert.equal(session.addCapture('voice', 'read-plain', AUDIO, 'audio/webm', 0.3).ok, false);
  assert.equal(session.addCapture('something-else' as never, 'x', AUDIO, 'audio/webm', 60).ok, false);
  assert.deepEqual(session.captures(), []);

  assert.equal(session.addCapture('face-photo', 'front-neutral', PHOTO, 'image/jpeg', 0).ok, true);
  assert.equal(session.addCapture('face-video', '', VIDEO, 'video/webm;codecs=vp9,opus', 131.2).ok, true);
  assert.equal(session.addCapture('voice', 'read-plain', AUDIO, 'audio/webm;codecs=opus', 61.7).ok, true);
  assert.deepEqual(
    session.captures().map((c) => [c.group, c.label, c.seconds]),
    [['face-photo', 'front-neutral', 0], ['face-video', 'guided-video', 131], ['voice', 'read-plain', 62]],
  );
});

test('a master comes back exactly, is gone once removed, and is never on disk in the clear', async () => {
  const { session, home, archive } = await openSession();
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  session.addCapture('face-photo', 'front-smile', PHOTO, 'image/jpeg', 0);
  const [photo] = session.captures();
  assert.ok(!('mediaId' in photo!));
  const contents = session.captureContents(photo!.id);
  assert.ok(contents && Buffer.from(contents.bytes).equals(Buffer.from(PHOTO)));
  assert.equal(contents?.mimeType, 'image/jpeg');
  assert.ok(!everythingOnDisk(home).includes('recognisable photo'));

  const before = readdirSync(path.join(archive, 'media')).length;
  session.removeCapture(photo!.id);
  assert.equal(readdirSync(path.join(archive, 'media')).length, before - 1);
  assert.equal(session.captureContents(photo!.id), null);

  session.addCapture('voice', 'talk-day', AUDIO, 'audio/webm', 90);
  session.lock();
  assert.deepEqual(session.captures(), []);
});

async function readyToInterview() {
  const opened = await openSession();
  opened.session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  await opened.session.testAndSaveAiKey(GOOD_KEY);
  asked.length = 0;
  return opened;
}

test('every topic starts with its fixed opening question, before the AI is ever asked', async () => {
  const { session } = await openSession();
  const state = session.interview();
  assert.equal(state.keyReady, false);
  assert.equal(state.topics.length, 12);
  assert.equal(state.topics[0]!.pending, 'Where did you grow up, and who was in the house with you?');
  assert.ok(state.topics.every((topic) => !topic.done && topic.exchanges.length === 0));
});

test('the interview needs consent and a working AI key', async () => {
  const { session } = await openSession();
  interviewer = says('{"done": false, "question": "And then?"}');
  assert.equal((await session.answerInterview('childhood', 'Luton.', null, '')).ok, false); // no consent
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  const withoutKey = await session.answerInterview('childhood', 'Luton.', null, '');
  assert.equal(withoutKey.ok, false);
  assert.ok(withoutKey.problems[0]!.includes('AI key'));
  // The answer was still saved, so nothing said is lost while the key is sorted out.
  assert.equal(session.interview().topics[0]!.exchanges[0]!.answer, 'Luton.');
  assert.equal(session.interview().topics[0]!.pending, null);
});

test('an answer is saved, then the interviewer is sent the whole conversation and its question is kept waiting', async () => {
  const { session } = await readyToInterview();
  session.addPerson(DAUGHTER);
  interviewer = says('{"done": false, "question": "Who was in the house with you?"}');
  assert.equal((await session.answerInterview('childhood', '  Luton, above a shop.  ', null, '')).ok, true);

  const topic = session.interview().topics[0]!;
  assert.deepEqual(topic.exchanges.map((e) => [e.question, e.answer, e.spoken]), [
    ['Where did you grow up, and who was in the house with you?', 'Luton, above a shop.', false],
  ]);
  assert.equal(topic.pending, 'Who was in the house with you?');

  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.key, GOOD_KEY);
  assert.ok(asked[0]!.request.system.includes('Ada Lovelace'));
  assert.ok(asked[0]!.request.system.includes('Childhood and family'));
  assert.ok(asked[0]!.request.system.includes('Ada (daughter)'));
  assert.deepEqual(asked[0]!.request.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(asked[0]!.request.messages[2]!.content, 'Luton, above a shop.');
});

test('a spoken answer keeps its recording; an empty answer is refused', async () => {
  const { session, archive } = await readyToInterview();
  interviewer = says('{"done": false, "question": "And then?"}');
  assert.equal((await session.answerInterview('work', '   ', null, '')).ok, false);
  const before = readdirSync(path.join(archive, 'media')).length;
  assert.equal((await session.answerInterview('work', 'I drove lorries.', AUDIO, 'audio/webm')).ok, true);
  assert.equal(readdirSync(path.join(archive, 'media')).length, before + 1);
  const work = session.interview().topics.find((t) => t.id === 'work')!;
  assert.equal(work.exchanges[0]!.spoken, true);
  assert.ok(!('mediaId' in work.exchanges[0]!));
});

test('if Anthropic cannot be reached the answer is kept, and trying again gets the next question', async () => {
  const { session } = await readyToInterview();
  interviewer = async () => ({ ok: false, problem: 'Echo could not reach Anthropic.' });
  const failed = await session.answerInterview('childhood', 'Luton.', null, '');
  assert.deepEqual(failed, { ok: false, problems: ['Echo could not reach Anthropic.'] });
  assert.equal(session.interview().topics[0]!.exchanges.length, 1);
  assert.equal(session.interview().topics[0]!.pending, null);
  assert.equal((await session.answerInterview('childhood', 'again', null, '')).ok, false); // nothing is waiting to be answered

  interviewer = says('What was the shop?');
  assert.equal((await session.retryInterview('childhood')).ok, true);
  assert.equal(session.interview().topics[0]!.pending, 'What was the shop?'); // plain words are accepted as the question
  assert.equal(session.interview().topics[0]!.exchanges.length, 1);
});

test('skipping a question tells the interviewer so, and saves no answer', async () => {
  const { session } = await readyToInterview();
  interviewer = says('{"done": false, "question": "What games did you play?"}');
  assert.equal((await session.anotherQuestion('childhood')).ok, true);
  const topic = session.interview().topics[0]!;
  assert.equal(topic.exchanges.length, 0);
  assert.equal(topic.pending, 'What games did you play?');
  assert.ok(asked[0]!.request.messages.at(-1)!.content.startsWith('(They would rather not'));
});

test('the interviewer can finish a topic; the person can finish it or reopen it too', async () => {
  const { session } = await readyToInterview();
  interviewer = says('{"done": true, "question": ""}');
  await session.answerInterview('humour', 'Puns, mostly.', null, '');
  let humour = session.interview().topics.find((t) => t.id === 'humour')!;
  assert.deepEqual([humour.done, humour.pending], [true, null]);

  interviewer = says('{"done": false, "question": "Tell me your worst pun."}');
  assert.equal((await session.setInterviewDone('humour', false)).ok, true);
  humour = session.interview().topics.find((t) => t.id === 'humour')!;
  assert.deepEqual([humour.done, humour.pending], [false, 'Tell me your worst pun.']);

  assert.equal((await session.setInterviewDone('humour', true)).ok, true);
  assert.equal(session.interview().topics.find((t) => t.id === 'humour')!.done, true);
  assert.equal((await session.setInterviewDone('no-such-topic', true)).ok, false);
});

test('a topic closes itself after twelve answers, without asking the AI again', async () => {
  const { session } = await readyToInterview();
  interviewer = says('{"done": false, "question": "And then?"}');
  for (let i = 0; i < 12; i += 1) assert.equal((await session.answerInterview('money', `answer ${i}`, null, '')).ok, true);
  const money = session.interview().topics.find((t) => t.id === 'money')!;
  assert.equal(money.exchanges.length, 12);
  assert.equal(money.done, true);
  assert.equal(asked.length, 11);
  assert.equal((await session.setInterviewDone('money', false)).ok, false);
});

test('the interview survives lock and unlock and is never on disk in the clear', async () => {
  const { session, home } = await readyToInterview();
  interviewer = says('{"done": false, "question": "A recognisable follow-up question?"}');
  await session.answerInterview('childhood', 'a recognisable interview answer', null, '');
  session.lock();
  assert.deepEqual(session.interview(), { topics: [], keyReady: false });
  const disk = everythingOnDisk(home);
  assert.ok(!disk.includes('recognisable interview answer') && !disk.includes('recognisable follow-up'));
  await session.unlock(PASSPHRASE);
  const topic = session.interview().topics[0]!;
  assert.equal(topic.exchanges[0]!.answer, 'a recognisable interview answer');
  assert.equal(topic.pending, 'A recognisable follow-up question?');
});

test('an interview answer is for everyone until it is marked for one person alone', async () => {
  const { session } = await readyToInterview();
  session.addPerson(DAUGHTER);
  const daughter = session.people()[0]!;
  interviewer = says('{"done": false, "question": "And then?"}');
  await session.answerInterview('each-person', 'Tell her I was proud of her.', null, '');
  assert.deepEqual(session.interview().topics.find((t) => t.id === 'each-person')!.exchanges[0]!.audience, { kind: 'everyone' });

  assert.equal(session.setInterviewAudience('each-person', 0, { kind: 'person', personId: 'nobody-with-this-id' }).ok, false);
  assert.equal(session.setInterviewAudience('each-person', 5, { kind: 'everyone' }).ok, false);
  assert.equal(session.setInterviewAudience('each-person', 0, { kind: 'person', personId: daughter.id }).ok, true);

  session.lock();
  await session.unlock(PASSPHRASE);
  const kept = session.interview().topics.find((t) => t.id === 'each-person')!.exchanges[0]!;
  assert.deepEqual(kept.audience, { kind: 'person', personId: daughter.id });
  assert.equal(kept.answer, 'Tell her I was proud of her.');
});

test('the record of activity says an interview happened, never what was said', async () => {
  const { session } = await readyToInterview();
  interviewer = says('{"done": false, "question": "A private follow-up?"}');
  await session.answerInterview('beliefs', 'a private belief', null, '');
  const activity = JSON.stringify(session.recentActivity());
  assert.ok(activity.includes('interview.answered'));
  assert.ok(!activity.includes('private belief') && !activity.includes('private follow-up'));
});

const ADVICE = (personId: string) => ({ personId, occasion: 'Your wedding day', kind: 'on-the-day' as const, date: '', text: 'a recognisable piece of advice' });

test('advice needs consent and a named person, can be typed or spoken, and can always be removed', async () => {
  const { session, archive, home } = await openSession();
  session.addPerson(DAUGHTER);
  const daughter = session.people()[0]!;
  assert.equal(session.addAdvice(ADVICE(daughter.id), null, '').ok, false); // no consent yet
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  assert.equal(session.addAdvice(ADVICE('nobody'), null, '').ok, false);

  assert.equal(session.addAdvice(ADVICE(daughter.id), null, '').ok, true);
  const before = readdirSync(path.join(archive, 'media')).length;
  assert.equal(session.addAdvice({ ...ADVICE(daughter.id), kind: 'when-asked', date: '2031-05-04', occasion: 'Losing a job' }, AUDIO, 'audio/webm').ok, true);
  assert.equal(readdirSync(path.join(archive, 'media')).length, before + 1);

  const [typed, spoken] = session.advice();
  assert.deepEqual([typed!.spoken, typed!.kind, typed!.personId], [false, 'on-the-day', daughter.id]);
  assert.deepEqual([spoken!.spoken, spoken!.kind, spoken!.date], [true, 'when-asked', '']); // no date unless it is for a day
  assert.equal(session.adviceAudio(typed!.id), null);
  assert.deepEqual(Buffer.from(session.adviceAudio(spoken!.id)!.bytes), Buffer.from(AUDIO));

  assert.equal(session.changeAdvice(typed!.id, { ...ADVICE(daughter.id), date: '2031-05-04' }).ok, true);
  assert.equal(session.advice()[0]!.date, '2031-05-04');
  assert.equal(session.changeAdvice('no-such-id', ADVICE(daughter.id)).ok, false);

  // Nothing said is in the clear, on disk or in the record of activity.
  assert.ok(!everythingOnDisk(home).includes('recognisable piece of advice'));
  assert.ok(!JSON.stringify(session.recentActivity()).includes('recognisable'));

  session.lock();
  assert.deepEqual(session.advice(), []);
  await session.unlock(PASSPHRASE);
  assert.equal(session.advice().length, 2);

  // Withdrawing consent blocks adding and changing, never removing.
  session.withdrawConsent();
  assert.equal(session.addAdvice(ADVICE(daughter.id), null, '').ok, false);
  assert.equal(session.changeAdvice(typed!.id, ADVICE(daughter.id)).ok, false);
  session.removeAdvice(spoken!.id);
  assert.equal(readdirSync(path.join(archive, 'media')).length, before);
  assert.deepEqual(session.advice().map((a) => a.occasion), ['Your wedding day']);
});

test('the memory store is built from stories, interview answers and advice, and follows who each is for', async () => {
  const { session } = await readyToInterview();
  session.addPerson(DAUGHTER);
  const daughter = session.people()[0]!;
  assert.deepEqual(session.memories(), { memories: [], storiesNotWrittenDown: 0 });

  session.addStory(STORY, AUDIO, 'audio/webm', 61);
  assert.deepEqual(session.memories(), { memories: [], storiesNotWrittenDown: 1 }); // a recording with no words yet
  session.changeStory(session.stories()[0]!.id, { ...STORY, text: 'We took the caravan to Cornwall with Ada.' });
  interviewer = says('{"done": false, "question": "And then?"}');
  await session.answerInterview('work', 'I drove lorries for thirty years.', null, '');
  session.setInterviewAudience('work', 0, { kind: 'person', personId: daughter.id });
  session.addAdvice({ personId: daughter.id, occasion: 'Your wedding day', kind: 'on-the-day', date: '', text: 'Marry someone who makes you laugh.' }, null, '');
  session.addAdvice({ personId: daughter.id, occasion: 'Losing a job', kind: 'when-asked', date: '', text: 'It is only a job.' }, null, '');

  const { memories, storiesNotWrittenDown } = session.memories();
  assert.equal(storiesNotWrittenDown, 0);
  assert.deepEqual(
    memories.map((m) => [m.source.kind, m.source.title, m.text, m.audience.kind, m.use]),
    [
      ['story', 'The caravan', 'We took the caravan to Cornwall with Ada.', 'everyone', 'memory'],
      ['interview', 'Work', 'I drove lorries for thirty years.', 'person', 'memory'],
      ['advice', 'Your wedding day', 'Marry someone who makes you laugh.', 'person', 'advice-on-the-day'],
      ['advice', 'Losing a job', 'It is only a job.', 'person', 'advice-when-asked'],
    ],
  );
  assert.ok(memories[1]!.context.length > 0); // the interviewer's question is kept as context, not as the memory
  assert.deepEqual(memories[0]!.people, [daughter.id]); // named in the story

  // Asking again changes nothing: same passages, same ids.
  assert.deepEqual(session.memories().memories.map((m) => m.id), memories.map((m) => m.id));

  // Deleting a source takes its passages with it.
  session.removeAdvice(session.advice()[1]!.id);
  assert.equal(session.memories().memories.length, 3);
});

test('a passage can be corrected, made private, left out and put back, and the choices last', async () => {
  const { session, home } = await readyToInterview();
  session.addPerson(DAUGHTER);
  const daughter = session.people()[0]!;
  session.addStory({ ...STORY, text: 'a recognisable memory passage' }, AUDIO, 'audio/webm', 61);
  const id = session.memories().memories[0]!.id;

  assert.equal(session.changeMemory(id, { words: '   ' }).ok, false);
  assert.equal(session.changeMemory(id, { audience: { kind: 'person', personId: 'nobody' } }).ok, false);
  assert.equal(session.changeMemory('no-such-id', { leftOut: true }).ok, false);
  assert.equal(session.changeMemory(id, { words: 'a corrected passage', audience: { kind: 'person', personId: daughter.id }, leftOut: true }).ok, true);

  session.lock();
  assert.deepEqual(session.memories(), { memories: [], storiesNotWrittenDown: 0 });
  assert.ok(!everythingOnDisk(home).includes('recognisable memory passage') && !everythingOnDisk(home).includes('corrected passage'));
  await session.unlock(PASSPHRASE);
  const kept = session.memories().memories[0]!;
  assert.deepEqual([kept.id, kept.words, kept.text, kept.leftOut, kept.ownAudience], [id, 'a corrected passage', 'a recognisable memory passage', true, true]);
  assert.deepEqual(kept.audience, { kind: 'person', personId: daughter.id });
  assert.ok(!JSON.stringify(session.recentActivity()).includes('corrected passage'));

  // Changing the story's words under a passage the person had marked holds the new passage back.
  session.changeStory(session.stories()[0]!.id, { ...STORY, text: 'a recognisable memory passage, now longer' });
  const held = session.memories().memories[0]!;
  assert.deepEqual([held.held, held.leftOut, held.audience.kind], [true, false, 'everyone']);
  assert.equal(session.changeMemory(held.id, { held: false }).ok, true);
  assert.equal(session.memories().memories[0]!.held, false);

  // With consent withdrawn a passage can still be left out, but nothing can be put back or widened.
  session.withdrawConsent();
  assert.equal(session.changeMemory(held.id, { leftOut: true }).ok, true);
  assert.equal(session.changeMemory(held.id, { leftOut: false }).ok, false);
  assert.equal(session.changeMemory(held.id, { words: 'more' }).ok, false);
  assert.equal(session.memories().memories[0]!.leftOut, true);
});

async function withPassages() {
  const opened = await readyToInterview();
  const { session } = opened;
  session.addPerson(DAUGHTER);
  const daughter = session.people()[0]!;
  session.addStory({ ...STORY, text: 'I always said what I thought, even when it cost me.' }, AUDIO, 'audio/webm', 61);
  session.addAdvice({ personId: daughter.id, occasion: 'Losing a job', kind: 'when-asked', date: '', text: 'Listen, kiddo, it is only a job.' }, null, '');
  session.addAdvice({ personId: daughter.id, occasion: 'Your wedding day', kind: 'on-the-day', date: '', text: 'A secret kept for the day.' }, null, '');
  asked.length = 0;
  return { ...opened, daughter };
}

const DRAFT = JSON.stringify({
  lines: [
    { section: 'values', text: 'I say what I think, even when it costs me.', passages: [1] },
    { section: 'voice', text: 'I talk plainly and do not dress things up.', passages: [1] },
    { section: 'people', text: 'I call her kiddo.', passages: [1] },
    { section: 'values', text: 'Nothing stands behind this line.', passages: [7] },
  ],
});

test('the character sheet is drafted only from passages for everyone, and each line keeps what it rests on', async () => {
  const { session } = await withPassages();
  assert.equal(session.sheet('character').lines.length, 0);
  assert.equal(session.sheet('character').passagesAvailable, 1);
  interviewer = says(DRAFT);
  assert.deepEqual(await session.draftSheet('character'), { ok: true, problems: [] });

  // One request, holding the story and nothing that was for the daughter alone.
  assert.equal(asked.length, 1);
  const sent = asked[0]!.request.messages[0]!.content;
  assert.ok(sent.includes('I always said what I thought'));
  assert.ok(!sent.includes('kiddo') && !sent.includes('secret kept for the day'));
  assert.ok(asked[0]!.request.system.includes('character sheet for Ada Lovelace'));

  const view = session.sheet('character');
  assert.deepEqual(view.lines.map((l) => [l.section, l.text, l.origin, l.checked, l.inUse]), [['values', 'I say what I think, even when it costs me.', 'drafted', false, true]]);
  assert.equal(view.lines[0]!.support[0]!.excerpt, 'I always said what I thought, even when it cost me.');
  assert.equal(view.draftedFrom, 1);

  // Leave the passage out and the drafted line is no longer relied on, until the person confirms it.
  session.changeMemory(view.lines[0]!.support[0]!.memoryId, { leftOut: true });
  assert.equal(session.sheet('character').lines[0]!.inUse, false);
  assert.equal(session.changeSheetLine('character', view.lines[0]!.id, { checked: true }).ok, true);
  assert.equal(session.sheet('character').lines[0]!.inUse, true);
});

test('the style profile adds lines about one person, drafted only from passages meant for them', async () => {
  const { session, daughter } = await withPassages();
  interviewer = says(DRAFT);
  assert.equal((await session.draftSheet('style')).ok, true);
  assert.equal(asked.length, 2);
  const [general, personal] = asked;
  assert.ok(general!.request.messages[0]!.content.includes('I always said what I thought') && !general!.request.messages[0]!.content.includes('kiddo'));
  assert.ok(general!.request.messages[0]!.content.includes('words to a sentence'));
  assert.ok(personal!.request.messages[0]!.content.includes('kiddo') && !personal!.request.messages[0]!.content.includes('I always said what I thought'));
  assert.ok(!personal!.request.messages[0]!.content.includes('secret kept for the day')); // advice kept for the day is never sent
  assert.ok(personal!.request.system.includes('Ada (daughter)'));

  const view = session.sheet('style');
  assert.deepEqual(view.lines.map((l) => [l.section, l.text, l.audience.kind]), [
    ['voice', 'I talk plainly and do not dress things up.', 'everyone'],
    ['people', 'I call her kiddo.', 'person'],
  ]);
  assert.deepEqual(view.lines[1]!.audience, { kind: 'person', personId: daughter.id });
  assert.ok(view.measure && view.measure.words > 0);
});

test('the person can correct, confirm, strike and add lines; a new draft respects all of it', async () => {
  const { session, home } = await withPassages();
  interviewer = says(JSON.stringify({ lines: [{ section: 'values', text: 'I love golf.', passages: [1] }, { section: 'humour', text: 'I laugh at myself first.', passages: [1] }] }));
  await session.draftSheet('character');
  const [golf, laugh] = session.sheet('character').lines;

  assert.equal(session.changeSheetLine('character', laugh!.id, { text: '   ' }).ok, false);
  assert.equal(session.changeSheetLine('character', laugh!.id, { text: 'I laugh at myself before anyone else can.' }).ok, true);
  assert.equal(session.removeSheetLine('character', golf!.id).ok, true);
  assert.equal(session.addSheetLine('character', 'never', 'I would never talk down to a waiter.', { kind: 'everyone' }).ok, true);
  assert.equal(session.addSheetLine('character', 'nonsense', 'x', { kind: 'everyone' }).ok, false);
  assert.equal(session.addSheetLine('character', 'never', 'x', { kind: 'person', personId: 'a' }).ok, false);
  assert.equal(session.addSheetLine('style', 'people', 'I call him son.', { kind: 'everyone' }).ok, false);

  // Claude suggests golf again, and a new line. Golf stays struck; the person's lines stay.
  asked.length = 0;
  interviewer = says(JSON.stringify({ lines: [{ section: 'values', text: 'I love golf.', passages: [1] }, { section: 'beliefs', text: 'I believe in turning up.', passages: [1] }] }));
  await session.draftSheet('character');
  assert.ok(asked[0]!.request.messages[0]!.content.includes('- I love golf.')); // Claude is told it was struck out
  assert.deepEqual(session.sheet('character').lines.map((l) => [l.text, l.origin, l.checked]), [
    ['I laugh at myself before anyone else can.', 'yours', true],
    ['I would never talk down to a waiter.', 'yours', true],
    ['I believe in turning up.', 'drafted', false],
  ]);

  // Encrypted on disk, kept across lock and unlock, and the record of activity has no words in it.
  session.lock();
  assert.equal(session.sheet('character').lines.length, 0);
  assert.ok(!everythingOnDisk(home).includes('talk down to a waiter'));
  await session.unlock(PASSPHRASE);
  assert.equal(session.sheet('character').lines.length, 3);
  const activity = JSON.stringify(session.recentActivity());
  assert.ok(activity.includes('character.drafted') && activity.includes('character.changed') && !activity.includes('waiter'));
});

test('drafting needs consent, a key and something to draft from; a failed draft changes nothing', async () => {
  const { session } = await openSession();
  interviewer = says(DRAFT);
  assert.equal((await session.draftSheet('character')).ok, false); // no consent
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  assert.ok((await session.draftSheet('character')).problems[0]!.includes('AI key'));
  await session.testAndSaveAiKey(GOOD_KEY);
  assert.ok((await session.draftSheet('character')).problems[0]!.includes('nothing to draft from'));

  session.addStory({ ...STORY, text: 'I always said what I thought.' }, AUDIO, 'audio/webm', 61);
  interviewer = async () => ({ ok: false, problem: 'Echo could not reach Anthropic.' });
  assert.deepEqual(await session.draftSheet('character'), { ok: false, problems: ['Echo could not reach Anthropic.'] });
  interviewer = says('Sorry, I cannot help with that.');
  assert.equal((await session.draftSheet('character')).ok, false);
  interviewer = says('{"lines": []}');
  const empty = await session.draftSheet('character');
  assert.ok(empty.ok && empty.note?.includes('no new lines'));
  assert.equal(session.sheet('character').lines.length, 0);

  // With consent withdrawn a line can still be struck out, but nothing can be drafted, added or confirmed.
  interviewer = says(DRAFT);
  await session.draftSheet('character');
  const line = session.sheet('character').lines[0]!;
  session.withdrawConsent();
  assert.equal((await session.draftSheet('character')).ok, false);
  assert.equal(session.addSheetLine('character', 'values', 'More.', { kind: 'everyone' }).ok, false);
  assert.equal(session.changeSheetLine('character', line.id, { checked: true }).ok, false);
  assert.equal(session.removeSheetLine('character', line.id).ok, true);
});

const ECHO_OK = '{"ok": true, "problems": []}';
/** A stand-in for Claude in conversation: answers each request from a list, in order. */
function conversation(answers: string[]) {
  return async (key: string, request: ClaudeRequest): Promise<ClaudeAnswer> => {
    asked.push({ key, request });
    const next = answers.shift();
    return next === undefined ? { ok: false, problem: 'the stand-in ran out of answers' } : { ok: true, text: next, model: 'test' };
  };
}

async function readyToTalk() {
  const opened = await withPassages(); // a story for everyone, advice for the daughter (one when asked, one kept for the day)
  const { session } = opened;
  session.addPerson({ name: 'Ben', relationship: 'son', callsMe: 'Dad', mayTalkToEcho: true });
  session.addPerson({ name: 'Nosy Neighbour', relationship: 'neighbour', callsMe: '', mayTalkToEcho: false });
  const [, son, neighbour] = session.people();
  asked.length = 0;
  return { ...opened, son: son!, neighbour: neighbour! };
}

test('a conversation opens with the fixed AI echo line, and a checked reply names the passages it drew on', async () => {
  const { session } = await readyToTalk();
  const start = session.chat({ kind: 'owner' });
  assert.equal(start.blocked, null);
  assert.deepEqual(start.speakingAs.map((option) => option.label), ['Myself, trying it out', 'Ada', 'Ben']); // not the neighbour
  assert.equal(start.messages.length, 1);
  assert.ok(start.messages[0]!.opening && start.messages[0]!.text.startsWith("I'm an AI echo of Ada Lovelace"));
  assert.equal(start.passages, 1);

  interviewer = conversation(['{"reply": "I always said what I thought, and it cost me.", "passages": [1]}', ECHO_OK]);
  assert.deepEqual(await session.sayToEcho({ kind: 'owner' }, '  What were you like at work?  '), { ok: true, problems: [] });
  const view = session.chat({ kind: 'owner' });
  assert.deepEqual(view.messages.map((m) => [m.role, m.text]), [
    ['echo', start.messages[0]!.text],
    ['them', 'What were you like at work?'],
    ['echo', 'I always said what I thought, and it cost me.'],
  ]);
  const reply = view.messages[2]!;
  assert.equal(reply.check, 'passed');
  assert.equal(reply.support[0]!.excerpt, 'I always said what I thought, even when it cost me.');
  assert.equal(view.waiting, false);

  // The draft request holds the rules and the opening line; the second request is the checker.
  assert.equal(asked.length, 2);
  assert.ok(asked[0]!.request.system.includes('You are the AI echo of Ada Lovelace') && asked[0]!.request.system.includes(start.messages[0]!.text));
  assert.deepEqual(asked[0]!.request.messages, [{ role: 'user', content: 'What were you like at work?' }]);
  assert.ok(asked[1]!.request.system.includes('You are the checker'));

  // The record of activity has which passages were drawn on, and none of the words.
  const activity = JSON.stringify(session.recentActivity());
  assert.ok(activity.includes('echo.replied') && activity.includes(reply.sources![0]!));
  assert.ok(!activity.includes('cost me') && !activity.includes('at work'));
});

test('each listener is only ever sent what they may hear', async () => {
  const { session, daughter, son, neighbour } = await readyToTalk();
  const reply = () => conversation(['{"reply": "Hello.", "passages": []}', ECHO_OK]);

  interviewer = reply();
  await session.sayToEcho({ kind: 'person', personId: daughter.id }, 'Hello Dad, I lost my job.');
  const toDaughter = asked[0]!.request.system;
  assert.ok(toDaughter.includes('Listen, kiddo, it is only a job.') && toDaughter.includes('advice for this person, for the occasion: Losing a job'));
  assert.ok(toDaughter.includes('I always said what I thought'));
  assert.ok(!toDaughter.includes('A secret kept for the day')); // advice kept for the day is never used in conversation
  assert.ok(toDaughter.includes('Ada, Ada\'s daughter.'));

  asked.length = 0;
  interviewer = reply();
  await session.sayToEcho({ kind: 'person', personId: son.id }, 'Hello Dad.');
  const toSon = asked[0]!.request.system + asked[1]!.request.messages[0]!.content;
  assert.ok(toSon.includes('I always said what I thought'));
  assert.ok(!toSon.includes('kiddo') && !toSon.includes('secret kept for the day'));
  assert.ok(!toSon.includes('I lost my job')); // what his sister told the echo is not his to hear

  asked.length = 0;
  interviewer = reply();
  await session.sayToEcho({ kind: 'owner' }, 'Hello.');
  assert.ok(!asked[0]!.request.system.includes('kiddo'));

  // Someone not allowed to talk to the echo, or not in the list, gets nothing at all.
  asked.length = 0;
  assert.equal((await session.sayToEcho({ kind: 'person', personId: neighbour.id }, 'Hello.')).ok, false);
  assert.equal((await session.sayToEcho({ kind: 'person', personId: 'stranger' }, 'Hello.')).ok, false);
  assert.ok(session.chat({ kind: 'person', personId: neighbour.id }).blocked);
  assert.equal(asked.length, 0);

  // Each listener's conversation is kept apart.
  assert.equal(session.chat({ kind: 'person', personId: daughter.id }).messages.length, 3);
  assert.equal(session.chat({ kind: 'person', personId: son.id }).messages[1]!.text, 'Hello Dad.');
});

test('an invented memory is never shown: redrafted once, then replaced by the "nothing" line', async () => {
  const { session } = await readyToTalk();
  const invented = '{"reply": "We went to Wales in 1994.", "passages": []}';
  const notOk = '{"ok": false, "problems": ["Wales in 1994 is in no passage."]}';
  interviewer = conversation([invented, notOk, '{"reply": "I never got round to telling Echo about Wales.", "passages": []}', ECHO_OK]);
  await session.sayToEcho({ kind: 'owner' }, 'Do you remember Wales?');
  let last = session.chat({ kind: 'owner' }).messages.at(-1)!;
  assert.deepEqual([last.text, last.check, last.rejected], ['I never got round to telling Echo about Wales.', 'redrafted', ['Wales in 1994 is in no passage.']]);

  interviewer = conversation([invented, notOk, invented, notOk]);
  await session.sayToEcho({ kind: 'owner' }, 'Go on, you must remember.');
  last = session.chat({ kind: 'owner' }).messages.at(-1)!;
  assert.equal(last.check, 'fallback');
  assert.ok(last.text.startsWith('I never got round to telling Echo'));
  assert.ok(!JSON.stringify(session.chat({ kind: 'owner' }).messages.map((m) => m.text)).includes('1994'));
});

test('what was said is kept when a reply fails, and trying again answers it', async () => {
  const { session, home } = await readyToTalk();
  interviewer = async () => ({ ok: false, problem: 'Echo could not reach Anthropic.' });
  assert.deepEqual(await session.sayToEcho({ kind: 'owner' }, 'a recognisable thing said to the echo'), { ok: false, problems: ['Echo could not reach Anthropic.'] });
  assert.equal(session.chat({ kind: 'owner' }).waiting, true);
  assert.equal((await session.sayToEcho({ kind: 'owner' }, '   ')).ok, false);

  interviewer = conversation(['{"reply": "a recognisable reply from the echo", "passages": []}', ECHO_OK]);
  assert.equal((await session.retryEcho({ kind: 'owner' })).ok, true);
  assert.deepEqual(session.chat({ kind: 'owner' }).messages.map((m) => m.role), ['echo', 'them', 'echo']);
  assert.equal((await session.retryEcho({ kind: 'owner' })).ok, false); // nothing is waiting for a reply

  // Encrypted on disk and kept across lock and unlock.
  session.lock();
  assert.ok(session.chat({ kind: 'owner' }).blocked);
  const disk = everythingOnDisk(home);
  assert.ok(!disk.includes('recognisable thing said') && !disk.includes('recognisable reply'));
  await session.unlock(PASSPHRASE);
  assert.equal(session.chat({ kind: 'owner' }).messages.length, 3);
});

test('a new conversation opens afresh, and the echo is told what this listener said before, never what others said', async () => {
  const { session, daughter } = await readyToTalk();
  const toDaughter = { kind: 'person' as const, personId: daughter.id };
  interviewer = conversation(['{"reply": "Well done.", "passages": []}', ECHO_OK]);
  await session.sayToEcho(toDaughter, 'I passed my driving test, Dad.');
  assert.equal(session.startChat(toDaughter).ok, true);
  const fresh = session.chat(toDaughter);
  assert.deepEqual([fresh.messages.length, fresh.earlierConversations, fresh.messages[0]!.opening], [1, 1, true]);

  asked.length = 0;
  interviewer = conversation(['{"reply": "Hello again.", "passages": []}', ECHO_OK]);
  await session.sayToEcho(toDaughter, 'Hello again.');
  assert.ok(asked[0]!.request.system.includes('WHAT ADA TOLD YOU IN EARLIER CONVERSATIONS') && asked[0]!.request.system.includes('- I passed my driving test, Dad.'));
  assert.deepEqual(asked[0]!.request.messages, [{ role: 'user', content: 'Hello again.' }]);

  asked.length = 0;
  interviewer = conversation(['{"reply": "Hello.", "passages": []}', ECHO_OK]);
  await session.sayToEcho({ kind: 'owner' }, 'Hello.');
  assert.ok(!asked[0]!.request.system.includes('driving test'));

  // Starting again without saying anything does not pile up empty conversations.
  session.startChat({ kind: 'owner' });
  session.startChat({ kind: 'owner' });
  assert.equal(session.chat({ kind: 'owner' }).earlierConversations, 1);
});

test('the echo does not talk without consent in force or without a key', async () => {
  const { session } = await openSession();
  assert.ok(session.chat({ kind: 'owner' }).blocked);
  assert.equal((await session.sayToEcho({ kind: 'owner' }, 'Hello.')).ok, false);
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  assert.equal(session.chat({ kind: 'owner' }).blocked, null);
  const noKey = await session.sayToEcho({ kind: 'owner' }, 'Hello.');
  assert.ok(!noKey.ok && noKey.problems[0]!.includes('AI key'));
  assert.equal(session.chat({ kind: 'owner' }).waiting, true); // what was said is kept
  session.withdrawConsent();
  assert.ok(session.chat({ kind: 'owner' }).blocked);
  assert.equal((await session.retryEcho({ kind: 'owner' })).ok, false);
});

test('the blind test: own answers stay out of the echo, the echo answers through the check, and judges never see labels', async () => {
  const { session, daughter, home } = await readyToTalk();
  assert.equal(session.blindTest().stage, 'none');
  assert.equal(session.saveBlindAnswer(0, 'x').ok, false); // not started
  assert.equal(session.startBlindTest().ok, true);
  let view = session.blindTest();
  assert.deepEqual([view.stage, view.writing.length, view.of, view.ownerName], ['writing', 20, 20, 'Ada Lovelace']);
  assert.deepEqual(view.possibleJudges.map((judge) => judge.label), ['Ada Lovelace', 'Ada', 'Ben']);

  assert.equal((await session.blindEchoNext()).ok, false); // own answers first
  assert.equal(session.saveBlindAnswer(0, '   ').ok, false);
  for (let i = 0; i < 20; i += 1) assert.equal(session.saveBlindAnswer(i, `my own recognisable answer ${i}`).ok, true);
  assert.equal(session.blindTest().stage, 'echo');
  assert.deepEqual(session.blindTest().writing, []); // no longer handed to the screen

  // The echo answers one question at a time; a failure loses nothing and it carries on.
  asked.length = 0;
  interviewer = conversation(['{"reply": "echo answer 0", "passages": [1]}', ECHO_OK]);
  assert.deepEqual(await session.blindEchoNext(), { ok: true, problems: [], remaining: 19 });
  const first = asked[0]!.request;
  assert.ok(first.system.includes('You are being asked one question') && !first.system.includes('ask something back'));
  assert.ok(first.system.includes('I always said what I thought') && !first.system.includes('kiddo')); // only what is for everyone
  assert.ok(!JSON.stringify(asked).includes('my own recognisable answer')); // the echo never sees the real answers
  assert.deepEqual(first.messages, [{ role: 'user', content: 'What would you say to someone who has just had the worst day of their life?' }]);
  interviewer = async () => ({ ok: false, problem: 'Echo could not reach Anthropic.' });
  assert.deepEqual(await session.blindEchoNext(), { ok: false, problems: ['Echo could not reach Anthropic.'], remaining: 19 });
  for (let i = 1; i < 20; i += 1) {
    interviewer = conversation([`{"reply": "echo answer ${i}", "passages": []}`, ECHO_OK]);
    assert.equal((await session.blindEchoNext()).remaining, 19 - i);
  }
  view = session.blindTest();
  assert.deepEqual([view.stage, view.echoAnswered, view.result!.complete, view.result!.breakdown], ['judging', 20, false, null]);
  assert.deepEqual(await session.blindEchoNext(), { ok: true, problems: [], remaining: 0 });

  // The memory store holds none of the test.
  assert.ok(!JSON.stringify(session.memories()).includes('recognisable answer'));

  // Judging: each judge gets twenty unlabelled pairs. Here the person always spots the real one and the daughter never does.
  const judge = (who: Parameters<typeof session.blindPair>[0], spotsReal: boolean, echoScore: number) => {
    for (let n = 1; n <= 20; n += 1) {
      const pair = session.blindPair(who)!;
      assert.deepEqual([pair.number, pair.of], [n, 20]);
      assert.deepEqual(Object.keys(pair).sort(), ['left', 'number', 'of', 'question', 'right']);
      const realIsLeft = pair.left.startsWith('my own');
      assert.equal(session.judgeBlindPair(who, { pick: spotsReal === realIsLeft ? 'left' : 'right', leftScore: realIsLeft ? 5 : echoScore, rightScore: realIsLeft ? echoScore : 5 }).ok, true);
    }
    assert.equal(session.blindPair(who), null);
    assert.equal(session.judgeBlindPair(who, { pick: 'left', leftScore: 3, rightScore: 3 }).ok, false);
  };
  assert.equal(session.blindPair({ kind: 'person', personId: 'stranger' }), null);
  assert.equal(session.judgeBlindPair({ kind: 'owner' }, { pick: 'left', leftScore: 9, rightScore: 3 }).ok, false);
  judge({ kind: 'owner' }, true, 4);
  assert.equal(session.saveBlindAnswer(0, 'changed after judging began').ok, false);
  let result = session.blindTest().result!;
  assert.deepEqual([result.complete, result.judges[0]!.pickedReal, result.judges[0]!.withinBar, result.breakdown], [false, 20, false, null]);

  judge({ kind: 'person', personId: daughter.id }, false, 5);
  result = session.blindTest().result!;
  assert.deepEqual([result.complete, result.passed, result.echoAverage], [true, false, 4.5]); // the person told them apart every time
  assert.deepEqual(result.judges.map((j) => [j.label, j.pickedReal, j.echoAverage]), [['Ada Lovelace', 20, 4], ['Ada', 0, 5]]);
  assert.equal(result.breakdown![0]!.mine, 'my own recognisable answer 0');
  assert.equal(result.breakdown![0]!.echo, 'echo answer 0');

  // Encrypted on disk, kept across lock and unlock, and the record of activity has no answers in it.
  const activity = JSON.stringify(session.recentActivity());
  assert.ok(activity.includes('blindtest.finished') && !activity.includes('recognisable') && !activity.includes('echo answer'));
  session.lock();
  assert.ok(!everythingOnDisk(home).includes('recognisable answer'));
  await session.unlock(PASSPHRASE);
  assert.equal(session.blindTest().result!.complete, true);

  // A new test starts clean and the old one is kept.
  session.startBlindTest();
  assert.deepEqual([session.blindTest().stage, session.blindTest().earlierTests], ['writing', 1]);
});

function chatFile(home: string, name = 'WhatsApp Chat - Ada.txt', extra: string[] = []): string {
  const file = path.join(home, name);
  writeFileSync(file, [
    '[13/12/2025, 09:15:02] Ada: Morning Dad, I have something private to tell you about the surprise party for Mum',
    '[13/12/2025, 09:16:40] Charles Babbage: Morning love, I always said the allotment was the best place to think',
    '[13/12/2025, 09:17:05] Ada: ‎image omitted',
    '[13/12/2025, 21:05:59] Charles Babbage: Proud of you, always was',
    ...extra,
  ].join('\r\n'));
  return file;
}

test('a WhatsApp export is previewed, then imported with the owner and everyone else kept apart', async () => {
  const { session, home, daughter } = await readyToTalk();
  assert.equal(session.previewImport(path.join(home, 'no-such-file.txt')).ok, false);
  writeFileSync(path.join(home, 'notes.txt'), 'Shopping list\nmilk');
  const notAChat = session.previewImport(path.join(home, 'notes.txt'));
  assert.ok(!notAChat.ok && notAChat.problems[0]!.includes('could not find any WhatsApp messages'));

  const previewed = session.previewImport(chatFile(home));
  assert.ok(previewed.ok && 'preview' in previewed);
  const preview = previewed.preview;
  assert.deepEqual([preview.suggestedLabel, preview.messages, preview.media, preview.from, preview.to], ['Ada', 3, 1, '2025-12-13T09:15:02', '2025-12-13T21:05:59']);
  assert.deepEqual(preview.senders, [{ name: 'Charles Babbage', count: 2 }, { name: 'Ada', count: 1 }]);
  assert.equal(preview.alreadyImportedAs, null);
  assert.deepEqual(session.imports(), []); // nothing is saved by looking

  const forDaughter = { kind: 'person' as const, personId: daughter.id };
  assert.equal(session.confirmImport(preview.token, { me: 'Someone Else', label: 'Ada', personId: daughter.id, audience: forDaughter }).ok, false);
  assert.equal(session.confirmImport('not-a-token', { me: 'Charles Babbage', label: 'Ada', personId: daughter.id, audience: forDaughter }).ok, false);
  assert.equal(session.confirmImport(preview.token, { me: 'Charles Babbage', label: ' Ada ', personId: daughter.id, audience: forDaughter }).ok, true);

  const [imported] = session.imports();
  assert.deepEqual([imported!.label, imported!.mine, imported!.others, imported!.me], ['Ada', 2, 1, 'Charles Babbage']);
  const page = session.importMessages(imported!.id, 0, 50);
  assert.deepEqual(page.messages.map((m) => [m.sender, m.thirdParty]), [['Ada', true], ['Charles Babbage', false], ['Charles Babbage', false]]);
  assert.equal(page.total, 3);
  assert.deepEqual(session.importMessages(imported!.id, 2, 50).messages.map((m) => m.text), ['Proud of you, always was']);

  // The same export cannot be imported twice.
  const again = session.previewImport(chatFile(home));
  assert.ok(again.ok && 'preview' in again && again.preview.alreadyImportedAs === 'Ada');
  assert.equal(session.confirmImport(again.preview.token, { me: 'Charles Babbage', label: 'Ada', personId: daughter.id, audience: forDaughter }).ok, false);

  // The owner's words are in the memory store, for the daughter alone. The daughter's words are not in it at all.
  const messages = session.memories().memories.filter((m) => m.source.kind === 'message');
  assert.deepEqual(messages.map((m) => [m.text, m.source.title, m.audience.kind]), [
    ['Morning love, I always said the allotment was the best place to think', 'WhatsApp with Ada', 'person'],
    ['Proud of you, always was', 'WhatsApp with Ada', 'person'],
  ]);
  assert.ok(!JSON.stringify(session.memories()).includes('surprise party'));

  // Encrypted on disk; the record of activity has counts and no names or words.
  assert.ok(!everythingOnDisk(home).replace(readFileSync(path.join(home, 'WhatsApp Chat - Ada.txt'), 'latin1'), '').includes('surprise party'));
  const activity = JSON.stringify(session.recentActivity());
  assert.ok(activity.includes('import.added') && !activity.includes('Babbage') && !activity.includes('allotment'));
});

test("other people's words never reach Claude, and a reply that repeats them is thrown away", async () => {
  const { session, home, daughter, son } = await readyToTalk();
  const toDaughter = { kind: 'person' as const, personId: daughter.id };
  const previewed = session.previewImport(chatFile(home));
  assert.ok(previewed.ok && 'preview' in previewed);
  session.confirmImport(previewed.preview.token, { me: 'Charles Babbage', label: 'Ada', personId: daughter.id, audience: toDaughter });

  // Talking to the daughter: her father's messages to her are there; her own words are not.
  asked.length = 0;
  interviewer = conversation(['{"reply": "The allotment, always.", "passages": [1]}', ECHO_OK]);
  await session.sayToEcho(toDaughter, 'Where did you do your thinking?');
  let sent = JSON.stringify(asked);
  assert.ok(sent.includes('the allotment was the best place to think'));
  assert.ok(!sent.includes('surprise party') && !sent.includes('something private'));

  // Talking to the son, or drafting the style profile: his sister's conversation is not his to hear.
  asked.length = 0;
  interviewer = conversation(['{"reply": "Hello.", "passages": []}', ECHO_OK]);
  await session.sayToEcho({ kind: 'person', personId: son.id }, 'Hello Dad.');
  assert.ok(!JSON.stringify(asked).includes('allotment') && !JSON.stringify(asked).includes('surprise party'));
  asked.length = 0;
  interviewer = says(DRAFT);
  await session.draftSheet('style');
  await session.draftSheet('character');
  sent = JSON.stringify(asked);
  assert.ok(sent.includes('allotment')); // in the request about how he talks to his daughter
  assert.ok(!sent.includes('surprise party'));

  // A draft that repeats her message word for word never gets as far as the checker, and is never shown.
  asked.length = 0;
  interviewer = conversation([
    '{"reply": "You said you had something private to tell you about the surprise party for Mum.", "passages": []}',
    '{"reply": "I never got round to telling Echo about that.", "passages": []}',
    ECHO_OK,
  ]);
  await session.sayToEcho(toDaughter, 'What did I tell you that morning?');
  const last = session.chat(toDaughter).messages.at(-1)!;
  assert.deepEqual([last.text, last.check], ['I never got round to telling Echo about that.', 'redrafted']);
  assert.ok(last.rejected![0]!.includes("someone else's private message"));
  assert.equal(asked.length, 3); // draft, redraft, one check: the first draft was stopped on this computer

  // Deleting the conversation takes its passages out of the memory store.
  session.removeImport(session.imports()[0]!.id);
  assert.deepEqual(session.imports(), []);
  assert.equal(session.memories().memories.filter((m) => m.source.kind === 'message').length, 0);
});

test('an export in a ZIP is read, a conversation can be kept for nobody, and importing needs consent', async () => {
  const { session, home } = await readyToTalk();
  const text = Buffer.from('[13/12/2025, 09:16:40] Charles Babbage: A message inside a zip file\r\n[13/12/2025, 09:17:00] Bob: Reply', 'utf8');
  const name = Buffer.from('_chat.txt');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(text.length, 18);
  local.writeUInt32LE(text.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(text.length, 20);
  central.writeUInt32LE(text.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(30 + name.length + text.length, 16);
  const zipPath = path.join(home, 'WhatsApp Chat - Bob.zip');
  writeFileSync(zipPath, Buffer.concat([local, name, text, central, name, end]));

  const previewed = session.previewImport(zipPath);
  assert.ok(previewed.ok && 'preview' in previewed);
  assert.deepEqual([previewed.preview.suggestedLabel, previewed.preview.messages], ['Bob', 2]);
  assert.equal(session.confirmImport(previewed.preview.token, { me: 'Charles Babbage', label: 'Bob', personId: null, audience: null }).ok, true);
  assert.equal(session.memories().memories.filter((m) => m.source.kind === 'message').length, 0); // kept, but the echo is given nothing

  session.withdrawConsent();
  assert.equal(session.previewImport(zipPath).ok, false);
  session.removeImport(session.imports()[0]!.id); // deleting is always allowed
  assert.deepEqual(session.imports(), []);
});

test('a Discord package lists its channels by name; a channel holds only the owner, and its words go to the memory store', async () => {
  const { session, home } = await readyToTalk();
  const zipPath = path.join(home, 'package.zip');
  const dm = [
    { ID: '2', Timestamp: '2025-12-13 09:16:00', Contents: 'and bring the long drill bits <:thumbsup:123>', Attachments: '' },
    { ID: '1', Timestamp: '2025-12-13 09:15:00', Contents: 'the shed roof needs felting before winter', Attachments: '' },
    { ID: '3', Timestamp: '2025-12-13 11:00:00', Contents: '', Attachments: 'https://cdn.example/roof.png' },
  ];
  writeFileSync(zipPath, makeZip([
    { name: 'package/messages/index.json', contents: Buffer.from(JSON.stringify({ '111': 'Direct Message with ben#0042', '222': 'general in Garden Club' })) },
    { name: 'package/messages/c111/messages.json', contents: Buffer.from(JSON.stringify(dm)), deflate: true },
    { name: 'package/messages/c111/channel.json', contents: Buffer.from('{"id":"111","type":1}') },
    { name: 'package/messages/c222/messages.csv', contents: Buffer.from('ID,Timestamp,Contents,Attachments\n9,2025-12-14 10:00:00+00:00,who has the key to the hall,\n') },
    { name: 'package/account/user.json', contents: Buffer.from('{}') },
  ]));

  const chosen = session.chooseDiscord(zipPath);
  assert.ok(chosen.ok && 'threads' in chosen);
  assert.deepEqual(chosen.threads.map((thread) => thread.name).sort(), ['Direct Message with ben#0042', 'general in Garden Club']);
  assert.deepEqual(session.imports(), []);

  const opened = session.openImportThread('111');
  assert.ok(opened.ok && 'preview' in opened);
  // The owner is the only sender, and is known without asking: the package holds nobody else.
  assert.deepEqual([opened.preview.service, opened.preview.suggestedLabel, opened.preview.messages, opened.preview.media], ['discord', 'ben#0042', 2, 1]);
  assert.deepEqual([opened.preview.senders, opened.preview.suggestedMe], [[{ name: 'Ada Lovelace', count: 2 }], 'Ada Lovelace']);
  assert.equal(session.confirmImport(opened.preview.token, { me: 'Ada Lovelace', label: 'Ben', personId: null, audience: { kind: 'everyone' } }).ok, true);

  const [imported] = session.imports();
  assert.deepEqual([imported!.service, imported!.label, imported!.mine, imported!.others], ['discord', 'Ben', 2, 0]);
  const passage = session.memories().memories.find((m) => m.source.kind === 'message')!;
  assert.deepEqual([passage.text, passage.source.title], ['the shed roof needs felting before winter and bring the long drill bits :thumbsup:', 'Discord with Ben']);

  // The older CSV layout, from the same package.
  const csv = session.openImportThread('222');
  assert.ok(csv.ok && 'preview' in csv);
  assert.deepEqual([csv.preview.suggestedLabel, csv.preview.messages], ['general in Garden Club', 1]);

  // One channel's file from a package that was unzipped.
  const loose = path.join(home, 'c333');
  mkdirSync(loose);
  writeFileSync(path.join(loose, 'messages.json'), JSON.stringify(dm));
  const single = session.chooseDiscord(path.join(loose, 'messages.json'));
  assert.ok(single.ok && 'preview' in single);
  assert.deepEqual([single.preview.suggestedLabel, single.preview.alreadyImportedAs], ['Discord c333', 'Ben']); // the same messages are recognised

  // Something that is not a Discord package is refused in plain words.
  const other = path.join(home, 'other.zip');
  writeFileSync(other, makeZip([{ name: 'photos/1.jpg', contents: Buffer.alloc(10) }]));
  const refused = session.chooseDiscord(other);
  assert.ok(!refused.ok && refused.problems[0]!.includes('Messages is ticked'));
  writeFileSync(path.join(loose, 'notes.json'), '{"hello": 1}');
  const notMessages = session.chooseDiscord(path.join(loose, 'notes.json'));
  assert.ok(!notMessages.ok && notMessages.problems[0]!.includes('Discord'));
});

test("a mailbox: the owner says which address is theirs, only what they sent is read, and nobody else's words are kept anywhere", async () => {
  const { session, home, son } = await readyToTalk();
  const file = path.join(home, 'Sent.mbox');
  writeFileSync(file, mailbox([
    { from: 'Ada Lovelace <ada@example.com>', to: 'Ben Babbage <ben@example.com>', labels: 'Sent', subject: 'The engine drawings', date: 'Sat, 13 Dec 2025 09:00:00 +0000', body: 'The drawings are in the top drawer of my desk.\r\n\r\n-- \r\nAda' },
    { from: 'Ben Babbage <ben@example.com>', to: 'ada@example.com', labels: 'Inbox', subject: 'Re: The engine drawings', date: 'Sat, 13 Dec 2025 09:30:00 +0000', body: 'Mother, please keep my new post at the foundry between us for now.' },
    { from: 'ada@example.com', to: 'ben@example.com', labels: 'Sent', subject: 'Re: The engine drawings', date: 'Sat, 13 Dec 2025 10:00:00 +0000', headers: ['In-Reply-To: <x@test>'], body: 'Not a word to anyone, I promise.\r\n\r\nOn Sat, 13 Dec 2025 at 09:30, Ben Babbage <ben@example.com> wrote:\r\n> Mother, please keep my new post at the foundry between us for now.' },
    { from: 'ada@example.com', to: 'vera@example.com', labels: 'Sent', date: 'Sun, 14 Dec 2025 10:00:00 +0000', body: 'See you on Sunday at ten.' },
  ]));

  const found = await session.chooseEmail(file);
  assert.ok(found.ok && 'mailbox' in found);
  assert.deepEqual([found.mailbox.emails, found.mailbox.suggested], [4, ['ada@example.com']]);
  assert.deepEqual(session.imports(), []); // nothing is kept yet
  assert.equal(session.chooseEmailAddresses([]).ok, false);
  assert.equal(session.chooseEmailAddresses(['nobody@example.com']).ok, false);

  const listed = session.chooseEmailAddresses(['Ada@Example.com']);
  assert.ok(listed.ok && 'threads' in listed);
  assert.deepEqual(listed.threads.map((thread) => [thread.name, thread.messages]), [['Ben Babbage (ben@example.com)', 2], ['vera@example.com', 1]]);

  const opened = session.openImportThread('ben@example.com');
  assert.ok(opened.ok && 'preview' in opened);
  assert.deepEqual([opened.preview.service, opened.preview.suggestedLabel, opened.preview.messages, opened.preview.suggestedMe], ['email', 'Ben Babbage', 2, 'Ada Lovelace']);
  assert.deepEqual(opened.preview.senders, [{ name: 'Ada Lovelace', count: 2 }]);
  const forSon = { kind: 'person' as const, personId: son.id };
  assert.equal(session.confirmImport(opened.preview.token, { me: 'Ada Lovelace', label: 'Ben', personId: son.id, audience: forSon }).ok, true);

  const [imported] = session.imports();
  assert.deepEqual([imported!.service, imported!.label, imported!.mine, imported!.others], ['email', 'Ben', 2, 0]);
  const passages = session.memories().memories.filter((m) => m.source.kind === 'message');
  assert.deepEqual(passages.map((m) => [m.text, m.source.title, m.audience]), [
    ['The engine drawings The drawings are in the top drawer of my desk.', 'Email with Ben', forSon],
    ['Not a word to anyone, I promise.', 'Email with Ben', forSon],
  ]);
  // The son's email, and the copy of it quoted under the reply, are in neither the memory store nor the stored conversation.
  assert.ok(!JSON.stringify(session.memories()).includes('foundry'));
  assert.ok(!JSON.stringify(session.importMessages(imported!.id, 0, 50)).includes('foundry'));

  // Without consent nothing is read.
  session.withdrawConsent();
  const refused = await session.chooseEmail(file);
  assert.ok(!refused.ok && refused.problems.length === 1 && /consent/i.test(refused.problems[0]!));
});

test('a letter: a page is read by the AI service, then corrected and checked by hand before it is kept, encrypted, and reaches the memory store', async () => {
  const { session, archive, son } = await readyToTalk();
  const picture = Buffer.from('a small picture of a page, standing in for a JPEG');

  interviewer = says('My dear Ben,\n\nThe [?] in the hall is yours.');
  const read = await session.readLetterPage(picture, 'image/jpeg');
  assert.deepEqual(read, { ok: true, text: 'My dear Ben,\n\nThe [?] in the hall is yours.' });
  const sent = asked.at(-1)!.request;
  assert.ok(sent.system.includes('Never guess a word you cannot read'));
  assert.deepEqual(sent.picture, { mimeType: 'image/jpeg', base64: picture.toString('base64') });
  assert.deepEqual(session.letters(), []); // reading keeps nothing

  assert.equal((await session.readLetterPage(picture, 'application/pdf')).ok, false);
  assert.equal((await session.readLetterPage(new Uint8Array(0), 'image/jpeg')).ok, false);
  interviewer = says('NOTHING');
  assert.equal((await session.readLetterPage(picture, 'image/jpeg')).ok, false);

  const forSon = { kind: 'person' as const, personId: son.id };
  const details = { title: 'About the clock', personId: son.id, writtenOn: '1998', text: 'My dear Ben,\n\nThe [?] in the hall is yours.', audience: forSon, mine: true, checked: true };
  const pages = [{ bytes: picture, mimeType: 'image/jpeg' }];
  assert.ok(session.addLetter(details, pages).problems[0]!.includes('still marked [?]')); // a word the reader could not make out
  const corrected = { ...details, text: 'My dear Ben,\n\nThe grandfather clock in the hall is yours.' };
  assert.ok(session.addLetter({ ...corrected, checked: false }, pages).problems[0]!.includes('tick the box'));
  assert.ok(session.addLetter({ ...corrected, mine: false }, pages).problems[0]!.includes('letters you wrote yourself'));
  assert.equal(session.addLetter(corrected, [{ bytes: picture, mimeType: 'application/pdf' }]).ok, false);
  assert.deepEqual(session.letters(), []);
  assert.deepEqual(session.addLetter(corrected, pages), { ok: true, problems: [] });

  const [letter] = session.letters();
  assert.deepEqual([letter!.title, letter!.writtenOn, letter!.pages, letter!.audience], ['About the clock', '1998', 1, forSon]);
  assert.deepEqual(Buffer.from(session.letterPage(letter!.id, 0)!.bytes), picture);
  assert.equal(session.letterPage(letter!.id, 1), null);
  // Neither the words nor the picture are readable on disk.
  const disk = everythingOnDisk(archive);
  assert.ok(!disk.includes('grandfather clock') && !disk.includes('standing in for a JPEG'));

  const passage = () => session.memories().memories.find((m) => m.source.kind === 'letter');
  assert.deepEqual([passage()!.text, passage()!.source.title, passage()!.audience], ['My dear Ben,\n\nThe grandfather clock in the hall is yours.', 'About the clock (to Ben, written 1998)', forSon]);
  assert.deepEqual(session.changeLetter(letter!.id, { ...corrected, text: 'My dear Ben,\n\nThe grandfather clock is yours. Wind it on Sundays.' }), { ok: true, problems: [] });
  assert.ok(passage()!.text.includes('Wind it on Sundays'));
  assert.equal(session.changeLetter('no-such-letter', corrected).ok, false);

  // Without consent nothing is read or added, but a letter can still be taken out.
  session.withdrawConsent();
  assert.equal((await session.readLetterPage(picture, 'image/jpeg')).ok, false);
  assert.equal(session.addLetter(corrected, pages).ok, false);
  session.removeLetter(letter!.id);
  assert.deepEqual(session.letters(), []);
  assert.equal(session.letterPage(letter!.id, 0), null);
  assert.ok(!everythingOnDisk(archive).includes(letter!.id));
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

test('a copy of everything is written as ordinary files that open without Echo, and holds no secrets', async () => {
  const { session, home, archive, daughter } = await withPassages();
  session.addLetter({ title: 'About the clock', personId: daughter.id, writtenOn: '1998', text: 'The grandfather clock is yours.', audience: { kind: 'everyone' }, mine: true, checked: true }, [{ bytes: Buffer.from('a page picture'), mimeType: 'image/jpeg' }]);
  writeFileSync(path.join(home, 'chat.txt'), '[13/12/2025, 09:15:02] Ben: Dad, keep this between us\n[13/12/2025, 09:16:40] Ada Lovelace: Not a word, I promise you that\n');
  const previewed = session.previewImport(path.join(home, 'chat.txt'));
  assert.ok(previewed.ok && 'preview' in previewed);
  session.confirmImport(previewed.preview.token, { me: 'Ada Lovelace', label: 'Ben', personId: null, audience: { kind: 'everyone' } });

  const target = path.join(home, 'copies');
  mkdirSync(target);
  assert.equal((await session.exportEverything(archive)).ok, false); // never into the archive itself
  assert.equal((await session.exportEverything(path.join(home, 'no-such-folder'))).ok, false);
  const made = await session.exportEverything(target);
  assert.ok(made.ok);
  assert.ok(path.basename(made.folder).startsWith('Echo export 20') && path.dirname(made.folder) === target);

  const files = filesUnder(made.folder);
  assert.equal(files.length, made.files); // the count given back is every file written
  for (const expected of [
    'README.txt',
    'people.json',
    'memory-times.json',
    'consent/consent.json',
    'consent/consent-recording.webm',
    'stories/stories.json',
    'stories/01 The caravan.txt',
    'stories/01 The caravan.webm',
    'interview/interview.json',
    'interview/interview.txt',
    'advice/advice.json',
    'advice/01 Ada - Losing a job.txt',
    'letters/01 About the clock.txt',
    'letters/01 About the clock page 1.jpg',
    'face-and-voice/captures.json',
    'messages/imports.json',
    'messages/01 WhatsApp - Ben.json',
    'messages/01 WhatsApp - Ben.txt',
    'echo/what-it-remembers.json',
    'echo/character-sheet.json',
    'echo/style-profile.json',
    'echo/conversations.json',
    'echo/conversations.txt',
    'echo/blind-tests.json',
    'activity-log.json',
  ]) assert.ok(files.includes(expected), `${expected} is missing from: ${files.join(', ')}`);

  const read = (name: string) => readFileSync(path.join(made.folder, name), 'utf8');
  assert.ok(read('README.txt').includes('NOTHING IN THIS FOLDER IS ENCRYPTED'));
  assert.ok(read('stories/01 The caravan.txt').includes('I always said what I thought, even when it cost me.'));
  assert.deepEqual(readFileSync(path.join(made.folder, 'stories/01 The caravan.webm')), Buffer.from(AUDIO));
  assert.deepEqual(readFileSync(path.join(made.folder, 'consent/consent-recording.webm')), Buffer.from(VIDEO));
  assert.deepEqual(readFileSync(path.join(made.folder, 'letters/01 About the clock page 1.jpg')), Buffer.from('a page picture'));
  assert.ok(read('letters/01 About the clock.txt').includes('Written: 1998') && read('letters/01 About the clock.txt').includes('The grandfather clock is yours.'));
  assert.ok(read('messages/01 WhatsApp - Ben.txt').includes('(theirs) Ben: Dad, keep this between us')); // other people's words are in it, and marked
  assert.equal(JSON.parse(read('people.json'))[0].name, 'Ada');
  assert.ok(JSON.parse(read('echo/what-it-remembers.json')).memories.length > 0);
  assert.equal(JSON.parse(read('activity-log.json')).intact, true);

  // The passphrase and the AI key are in no file of the copy.
  const everything = everythingOnDisk(made.folder);
  assert.ok(!everything.includes(PASSPHRASE) && !everything.includes(GOOD_KEY));

  // A second copy in the same minute goes beside the first, not over it.
  const again = await session.exportEverything(target);
  assert.ok(again.ok && again.folder !== made.folder);
});

test('removing one thing takes it out of what the echo is given, and conversations can be deleted', async () => {
  const { session } = await readyToTalk();
  session.startChat({ kind: 'owner' });
  interviewer = conversation(['{"reply": "I always said what I thought.", "passages": [1]}', ECHO_OK]);
  assert.equal((await session.sayToEcho({ kind: 'owner' }, 'What were you like at work?')).ok, true);
  assert.ok(JSON.stringify(asked).includes('even when it cost me')); // the story was given to the echo

  session.removeStory(session.stories()[0]!.id);
  assert.ok(!JSON.stringify(session.memories()).includes('even when it cost me'));
  asked.length = 0;
  interviewer = conversation(['{"reply": "I have nothing on that.", "passages": []}', ECHO_OK]);
  await session.sayToEcho({ kind: 'owner' }, 'And what were you like at home?');
  // The removed story is not among the passages. What the echo itself said earlier is still in the conversation.
  assert.ok(asked.length > 0 && !asked.some((call) => call.request.system.includes('even when it cost me')));

  assert.ok(session.chat({ kind: 'owner' }).messages.length > 1);
  assert.deepEqual(session.deleteConversations(), { ok: true, problems: [] });
  const fresh = session.chat({ kind: 'owner' });
  assert.ok(fresh.messages.every((message) => message.opening === true)); // nothing but the opening line
});

test('deleting everything asks for the passphrase again, removes the archive and its backup, and leaves Echo ready to start afresh', async () => {
  const { session, home, archive } = await withPassages();
  await session.setBackupLocation(drive(home));
  const backup = session.backupStatus().folder!;
  assert.ok(existsSync(backup) && existsSync(archive));

  const wrong = await session.deleteEverything('not the passphrase', true);
  assert.ok(!wrong.ok && wrong.problems[0]!.includes('Nothing has been deleted'));
  assert.ok(existsSync(archive) && session.status().state === 'unlocked');

  assert.deepEqual(await session.deleteEverything(PASSPHRASE, true), { ok: true, backup: 'deleted' });
  assert.ok(!existsSync(archive) && !existsSync(backup));
  assert.equal(session.status().state, 'none');
  assert.deepEqual(session.stories(), []);
  assert.equal((await session.deleteEverything(PASSPHRASE, true)).ok, false); // nothing left to delete
  // A new archive can be made in the same place.
  assert.deepEqual((await session.create(home, PASSPHRASE, PASSPHRASE)).problems, []);
});

test('the backup is kept when asked, and said to be out of reach when its drive is not there', async () => {
  const kept = await withPassages();
  await kept.session.setBackupLocation(drive(kept.home));
  const keptBackup = kept.session.backupStatus().folder!;
  assert.deepEqual(await kept.session.deleteEverything(PASSPHRASE, false), { ok: true, backup: 'kept' });
  assert.ok(existsSync(keptBackup) && !existsSync(kept.archive));

  const away = await withPassages();
  await away.session.setBackupLocation(drive(away.home));
  renameSync(drive(away.home), path.join(away.home, 'unplugged'));
  assert.deepEqual(await away.session.deleteEverything(PASSPHRASE, true), { ok: true, backup: 'unreachable' });

  const none = await withPassages();
  assert.deepEqual(await none.session.deleteEverything(PASSPHRASE, true), { ok: true, backup: 'none' });
});

test("the assistant door: a store with a key of its own, holding only the owner's words marked for everyone, readable while the archive is locked", async () => {
  const { session, home, archive, daughter } = await withPassages();
  session.addStory({ ...STORY, title: 'For her only', audience: { kind: 'person', personId: daughter.id }, text: 'This part is for my daughter alone, about the ring.' }, AUDIO, 'audio/webm', 61);
  writeFileSync(path.join(home, 'chat.txt'), '[13/12/2025, 09:15:02] Ben: Dad, keep this between us\n[13/12/2025, 09:16:40] Ada Lovelace: Not a word, I promise you that\n');
  const previewed = session.previewImport(path.join(home, 'chat.txt'));
  assert.ok(previewed.ok && 'preview' in previewed);
  session.confirmImport(previewed.preview.token, { me: 'Ada Lovelace', label: 'Ben', personId: null, audience: { kind: 'everyone' } });

  // Off by default: nothing on disk, and the screen can say what turning it on would share.
  const off = session.doorStatus();
  assert.deepEqual([off.on, off.passages, existsSync(off.folder)], [false, 0, false]);
  assert.ok(off.wouldShare !== null && off.wouldShare.passages >= 2);
  assert.ok(!off.folder.startsWith(archive)); // beside the settings, not in the archive

  assert.deepEqual(session.turnDoorOn(), { ok: true, problems: [] });
  const on = session.doorStatus();
  assert.deepEqual([on.on, on.passages], [true, off.wouldShare.passages]);
  assert.deepEqual(readdirSync(on.folder).sort(), ['door-key.json', 'store.sealed']);

  const store = readDoorStore(on.folder)!;
  const held = JSON.stringify(store);
  assert.equal(store.owner, 'Ada Lovelace');
  assert.ok(held.includes('even when it cost me')); // a story for everyone
  assert.ok(held.includes('Not a word, I promise you that')); // her own side of a conversation
  assert.ok(!held.includes('about the ring')); // marked for one person
  assert.ok(!held.includes('it is only a job')); // advice is only for the person it was written for
  assert.ok(!held.includes('keep this between us')); // someone else's words
  assert.ok(!held.includes(GOOD_KEY) && !held.includes(PASSPHRASE));
  // The store is encrypted on disk, under a key that is not the archive's.
  const onDisk = everythingOnDisk(on.folder);
  assert.ok(!onDisk.includes('even when it cost me'));
  const doorKey = JSON.parse(readFileSync(path.join(on.folder, 'door-key.json'), 'utf8')).key as string;
  assert.throws(() => readSealedFile(path.join(archive, 'stories.sealed'), Buffer.from(doorKey, 'base64'), 'echo/stories/v1'));

  // What the owner takes out of Echo goes out of the store.
  session.removeStory(session.stories().find((story) => story.title === 'The caravan')!.id);
  session.memories();
  assert.ok(!JSON.stringify(readDoorStore(on.folder)).includes('even when it cost me'));

  // Locked: the assistant can still read its store, and nothing else has changed hands.
  session.lock();
  const locked = session.doorStatus();
  assert.deepEqual([locked.on, locked.wouldShare, locked.passages > 0], [true, null, true]);
  assert.ok(JSON.stringify(readDoorStore(on.folder)).includes('Not a word, I promise you that'));

  // Turning it off deletes the store and the key.
  await session.unlock(PASSPHRASE);
  assert.deepEqual(session.turnDoorOff(), { ok: true, problems: [] });
  assert.deepEqual([session.doorStatus().on, existsSync(on.folder), readDoorStore(on.folder)], [false, false, null]);
});

test("what the assistant did through the door reaches the activity log the next time the archive is open, without any words", async () => {
  const { session } = await withPassages();
  session.turnDoorOn();
  const folder = session.doorStatus().folder;
  session.lock();

  // With Echo locked, the assistant searches twice and reads once.
  assert.equal(runDoorCommand(['search', 'thought', 'cost'], folder).exit, 0);
  assert.equal(runDoorCommand(['search', 'submarine'], folder).exit, 0);
  assert.equal(runDoorCommand(['read'], folder).exit, 0);

  await session.unlock(PASSPHRASE);
  session.memories();
  const used = session.recentActivity().items.filter((item) => item.type === 'door.used');
  assert.deepEqual(used.map((item) => [item.detail.command, item.detail.times]).sort(), [['read', 1], ['search', 2]]);
  assert.ok(!JSON.stringify(used).includes('thought') && !JSON.stringify(used).includes('submarine'));
  assert.equal(session.recentActivity().intact, true);
  // Written down once, not again on the next look.
  session.memories();
  assert.equal(session.recentActivity().items.filter((item) => item.type === 'door.used').length, 2);
});

test("the tray: what the assistant leaves is not part of the echo until the owner approves it, and approving makes it theirs", async () => {
  const { session, home } = await withPassages();
  session.turnDoorOn();
  const folder = session.doorStatus().folder;
  const before = session.memories().memories.length;

  // The assistant leaves a draft and points out a file, with Echo locked.
  session.lock();
  assert.equal(suggestWords(folder, { title: 'The caravan at Skegness', text: 'We went every August. Dad drove the hole way.', note: 'Told to me on Sunday' }).exit, 0);
  writeFileSync(path.join(home, 'chat.txt'), '[13/12/2025, 09:15:02] Ben: Dad, keep this between us\n[13/12/2025, 09:16:40] Ada Lovelace: Not a word, I promise you that\n');
  assert.equal(suggestFile(folder, { path: path.join(home, 'chat.txt'), service: 'whatsapp', note: '' }).exit, 0);
  await session.unlock(PASSPHRASE);

  // Waiting, and not part of anything yet.
  assert.equal(session.doorStatus().waiting, 2);
  const [draft, file] = session.doorTray();
  assert.ok(draft !== undefined && draft.kind === 'words' && file !== undefined && file.kind === 'file');
  assert.equal(session.memories().memories.length, before);
  assert.ok(!JSON.stringify(session.memories()).includes('Skegness'));
  assert.ok(!JSON.stringify(readDoorStore(folder)).includes('Skegness'));

  // It cannot be kept without the owner saying it is theirs.
  const details = { title: draft.title, text: 'We went every August. Dad drove the whole way.', audience: { kind: 'everyone' as const }, mine: false };
  assert.ok(session.approveTrayWords(draft.id, details).problems[0]!.includes('tick the box'));
  assert.deepEqual(session.notes(), []);
  assert.deepEqual(session.approveTrayWords(draft.id, { ...details, mine: true }), { ok: true, problems: [] });

  // Now it is theirs, as they corrected it, and named for where it began. It has left the tray.
  const [note] = session.notes();
  assert.deepEqual([note!.title, note!.text], ['The caravan at Skegness', 'We went every August. Dad drove the whole way.']);
  const passage = session.memories().memories.find((m) => m.source.kind === 'note')!;
  assert.deepEqual([passage.text, passage.source.title], ['We went every August. Dad drove the whole way.', 'The caravan at Skegness (written up by my assistant, read and approved by me)']);
  assert.equal(session.doorTray().length, 1);
  assert.equal(session.approveTrayWords(draft.id, { ...details, mine: true }).ok, false); // not twice
  assert.ok(JSON.stringify(readDoorStore(folder)).includes('Skegness')); // and the assistant can now read it back, as the owner's words

  // The file goes through the ordinary import preview. Nothing is kept by opening it.
  const opened = await session.openTrayFile(file.id, 'whatsapp');
  assert.ok(opened.ok && 'preview' in opened);
  assert.deepEqual(session.imports(), []);
  assert.equal((await session.openTrayFile(draft.id, 'whatsapp')).ok, false);
  assert.deepEqual(session.discardTrayItem(file.id), { ok: true, problems: [] });
  assert.equal(session.discardTrayItem(file.id).ok, false);
  assert.equal(session.doorStatus().waiting, 0);

  const types = session.recentActivity().items.map((item) => item.type);
  for (const expected of ['door.tray.approved', 'door.tray.opened', 'door.tray.discarded']) assert.ok(types.includes(expected), expected);
  assert.ok(!JSON.stringify(session.recentActivity()).includes('Skegness'));

  // Removing the note takes it out of the echo. Without consent nothing can be approved, but things can still be thrown away.
  session.removeNote(note!.id);
  assert.ok(!JSON.stringify(session.memories()).includes('Skegness'));
  suggestWords(folder, { title: 'Another', text: 'More words.', note: '' });
  const another = session.doorTray()[0]!;
  session.withdrawConsent();
  assert.equal(session.approveTrayWords(another.id, { title: 'Another', text: 'More words.', audience: { kind: 'everyone' }, mine: true }).ok, false);
});

test("the assistant asks the echo with Echo locked; the owner can read the conversation, and chooses whether their own key pays", async () => {
  const { session } = await withPassages();
  session.turnDoorOn();
  const folder = session.doorStatus().folder;

  // The owner's AI key is not in the assistant's store unless they say so.
  assert.equal(session.doorStatus().sharesAiKey, false);
  assert.ok(!JSON.stringify(readDoorStore(folder)).includes(GOOD_KEY));
  assert.deepEqual(session.setDoorSharesAiKey(true), { ok: true, problems: [] });
  assert.equal(readDoorStore(folder)!.aiKey, GOOD_KEY);
  assert.ok(!everythingOnDisk(folder).includes(GOOD_KEY)); // sealed, like the rest of the store
  session.setDoorSharesAiKey(false);
  assert.equal(readDoorStore(folder)!.aiKey, undefined);
  session.setDoorSharesAiKey(true);

  session.lock();
  const sent: ClaudeRequest[] = [];
  const answers = ['{"reply": "I always said what I thought.", "passages": [1]}', ECHO_OK];
  const ask = async (key: string, request: ClaudeRequest): Promise<ClaudeAnswer> => {
    assert.equal(key, GOOD_KEY);
    sent.push(request);
    return { ok: true, text: answers.shift() ?? '', model: 'test' };
  };
  const answer = await askTheEcho(folder, 'What were you like at work?', false, { ask, env: {} });
  assert.equal(answer.exit, 0);
  // The echo was given only what is in the assistant's store.
  assert.ok(sent[0]!.system.includes('even when it cost me') && !sent[0]!.system.includes('it is only a job'));

  await session.unlock(PASSPHRASE);
  const [conversation] = session.doorConversations();
  assert.deepEqual(conversation!.messages.map((message) => message.text).slice(1), ['What were you like at work?', 'I always said what I thought.']);
  assert.deepEqual([session.doorStatus().askedToday, session.doorStatus().dailyQuestions], [1, 30]);
  session.memories();
  assert.ok(session.recentActivity().items.some((item) => item.type === 'door.used' && item.detail.command === 'ask'));
  assert.ok(!JSON.stringify(session.recentActivity()).includes('What were you like'));
  // It is kept apart from the family's conversations and from the owner's own.
  assert.ok(session.chat({ kind: 'owner' }).messages.every((message) => message.opening === true));

  // Deleting all conversations deletes the assistant's too, in both places.
  session.deleteConversations();
  assert.deepEqual(session.doorConversations(), []);
  assert.deepEqual(readDoorConversations(folder), []);

  // Without a saved key there is nothing to share.
  session.removeAiKey();
  assert.equal(readDoorStore(session.doorStatus().folder)!.aiKey, undefined);
});

test('the assistant door needs consent, closes when consent is withdrawn, and is wiped when everything is deleted', async () => {
  const { session } = await withPassages();
  session.turnDoorOn();
  const folder = session.doorStatus().folder;
  assert.ok(existsSync(folder));
  session.withdrawConsent();
  assert.deepEqual([session.doorStatus().on, existsSync(folder)], [false, false]);
  assert.equal(session.turnDoorOn().ok, false); // not without consent
  assert.equal(session.doorStatus().wouldShare, null);

  const other = await withPassages();
  other.session.turnDoorOn();
  const otherFolder = other.session.doorStatus().folder;
  assert.ok(existsSync(otherFolder));
  assert.equal((await other.session.deleteEverything('not the passphrase', true)).ok, false);
  assert.ok(existsSync(otherFolder)); // a wrong passphrase deletes nothing
  assert.equal((await other.session.deleteEverything(PASSPHRASE, true)).ok, true);
  assert.ok(!existsSync(otherFolder));
});

/** Makes the door's store unwritable the way a locked or full disk would: a folder sits where the file must go. */
function breakDoorWrites(folder: string): void {
  rmSync(path.join(folder, 'store.sealed'), { force: true });
  mkdirSync(path.join(folder, 'store.sealed'));
}

test('a failed write to the assistant door never stops the archive locking, and the key is wiped', async () => {
  const { session } = await withPassages();
  assert.equal(session.turnDoorOn().ok, true);
  breakDoorWrites(session.doorStatus().folder);
  assert.doesNotThrow(() => session.lock());
  assert.equal((session as unknown as { masterKey: Buffer | null }).masterKey, null);
  assert.equal(session.status().state, 'locked');
});

test('memories and the Settings door status still answer when the assistant door cannot be written', async () => {
  const { session } = await withPassages();
  assert.equal(session.turnDoorOn().ok, true);
  breakDoorWrites(session.doorStatus().folder);
  session.addStory({ ...STORY, title: 'A new one', text: 'Something said after the disk went wrong.' }, AUDIO, 'audio/webm', 61);
  const store = session.memories();
  assert.ok(store.memories.length > 0);
  assert.equal(session.doorStatus().on, true);
});

test('turning the assistant door on gives a plain refusal, not a thrown error, when the disk will not take it', async () => {
  const { session } = await withPassages();
  const folder = session.doorStatus().folder;
  mkdirSync(path.dirname(folder), { recursive: true });
  writeFileSync(folder, 'a file where the door folder must go');
  const result = session.turnDoorOn();
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, ["Echo could not update the assistant's door on this computer."]);
});

const messengerThread = (title: string, other: string, said: string, reply: string) => ({
  participants: [{ name: other }, { name: 'Charles Babbage' }],
  messages: [
    { sender_name: 'Charles Babbage', timestamp_ms: 1_765_617_420_000, content: reply, type: 'Generic' },
    { sender_name: other, timestamp_ms: 1_765_617_300_000, content: said, type: 'Generic' },
  ],
  title,
});

test('a Messenger download with many conversations lists them, and each is previewed and imported like any other', async () => {
  const { session, home, son } = await readyToTalk();
  const zipPath = path.join(home, 'facebook-export.zip');
  writeFileSync(zipPath, makeZip([
    { name: 'your_facebook_activity/messages/inbox/benbabbage_22/message_1.json', contents: Buffer.from(JSON.stringify(messengerThread('Ben Babbage', 'Ben Babbage', 'Dad, keep the news about my new job between us for now', 'I will not say a word to anyone, son'))), deflate: true },
    { name: 'your_facebook_activity/messages/inbox/benbabbage_22/photos/1.jpg', contents: Buffer.alloc(2000, 1) },
    { name: 'your_facebook_activity/messages/inbox/gardenclub_7/message_1.json', contents: Buffer.from(JSON.stringify(messengerThread('Garden Club', 'Vera', 'Who has the key?', 'I have it, see you Sunday at ten'))) },
    { name: 'your_facebook_activity/messages/autofill_information.json', contents: Buffer.from('{}') },
  ]));

  const chosen = session.chooseMessenger(zipPath);
  assert.ok(chosen.ok && 'threads' in chosen);
  assert.deepEqual(chosen.threads.map((thread) => thread.name).sort(), ['benbabbage', 'gardenclub']);
  assert.deepEqual(session.imports(), []);

  const key = chosen.threads.find((thread) => thread.name === 'benbabbage')!.key;
  const opened = session.openImportThread(key);
  assert.ok(opened.ok && 'preview' in opened);
  assert.deepEqual([opened.preview.service, opened.preview.suggestedLabel, opened.preview.messages, opened.preview.suggestedMe], ['messenger', 'Ben Babbage', 2, null]);
  assert.equal(session.openImportThread('no-such-conversation').ok, false);
  const forSon = { kind: 'person' as const, personId: son.id };
  assert.equal(session.confirmImport(opened.preview.token, { me: 'Charles Babbage', label: 'Ben', personId: son.id, audience: forSon }).ok, true);

  const [imported] = session.imports();
  assert.deepEqual([imported!.service, imported!.label, imported!.mine, imported!.others], ['messenger', 'Ben', 1, 1]);
  const passage = session.memories().memories.find((m) => m.source.kind === 'message')!;
  assert.deepEqual([passage.text, passage.source.title, passage.audience], ['I will not say a word to anyone, son', 'Messenger with Ben', forSon]);
  assert.ok(!JSON.stringify(session.memories()).includes('new job')); // the son's words are not in the store

  // The second conversation from the same download: Echo now knows which sender is the owner.
  const second = session.openImportThread(chosen.threads.find((thread) => thread.name === 'gardenclub')!.key);
  assert.ok(second.ok && 'preview' in second);
  assert.equal(second.preview.suggestedMe, 'Charles Babbage');

  // Locking forgets the open download.
  session.lock();
  await session.unlock(PASSPHRASE);
  assert.equal(session.openImportThread(key).ok, false);
});

test('one Messenger conversation file is read on its own, in either layout; other files are refused in plain words', async () => {
  const { session, home } = await readyToTalk();
  const encrypted = path.join(home, 'Vera Smith_12.json');
  writeFileSync(encrypted, JSON.stringify({
    participants: ['Vera Smith', 'Charles Babbage'],
    threadName: 'Vera Smith_12',
    messages: [
      { isUnsent: false, senderName: 'Vera Smith', text: 'Are you coming Sunday?', timestamp: 1_765_617_300_000, type: 'text' },
      { isUnsent: false, senderName: 'Charles Babbage', text: 'Wild horses would not stop me', timestamp: 1_765_617_360_000, type: 'text' },
    ],
  }));
  const chosen = session.chooseMessenger(encrypted);
  assert.ok(chosen.ok && 'preview' in chosen);
  assert.deepEqual([chosen.preview.suggestedLabel, chosen.preview.messages, chosen.preview.senders.length], ['Vera Smith', 2, 2]);
  assert.equal(session.confirmImport(chosen.preview.token, { me: 'Charles Babbage', label: 'Vera', personId: null, audience: { kind: 'everyone' } }).ok, true);
  assert.equal(session.memories().memories.find((m) => m.source.kind === 'message')!.text, 'Wild horses would not stop me');

  writeFileSync(path.join(home, 'profile.json'), JSON.stringify({ profile: { name: 'Charles' } }));
  const notAThread = session.chooseMessenger(path.join(home, 'profile.json'));
  assert.ok(!notAThread.ok && notAThread.problems[0]!.includes('not a Messenger conversation'));
  writeFileSync(path.join(home, 'broken.json'), '{ this is not json');
  assert.equal(session.chooseMessenger(path.join(home, 'broken.json')).ok, false);
  writeFileSync(path.join(home, 'html-export.zip'), makeZip([{ name: 'messages/inbox/ben_1/message_1.html', contents: Buffer.from('<html></html>') }]));
  const html = session.chooseMessenger(path.join(home, 'html-export.zip'));
  assert.ok(!html.ok && html.problems[0]!.includes('JSON'));
});

test('iPhone texts are read from a backup on the computer, and imported like any other conversation', async () => {
  const { session, home, daughter } = await readyToTalk();
  const backups = path.join(home, 'MobileSync', 'Backup');
  assert.deepEqual(session.iphoneBackups(), []); // no backups yet, and no folder either

  const T = 1_765_617_300_000;
  const folder = makeIphoneBackup(backups, '00008030-A', {
    device: "Charles's iPhone",
    contacts: [{ first: 'Ada', last: 'Lovelace', value: '07700 900123' }],
    messages: [
      { chat: '+447700900123', from: '+447700900123', text: 'Dad, keep the news about the house between us for now', at: T },
      { chat: '+447700900123', body: attributedBody('Not a word to anyone, I promise you that'), at: T + 60_000 },
      { chat: '+447700900123', from: '+447700900123', text: '\ufffc', at: T + 90_000 },
      { chat: 'chat99', from: 'vera@example.com', text: 'Who has the key?', at: T + 200_000 },
    ],
  });
  assert.deepEqual(session.iphoneBackups().map((backup) => [backup.folder, backup.device]), [[folder, "Charles's iPhone"]]);

  const chosen = await session.chooseIphoneBackup(folder);
  assert.ok(chosen.ok && 'threads' in chosen);
  assert.equal(chosen.fileName, "Charles's iPhone");
  assert.deepEqual(chosen.threads.map((thread) => [thread.name, thread.messages]), [['Ada Lovelace', 3], ['Group chat (chat99)', 1]]);

  const opened = session.openImportThread('+447700900123');
  assert.ok(opened.ok && 'preview' in opened);
  const preview = opened.preview;
  // The contact has the same name as the owner on the consent, so the owner is marked to keep the two apart.
  assert.deepEqual(preview.senders, [{ name: 'Ada Lovelace', count: 1 }, { name: 'Ada Lovelace (this iPhone)', count: 1 }]);
  assert.deepEqual([preview.service, preview.suggestedLabel, preview.messages, preview.media, preview.suggestedMe], ['iphone', 'Ada Lovelace', 2, 1, 'Ada Lovelace (this iPhone)']);
  const forDaughter = { kind: 'person' as const, personId: daughter.id };
  assert.equal(session.confirmImport(preview.token, { me: 'Ada Lovelace (this iPhone)', label: 'Ada', personId: daughter.id, audience: forDaughter }).ok, true);
  const imported = session.importMessages(session.imports()[0]!.id, 0, 10).messages;
  assert.deepEqual(imported.map((m) => [m.thirdParty, m.text]), [[true, 'Dad, keep the news about the house between us for now'], [false, 'Not a word to anyone, I promise you that']]);
  assert.ok(!JSON.stringify(session.memories()).includes('news about the house'));
  assert.deepEqual(session.imports().map((summary) => [summary.service, summary.label]), [['iphone', 'Ada']]);
  assert.ok(session.memories().memories.some((m) => m.source.title === 'iPhone texts with Ada'));

  // Folders that are not a backup, and a backup with no messages, are refused in plain words.
  assert.ok(!(await session.chooseIphoneBackup(home)).ok);
  const empty = makeIphoneBackup(backups, 'EMPTY', { messages: [] });
  const none = await session.chooseIphoneBackup(empty);
  assert.ok(!none.ok && none.problems[0]!.includes('iCloud'));
  // A backup with no messages file, that does not say it is encrypted, is not asked for a password.
  rmSync(path.join(empty, '3d'), { recursive: true });
  const missing = await session.chooseIphoneBackup(empty);
  assert.ok(!missing.ok && missing.needsPassword !== true && missing.problems[0]!.includes('iCloud'));
});

test('an encrypted iPhone backup asks for its password, and is read without leaving a decrypted copy', async () => {
  const { session, home, daughter } = await readyToTalk();
  const T = 1_765_617_300_000;
  const folder = makeEncryptedIphoneBackup(path.join(home, 'MobileSync', 'Backup'), 'ENCRYPTED', 'backup password', {
    device: "Charles's iPhone",
    contacts: [{ first: 'Ada', last: 'King', value: '07700 900123' }],
    messages: [
      { chat: '+447700900123', from: '+447700900123', text: 'Dad, keep the news about the house between us for now', at: T },
      { chat: '+447700900123', body: attributedBody('Not a word to anyone, I promise you that'), at: T + 60_000 },
    ],
  });
  const copies = () => readdirSync(tmpdir()).filter((name) => name.startsWith('echo-backup-')).length;
  const before = copies();

  const asked = await session.chooseIphoneBackup(folder);
  assert.ok(!asked.ok && asked.needsPassword === true && asked.folder === folder && asked.problems[0]!.includes('encrypted'));
  const wrong = await session.chooseIphoneBackup(folder, 'not the password');
  assert.ok(!wrong.ok && wrong.needsPassword === true && wrong.problems[0]!.includes('not the password'));
  assert.equal(session.openImportThread('+447700900123').ok, false); // nothing was opened

  const chosen = await session.chooseIphoneBackup(folder, 'backup password');
  assert.ok(chosen.ok && 'threads' in chosen);
  assert.deepEqual(chosen.threads.map((thread) => [thread.name, thread.messages]), [['Ada King', 2]]);
  assert.equal(copies(), before);

  const opened = session.openImportThread('+447700900123');
  assert.ok(opened.ok && 'preview' in opened);
  assert.deepEqual(opened.preview.senders.map((sender) => sender.name).sort(), ['Ada King', 'Ada Lovelace']);
  assert.equal(opened.preview.suggestedMe, 'Ada Lovelace');
  assert.equal(copies(), before);
  assert.equal(session.confirmImport(opened.preview.token, { me: 'Ada Lovelace', label: 'Ada', personId: daughter.id, audience: { kind: 'person', personId: daughter.id } }).ok, true);
  assert.ok(session.memories().memories.some((m) => m.text === 'Not a word to anyone, I promise you that'));
  assert.ok(!JSON.stringify(session.memories()).includes('news about the house'));

  // The password is nowhere in the archive, and locking forgets the unlocked backup.
  assert.ok(!everythingOnDisk(path.join(home, ARCHIVE_FOLDER_NAME)).includes('backup password'));
  session.lock();
  await session.unlock(PASSPHRASE);
  assert.equal(session.openImportThread('+447700900123').ok, false);
});

test('memory times are saved through the session, put-away questions are remembered and can be brought back', async () => {
  const { session, archive } = await openSession();
  assert.equal(session.setMemoryTimes({ days: [1], time: 'noon', minutes: 15 }).ok, false);
  assert.equal(session.setMemoryTimes({ days: [6], time: '10:00', minutes: 15 }).ok, true);

  // Saturday 21 November 2026 is missed: the nudge is owed on the Sunday.
  const sunday = new Date(2026, 10, 22, 11);
  assert.equal(session.memoryTimes(sunday).missed, new Date(2026, 10, 21, 10).toISOString());
  assert.equal(session.memoryTimes(sunday).next, new Date(2026, 10, 28, 10).toISOString());

  // "I don't remember" on the Saturday counts as having come.
  assert.equal(session.retirePrompt('   ').ok, false);
  assert.equal(session.retirePrompt('Who was your first crush?', new Date(2026, 10, 21, 10, 5)).ok, true);
  assert.deepEqual(session.memoryTimes(sunday).retired, ['Who was your first crush?']);
  assert.equal(session.memoryTimes(sunday).missed, null);

  const trail = JSON.stringify(session.recentActivity());
  assert.ok(trail.includes('prompt.retired') && trail.includes('memory-times.changed'));
  assert.ok(!trail.includes('crush'), 'the question itself stays out of the audit trail');
  assert.ok(!everythingOnDisk(archive).includes('crush'));

  session.restorePrompt('Who was your first crush?');
  assert.deepEqual(session.memoryTimes(sunday).retired, []);
});

async function openInboxSession(): Promise<{ session: ArchiveSession; archive: string; home: string }> {
  const home = mkdtempSync(path.join(tmpdir(), 'echo-phone-'));
  const session = new ArchiveSession(path.join(home, 'settings', 'config.json'), { checkKey, kdf: FAST, minConsentSeconds: 10, inbox: { host: '127.0.0.1', port: 0, lanAddress: () => '127.0.0.1' } });
  assert.deepEqual((await session.create(home, PASSPHRASE, PASSPHRASE)).problems, []);
  return { session, home, archive: path.join(home, ARCHIVE_FOLDER_NAME) };
}

const post = async (port: number, route: string, body: Uint8Array | string) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', body });
  return { status: response.status, body: (await response.json()) as Record<string, string> };
};

test('a phone pairs by its code, sends a recording that becomes a story, and is believed only on a real receipt', async () => {
  const { session, archive } = await openInboxSession();
  assert.equal(session.phoneInboxPort, null, 'nothing listens until there is a phone to listen for');

  const started = await session.startPhonePairing();
  assert.ok(started.ok);
  const port = session.phoneInboxPort!;
  const code = readPairingCode(started.offer.code)!;
  assert.equal(code.port, port);
  assert.match(started.offer.qr, /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(started.offer.qr.split(',')[1]!, 'base64').toString('utf8'), /<svg[^>]*>.*<path/s, 'the QR code is drawn ready to show');

  const phone = makeLinkKeys();
  assert.equal((await post(port, '/pair', JSON.stringify(sealPairRequest(phone, { ...code, token: makePairingToken() }, 'Wrong')))).status, 403);
  const paired = await post(port, '/pair', JSON.stringify(sealPairRequest(phone, code, "Dad's phone")));
  assert.equal(paired.status, 200);
  assert.ok(receiptChecks(phone, code.pc, `paired:${paired.body.paired}`, paired.body.receipt!));
  assert.equal((await post(port, '/pair', JSON.stringify(sealPairRequest(makeLinkKeys(), code, 'Again')))).status, 410, 'a code works once');
  assert.deepEqual(session.phones().map((p) => p.name), ["Dad's phone"]);

  const header = { id: 'rec-0001-abcdef', recordedAt: '2026-11-14T10:00:00.000Z', prompt: 'Who taught you to ride a bike?', seconds: 42, mimeType: 'audio/webm' };
  const sound = new Uint8Array(Buffer.from('a recognisable bike story'));
  assert.equal((await post(port, '/recordings', sealRecording(phone, code.pc, header, sound))).status, 422, 'no consent, so the phone keeps it');
  assert.equal(session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25).ok, true);

  const sent = await post(port, '/recordings', sealRecording(phone, code.pc, header, sound));
  assert.equal(sent.status, 200);
  assert.ok(receiptChecks(phone, code.pc, header.id, sent.body.receipt!));
  const again = await post(port, '/recordings', sealRecording(phone, code.pc, header, sound));
  assert.equal(again.status, 200, 'a resend gets its receipt');
  const stories = session.stories();
  assert.equal(stories.length, 1, 'and is saved once');
  assert.equal(stories[0]!.prompt, header.prompt);
  assert.equal(stories[0]!.recordedAt, header.recordedAt);
  assert.deepEqual(new Uint8Array(session.storyAudio(stories[0]!.id)!.bytes), sound);
  assert.ok(!everythingOnDisk(archive).includes('recognisable'));

  const stranger = makeLinkKeys();
  assert.equal((await post(port, '/recordings', sealRecording(stranger, code.pc, { ...header, id: 'rec-0002-abcdef' }, sound))).status, 403);

  session.lock();
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(session.phoneInboxPort, null, 'locking stops the inbox');
  await assert.rejects(fetch(`http://127.0.0.1:${port}/hello`));

  assert.equal((await session.unlock(PASSPHRASE)).ok, true);
  await new Promise((done) => setTimeout(done, 50));
  assert.notEqual(session.phoneInboxPort, null, 'opening the archive listens again for the paired phone');
  await session.unpairPhone(session.phones()[0]!.id);
  assert.equal(session.phoneInboxPort, null, 'with no phone left, nothing listens');
  session.lock();
});

test('a phone can send a story with pictures, or a video; sizes that do not add up are refused whole', async () => {
  const { session, archive } = await openInboxSession();
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  const started = await session.startPhonePairing();
  assert.ok(started.ok);
  const port = session.phoneInboxPort!;
  const code = readPairingCode(started.offer.code)!;
  const phone = makeLinkKeys();
  assert.equal((await post(port, '/pair', JSON.stringify(sealPairRequest(phone, code, 'Phone')))).status, 200);

  const sound = Buffer.from('a recognisable story about the old house');
  const front = Buffer.from([0xff, 0xd8, ...Buffer.from('recognisable front door')]);
  const garden = Buffer.from([0x89, 0x50, ...Buffer.from('recognisable garden')]);
  const header = {
    id: 'rec-pictures-0001',
    recordedAt: '2026-11-15T10:00:00.000Z',
    prompt: '',
    seconds: 30,
    mimeType: 'audio/mp4',
    pictures: [
      { mimeType: 'image/jpeg', bytes: front.length },
      { mimeType: 'image/png', bytes: garden.length },
    ],
  };
  const sent = await post(port, '/recordings', sealRecording(phone, code.pc, header, Buffer.concat([sound, front, garden])));
  assert.equal(sent.status, 200);
  const story = session.stories()[0]!;
  assert.equal(story.pictures, 2);
  assert.deepEqual(Buffer.from(session.storyAudio(story.id)!.bytes), sound, 'the sound is cut off exactly where the pictures start');
  assert.deepEqual(Buffer.from(session.storyPicture(story.id, 0)!.bytes), front);
  assert.equal(session.storyPicture(story.id, 1)!.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(session.storyPicture(story.id, 1)!.bytes), garden);
  assert.equal(session.storyPicture(story.id, 2), null);
  assert.ok(!everythingOnDisk(archive).includes('recognisable'));

  const video = Buffer.from('a recognisable video of the garden');
  const filmed = await post(port, '/recordings', sealRecording(phone, code.pc, { ...header, id: 'rec-video-0001', mimeType: 'video/mp4', pictures: undefined }, video));
  assert.equal(filmed.status, 200);
  const videoStory = session.stories().find((candidate) => candidate.pictures === 0)!;
  assert.equal(session.storyAudio(videoStory.id)!.mimeType, 'video/mp4');

  const tooBig = { ...header, id: 'rec-broken-0001', pictures: [{ mimeType: 'image/jpeg', bytes: 10_000 }] };
  assert.equal((await post(port, '/recordings', sealRecording(phone, code.pc, tooBig, Buffer.concat([sound, front])))).status, 400);
  const nothingLeft = { ...header, id: 'rec-broken-0002', pictures: [{ mimeType: 'image/jpeg', bytes: front.length }] };
  assert.equal((await post(port, '/recordings', sealRecording(phone, code.pc, nothingLeft, front))).status, 400, 'pictures with no recording are not a story');
  const heic = { ...header, id: 'rec-heic-0001', pictures: [{ mimeType: 'image/heic', bytes: front.length }] };
  assert.equal((await post(port, '/recordings', sealRecording(phone, code.pc, heic, Buffer.concat([sound, front])))).status, 422, 'a picture Echo cannot show is refused');
  assert.equal(session.stories().length, 2);

  const before = readdirSync(path.join(archive, 'media')).length;
  session.removeStory(story.id);
  assert.equal(readdirSync(path.join(archive, 'media')).length, before - 3, 'removing a story removes its pictures too');
  session.lock();
});

test('a story recorded on the PC refuses pictures it could not show, or too many of them', async () => {
  const { session } = await openSession();
  session.giveConsent('Ada Lovelace', VIDEO, 'video/webm', 25);
  const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' };
  assert.equal(session.addStory(STORY, AUDIO, 'audio/webm', 30, undefined, [{ ...jpeg, mimeType: 'image/heic' }]).ok, false);
  assert.equal(session.addStory(STORY, AUDIO, 'audio/webm', 30, undefined, [{ ...jpeg, bytes: new Uint8Array(0) }]).ok, false);
  assert.equal(session.addStory(STORY, AUDIO, 'audio/webm', 30, undefined, Array.from({ length: 13 }, () => jpeg)).ok, false);
  assert.deepEqual(session.stories(), []);
  assert.equal(session.addStory(STORY, AUDIO, 'audio/webm', 30, undefined, [jpeg]).ok, true);
  assert.equal(session.stories()[0]!.pictures, 1);
});
