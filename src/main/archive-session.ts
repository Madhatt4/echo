// Everything the app does with the archive goes through here. The master key
// lives in this file's memory while the archive is unlocked and nowhere else:
// it is never sent to the screen and never written to disk.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ActionResult,
  ActivityReport,
  AiKeyStatus,
  ArchiveStatus,
  BackupStatus,
  ConsentStatus,
  ConsentVideo,
  Recording,
  RecoveryKit,
} from '../shared/api.ts';
import { FACE_VIDEO_SECONDS, SELFIE_POSES, VOICE_PASSAGES } from '../shared/capture-guides.ts';
import type { Capture, CaptureGroup } from '../shared/capture-guides.ts';
import { adviceAudience, adviceProblems } from '../shared/advice.ts';
import { MAX_BLIND_ANSWER_LENGTH, blindResult, blindStage, newBlindTest, newJudgeRun, nextPair, recordVerdict, verdictProblems } from '../shared/blind-test.ts';
import type { BlindPair, BlindTest, BlindTestView, PairVerdict } from '../shared/blind-test.ts';
import { MAX_MESSAGE_LENGTH, toldBefore } from '../shared/chat.ts';
import { SERVICE_NAMES, importChoiceProblems, messageSources, repeatsThirdParty, thirdPartyRuns } from '../shared/imports.ts';
import type { ImportChoice, ImportChosen, ImportService, ImportSummary, ImportedMessage, ThreadChoice } from '../shared/imports.ts';
import type { IphoneBackup } from '../shared/iphone.ts';
import { findThreads, mergeMessengerFiles, readMessengerFile } from '../shared/messenger.ts';
import type { MessengerThread } from '../shared/messenger.ts';
import { chatNameFromFile, parseWhatsApp } from '../shared/whatsapp.ts';
import type { ParsedChat } from '../shared/whatsapp.ts';
import type { ChatMessage, ChatSession, ChatView } from '../shared/chat.ts';
import { choosePassages, listenerKey, openingLine, permittedLines, permittedPassages } from '../shared/persona.ts';
import type { Listener } from '../shared/persona.ts';
import type { Advice, AdviceDetails } from '../shared/advice.ts';
import { consentWording, nameProblems } from '../shared/consent.ts';
import {
  INTERVIEW_TOPICS,
  MAX_ANSWER_LENGTH,
  MAX_EXCHANGES_PER_TOPIC,
  interviewMessages,
  interviewerInstructions,
  readInterviewerReply,
} from '../shared/interview.ts';
import type { InterviewState, InterviewTopic } from '../shared/interview.ts';
import { applyMemoryChange, memoryChangeProblems, memoryWords, syncMemories } from '../shared/memories.ts';
import type { Memory, MemoryChange, MemorySource, MemoryStore } from '../shared/memories.ts';
import {
  MAX_REJECTED_REMEMBERED,
  PEOPLE_SECTION,
  SHEET_SECTIONS,
  draftInstructions,
  draftMessage,
  lineProblems,
  measureStyle,
  mergeDraft,
  passagesForEveryone,
  passagesForPerson,
  readDraft,
  sheetTitle,
  viewLines,
  withinBudget,
} from '../shared/sheets.ts';
import type { SheetKind, SheetLine, SheetLineChange, SheetView } from '../shared/sheets.ts';
import { EVERYONE, audienceLabel, personProblems } from '../shared/people.ts';
import type { Audience, Person, PersonDetails } from '../shared/people.ts';
import { MAX_STORY_MINUTES, pictureProblems, storyProblems } from '../shared/stories.ts';
import type { Story, StoryDetails, StoryPicture } from '../shared/stories.ts';
import { NO_MEMORY_TIMES, missedMemoryTime, nextMemoryTime, scheduleProblems } from '../shared/memory-times.ts';
import type { MemorySchedule, MemoryTimesView } from '../shared/memory-times.ts';
import { passphraseProblems } from '../shared/passphrase.ts';
import { normaliseGroup, recoveryGroups } from '../shared/recovery-code.ts';
import { addAdvice, changeAdvice, loadAdvice, removeAdvice } from '../core/advice.ts';
import { addLetter, changeLetter, loadLetters, removeLetter } from '../core/letters.ts';
import { closeDoor, doorFolder, doorTurnedOnAt, openDoor, readDoorStore, readTray, removeTrayItem, takeDoorUses, writeDoorStore } from '../core/door.ts';
import { addNote, loadNotes, removeNote } from '../core/notes.ts';
import { askedOn, clearDoorConversations, readDoorConversations } from '../core/door-ask.ts';
import { noteProblems, noteSourceTitle } from '../shared/notes.ts';
import type { Note, NoteDetails } from '../shared/notes.ts';
import { DOOR_DAILY_QUESTIONS, doorLines, doorPassages, summariseDoorUses } from '../shared/door.ts';
import type { DoorStatus, DoorStore, TrayItem, TrayService } from '../shared/door.ts';
import { exportFolderName, exportReadme, extensionFor, namer, numbered, safeName, textFile } from '../core/export.ts';
import { MAX_LETTER_PAGES, MAX_PAGE_BYTES, PAGE_TYPES, READ_PAGE_INSTRUCTIONS, READ_PAGE_MESSAGE, letterProblems, letterSourceTitle, readPageAnswer } from '../shared/letters.ts';
import type { Letter, LetterDetails } from '../shared/letters.ts';
import { askClaude, checkAnthropicKey } from '../core/anthropic.ts';
import type { ClaudeAnswer, ClaudeRequest, KeyCheck } from '../core/anthropic.ts';
import { appendAudit, readAudit } from '../core/audit.ts';
import type { AuditDetail } from '../core/audit.ts';
import { backupArchive, backupDirIn, backupLocationProblems, checkBackup, restoreArchive } from '../core/backup.ts';
import { addCapture, loadCaptures, removeCapture } from '../core/captures.ts';
import { loadBlindTests, saveBlindTests } from '../core/blind-test.ts';
import { loadChats, saveChats } from '../core/chats.ts';
import { addImport, loadImportedMessages, loadImports, removeImport } from '../core/imports.ts';
import { SMS_FILE, backupFilePath, findBackups, isReadableDatabase, listIphoneThreads, loadContacts, loadContactsFrom, readIphoneThread } from '../core/iphone.ts';
import { removeLeftoverCopies, saysItIsEncrypted, unlockBackup, withDecrypted } from '../core/iphone-encrypted.ts';
import { mailEntry, readSentEmails, scanMailbox, senderAddresses, sentByRecipient } from '../core/email.ts';
import type { MailEntry } from '../core/email.ts';
import { discordFileKind, discordLabel, findDiscordChannels, nameDiscordChannels, readDiscordMessages } from '../shared/discord.ts';
import type { LockedFile } from '../core/iphone-encrypted.ts';
import { namesInZip, readFromZip, readManyFromZip } from '../core/zip.ts';
import { loadConfig, saveConfig } from '../core/config.ts';
import { composeReply } from '../core/persona.ts';
import { loadInterview, saveInterview } from '../core/interview.ts';
import type { StoredExchange, StoredTopic } from '../core/interview.ts';
import { consentState, loadConsent, saveConsent } from '../core/consent.ts';
import { readMedia, removeMedia, writeMedia } from '../core/media.ts';
import { loadMemories, saveMemories } from '../core/memories.ts';
import { addPerson, changePerson, loadPeople, removePerson } from '../core/people.ts';
import { loadSettings, saveSettings } from '../core/settings.ts';
import { loadSheet, saveSheet } from '../core/sheets.ts';
import { addStory, changeStory, loadStories, removeStory, storyView } from '../core/stories.ts';
import { loadMemoryTimes, restorePrompt, retirePrompt, saveSchedule } from '../core/memory-times.ts';
import type { RecordingHeader } from '../core/phone-link.ts';
import { PhoneInbox } from './phone-inbox.ts';
import type { PhoneInboxOptions } from './phone-inbox.ts';
import type { PairingOffer, PhoneSummary } from '../shared/api.ts';
import type { KdfSettings } from '../core/vault.ts';
import {
  DEFAULT_KDF,
  VAULT_FILENAME,
  VaultExistsError,
  WrongPassphraseError,
  WrongRecoveryCodeError,
  clearFailedAttempts,
  createVault,
  failedAttempts,
  generateRecoveryCode,
  hasRecoveryKit,
  readVault,
  recordFailedAttempt,
  setPassphrase,
  setRecoveryCode,
  unlockVault,
  unlockVaultWithRecoveryCode,
} from '../core/vault.ts';

export const ARCHIVE_FOLDER_NAME = 'Echo Archive';
/** The most text Echo will read from one export, unpacked. */
/** The name the assistant's conversations with the echo are kept under, beside each person's. */
const ASSISTANT_KEY = 'assistant';

const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
const ACTIVITY_SHOWN = 8;

const OK: ActionResult = { ok: true, problems: [] };
const refuse = (...problems: string[]): ActionResult => ({ ok: false, problems });
const DOOR_FAILED = "Echo could not update the assistant's door on this computer.";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface SessionOptions {
  /** Where the phone inbox listens. Tests use port 0 on 127.0.0.1. */
  inbox?: PhoneInboxOptions;
  /** Stands in for the live check with Anthropic. Used by tests. */
  checkKey?: (key: string) => Promise<KeyCheck>;
  /** A lighter work factor. Used by tests so they run fast. */
  kdf?: KdfSettings;
  /** Shortest consent recording accepted, in seconds. Tests shorten it. */
  minConsentSeconds?: number;
  /** Lets the backup sit on the same drive as the archive. Tests only. */
  allowBackupOnSameDrive?: boolean;
  /** Shortest guided face video accepted, in seconds. Tests shorten it. */
  minFaceVideoSeconds?: number;
  /** Stands in for Claude. Used by tests. */
  ask?: (key: string, request: ClaudeRequest) => Promise<ClaudeAnswer>;
  /** Stands in for chance when shuffling the blind test. Used by tests. */
  random?: () => number;
  /** Where to look for iPhone backups, in place of the folders Apple's apps use. Used by tests. */
  backupRoots?: string[];
}

/** Reading the statement aloud takes about twenty seconds. Less than this is not a reading. */
const MIN_CONSENT_SECONDS = 10;
const MAX_CONSENT_BYTES = 300 * 1024 * 1024;
const MAX_STORY_BYTES = 300 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 400 * 1024 * 1024;
const NO_CONSENT = 'Echo cannot capture anything until your consent is recorded. Open the Consent tile first.';

export class ArchiveSession {
  private readonly configFile: string;
  /** True while the assistant's store is being rewritten, so that doing so cannot set itself off again. */
  private refreshingDoor = false;
  private readonly checkKey: (key: string) => Promise<KeyCheck>;
  private readonly kdf: KdfSettings;
  private readonly minConsentSeconds: number;
  private readonly allowBackupOnSameDrive: boolean;
  private readonly minFaceVideoSeconds: number;
  private readonly ask: (key: string, request: ClaudeRequest) => Promise<ClaudeAnswer>;
  private readonly random: () => number;
  private readonly backupRoots: string[];
  /** Chats that have been read and shown to the person but not yet saved. Forgotten when the archive locks. */
  private readonly pendingImports = new Map<string, { service: ImportService; parsed: ParsedChat; fileName: string; fileHash: string }>();
  /** A download holding many conversations, kept open while the person picks from it. Forgotten when the archive locks. */
  private pendingDownload:
    | { kind: 'messenger' | 'discord'; filePath: string; fileName: string; filesOf: Map<string, string[]>; threads: ThreadChoice[] }
    | { kind: 'email'; filePath: string; fileName: string; entries: MailEntry[]; groups: Map<string, { name: string; emails: MailEntry[] }>; threads: ThreadChoice[] }
    | { kind: 'iphone'; messages: { smsPath: string } | { locked: LockedFile }; fileName: string; contacts: Map<string, string>; threads: ThreadChoice[] }
    | null = null;
  /** The memory store as last built, kept while nothing it is built from has changed on disk. */
  private memoryCache: { fingerprint: string; store: MemoryStore } | null = null;
  /** Every run of words in other people's messages, for checking replies against. */
  private thirdPartyCache: { fingerprint: string; runs: Set<string> } | null = null;
  /** The Claude model that last worked for this key, so it is not looked up every time. */
  private model: string | undefined;
  private masterKey: Buffer | null = null;
  private readonly phoneInbox: PhoneInbox;
  /** True after opening with the recovery kit, until a new passphrase is set. */
  private needsNewPassphrase = false;
  /** A recovery code that has been shown but not yet proven. Memory only. */
  private pendingKit: { code: string; challenge: [number, number] } | null = null;

  constructor(configFile: string, options: SessionOptions = {}) {
    this.configFile = configFile;
    this.checkKey = options.checkKey ?? ((key) => checkAnthropicKey(key));
    this.kdf = options.kdf ?? DEFAULT_KDF;
    this.minConsentSeconds = options.minConsentSeconds ?? MIN_CONSENT_SECONDS;
    this.allowBackupOnSameDrive = options.allowBackupOnSameDrive ?? false;
    this.minFaceVideoSeconds = options.minFaceVideoSeconds ?? FACE_VIDEO_SECONDS;
    this.random = options.random ?? Math.random;
    this.phoneInbox = new PhoneInbox({
      ...options.inbox,
      archive: () => (this.archivePath && this.masterKey ? { dir: this.archivePath, key: this.masterKey } : null),
      fileStory: (header, recording, pictures) => this.fileStoryFromPhone(header, recording, pictures),
      record: (type, detail) => this.record(type, detail),
      now: () => new Date(),
    });
    // If Echo was stopped while reading an encrypted backup, a decrypted copy may have been left. Clear it now.
    removeLeftoverCopies();
    // iTunes from Apple's site keeps backups under AppData. Apple Devices and iTunes from the Microsoft Store keep them under the user's folder.
    this.backupRoots = options.backupRoots ?? [
      path.join(process.env.APPDATA ?? '', 'Apple Computer', 'MobileSync', 'Backup'),
      path.join(process.env.USERPROFILE ?? '', 'Apple', 'MobileSync', 'Backup'),
    ];
    this.ask =
      options.ask ??
      (async (key, request) => {
        const answer = await askClaude(key, request, this.model);
        if (answer.ok) this.model = answer.model;
        return answer;
      });
  }

  private get archivePath(): string | null {
    return loadConfig(this.configFile).archivePath ?? null;
  }

  status(): ArchiveStatus {
    const archivePath = this.archivePath;
    const base = { recoveryKit: false, needsNewPassphrase: false };
    if (!archivePath) return { state: 'none', archivePath: null, ...base };
    let found = false;
    try {
      found = readVault(archivePath) !== null;
    } catch {
      found = existsSync(archivePath);
    }
    if (!found) return { state: 'missing', archivePath, ...base };
    let recoveryKit = false;
    try {
      recoveryKit = hasRecoveryKit(archivePath);
    } catch {
      recoveryKit = false;
    }
    return {
      state: this.masterKey ? 'unlocked' : 'locked',
      archivePath,
      recoveryKit,
      needsNewPassphrase: this.masterKey !== null && this.needsNewPassphrase,
    };
  }

  private record(type: string, detail: AuditDetail = {}): void {
    const archivePath = this.archivePath;
    if (archivePath && this.masterKey) appendAudit(archivePath, this.masterKey, type, detail);
    // Anything worth recording may have changed what the echo can draw on, so nothing cached is trusted past it.
    this.memoryCache = null;
    this.thirdPartyCache = null;
  }

  /** Creates a new archive in `<location>\Echo Archive` and leaves it unlocked. */
  async create(location: string, passphrase: string, confirmation: string): Promise<ActionResult> {
    if (this.masterKey) return refuse('An archive is already open. Lock it first.');
    const problems = passphraseProblems(passphrase, confirmation);
    if (problems.length > 0) return refuse(...problems);
    if (!location || !path.isAbsolute(location)) return refuse('Choose a folder to keep your archive in.');
    if (!existsSync(location)) return refuse(`The folder ${location} does not exist. Choose another.`);

    const archivePath = path.join(location, ARCHIVE_FOLDER_NAME);
    try {
      this.masterKey = await createVault(archivePath, passphrase, this.kdf);
    } catch (error) {
      if (error instanceof VaultExistsError) {
        return refuse(`There is already an archive at ${archivePath}. Use "I already have an archive" to open it, or choose a different folder.`);
      }
      return refuse(`Echo could not create the archive at ${archivePath}. Check you are allowed to save files there.`);
    }
    saveConfig(this.configFile, { archivePath });
    clearFailedAttempts(archivePath);
    this.record('archive.created');
    return OK;
  }

  /** Points Echo at an archive folder that already exists. It stays locked. */
  useExisting(folder: string): ActionResult {
    if (this.masterKey) return refuse('An archive is already open. Lock it first.');
    const candidates = [folder, path.join(folder, ARCHIVE_FOLDER_NAME)];
    for (const candidate of candidates) {
      try {
        if (readVault(candidate)) {
          saveConfig(this.configFile, { archivePath: candidate });
          return OK;
        }
      } catch (error) {
        return refuse(error instanceof Error ? error.message : 'That archive could not be read.');
      }
    }
    return refuse(`There is no Echo archive in ${folder}. Look for the folder named "${ARCHIVE_FOLDER_NAME}".`);
  }

  async unlock(passphrase: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath) return refuse('No archive has been set up yet.');
    if (this.masterKey) return OK;

    // Each wrong guess makes the next answer slower, up to eight seconds.
    const failedBefore = failedAttempts(archivePath);
    if (failedBefore > 0) await pause(Math.min(250 * 2 ** (failedBefore - 1), 8000));

    try {
      this.masterKey = await unlockVault(archivePath, passphrase);
    } catch (error) {
      if (error instanceof WrongPassphraseError) {
        recordFailedAttempt(archivePath);
        return refuse('That passphrase is not right. Check for capital letters and try again.');
      }
      return refuse(`Echo could not open the archive at ${archivePath}.`);
    }
    clearFailedAttempts(archivePath);
    this.record('archive.unlocked', { method: 'passphrase', failedAttemptsBefore: failedBefore });
    await this.backUpQuietly();
    this.listenForPhones();
    return OK;
  }

  /** Opens the archive with the code from the printed recovery kit. */
  async unlockWithRecoveryCode(code: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath) return refuse('No archive has been set up yet.');
    if (this.masterKey) return OK;

    const failedBefore = failedAttempts(archivePath);
    if (failedBefore > 0) await pause(Math.min(250 * 2 ** (failedBefore - 1), 8000));

    try {
      this.masterKey = await unlockVaultWithRecoveryCode(archivePath, code);
    } catch (error) {
      if (error instanceof WrongRecoveryCodeError) {
        recordFailedAttempt(archivePath);
        return refuse('That recovery code is not right. Check each group against the printed kit and try again.');
      }
      return refuse(`Echo could not open the archive at ${archivePath}.`);
    }
    clearFailedAttempts(archivePath);
    this.needsNewPassphrase = true;
    this.record('archive.unlocked', { method: 'recovery kit', failedAttemptsBefore: failedBefore });
    await this.backUpQuietly();
    this.listenForPhones();
    return OK;
  }

  /** After opening with the recovery kit: replaces the forgotten passphrase. */
  async setNewPassphrase(passphrase: string, confirmation: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.needsNewPassphrase) return refuse('A new passphrase can only be set here after opening with the recovery kit.');
    const problems = passphraseProblems(passphrase, confirmation);
    if (problems.length > 0) return refuse(...problems);
    await setPassphrase(archivePath, this.masterKey, passphrase, this.kdf);
    this.needsNewPassphrase = false;
    this.record('passphrase.changed', { after: 'recovery kit' });
    return OK;
  }

  /** Changes the passphrase on request. The current one must be given. */
  async changePassphrase(current: string, next: string, confirmation: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    try {
      (await unlockVault(archivePath, current)).fill(0);
    } catch {
      return refuse('The current passphrase is not right.');
    }
    const problems = passphraseProblems(next, confirmation);
    if (problems.length > 0) return refuse(...problems);
    if (next === current) return refuse('The new passphrase is the same as the current one.');
    await setPassphrase(archivePath, this.masterKey, next, this.kdf);
    this.record('passphrase.changed', { after: 'asked' });
    return OK;
  }

  aiKeyStatus(): AiKeyStatus {
    const archivePath = this.archivePath;
    const none: AiKeyStatus = { saved: false, ending: null, testedAt: null };
    if (!archivePath || !this.masterKey) return none;
    const saved = loadSettings(archivePath, this.masterKey).aiKey;
    return saved ? { saved: true, ending: saved.key.slice(-4), testedAt: saved.testedAt } : none;
  }

  /** The saved AI key, for the parts of Echo that talk to Anthropic. Never sent to the screen. */
  aiKey(): string | null {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return null;
    return loadSettings(archivePath, this.masterKey).aiKey?.key ?? null;
  }

  /** Asks Anthropic whether the key is valid. Saves it, encrypted, only if it is. */
  async testAndSaveAiKey(rawKey: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const key = rawKey.trim();
    const check = await this.checkKey(key);
    if (!check.ok) return refuse(check.problem);
    const settings = loadSettings(archivePath, this.masterKey);
    const replacing = settings.aiKey !== undefined;
    saveSettings(archivePath, this.masterKey, {
      ...settings,
      aiKey: { provider: 'anthropic', key, testedAt: new Date().toISOString() },
    });
    this.record('ai-key.saved', { provider: 'anthropic', replacedEarlierKey: replacing });
    // A shared copy in the assistant's store follows the new key at once.
    this.refreshDoor();
    return OK;
  }

  removeAiKey(): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    const { aiKey, ...rest } = loadSettings(archivePath, this.masterKey);
    if (!aiKey) return;
    saveSettings(archivePath, this.masterKey, rest);
    this.record('ai-key.removed', { provider: 'anthropic' });
    // If a copy of the key was in the assistant's store, it comes out now, not at the next change.
    this.refreshDoor();
  }

  people(): Person[] {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return [];
    return loadPeople(archivePath, this.masterKey);
  }

  addPerson(details: PersonDetails): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const problems = personProblems(details, this.people());
    if (problems.length > 0) return refuse(...problems);
    addPerson(archivePath, this.masterKey, details);
    this.record('person.added', { mayTalkToEcho: details.mayTalkToEcho === true });
    return OK;
  }

  changePerson(id: string, details: PersonDetails): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const problems = personProblems(details, this.people().filter((person) => person.id !== id));
    if (problems.length > 0) return refuse(...problems);
    if (!changePerson(archivePath, this.masterKey, id, details)) return refuse('That person is no longer in your list.');
    this.record('person.changed', { mayTalkToEcho: details.mayTalkToEcho === true });
    return OK;
  }

  /** Removes someone. Anything marked for them alone is then heard by nobody. */
  removePerson(id: string): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    if (removePerson(archivePath, this.masterKey, id)) this.record('person.removed');
  }

  private topicOrNew(stored: Record<string, StoredTopic>, topic: InterviewTopic): StoredTopic {
    return stored[topic.id] ?? { pending: topic.opening, done: false, exchanges: [] };
  }

  /** Where the interview has got to, topic by topic. */
  interview(): InterviewState {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return { topics: [], keyReady: false };
    const stored = loadInterview(archivePath, this.masterKey);
    return {
      keyReady: this.aiKey() !== null,
      topics: INTERVIEW_TOPICS.map((topic) => {
        const progress = this.topicOrNew(stored, topic);
        return {
          id: topic.id,
          title: topic.title,
          pending: progress.pending,
          done: progress.done,
          exchanges: progress.exchanges.map((exchange) => ({
            question: exchange.question,
            answer: exchange.answer,
            answeredAt: exchange.answeredAt,
            spoken: exchange.mediaId !== undefined,
            audience: exchange.audience ?? EVERYONE,
          })),
        };
      }),
    };
  }

  /**
   * Asks the interviewer for the next question in a topic and saves it as the
   * one waiting. If the interviewer says the topic is covered, it is marked done.
   */
  private async nextQuestion(topic: InterviewTopic, skipped: string | null): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const key = this.aiKey();
    if (!key) return refuse('The interviewer needs your AI key. Open Setup and add it, then come back.');

    const before = this.topicOrNew(loadInterview(archivePath, this.masterKey), topic);
    const answer = await this.ask(key, {
      system: interviewerInstructions(topic, this.consentStatus().fullName, this.people()),
      messages: interviewMessages(before.exchanges, skipped),
      maxTokens: 400,
    });
    if (!this.masterKey) return refuse('Your archive was locked while the interviewer was thinking. Unlock it and press Try again.');
    if (!answer.ok) return refuse(answer.problem);
    const reply = readInterviewerReply(answer.text);
    if (!reply) return refuse('The interviewer did not come back with a question. Press Try again.');

    // Read again before writing: the person may have done something else meanwhile.
    const stored = loadInterview(archivePath, this.masterKey);
    const progress = this.topicOrNew(stored, topic);
    saveInterview(archivePath, this.masterKey, {
      ...stored,
      [topic.id]: reply.done ? { ...progress, pending: null, done: true } : { ...progress, pending: reply.question, done: false },
    });
    if (reply.done) this.record('interview.topic-finished', { topic: topic.id, answers: progress.exchanges.length });
    return OK;
  }

  /** Saves the person's answer to the waiting question, then gets the next question. */
  async answerInterview(topicId: string, text: string, audio: Uint8Array | null, mimeType: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const topic = INTERVIEW_TOPICS.find((candidate) => candidate.id === topicId);
    if (!topic) return refuse('Echo did not recognise that part of the interview.');
    const answer = text.trim();
    if (answer.length === 0) return refuse('Say or type your answer first.');
    if (answer.length > MAX_ANSWER_LENGTH) return refuse('That answer is too long to send in one go. Send part of it, then carry on in the next answer.');
    if (audio && audio.length > MAX_STORY_BYTES) return refuse('That recording is too long for one answer.');

    const stored = loadInterview(archivePath, this.masterKey);
    const progress = this.topicOrNew(stored, topic);
    if (!progress.pending) return refuse('There is no question waiting for an answer. Press Try again to get one.');

    // The answer is saved before anything is sent, so it cannot be lost if Anthropic cannot be reached.
    const recording = audio && audio.length > 0 && /^(audio|video)\/[a-z0-9.+-]+/i.test(mimeType) ? audio : null;
    const exchange: StoredExchange = {
      question: progress.pending,
      answer,
      answeredAt: new Date().toISOString(),
      ...(recording ? { mediaId: writeMedia(archivePath, this.masterKey, recording), mimeType } : {}),
    };
    const exchanges = [...progress.exchanges, exchange];
    const full = exchanges.length >= MAX_EXCHANGES_PER_TOPIC;
    saveInterview(archivePath, this.masterKey, { ...stored, [topic.id]: { pending: null, done: full, exchanges } });
    this.record('interview.answered', { topic: topic.id, spoken: recording !== null });
    if (full) {
      this.record('interview.topic-finished', { topic: topic.id, answers: exchanges.length });
      return OK;
    }
    return this.nextQuestion(topic, null);
  }

  /** Skips the waiting question and asks for a different one. */
  async anotherQuestion(topicId: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const topic = INTERVIEW_TOPICS.find((candidate) => candidate.id === topicId);
    if (!topic) return refuse('Echo did not recognise that part of the interview.');
    const waiting = this.topicOrNew(loadInterview(archivePath, this.masterKey), topic).pending;
    return this.nextQuestion(topic, waiting);
  }

  /** Asks again for the next question, after a failure left none waiting. */
  async retryInterview(topicId: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const topic = INTERVIEW_TOPICS.find((candidate) => candidate.id === topicId);
    if (!topic) return refuse('Echo did not recognise that part of the interview.');
    return this.nextQuestion(topic, null);
  }

  /** Marks a topic finished, or opens a finished one again so it can carry on. */
  async setInterviewDone(topicId: string, done: boolean): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const topic = INTERVIEW_TOPICS.find((candidate) => candidate.id === topicId);
    if (!topic) return refuse('Echo did not recognise that part of the interview.');
    const stored = loadInterview(archivePath, this.masterKey);
    const progress = this.topicOrNew(stored, topic);
    if (done) {
      saveInterview(archivePath, this.masterKey, { ...stored, [topic.id]: { ...progress, pending: null, done: true } });
      this.record('interview.topic-finished', { topic: topic.id, answers: progress.exchanges.length });
      return OK;
    }
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    if (progress.exchanges.length >= MAX_EXCHANGES_PER_TOPIC) {
      return refuse('This part of the interview is as long as it can be. Your answers are all kept.');
    }
    saveInterview(archivePath, this.masterKey, { ...stored, [topic.id]: { ...progress, done: false } });
    return progress.pending ? OK : this.nextQuestion(topic, null);
  }

  /** Changes who may hear one interview answer from the echo. */
  setInterviewAudience(topicId: string, index: number, audience: Audience): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const stored = loadInterview(archivePath, this.masterKey);
    const progress = stored[topicId];
    const exchange = progress?.exchanges[index];
    if (!progress || !exchange) return refuse('That answer is no longer in your archive.');
    if (audience.kind === 'person') {
      const personId = audience.personId;
      if (!this.people().some((person) => person.id === personId)) {
        return refuse('The person this answer is for is no longer in your list. Choose again.');
      }
    }
    const changed: StoredExchange = { ...exchange, audience };
    saveInterview(archivePath, this.masterKey, {
      ...stored,
      [topicId]: { ...progress, exchanges: progress.exchanges.map((candidate, at) => (at === index ? changed : candidate)) },
    });
    this.record('interview.audience-changed', { topic: topicId, forOnePerson: audience.kind === 'person' });
    return OK;
  }

  /** Every piece of advice, without its recording. */
  advice(): Advice[] {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return [];
    return loadAdvice(archivePath, this.masterKey).map((stored) => ({
      id: stored.id,
      personId: stored.personId,
      occasion: stored.occasion,
      kind: stored.kind,
      date: stored.date,
      text: stored.text,
      spoken: stored.mediaId !== undefined,
      savedAt: stored.savedAt,
    }));
  }

  /** Saves advice for one person and one occasion. `audio` is the recording when it was spoken. */
  addAdvice(details: AdviceDetails, audio: Uint8Array | null, mimeType: string): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const problems = adviceProblems(details, this.people());
    if (problems.length > 0) return refuse(...problems);
    if (audio && audio.length > MAX_STORY_BYTES) return refuse('That recording is too long for one piece of advice.');
    const recording = audio && audio.length > 0 && /^(audio|video)\/[a-z0-9.+-]+/i.test(mimeType) ? audio : null;
    addAdvice(archivePath, this.masterKey, details, recording ? { mediaId: writeMedia(archivePath, this.masterKey, recording), mimeType } : null);
    this.record('advice.added', { kind: details.kind, spoken: recording !== null });
    return OK;
  }

  /** Changes who advice is for, its occasion, when it is shared, or its words. */
  changeAdvice(id: string, details: AdviceDetails): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const problems = adviceProblems(details, this.people());
    if (problems.length > 0) return refuse(...problems);
    if (!changeAdvice(archivePath, this.masterKey, id, details)) return refuse('That advice is no longer in your archive.');
    this.record('advice.changed', { kind: details.kind });
    return OK;
  }

  adviceAudio(id: string): Recording | null {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return null;
    const stored = loadAdvice(archivePath, this.masterKey).find((candidate) => candidate.id === id);
    if (!stored?.mediaId) return null;
    return { bytes: readMedia(archivePath, this.masterKey, stored.mediaId), mimeType: stored.mimeType ?? 'audio/webm' };
  }

  /** Removes advice and its recording from the archive. Allowed even without consent. */
  removeAdvice(id: string): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    const removed = removeAdvice(archivePath, this.masterKey, id);
    if (!removed) return;
    if (removed.mediaId) removeMedia(archivePath, removed.mediaId);
    this.record('advice.removed');
  }

  /** The letters the person wrote, newest first. */
  letters(): Letter[] {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return [];
    return loadLetters(archivePath, this.masterKey)
      .map((stored) => ({
        id: stored.id,
        title: stored.title,
        personId: stored.personId,
        writtenOn: stored.writtenOn,
        text: stored.text,
        audience: stored.audience,
        pages: stored.pages.length,
        savedAt: stored.savedAt,
      }))
      .reverse();
  }

  /**
   * Has the AI service read the words off a picture of one page of a letter
   * the person wrote. The picture goes to the service under the person's own
   * key. Nothing is saved: the words come back for the person to correct.
   */
  async readLetterPage(picture: Uint8Array, mimeType: string): Promise<{ ok: true; text: string } | { ok: false; problems: string[] }> {
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    if (!this.archivePath || !this.masterKey) return stop('Open the archive first.');
    if (!this.captureAllowed()) return stop(NO_CONSENT);
    if (!PAGE_TYPES.includes(mimeType) || picture.length === 0) return stop('Echo could not open that picture. It reads JPEG, PNG and WebP pictures.');
    if (picture.length > MAX_PAGE_BYTES) return stop('That picture is too big to send. Take the photo again, or type the words.');
    const key = this.aiKey();
    if (!key) return stop('Reading a page needs your AI key. Open Setup and add it, or type the words of the letter yourself.');
    const answer = await this.ask(key, {
      system: READ_PAGE_INSTRUCTIONS,
      messages: [{ role: 'user', content: READ_PAGE_MESSAGE }],
      picture: { mimeType, base64: Buffer.from(picture).toString('base64') },
      maxTokens: 4000,
      timeoutMs: 120_000,
    });
    if (!this.masterKey) return stop('Your archive was locked while the page was being read. Unlock it and try again.');
    if (!answer.ok) return stop(answer.problem);
    const read = readPageAnswer(answer.text);
    if (!read.ok) return stop(read.problem);
    this.record('letter.page-read');
    return read;
  }

  /** Saves a letter the person wrote, with the pictures of its pages. */
  addLetter(details: LetterDetails, pages: readonly { bytes: Uint8Array; mimeType: string }[]): ActionResult {
    const archivePath = this.archivePath;
    const masterKey = this.masterKey;
    if (!archivePath || !masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const problems = letterProblems(details, this.people());
    if (problems.length > 0) return refuse(...problems);
    if (pages.length > MAX_LETTER_PAGES) return refuse(`Keep a letter to ${MAX_LETTER_PAGES} pages. Split a longer one into parts.`);
    if (pages.some((page) => !PAGE_TYPES.includes(page.mimeType) || page.bytes.length === 0 || page.bytes.length > MAX_PAGE_BYTES)) {
      return refuse('One of the pictures could not be kept. Take it out and add it again.');
    }
    const kept = pages.map((page) => ({ mediaId: writeMedia(archivePath, masterKey, page.bytes), mimeType: page.mimeType }));
    addLetter(archivePath, masterKey, details, kept);
    this.record('letter.added', { pages: kept.length });
    return OK;
  }

  /** Changes a letter's name, who it was to, when it was written, its words or who may hear it. */
  changeLetter(id: string, details: LetterDetails): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const problems = letterProblems(details, this.people());
    if (problems.length > 0) return refuse(...problems);
    if (!changeLetter(archivePath, this.masterKey, id, details)) return refuse('That letter is no longer in your archive.');
    this.record('letter.changed');
    return OK;
  }

  /** The picture of one page of a letter, for looking at beside its words. */
  letterPage(id: string, page: number): Recording | null {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return null;
    const stored = loadLetters(archivePath, this.masterKey).find((candidate) => candidate.id === id)?.pages[page];
    return stored ? { bytes: readMedia(archivePath, this.masterKey, stored.mediaId), mimeType: stored.mimeType } : null;
  }

  /** Removes a letter and the pictures of its pages from the archive. Allowed even without consent. */
  removeLetter(id: string): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    const removed = removeLetter(archivePath, this.masterKey, id);
    if (!removed) return;
    for (const page of removed.pages) removeMedia(archivePath, page.mediaId);
    this.record('letter.removed');
  }

  /** Everything captured in words, as the memory store sees it. */
  private memorySources(archivePath: string, masterKey: Buffer): MemorySource[] {
    const sources: MemorySource[] = [];
    for (const story of loadStories(archivePath, masterKey)) {
      sources.push({ kind: 'story', id: story.id, title: story.title, context: story.prompt, text: story.text, date: story.recordedAt, audience: story.audience, use: 'memory' });
    }
    const interview = loadInterview(archivePath, masterKey);
    for (const topic of INTERVIEW_TOPICS) {
      for (const exchange of interview[topic.id]?.exchanges ?? []) {
        sources.push({
          kind: 'interview',
          id: `${topic.id}/${exchange.answeredAt}`,
          title: topic.title,
          context: exchange.question,
          text: exchange.answer,
          date: exchange.answeredAt,
          audience: exchange.audience ?? EVERYONE,
          use: 'memory',
        });
      }
    }
    for (const advice of loadAdvice(archivePath, masterKey)) {
      sources.push({
        kind: 'advice',
        id: advice.id,
        title: advice.occasion,
        context: '',
        text: advice.text,
        date: advice.savedAt,
        audience: adviceAudience(advice),
        use: advice.kind === 'on-the-day' ? 'advice-on-the-day' : 'advice-when-asked',
      });
    }
    // Letters the person wrote. Only their own are ever saved.
    const names = new Map(this.people().map((person) => [person.id, person.name]));
    for (const letter of loadLetters(archivePath, masterKey)) {
      sources.push({
        kind: 'letter',
        id: letter.id,
        title: letterSourceTitle(letter, letter.personId ? (names.get(letter.personId) ?? null) : null),
        context: '',
        text: letter.text,
        date: letter.savedAt,
        audience: letter.audience,
        use: 'memory',
      });
    }
    // Drafts from the assistant that the person read and approved as their own.
    for (const note of loadNotes(archivePath, masterKey)) {
      sources.push({ kind: 'note', id: note.id, title: noteSourceTitle(note.title), context: '', text: note.text, date: note.approvedAt, audience: note.audience, use: 'memory' });
    }
    // The person's own words from imported conversations. Other people's messages are never a source.
    for (const summary of loadImports(archivePath, masterKey)) {
      if (summary.audience === null) continue;
      sources.push(...messageSources(summary, loadImportedMessages(archivePath, masterKey, summary.id)));
    }
    return sources;
  }

  /** Changes whenever any encrypted document in the archive changes. Used to know when a cached answer is stale. */
  private fingerprint(archivePath: string): string {
    return readdirSync(archivePath)
      .filter((name) => name.endsWith('.sealed'))
      .sort()
      .map((name) => {
        const stat = statSync(path.join(archivePath, name));
        return `${name}:${stat.mtimeMs}:${stat.size}`;
      })
      .join('|');
  }

  /**
   * The memory store, brought up to date with what has been captured. The
   * passages are cut from the person's own words; nothing is sent anywhere.
   */
  memories(): MemoryStore {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return { memories: [], storiesNotWrittenDown: 0 };
    if (this.memoryCache && this.memoryCache.fingerprint === this.fingerprint(archivePath)) return this.memoryCache.store;
    const sources = this.memorySources(archivePath, this.masterKey);
    const result = syncMemories(loadMemories(archivePath, this.masterKey), sources, this.people(), randomUUID);
    if (result.changed) {
      saveMemories(archivePath, this.masterKey, result.memories);
      // Capturing is already on the record. Only passages held back for the person are worth a line of their own.
      if (result.held > 0) this.record('memory.held', { passages: result.held });
    }
    const store: MemoryStore = {
      memories: result.memories,
      storiesNotWrittenDown: sources.filter((source) => source.kind === 'story' && source.text.trim().length === 0).length,
    };
    this.memoryCache = { fingerprint: this.fingerprint(archivePath), store };
    // What the echo can draw on has just been worked out afresh, so the assistant's store is rewritten to match.
    this.refreshDoor(store);
    return store;
  }

  /**
   * Changes one passage. Leaving a passage out is always allowed. Anything
   * that lets the echo say more (new words, a new audience, putting a passage
   * back) needs consent in force.
   */
  changeMemory(id: string, change: MemoryChange): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const onlyLeavingOut = change.leftOut === true && change.words === undefined && change.audience === undefined && change.held === undefined;
    if (!onlyLeavingOut && !this.captureAllowed()) return refuse(NO_CONSENT);
    const people = this.people();
    const problems = memoryChangeProblems(change, people);
    if (problems.length > 0) return refuse(...problems);
    const memories = this.memories().memories;
    const memory = memories.find((candidate) => candidate.id === id);
    if (!memory) return refuse('That passage is no longer in your archive.');
    const changed = applyMemoryChange(memory, change, people);
    saveMemories(archivePath, this.masterKey, memories.map((candidate) => (candidate.id === id ? changed : candidate)));
    this.record('memory.changed', {
      words: change.words !== undefined,
      audience: change.audience !== undefined,
      ...(change.leftOut !== undefined ? { leftOut: change.leftOut } : {}),
      released: change.held === false,
    });
    return OK;
  }

  /** The character sheet or the style profile, with what stands behind each line now. */
  sheet(kind: SheetKind): SheetView {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) {
      return { kind, lines: [], draftedAt: null, draftedFrom: 0, passagesAvailable: 0, keyReady: false, measure: null };
    }
    const memories = this.memories().memories;
    const sheet = loadSheet(archivePath, this.masterKey, kind);
    const forEveryone = passagesForEveryone(memories);
    const personal = kind === 'style' ? this.people().reduce((sum, person) => sum + passagesForPerson(memories, person.id).length, 0) : 0;
    return {
      kind,
      lines: viewLines(sheet.lines, memories),
      draftedAt: sheet.draftedAt,
      draftedFrom: sheet.draftedFrom,
      passagesAvailable: forEveryone.length + personal,
      keyReady: this.aiKey() !== null,
      measure: kind === 'style' ? measureStyle(forEveryone.map(memoryWords)) : null,
    };
  }

  /**
   * Asks Claude to draft the character sheet or the style profile from the
   * person's passages. General lines come only from passages meant for
   * everyone. For the style profile, lines about how the person talks to one
   * named person come only from passages meant for that person.
   */
  async draftSheet(kind: SheetKind): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const key = this.aiKey();
    if (!key) return refuse('Drafting needs your AI key. Open Setup and add it, then come back.');

    const memories = this.memories().memories;
    const ownerName = this.consentStatus().fullName;
    const rejected = loadSheet(archivePath, this.masterKey, kind).rejected;
    const everyone = passagesForEveryone(memories);
    const jobs: { forPerson: Person | null; passages: Memory[] }[] = [];
    if (everyone.length > 0) jobs.push({ forPerson: null, passages: withinBudget(everyone) });
    if (kind === 'style') {
      for (const person of this.people()) {
        const theirs = withinBudget(passagesForPerson(memories, person.id));
        if (theirs.length > 0) jobs.push({ forPerson: person, passages: theirs });
      }
    }
    if (jobs.length === 0) {
      return refuse('There is nothing to draft from yet. Answer some interview questions or write down a story first.');
    }

    const drafts: { audience: Audience; lines: Omit<SheetLine, 'id' | 'origin' | 'checked'>[] }[] = [];
    for (const job of jobs) {
      const audience: Audience = job.forPerson ? { kind: 'person', personId: job.forPerson.id } : EVERYONE;
      const sections = job.forPerson ? [PEOPLE_SECTION] : SHEET_SECTIONS[kind].map((section) => section.id).filter((id) => id !== PEOPLE_SECTION);
      const measure = kind === 'style' && !job.forPerson ? measureStyle(everyone.map(memoryWords)) : null;
      const answer = await this.ask(key, {
        system: draftInstructions(kind, ownerName, job.forPerson),
        messages: [{ role: 'user', content: draftMessage(job.passages, rejected, measure) }],
        maxTokens: 4000,
        timeoutMs: 180_000,
      });
      if (!this.masterKey) return refuse('Your archive was locked while the draft was being written. Unlock it and try again.');
      if (!answer.ok) return refuse(answer.problem);
      const read = readDraft(answer.text, sections, job.passages.length);
      if (!read) return refuse('Claude did not come back with a draft Echo could read. Try again.');
      drafts.push({
        audience,
        lines: read.map((line) => ({
          section: line.section,
          text: line.text,
          evidence: line.passages.map((index) => job.passages[index]).filter((memory) => memory !== undefined).map((memory) => memory.id),
          audience,
        })),
      });
    }

    // Read again before writing: the person may have changed a line while the draft was being written.
    const latest = loadSheet(archivePath, this.masterKey, kind);
    let lines = latest.lines;
    for (const draft of drafts) lines = mergeDraft({ ...latest, lines }, draft.lines, draft.audience, randomUUID);
    const written = lines.filter((line) => !latest.lines.some((before) => before.id === line.id)).length;
    const from = jobs.reduce((sum, job) => sum + job.passages.length, 0);
    saveSheet(archivePath, this.masterKey, kind, { ...latest, lines, draftedAt: new Date().toISOString(), draftedFrom: from });
    this.record(`${kind}.drafted`, { lines: written, passages: from });
    return written > 0
      ? OK
      : { ok: true, problems: [], note: `This draft added no new lines to your ${sheetTitle(kind).toLowerCase()}. Capture more, then draft it again.` };
  }

  /** Corrects a line's words, which makes it the person's own, or confirms a drafted line. */
  changeSheetLine(kind: SheetKind, id: string, change: SheetLineChange): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const sheet = loadSheet(archivePath, this.masterKey, kind);
    const line = sheet.lines.find((candidate) => candidate.id === id);
    if (!line) return refuse('That line is no longer on the sheet.');
    if (change.text !== undefined) {
      const problems = lineProblems(change.text);
      if (problems.length > 0) return refuse(...problems);
    }
    const changed: SheetLine =
      change.text !== undefined && change.text.trim() !== line.text
        ? { ...line, text: change.text.trim(), origin: 'yours', checked: true }
        : { ...line, checked: line.checked || change.checked === true || change.text !== undefined };
    saveSheet(archivePath, this.masterKey, kind, { ...sheet, lines: sheet.lines.map((candidate) => (candidate.id === id ? changed : candidate)) });
    this.record(`${kind}.changed`, { what: changed.text !== line.text ? 'words' : 'confirmed' });
    return OK;
  }

  /** Strikes a line out. Always allowed. A drafted line that is struck out is remembered, so it is not suggested again. */
  removeSheetLine(kind: SheetKind, id: string): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const sheet = loadSheet(archivePath, this.masterKey, kind);
    const line = sheet.lines.find((candidate) => candidate.id === id);
    if (!line) return refuse('That line is no longer on the sheet.');
    saveSheet(archivePath, this.masterKey, kind, {
      ...sheet,
      lines: sheet.lines.filter((candidate) => candidate.id !== id),
      rejected: line.origin === 'drafted' ? [...sheet.rejected, line.text].slice(-MAX_REJECTED_REMEMBERED) : sheet.rejected,
    });
    this.record(`${kind}.changed`, { what: 'struck' });
    return OK;
  }

  /** Adds a line in the person's own words. */
  addSheetLine(kind: SheetKind, section: string, text: string, audience: Audience): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    if (!SHEET_SECTIONS[kind].some((candidate) => candidate.id === section)) return refuse('Echo did not recognise that part of the sheet.');
    const problems = lineProblems(text);
    if (problems.length > 0) return refuse(...problems);
    if (section === PEOPLE_SECTION) {
      if (audience.kind !== 'person' || !this.people().some((person) => person.id === audience.personId)) {
        return refuse('Choose which person this line is about.');
      }
    } else if (audience.kind !== 'everyone') {
      return refuse('Only lines about how you talk to one person can be for that person alone.');
    }
    const sheet = loadSheet(archivePath, this.masterKey, kind);
    const line: SheetLine = { id: randomUUID(), section, text: text.trim(), evidence: [], audience, origin: 'yours', checked: true };
    saveSheet(archivePath, this.masterKey, kind, { ...sheet, lines: [...sheet.lines, line] });
    this.record(`${kind}.changed`, { what: 'added' });
    return OK;
  }

  /** Why the echo cannot talk to this listener right now, or null if it can. */
  private chatBlocked(listener: Listener): string | null {
    if (!this.captureAllowed()) return NO_CONSENT;
    if (!this.consentStatus().fullName) return NO_CONSENT;
    if (listener.kind === 'person') {
      const person = this.people().find((candidate) => candidate.id === listener.personId);
      if (!person) return 'That person is no longer in your list.';
      if (!person.mayTalkToEcho) return `${person.name} is not marked as allowed to talk to your echo. Change that on the People screen first.`;
    }
    return null;
  }

  /** A new conversation, holding only the fixed opening line. */
  private openedSession(): ChatSession {
    const at = new Date().toISOString();
    return {
      startedAt: at,
      messages: [{ id: randomUUID(), role: 'echo', text: openingLine(this.consentStatus().fullName ?? ''), at, opening: true }],
    };
  }

  /** The current conversation with this listener. Starts one, with its opening line, if there is none. */
  chat(listener: Listener): ChatView {
    const archivePath = this.archivePath;
    const people = this.people();
    const speakingAs: ChatView['speakingAs'] = [
      { listener: { kind: 'owner' }, label: 'Myself, trying it out' },
      ...people.filter((person) => person.mayTalkToEcho).map((person) => ({ listener: { kind: 'person' as const, personId: person.id }, label: person.name })),
    ];
    const empty: ChatView = { listener, speakingAs, messages: [], waiting: false, keyReady: false, passages: 0, earlierConversations: 0, blocked: 'Open the archive first.' };
    if (!archivePath || !this.masterKey) return empty;
    const blocked = this.chatBlocked(listener);
    const keyReady = this.aiKey() !== null;
    if (blocked) return { ...empty, keyReady, blocked };

    const key = listenerKey(listener);
    let chats = loadChats(archivePath, this.masterKey);
    if (!chats[key] || chats[key].length === 0) {
      chats = { ...chats, [key]: [this.openedSession()] };
      saveChats(archivePath, this.masterKey, chats);
    }
    const sessions = chats[key] ?? [];
    const current = sessions.at(-1);
    const memories = this.memories().memories;
    const messages = (current?.messages ?? []).map((message) => ({
      ...message,
      support: (message.sources ?? []).flatMap((id) => {
        const memory = memories.find((candidate) => candidate.id === id);
        if (!memory) return [];
        const words = memoryWords(memory);
        return [{ memoryId: id, title: memory.source.title, excerpt: words.length > 220 ? `${words.slice(0, 220)}…` : words }];
      }),
    }));
    return {
      listener,
      speakingAs,
      messages,
      waiting: messages.at(-1)?.role === 'them',
      keyReady,
      passages: permittedPassages(memories, listener, people).length,
      earlierConversations: sessions.length - 1,
      blocked: null,
    };
  }

  /** Starts a new conversation with this listener. Earlier ones are kept. */
  startChat(listener: Listener): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const blocked = this.chatBlocked(listener);
    if (blocked) return refuse(blocked);
    const key = listenerKey(listener);
    const chats = loadChats(archivePath, this.masterKey);
    const sessions = chats[key] ?? [];
    // A conversation nobody has said anything in is not worth keeping as an earlier one.
    const kept = sessions.filter((session) => session.messages.some((message) => message.role === 'them'));
    saveChats(archivePath, this.masterKey, { ...chats, [key]: [...kept, this.openedSession()] });
    return OK;
  }

  private appendToChat(archivePath: string, masterKey: Buffer, listener: Listener, message: ChatMessage): void {
    const key = listenerKey(listener);
    const chats = loadChats(archivePath, masterKey);
    const sessions = chats[key] && chats[key].length > 0 ? chats[key] : [this.openedSession()];
    const current = sessions.at(-1);
    if (!current) return;
    saveChats(archivePath, masterKey, { ...chats, [key]: [...sessions.slice(0, -1), { ...current, messages: [...current.messages, message] }] });
  }

  /**
   * Makes the echo's reply to the last thing this listener said. The reply is
   * built only from what this listener may hear, and is not saved or shown
   * until it has passed the source check.
   */
  private async echoReply(listener: Listener): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const blocked = this.chatBlocked(listener);
    if (blocked) return refuse(blocked);
    const key = this.aiKey();
    if (!key) return refuse('Your echo needs your AI key to talk. Open Setup and add it, then come back.');

    const people = this.people();
    const sessions = loadChats(archivePath, this.masterKey)[listenerKey(listener)] ?? [];
    const current = sessions.at(-1);
    const turns = (current?.messages ?? []).filter((message) => !message.opening).map((message) => ({ role: message.role, text: message.text }));
    if (turns.at(-1)?.role !== 'them') return refuse('Say something to your echo first.');

    const memories = this.memories().memories;
    const lately = turns.filter((turn) => turn.role === 'them').slice(-2).map((turn) => turn.text).join(' ');
    const passages = choosePassages(permittedPassages(memories, listener, people), lately, listener);
    const composed = await composeReply((request) => this.ask(key, request), {
      ownerName: this.consentStatus().fullName ?? '',
      listener: listener.kind === 'person' ? (people.find((person) => person.id === listener.personId) ?? null) : null,
      character: permittedLines(this.sheet('character').lines, listener, people),
      style: permittedLines(this.sheet('style').lines, listener, people),
      passages,
      toldBefore: toldBefore(sessions.slice(0, -1)),
    }, turns, this.thirdPartyCheck());
    if (!this.masterKey) return refuse('Your archive was locked while your echo was thinking. Unlock it and press Try again.');
    if (!composed.ok) return refuse(composed.problem);

    this.appendToChat(archivePath, this.masterKey, listener, {
      id: randomUUID(),
      role: 'echo',
      text: composed.reply,
      at: new Date().toISOString(),
      sources: composed.sources,
      check: composed.check,
      ...(composed.rejected.length > 0 ? { rejected: composed.rejected } : {}),
    });
    // The record keeps which passages a reply drew on and how it got through the check, never the words.
    this.record('echo.replied', { to: listener.kind, check: composed.check, passages: composed.sources.length, sources: composed.sources.join(' ') });
    return OK;
  }

  /** Says something to the echo. What was said is saved before the echo is asked, so it is never lost. */
  async sayToEcho(listener: Listener, text: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const blocked = this.chatBlocked(listener);
    if (blocked) return refuse(blocked);
    const said = text.trim();
    if (said.length === 0) return refuse('Type something to say first.');
    if (said.length > MAX_MESSAGE_LENGTH) return refuse('That is too long to say in one go. Send part of it, then carry on.');
    this.appendToChat(archivePath, this.masterKey, listener, { id: randomUUID(), role: 'them', text: said, at: new Date().toISOString() });
    return this.echoReply(listener);
  }

  /** Asks again for a reply that failed. */
  async retryEcho(listener: Listener): Promise<ActionResult> {
    return this.echoReply(listener);
  }

  /** Who may judge the blind test: the person, and each family member allowed to talk to the echo. */
  private blindJudges(): { listener: Listener; label: string }[] {
    return [
      { listener: { kind: 'owner' }, label: this.consentStatus().fullName ?? 'Me' },
      ...this.people().filter((person) => person.mayTalkToEcho).map((person) => ({ listener: { kind: 'person' as const, personId: person.id }, label: person.name })),
    ];
  }

  /** Where the blind test has got to. Labelled answers are only in it once the test is complete. */
  blindTest(): BlindTestView {
    const archivePath = this.archivePath;
    const empty: BlindTestView = {
      stage: 'none',
      blocked: 'Open the archive first.',
      keyReady: false,
      ownerName: '',
      writing: [],
      echoAnswered: 0,
      of: 0,
      possibleJudges: [],
      result: null,
      earlierTests: 0,
    };
    if (!archivePath || !this.masterKey) return empty;
    const tests = loadBlindTests(archivePath, this.masterKey);
    const test = tests.at(-1) ?? null;
    const stage = blindStage(test);
    return {
      stage,
      blocked: this.chatBlocked({ kind: 'owner' }),
      keyReady: this.aiKey() !== null,
      ownerName: this.consentStatus().fullName ?? '',
      writing: test && stage === 'writing' ? test.items.map((item) => ({ question: item.question, mine: item.mine })) : [],
      echoAnswered: test ? test.items.filter((item) => item.echo !== null).length : 0,
      of: test ? test.items.length : 0,
      possibleJudges: this.blindJudges(),
      result: test && stage === 'judging' ? blindResult(test) : null,
      earlierTests: Math.max(tests.length - 1, 0),
    };
  }

  /** Starts a new blind test. An earlier one is kept. */
  startBlindTest(): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const blocked = this.chatBlocked({ kind: 'owner' });
    if (blocked) return refuse(blocked);
    saveBlindTests(archivePath, this.masterKey, [...loadBlindTests(archivePath, this.masterKey), newBlindTest(randomUUID(), new Date().toISOString())]);
    this.record('blindtest.started');
    return OK;
  }

  private changeBlindTest(archivePath: string, masterKey: Buffer, change: (test: BlindTest) => BlindTest): void {
    const tests = loadBlindTests(archivePath, masterKey);
    const current = tests.at(-1);
    if (current) saveBlindTests(archivePath, masterKey, [...tests.slice(0, -1), change(current)]);
  }

  /** Saves the person's own answer to one question. It stays with the test and is never given to the echo. */
  saveBlindAnswer(index: number, text: string): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const test = loadBlindTests(archivePath, this.masterKey).at(-1);
    if (!test || !test.items[index]) return refuse('Start the test first.');
    if (test.judges.length > 0) return refuse('Judging has started, so the answers can no longer be changed. Start a new test to change them.');
    const answer = text.trim();
    if (answer.length === 0) return refuse('Write your answer first.');
    if (answer.length > MAX_BLIND_ANSWER_LENGTH) return refuse('Keep each answer to a few sentences, the way you would say it.');
    this.changeBlindTest(archivePath, this.masterKey, (current) => ({
      ...current,
      items: current.items.map((item, at) => (at === index ? { ...item, mine: answer } : item)),
    }));
    return OK;
  }

  /**
   * Has the echo answer the next question it has not answered, through the
   * same draft and source check as any reply. It answers as it would to any
   * family member, and is never shown the person's own answers.
   */
  async blindEchoNext(): Promise<ActionResult & { remaining: number }> {
    const archivePath = this.archivePath;
    const stop = (problem: string, remaining = 0) => ({ ok: false, problems: [problem], remaining });
    if (!archivePath || !this.masterKey) return stop('Open the archive first.');
    const blocked = this.chatBlocked({ kind: 'owner' });
    if (blocked) return stop(blocked);
    const key = this.aiKey();
    if (!key) return stop('Your echo needs your AI key to answer. Open Setup and add it, then come back.');
    const test = loadBlindTests(archivePath, this.masterKey).at(-1);
    if (!test || blindStage(test) === 'writing') return stop('Write your own answers to all the questions first.');
    const index = test.items.findIndex((item) => item.echo === null);
    const item = test.items[index];
    if (!item) return { ok: true, problems: [], remaining: 0 };
    const left = test.items.filter((candidate) => candidate.echo === null).length;

    const listener: Listener = { kind: 'owner' };
    const people = this.people();
    const composed = await composeReply((request) => this.ask(key, request), {
      ownerName: this.consentStatus().fullName ?? '',
      listener: null,
      character: permittedLines(this.sheet('character').lines, listener, people),
      style: permittedLines(this.sheet('style').lines, listener, people),
      passages: choosePassages(permittedPassages(this.memories().memories, listener, people), item.question, listener),
      toldBefore: [],
      singleAnswer: true,
    }, [{ role: 'them', text: item.question }], this.thirdPartyCheck());
    if (!this.masterKey) return stop('Your archive was locked while your echo was answering. Unlock it and carry on.', left);
    if (!composed.ok) return stop(composed.problem, left);

    this.changeBlindTest(archivePath, this.masterKey, (current) => ({
      ...current,
      items: current.items.map((candidate, at) => (at === index && candidate.echo === null ? { ...candidate, echo: composed.reply, echoCheck: composed.check } : candidate)),
    }));
    this.record('blindtest.echo-answered', { question: index + 1, check: composed.check });
    return { ok: true, problems: [], remaining: left - 1 };
  }

  /** The next unlabelled pair for this judge, or null when they have finished. Starts their run if they have none. */
  blindPair(judge: Listener): BlindPair | null {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return null;
    const test = loadBlindTests(archivePath, this.masterKey).at(-1);
    if (!test || blindStage(test) !== 'judging') return null;
    const who = this.blindJudges().find((candidate) => listenerKey(candidate.listener) === listenerKey(judge));
    if (!who) return null;
    const key = listenerKey(judge);
    const existing = test.judges.find((run) => run.key === key);
    if (existing) return nextPair(test, existing);
    const run = newJudgeRun(key, who.label, test.items.length, this.random);
    this.changeBlindTest(archivePath, this.masterKey, (current) => ({ ...current, judges: [...current.judges, run] }));
    return nextPair(test, run);
  }

  /** Records this judge's verdict on the pair they are on. */
  judgeBlindPair(judge: Listener, verdict: PairVerdict): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const problems = verdictProblems(verdict);
    if (problems.length > 0) return refuse(...problems);
    const test = loadBlindTests(archivePath, this.masterKey).at(-1);
    const key = listenerKey(judge);
    const run = test?.judges.find((candidate) => candidate.key === key);
    if (!test || !run || !nextPair(test, run)) return refuse('There is no pair waiting to be judged.');
    const judged = recordVerdict(run, verdict);
    const after: BlindTest = { ...test, judges: test.judges.map((candidate) => (candidate.key === key ? judged : candidate)) };
    this.changeBlindTest(archivePath, this.masterKey, () => after);
    if (judged.judgements.length >= judged.order.length) {
      const result = blindResult(after);
      const mine = result.judges.find((candidate) => candidate.key === key);
      this.record('blindtest.judged', { judge: judge.kind, pickedReal: mine?.pickedReal ?? 0, echoAverage: mine?.echoAverage ?? 0 });
      if (result.complete && result.passed !== null) this.record('blindtest.finished', { passed: result.passed, echoAverage: result.echoAverage ?? 0 });
    }
    return OK;
  }

  /** Every imported conversation, without its messages. */
  imports(): ImportSummary[] {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return [];
    return loadImports(archivePath, this.masterKey);
  }

  /** Holds a conversation that has been read until the person decides, and says what was found in it. */
  private offerImport(service: ImportService, parsed: ParsedChat, fileName: string, suggestedLabel: string, knownOwner: string | null = null): ImportChosen {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return { ok: false, problems: ['Open the archive first.'] };
    const first = parsed.messages[0];
    const last = parsed.messages.at(-1);
    if (!first || !last) return { ok: false, problems: ['Echo found no messages with words in that conversation.'] };
    const earlier = loadImports(archivePath, this.masterKey);
    const fileHash = createHash('sha256').update(JSON.stringify(parsed.messages)).digest('hex');
    const token = randomUUID();
    this.pendingImports.clear(); // only the latest preview can be saved
    this.pendingImports.set(token, { service, parsed, fileName, fileHash });
    const ownerName = this.consentStatus().fullName;
    const known = new Set(earlier.map((summary) => summary.me));
    return {
      ok: true,
      preview: {
        token,
        service,
        fileName,
        suggestedLabel,
        messages: parsed.messages.length,
        senders: parsed.senders,
        from: first.at,
        to: last.at,
        datesAssumedDayFirst: !parsed.dateOrderCertain,
        media: parsed.media,
        notices: parsed.notices,
        sample: parsed.messages.slice(0, 12),
        alreadyImportedAs: earlier.find((summary) => summary.fileHash === fileHash)?.label ?? null,
        suggestedMe:
          knownOwner ?? parsed.senders.find((sender) => known.has(sender.name))?.name ?? parsed.senders.find((sender) => sender.name === ownerName)?.name ?? null,
      },
    };
  }

  /**
   * Reads an exported WhatsApp chat from this computer and says what was
   * found in it. Nothing is saved until the person has said which sender is them.
   */
  previewImport(filePath: string): ImportChosen {
    const archivePath = this.archivePath;
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    if (!archivePath || !this.masterKey) return stop('Open the archive first.');
    if (!this.captureAllowed()) return stop(NO_CONSENT);
    const fileName = path.basename(filePath);
    let chatText: string;
    try {
      if (/\.zip$/i.test(fileName)) {
        const pick = (names: string[]) =>
          names.find((name) => /(^|\/)_chat\.txt$/i.test(name)) ?? names.find((name) => /\.txt$/i.test(name) && !name.startsWith('__MACOSX')) ?? null;
        chatText = readFromZip(filePath, pick, MAX_IMPORT_BYTES).contents.toString('utf8');
      } else {
        if (statSync(filePath).size > MAX_IMPORT_BYTES) return stop('That file is too big to be a chat export.');
        chatText = readFileSync(filePath, 'utf8');
      }
    } catch (error) {
      return stop(error instanceof Error && /ZIP|chat text|too big/.test(error.message) ? error.message : 'Echo could not read that file.');
    }
    const parsed = parseWhatsApp(chatText);
    if (parsed.messages.length === 0) {
      return stop('Echo could not find any WhatsApp messages in that file. Use the file WhatsApp makes with "Export chat": a ZIP, or the text file inside it.');
    }
    return this.offerImport('whatsapp', parsed, fileName, chatNameFromFile(fileName));
  }

  /** Turns the files of one Messenger conversation into something to preview. */
  private offerMessenger(files: readonly Buffer[], fileName: string, fallbackName: string): ImportChosen {
    const threads: MessengerThread[] = [];
    for (const file of files) {
      let json: unknown;
      try {
        json = JSON.parse(file.toString('utf8'));
      } catch {
        return { ok: false, problems: ['Echo could not read that file. It is not the JSON that Messenger makes.'] };
      }
      const thread = readMessengerFile(json);
      if (!thread) return { ok: false, problems: ['That file is not a Messenger conversation.'] };
      threads.push(thread);
    }
    const merged = mergeMessengerFiles(threads);
    // A secure storage download names a conversation "Ada Lovelace_12". The number is Meta's, not part of the name.
    return this.offerImport('messenger', merged, fileName, (merged.title || fallbackName).replace(/_\d+$/, ''));
  }

  /**
   * Reads a Messenger download from this computer: the ZIP from "Export your
   * information", the ZIP from "Download secure storage data", or one
   * conversation's JSON file. A ZIP that holds many conversations gives back
   * the list to pick from.
   */
  chooseMessenger(filePath: string): ImportChosen {
    const archivePath = this.archivePath;
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    if (!archivePath || !this.masterKey) return stop('Open the archive first.');
    if (!this.captureAllowed()) return stop(NO_CONSENT);
    const fileName = path.basename(filePath);
    this.forgetDownload();
    try {
      if (!/\.zip$/i.test(fileName)) {
        if (statSync(filePath).size > MAX_IMPORT_BYTES) return stop('That file is too big to be one conversation.');
        return this.offerMessenger([readFileSync(filePath)], fileName, fileName.replace(/\.json$/i, ''));
      }
      const found = findThreads(namesInZip(filePath));
      if (found.threads.length === 0) {
        return stop('Echo found no Messenger conversations in that ZIP. When you ask Meta for the download, choose JSON as the format, not HTML.');
      }
      this.pendingDownload = { kind: 'messenger', filePath, fileName, filesOf: found.filesOf, threads: found.threads };
      const only = found.threads.length === 1 ? found.threads[0] : undefined;
      return only ? this.openImportThread(only.key) : { ok: true, threads: found.threads, fileName };
    } catch (error) {
      return stop(error instanceof Error && /ZIP|too big/.test(error.message) ? error.message : 'Echo could not read that file.');
    }
  }

  /** The iPhone backups Echo can find on this computer, newest first. */
  iphoneBackups(): IphoneBackup[] {
    if (!this.archivePath || !this.masterKey) return [];
    return findBackups(this.backupRoots);
  }

  /** One Discord channel's messages file, offered for import. Everything in it was sent by the owner. */
  private offerDiscord(contents: Buffer, entryName: string, fileName: string, label: string): ImportChosen {
    // Discord's package holds only the owner's messages and does not name them in it. They are given the name on the consent, or "Me".
    const me = this.consentStatus().fullName ?? 'Me';
    const parsed = readDiscordMessages(contents.toString('utf8'), discordFileKind(entryName), me);
    if (!parsed) return { ok: false, problems: ['That does not look like a messages file from a Discord data package.'] };
    return this.offerImport('discord', parsed, fileName, discordLabel(label), me);
  }

  /**
   * Reads a Discord data package: the ZIP as Discord sends it, or one
   * channel's messages file from a package that has been unzipped. A package
   * holds only what the owner sent, so there are no one else's words in it.
   */
  chooseDiscord(filePath: string): ImportChosen {
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    if (!this.archivePath || !this.masterKey) return stop('Open the archive first.');
    if (!this.captureAllowed()) return stop(NO_CONSENT);
    const fileName = path.basename(filePath);
    this.forgetDownload();
    try {
      if (!/\.zip$/i.test(fileName)) {
        if (statSync(filePath).size > MAX_IMPORT_BYTES) return stop('That file is too big to be one conversation.');
        // Unzipped, each conversation sits in a folder named with its number: that is all there is to call it.
        return this.offerDiscord(readFileSync(filePath), fileName, fileName, `Discord ${path.basename(path.dirname(filePath))}`);
      }
      const found = findDiscordChannels(namesInZip(filePath));
      if (found.threads.length === 0) {
        return stop('Echo found no Discord messages in that ZIP. When you ask Discord for your data, make sure Messages is ticked.');
      }
      const index = found.indexFile ? readManyFromZip(filePath, [found.indexFile], MAX_IMPORT_BYTES)[0] : undefined;
      const threads = index ? nameDiscordChannels(found.threads, index.toString('utf8')) : found.threads;
      this.pendingDownload = { kind: 'discord', filePath, fileName, filesOf: found.filesOf, threads };
      const only = threads.length === 1 ? threads[0] : undefined;
      return only ? this.openImportThread(only.key) : { ok: true, threads, fileName };
    } catch (error) {
      return stop(error instanceof Error && /ZIP|too big/.test(error.message) ? error.message : 'Echo could not read that file.');
    }
  }

  /**
   * Reads a mailbox file from end to end, looking only at who each email is
   * from and to. Nothing is kept yet and no words are read: the owner first
   * says which of the addresses are theirs.
   */
  async chooseEmail(filePath: string): Promise<ImportChosen> {
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    if (!this.archivePath || !this.masterKey) return stop('Open the archive first.');
    if (!this.captureAllowed()) return stop(NO_CONSENT);
    const fileName = path.basename(filePath);
    this.forgetDownload();
    const entries: MailEntry[] = [];
    try {
      await scanMailbox(filePath, (start, offset) => {
        const entry = mailEntry(start.subarray(0, 64 * 1024).toString('latin1'), offset, start.length);
        if (entry) entries.push(entry);
      });
    } catch {
      return stop('Echo could not read that file.');
    }
    if (entries.length === 0) return stop('Echo found no emails in that file. It reads mailbox files, the kind whose name ends in .mbox.');
    // The archive may have been locked while a big mailbox was being read.
    if (!this.archivePath || !this.masterKey) return stop('Open the archive first.');
    this.pendingDownload = { kind: 'email', filePath, fileName, entries, groups: new Map(), threads: [] };
    return { ok: true, mailbox: { fileName, emails: entries.length, ...senderAddresses(entries) } };
  }

  /** The owner has said which addresses are theirs: lists who they wrote to, most emails first. Only emails they sent are counted. */
  chooseEmailAddresses(mine: readonly string[]): ImportChosen {
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    if (!this.archivePath || !this.masterKey) return stop('Open the archive first.');
    if (!this.captureAllowed()) return stop(NO_CONSENT);
    const download = this.pendingDownload;
    if (download?.kind !== 'email') return stop('Choose the mailbox file again. Echo no longer has it open.');
    const addresses = new Set(mine.map((address) => address.trim().toLowerCase()).filter((address) => address.length > 0));
    if (addresses.size === 0) return stop('Tick the addresses that are yours.');
    const groups = sentByRecipient(download.entries, addresses);
    if (groups.size === 0) return stop('Echo found no emails sent from those addresses in that mailbox.');
    const threads: ThreadChoice[] = [...groups].map(([key, group]) => ({
      key,
      name: group.name === key ? key : `${group.name} (${key})`,
      files: 1,
      bytes: group.emails.reduce((total, email) => total + email.length, 0),
      messages: group.emails.length,
    }));
    threads.sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0) || a.key.localeCompare(b.key));
    download.groups = groups;
    download.threads = threads;
    return { ok: true, threads, fileName: download.fileName };
  }

  /** Forgets the download or backup that was open, wiping any key held for it. */
  private forgetDownload(): void {
    const download = this.pendingDownload;
    if (download?.kind === 'iphone' && 'locked' in download.messages) download.messages.locked.key.fill(0);
    this.pendingDownload = null;
  }

  /**
   * Reads the list of conversations in an iPhone backup. A backup that is not
   * encrypted is opened read-only where it is. An encrypted one is unlocked
   * with its password, which is used here and never stored; its messages are
   * read from a decrypted copy that is deleted before this returns.
   */
  async chooseIphoneBackup(folder: string, password?: string): Promise<ImportChosen> {
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    if (!this.archivePath || !this.masterKey) return stop('Open the archive first.');
    if (!this.captureAllowed()) return stop(NO_CONSENT);
    this.forgetDownload();
    if (!existsSync(path.join(folder, 'Manifest.db')) && !existsSync(path.join(folder, 'Manifest.plist'))) {
      return stop('That folder is not an iPhone backup. Choose the folder with the long name of letters and numbers, inside MobileSync, Backup.');
    }
    const noMessages = 'That backup has no text messages in it. Messages kept in iCloud may be left out of a backup made on a computer.';
    const fileName = findBackups([path.dirname(folder)]).find((backup) => backup.folder === folder)?.device || 'iPhone backup';
    try {
      const smsPath = backupFilePath(folder, SMS_FILE);
      if (smsPath && isReadableDatabase(smsPath)) {
        const contacts = loadContacts(folder);
        const threads = listIphoneThreads(smsPath, contacts);
        if (threads.length === 0) return stop(noMessages);
        this.pendingDownload = { kind: 'iphone', messages: { smsPath }, fileName, contacts, threads };
        return { ok: true, threads, fileName };
      }
      // No messages file at all, in a backup that does not say it is encrypted: there are no messages to read.
      if (!smsPath && !saysItIsEncrypted(folder)) return stop(noMessages);
      if (!existsSync(path.join(folder, 'Manifest.plist'))) return stop('That backup is encrypted, but the record of how is missing, so Echo cannot open it.');

      if (password === undefined) {
        return {
          ok: false,
          needsPassword: true,
          folder,
          problems: ['That backup is encrypted. Type the password you chose when you ticked "Encrypt local backup". It is not your iPhone passcode or your Apple password.'],
        };
      }
      const unlocked = await unlockBackup(folder, password);
      if (!this.masterKey) return stop('Your archive was locked while the backup was being unlocked. Unlock it and try again.');
      // Only a wrong password is worth asking for again. Anything else would fail the same way with the right one.
      if (!unlocked.ok) return unlocked.wrongPassword ? { ok: false, needsPassword: true, folder, problems: [unlocked.problem] } : stop(unlocked.problem);
      if (!unlocked.sms) return stop(noMessages);
      const contacts = unlocked.contacts ? withDecrypted(unlocked.contacts, (copy) => loadContactsFrom(copy)) : new Map<string, string>();
      unlocked.contacts?.key.fill(0);
      const threads = withDecrypted(unlocked.sms, (copy) => listIphoneThreads(copy, contacts));
      if (threads.length === 0) return stop(noMessages);
      this.pendingDownload = { kind: 'iphone', messages: { locked: unlocked.sms }, fileName, contacts, threads };
      return { ok: true, threads, fileName };
    } catch {
      return stop('Echo could not read the messages in that backup.');
    }
  }

  /** Opens one conversation from the download or backup last chosen, ready to preview. */
  openImportThread(key: string): ImportChosen {
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    if (!this.archivePath || !this.masterKey) return stop('Open the archive first.');
    if (!this.captureAllowed()) return stop(NO_CONSENT);
    const download = this.pendingDownload;
    const thread = download?.threads.find((candidate) => candidate.key === key);
    if (!download || !thread) return stop('Choose the download or backup again. Echo no longer has it open.');
    try {
      if (download.kind === 'iphone') {
        // On the phone, the owner's messages carry no name. They are given the name on the consent, or "Me".
        const me = this.consentStatus().fullName ?? 'Me';
        const contacts = download.contacts;
        const messages = download.messages;
        const read = 'locked' in messages ? withDecrypted(messages.locked, (copy) => readIphoneThread(copy, key, contacts, me)) : readIphoneThread(messages.smsPath, key, contacts, me);
        // The phone itself says which messages its owner sent, so Echo knows who the owner is. They still confirm it.
        return this.offerImport('iphone', read, download.fileName, thread.name, read.senders.some((sender) => sender.name === read.owner) ? read.owner : null);
      }
      if (download.kind === 'email') {
        const group = download.groups.get(key);
        if (!group) return stop('Choose the mailbox file again. Echo no longer has it open.');
        // Only the owner's own emails are read, so every one is theirs. They are given the name on the consent, or "Me".
        const me = this.consentStatus().fullName ?? 'Me';
        return this.offerImport('email', readSentEmails(download.filePath, group.emails, me), download.fileName, group.name.slice(0, 80), me);
      }
      const files = download.filesOf.get(key);
      if (!files) return stop('Choose the download again. Echo no longer has it open.');
      if (download.kind === 'discord') {
        const entry = files[0];
        const contents = entry ? readManyFromZip(download.filePath, [entry], MAX_IMPORT_BYTES)[0] : undefined;
        if (!entry || !contents) return stop('Choose the download again. Echo no longer has it open.');
        return this.offerDiscord(contents, entry, download.fileName, thread.name);
      }
      return this.offerMessenger(readManyFromZip(download.filePath, files, MAX_IMPORT_BYTES), download.fileName, thread.name);
    } catch (error) {
      return stop(error instanceof Error && /ZIP|too big/.test(error.message) ? error.message : 'Echo could not read that conversation.');
    }
  }

  /** Saves a previewed conversation. Every message not from the chosen sender is marked as someone else's, for good. */
  confirmImport(token: string, choice: ImportChoice): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const pending = this.pendingImports.get(token);
    if (!pending) return refuse('Choose the file again. Echo no longer has it open.');
    const problems = importChoiceProblems(choice, pending.parsed.senders, this.people());
    if (problems.length > 0) return refuse(...problems);
    const earlier = loadImports(archivePath, this.masterKey).find((summary) => summary.fileHash === pending.fileHash);
    if (earlier) return refuse(`You have already imported this export, as "${earlier.label}". Delete that one first if you want to import it again.`);

    const messages: ImportedMessage[] = pending.parsed.messages.map((message) => ({ ...message, thirdParty: message.sender !== choice.me }));
    const mine = messages.filter((message) => !message.thirdParty).length;
    const summary: ImportSummary = {
      id: randomUUID(),
      service: pending.service,
      label: choice.label.trim(),
      importedAt: new Date().toISOString(),
      fileHash: pending.fileHash,
      me: choice.me,
      personId: choice.personId,
      audience: choice.audience,
      mine,
      others: messages.length - mine,
      from: messages[0]?.at ?? '',
      to: messages.at(-1)?.at ?? '',
    };
    addImport(archivePath, this.masterKey, summary, messages);
    this.pendingImports.delete(token);
    this.record('import.added', { service: summary.service, mine, others: summary.others, heardBy: choice.audience === null ? 'nobody' : choice.audience.kind });
    return OK;
  }

  /** A page of one imported conversation, oldest first. */
  importMessages(id: string, offset: number, limit: number): { messages: ImportedMessage[]; total: number } {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return { messages: [], total: 0 };
    if (!loadImports(archivePath, this.masterKey).some((summary) => summary.id === id)) return { messages: [], total: 0 };
    const all = loadImportedMessages(archivePath, this.masterKey, id);
    const start = Math.max(0, Math.floor(offset));
    return { messages: all.slice(start, start + Math.min(Math.max(1, Math.floor(limit)), 500)), total: all.length };
  }

  /** Removes a conversation and everything in it. Allowed even without consent. Its passages leave the memory store with it. */
  removeImport(id: string): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    if (removeImport(archivePath, this.masterKey, id)) this.record('import.removed');
  }

  /**
   * The check every draft reply gets on this computer before it goes any
   * further: it must not repeat a run of words from someone else's message.
   */
  private thirdPartyCheck(): (reply: string) => string | null {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return () => null;
    const fingerprint = this.fingerprint(archivePath);
    if (!this.thirdPartyCache || this.thirdPartyCache.fingerprint !== fingerprint) {
      const runs = new Set<string>();
      for (const summary of loadImports(archivePath, this.masterKey)) thirdPartyRuns(loadImportedMessages(archivePath, this.masterKey, summary.id), runs);
      this.thirdPartyCache = { fingerprint, runs };
    }
    const runs = this.thirdPartyCache.runs;
    return (reply) => (repeatsThirdParty(reply, runs) ? "The draft repeats words from someone else's private message. Say it in your own words, or leave it out." : null);
  }

  /** Every face and voice master recording, without its contents. */
  captures(): Capture[] {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return [];
    return loadCaptures(archivePath, this.masterKey).map(({ mediaId: _mediaId, mimeType: _mimeType, ...capture }) => capture);
  }

  /** Saves a selfie, the guided video, or a voice recording. Refused unless consent is in force. */
  addCapture(group: CaptureGroup, label: string, contents: Uint8Array, mimeType: string, seconds: number): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    if (!(contents instanceof Uint8Array) || contents.length === 0) return refuse('Nothing was captured. Try again.');
    if (contents.length > MAX_CAPTURE_BYTES) return refuse('That recording is too big to keep in one piece. Record a shorter one.');

    if (group === 'face-photo') {
      if (!SELFIE_POSES.some((pose) => pose.id === label)) return refuse('Echo did not recognise which photo that was.');
      if (!/^image\/(jpeg|png)$/i.test(mimeType)) return refuse('Echo did not recognise that kind of photo.');
    } else if (group === 'face-video') {
      if (!/^video\/[a-z0-9.+-]+/i.test(mimeType)) return refuse('Echo did not recognise that kind of video.');
      if (!Number.isFinite(seconds) || seconds < this.minFaceVideoSeconds) {
        return refuse(`That video is too short. The avatar needs at least ${Math.round(this.minFaceVideoSeconds / 60)} minutes in one take. Record it again and keep going until the timer says so.`);
      }
    } else if (group === 'voice') {
      if (!VOICE_PASSAGES.some((passage) => passage.id === label)) return refuse('Echo did not recognise which recording that was.');
      if (!/^audio\/[a-z0-9.+-]+/i.test(mimeType)) return refuse('Echo did not recognise that kind of recording.');
      if (!Number.isFinite(seconds) || seconds < 1) return refuse('That recording is too short to be useful.');
    } else {
      return refuse('Echo did not recognise what was captured.');
    }

    const mediaId = writeMedia(archivePath, this.masterKey, contents);
    addCapture(archivePath, this.masterKey, {
      group,
      label: group === 'face-video' ? 'guided-video' : label,
      seconds: group === 'face-photo' ? 0 : seconds,
      mediaId,
      mimeType,
    });
    this.record('capture.added', { group, seconds: group === 'face-photo' ? 0 : Math.round(seconds) });
    return OK;
  }

  captureContents(id: string): Recording | null {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return null;
    const capture = loadCaptures(archivePath, this.masterKey).find((candidate) => candidate.id === id);
    if (!capture) return null;
    return { bytes: readMedia(archivePath, this.masterKey, capture.mediaId), mimeType: capture.mimeType };
  }

  /** Removes a master recording from the archive. Allowed even without consent. */
  removeCapture(id: string): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    const removed = removeCapture(archivePath, this.masterKey, id);
    if (!removed) return;
    removeMedia(archivePath, removed.mediaId);
    this.record('capture.removed', { group: removed.group });
  }

  /** Every story, without its sound. */
  stories(): Story[] {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return [];
    return loadStories(archivePath, this.masterKey).map(storyView);
  }

  /** Saves a newly recorded story, with any pictures that go with it. Refused unless the person's consent is in force. */
  addStory(details: StoryDetails, audio: Uint8Array, mimeType: string, seconds: number, recordedAt?: string, pictures: readonly StoryPicture[] = []): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const problems = storyProblems(details, this.people());
    if (problems.length > 0) return refuse(...problems);
    if (!(audio instanceof Uint8Array) || audio.length === 0) return refuse('Nothing was recorded. Record the story first.');
    if (audio.length > MAX_STORY_BYTES || seconds > MAX_STORY_MINUTES * 60) {
      return refuse(`That recording is too long for one story. Keep each one under ${MAX_STORY_MINUTES} minutes and tell it in parts.`);
    }
    if (!Number.isFinite(seconds) || seconds < 1) return refuse('That recording is too short to be a story.');
    if (!/^(audio|video)\/[a-z0-9.+-]+/i.test(mimeType)) return refuse('Echo did not recognise that kind of recording.');
    const pictureTrouble = pictureProblems(pictures);
    if (pictureTrouble.length > 0) return refuse(...pictureTrouble);

    const mediaId = writeMedia(archivePath, this.masterKey, audio);
    const stored = pictures.map((picture) => ({ mediaId: writeMedia(archivePath, this.masterKey!, picture.bytes), mimeType: picture.mimeType.split(';')[0]!.trim().toLowerCase() }));
    addStory(archivePath, this.masterKey, details, { mediaId, mimeType, seconds, recordedAt }, stored);
    this.record('story.recorded', { seconds: Math.round(seconds), forOnePerson: details.audience.kind === 'person', pictures: stored.length });
    return OK;
  }

  /** Changes a story's title, words or who it is for. */
  changeStory(id: string, details: StoryDetails): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const problems = storyProblems(details, this.people());
    if (problems.length > 0) return refuse(...problems);
    if (!changeStory(archivePath, this.masterKey, id, details)) return refuse('That story is no longer in your archive.');
    this.record('story.changed', { forOnePerson: details.audience.kind === 'person' });
    return OK;
  }

  storyAudio(id: string): Recording | null {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return null;
    const story = loadStories(archivePath, this.masterKey).find((candidate) => candidate.id === id);
    if (!story) return null;
    return { bytes: readMedia(archivePath, this.masterKey, story.mediaId), mimeType: story.mimeType };
  }

  /** One of a story's pictures, decrypted for showing. `index` counts from 0. */
  storyPicture(id: string, index: number): Recording | null {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return null;
    const picture = loadStories(archivePath, this.masterKey).find((candidate) => candidate.id === id)?.pictures?.[index];
    if (!picture) return null;
    return { bytes: readMedia(archivePath, this.masterKey, picture.mediaId), mimeType: picture.mimeType };
  }

  /** Removes a story, its sound and its pictures from the archive. Allowed even without consent. */
  removeStory(id: string): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    const removed = removeStory(archivePath, this.masterKey, id);
    if (!removed) return;
    removeMedia(archivePath, removed.mediaId);
    for (const picture of removed.pictures ?? []) removeMedia(archivePath, picture.mediaId);
    this.record('story.removed');
  }

  /** The memory times, what is put away, and when the next one is. `now` is for tests. */
  memoryTimes(now: Date = new Date()): MemoryTimesView {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return { schedule: NO_MEMORY_TIMES, retired: [], next: null, missed: null };
    const store = loadMemoryTimes(archivePath, this.masterKey);
    const times = [...this.stories().map((story) => story.recordedAt), ...store.retired.map((retired) => retired.at)].map((iso) => new Date(iso).getTime());
    const lastActivity = times.length > 0 ? new Date(Math.max(...times)) : null;
    return {
      schedule: store.schedule,
      retired: store.retired.map((retired) => retired.text),
      next: nextMemoryTime(store.schedule, now)?.toISOString() ?? null,
      missed: missedMemoryTime(store.schedule, lastActivity, now)?.toISOString() ?? null,
    };
  }

  setMemoryTimes(schedule: MemorySchedule): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const problems = scheduleProblems(schedule);
    if (problems.length > 0) return refuse(...problems);
    saveSchedule(archivePath, this.masterKey, schedule);
    this.record('memory-times.changed', { days: schedule.days.length, minutes: schedule.minutes });
    return OK;
  }

  /** "I don't remember": the question is put away and never suggested again. */
  retirePrompt(text: string, now: Date = new Date()): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (text.trim().length === 0 || text.length > 500) return refuse('There is no question to put away.');
    if (retirePrompt(archivePath, this.masterKey, text, now)) this.record('prompt.retired');
    return OK;
  }

  /** Brings back a question put away by mistake. */
  restorePrompt(text: string): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    if (restorePrompt(archivePath, this.masterKey, text)) this.record('prompt.restored');
  }

  consentStatus(): ConsentStatus {
    const archivePath = this.archivePath;
    const none: ConsentStatus = { state: 'none', fullName: null, wording: null, givenAt: null, withdrawnAt: null, seconds: null };
    if (!archivePath || !this.masterKey) return none;
    const record = loadConsent(archivePath, this.masterKey);
    if (!record.latest) return none;
    return {
      state: consentState(record),
      fullName: record.latest.fullName,
      wording: record.latest.wording,
      givenAt: record.latest.givenAt,
      withdrawnAt: record.withdrawnAt ?? null,
      seconds: record.latest.seconds,
    };
  }

  /**
   * True only while the person's recorded consent is in force. Every part of
   * Echo that captures anything must check this first.
   */
  captureAllowed(): boolean {
    return this.consentStatus().state === 'given';
  }

  /** The statement to read aloud, for this name, dated today. */
  consentWordingFor(fullName: string): string {
    return consentWording(fullName, new Date());
  }

  /** Saves the video of the statement being read, and the record that goes with it. */
  giveConsent(fullName: string, video: Uint8Array, mimeType: string, seconds: number): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const problems = nameProblems(fullName);
    if (problems.length > 0) return refuse(...problems);
    if (!(video instanceof Uint8Array) || video.length === 0) return refuse('Nothing was recorded. Record yourself reading the statement.');
    if (video.length > MAX_CONSENT_BYTES) return refuse('That recording is too long. Record just the statement.');
    if (!Number.isFinite(seconds) || seconds < this.minConsentSeconds) {
      return refuse(`That recording is too short to be the whole statement. Read all of it aloud. It takes about twenty seconds.`);
    }
    if (!/^(video|audio)\/[a-z0-9.+-]+/i.test(mimeType)) return refuse('Echo did not recognise that kind of recording.');

    const now = new Date();
    const record = loadConsent(archivePath, this.masterKey);
    const mediaId = writeMedia(archivePath, this.masterKey, video);
    const replaced = record.latest !== undefined;
    saveConsent(archivePath, this.masterKey, {
      latest: {
        fullName: fullName.trim(),
        wording: consentWording(fullName, now),
        givenAt: now.toISOString(),
        mediaId,
        mimeType,
        seconds: Math.round(seconds),
      },
      earlier: record.latest ? [...record.earlier, record.latest] : record.earlier,
    });
    this.record('consent.given', { seconds: Math.round(seconds), replacedEarlierConsent: replaced });
    return OK;
  }

  /** The saved consent recording, decrypted, for playing back. */
  consentVideo(): ConsentVideo | null {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return null;
    const latest = loadConsent(archivePath, this.masterKey).latest;
    if (!latest) return null;
    return { bytes: readMedia(archivePath, this.masterKey, latest.mediaId), mimeType: latest.mimeType };
  }

  /** Withdraws consent. Nothing more may be captured until consent is given again. */
  withdrawConsent(): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    const record = loadConsent(archivePath, this.masterKey);
    if (consentState(record) !== 'given') return;
    saveConsent(archivePath, this.masterKey, { ...record, withdrawnAt: new Date().toISOString() });
    this.record('consent.withdrawn');
    // Without consent nothing may speak for the person, so the assistant's store goes too.
    if (doorTurnedOnAt(this.doorFolder)) {
      closeDoor(this.doorFolder);
      this.record('door.off', { reason: 'consent withdrawn' });
    }
  }

  /**
   * Makes a fresh recovery code to show and print. It opens nothing until
   * `confirmRecoveryKit` succeeds, and is forgotten if Echo is locked or closed.
   */
  beginRecoveryKit(): RecoveryKit | null {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return null;
    const vault = readVault(archivePath);
    if (!vault) return null;
    const code = generateRecoveryCode();
    const groups = recoveryGroups(code);
    const first = 1 + Math.floor(Math.random() * groups.length);
    let second = 1 + Math.floor(Math.random() * (groups.length - 1));
    if (second >= first) second += 1;
    const challenge: [number, number] = first < second ? [first, second] : [second, first];
    this.pendingKit = { code, challenge };
    return {
      groups,
      createdAt: new Date().toISOString(),
      archivePath,
      archiveId: vault.archiveId.slice(0, 8).toUpperCase(),
      challenge,
    };
  }

  /** Proves the person holds the kit, then makes its code able to open the archive. */
  async confirmRecoveryKit(first: string, second: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey || !this.pendingKit) return refuse('Start the recovery kit again.');
    const groups = recoveryGroups(this.pendingKit.code);
    const [a, b] = this.pendingKit.challenge;
    if (normaliseGroup(first) !== groups[a - 1] || normaliseGroup(second) !== groups[b - 1]) {
      return refuse('Those do not match your kit. Check you are reading the right groups and try again.');
    }
    const replacing = hasRecoveryKit(archivePath);
    await setRecoveryCode(archivePath, this.masterKey, this.pendingKit.code, this.kdf);
    this.pendingKit = null;
    this.record('recovery-kit.created', { replacedEarlierKit: replacing });
    return OK;
  }

  lock(reason: 'asked' | 'app closed' = 'asked'): void {
    if (!this.masterKey) return;
    try {
      // The assistant's store is brought up to date one last time, while the archive can still be read.
      this.refreshDoor();
      this.record('archive.locked', { reason });
    } finally {
      // Whatever went wrong above, the key is wiped: locking must never depend on a disk write.
      this.masterKey.fill(0);
      this.masterKey = null;
      this.pendingImports.clear();
      this.forgetDownload();
      this.memoryCache = null;
      this.thirdPartyCache = null;
      this.pendingKit = null;
      this.needsNewPassphrase = false;
      void this.phoneInbox.stop();
    }
  }

  /** Starts the phone inbox if a phone is paired. A failure to listen never stops the archive opening. */
  private listenForPhones(): void {
    this.phoneInbox.sync().catch(() => this.record('phone.inbox-unavailable'));
  }

  /** Shows a one-time pairing code for the phone to scan. */
  startPhonePairing(): Promise<{ ok: true; offer: PairingOffer } | { ok: false; problems: string[] }> {
    return this.phoneInbox.startPairing();
  }

  cancelPhonePairing(): Promise<void> {
    return this.phoneInbox.cancelPairing();
  }

  phones(): PhoneSummary[] {
    return this.phoneInbox.phones();
  }

  unpairPhone(id: string): Promise<void> {
    return this.phoneInbox.unpair(id);
  }

  /** The port the phone inbox is listening on, or null. For tests and the settings screen. */
  get phoneInboxPort(): number | null {
    return this.phoneInbox.listeningOn;
  }

  /** A recording from a paired phone, with any pictures, becomes a story ready to be written down. */
  private fileStoryFromPhone(header: RecordingHeader, media: Buffer, pictures: { bytes: Buffer; mimeType: string }[]): ActionResult {
    const date = new Date(header.recordedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const prompt = header.prompt.trim();
    const title = prompt ? (prompt.length > 100 ? `${prompt.slice(0, 99)}…` : prompt) : `Shared from the phone, ${date}`;
    return this.addStory({ title, prompt, audience: EVERYONE, text: '' }, new Uint8Array(media), header.mimeType, header.seconds, new Date(header.recordedAt).toISOString(), pictures.map((picture) => ({ bytes: new Uint8Array(picture.bytes), mimeType: picture.mimeType })));
  }

  private get doorFolder(): string {
    return doorFolder(this.configFile);
  }

  /** What the assistant would be given if its store were written now: the person's own words and sheet lines marked for everyone. */
  private doorContents(memories: MemoryStore): DoorStore {
    const sharedKey = this.doorSharesAiKey() ? this.aiKey() : null;
    return {
      version: 1,
      writtenAt: new Date().toISOString(),
      owner: this.consentStatus().fullName ?? '',
      passages: doorPassages(memories.memories),
      characterSheet: doorLines(this.sheet('character').lines),
      styleProfile: doorLines(this.sheet('style').lines),
      // The AI key goes in only if the person chose to let the assistant's questions be paid for with it.
      ...(sharedKey ? { aiKey: sharedKey } : {}),
    };
  }

  /**
   * Rewrites the assistant's store from the archive as it stands. Does nothing
   * if the door is off, the archive is locked, or consent is not in force.
   */
  private refreshDoor(memories?: MemoryStore): void {
    if (this.refreshingDoor || !this.archivePath || !this.masterKey) return;
    if (!doorTurnedOnAt(this.doorFolder) || !this.captureAllowed()) return;
    this.refreshingDoor = true;
    try {
      writeDoorStore(this.doorFolder, this.doorContents(memories ?? this.memories()));
      // What the assistant did while nobody was looking goes into the activity log: when, what kind, how much. No words.
      for (const use of summariseDoorUses(takeDoorUses(this.doorFolder))) this.record('door.used', use);
      this.keepDoorConversations();
    } catch (error) {
      // Best effort: a full disk or a virus scanner's lock must not stop capturing, the Settings screen or locking.
      try {
        this.record('door.refresh_failed', { reason: error instanceof Error ? error.name : 'unknown' });
      } catch {
        // The audit line is a courtesy too; the disk that refused the store may refuse this.
      }
    } finally {
      this.refreshingDoor = false;
    }
  }

  private doorSharesAiKey(): boolean {
    if (!this.archivePath || !this.masterKey) return false;
    return loadSettings(this.archivePath, this.masterKey).door?.sharesAiKey === true;
  }

  /**
   * Copies the conversations the assistant has had with the echo into the
   * archive, so the person can read them and they are in every copy and
   * backup. The door's own copy stays where it is: the echo uses it to
   * remember what the assistant told it.
   */
  private keepDoorConversations(): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    const theirs = readDoorConversations(this.doorFolder);
    const chats = loadChats(archivePath, this.masterKey);
    const kept = chats[ASSISTANT_KEY] ?? [];
    const messages = (sessions: readonly { messages: unknown[] }[]) => sessions.reduce((total, session) => total + session.messages.length, 0);
    if (theirs.length === 0 || (theirs.length === kept.length && messages(theirs) === messages(kept))) return;
    saveChats(archivePath, this.masterKey, { ...chats, [ASSISTANT_KEY]: theirs });
  }

  /** The conversations the assistant has had with the echo, newest first, for the person to read. */
  doorConversations(): ChatSession[] {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return [];
    this.refreshDoor();
    return [...(loadChats(archivePath, this.masterKey)[ASSISTANT_KEY] ?? [])].reverse();
  }

  /**
   * Lets the assistant's questions to the echo be paid for with the person's
   * own AI key, or stops that. On, the key is written into the assistant's
   * store; off, it is taken out again.
   */
  setDoorSharesAiKey(shares: boolean): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (shares && !this.captureAllowed()) return refuse(NO_CONSENT);
    if (shares && !this.aiKey()) return refuse('There is no AI key saved to share. Add it above first.');
    const settings = loadSettings(archivePath, this.masterKey);
    saveSettings(archivePath, this.masterKey, { ...settings, door: { ...settings.door, sharesAiKey: shares } });
    this.record('door.ai_key', { shared: shares });
    this.refreshDoor();
    return OK;
  }

  /** Whether the assistant door is on, what is in its store, and what turning it on would share. */
  doorStatus(): DoorStatus {
    const folder = this.doorFolder;
    const turnedOnAt = doorTurnedOnAt(folder);
    const unlocked = Boolean(this.archivePath && this.masterKey);
    if (turnedOnAt && unlocked) this.refreshDoor();
    const store = turnedOnAt ? readDoorStore(folder) : null;
    const would = unlocked && this.captureAllowed() ? this.doorContents(this.memories()) : null;
    return {
      on: turnedOnAt !== null,
      folder,
      turnedOnAt,
      writtenAt: store?.writtenAt ?? null,
      passages: store?.passages.length ?? 0,
      sheetLines: store ? store.characterSheet.length + store.styleProfile.length : 0,
      wouldShare: would ? { passages: would.passages.length, sheetLines: would.characterSheet.length + would.styleProfile.length } : null,
      waiting: turnedOnAt ? readTray(folder).length : 0,
      sharesAiKey: this.doorSharesAiKey(),
      askedToday: turnedOnAt ? askedOn(folder, new Date().toISOString().slice(0, 10)) : 0,
      dailyQuestions: DOOR_DAILY_QUESTIONS,
    };
  }

  /**
   * Turns the assistant door on: makes a store with its own key beside Echo's
   * settings and fills it. Needs the archive open and consent in force. The
   * archive's key is never put there.
   */
  turnDoorOn(): ActionResult {
    if (!this.archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    if (doorTurnedOnAt(this.doorFolder)) return OK;
    try {
      openDoor(this.doorFolder);
      this.refreshDoor();
      this.record('door.on');
    } catch {
      return refuse(DOOR_FAILED);
    }
    return OK;
  }

  /** Turns the assistant door off and deletes its store and key. Always allowed, locked or not. */
  turnDoorOff(): ActionResult {
    if (!doorTurnedOnAt(this.doorFolder)) return OK;
    try {
      closeDoor(this.doorFolder);
      this.record('door.off', { reason: 'asked' });
    } catch {
      return refuse(DOOR_FAILED);
    }
    return OK;
  }

  /** What the assistant has left in the tray for the person to look at, oldest first. */
  doorTray(): TrayItem[] {
    if (!this.archivePath || !this.masterKey) return [];
    return readTray(this.doorFolder);
  }

  /** Throws away something the assistant left. Always allowed. */
  discardTrayItem(id: string): ActionResult {
    if (!this.archivePath || !this.masterKey) return refuse('Open the archive first.');
    const item = readTray(this.doorFolder).find((one) => one.id === id);
    if (!item || !removeTrayItem(this.doorFolder, id)) return refuse('That is no longer in the tray.');
    this.record('door.tray.discarded', { kind: item.kind });
    return OK;
  }

  /**
   * Opens a file the assistant pointed out, through the same import the
   * person would use themselves: nothing is kept until they have seen the
   * preview and saved it. The suggestion stays in the tray until thrown away.
   */
  async openTrayFile(id: string, service: TrayService): Promise<ImportChosen> {
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    if (!this.archivePath || !this.masterKey) return stop('Open the archive first.');
    if (!this.captureAllowed()) return stop(NO_CONSENT);
    const item = readTray(this.doorFolder).find((one) => one.id === id);
    if (!item || item.kind !== 'file') return stop('That is no longer in the tray.');
    if (!existsSync(item.path)) return stop(`The file your assistant pointed to is not there any more: ${item.path}`);
    this.record('door.tray.opened', { as: service });
    if (service === 'messenger') return this.chooseMessenger(item.path);
    if (service === 'discord') return this.chooseDiscord(item.path);
    if (service === 'email') return this.chooseEmail(item.path);
    return this.previewImport(item.path);
  }

  /**
   * Keeps a draft the assistant left, as the person's own words. They have
   * read it, put it right, and said it is theirs: only then does it leave the
   * tray and become something the echo may draw on.
   */
  approveTrayWords(id: string, details: NoteDetails): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    if (!this.captureAllowed()) return refuse(NO_CONSENT);
    const item = readTray(this.doorFolder).find((one) => one.id === id);
    if (!item || item.kind !== 'words') return refuse('That is no longer in the tray.');
    const problems = noteProblems(details, this.people());
    if (problems.length > 0) return refuse(...problems);
    addNote(archivePath, this.masterKey, details);
    removeTrayItem(this.doorFolder, id);
    this.record('door.tray.approved', { changedByOwner: details.text.trim() !== item.text.trim() });
    return OK;
  }

  /** The drafts from the assistant that the person has approved as their own, newest first. */
  notes(): Note[] {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return [];
    return loadNotes(archivePath, this.masterKey).reverse();
  }

  /** Removes an approved note from the archive. Allowed even without consent. */
  removeNote(id: string): void {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    if (removeNote(archivePath, this.masterKey, id)) this.record('note.removed');
  }

  /**
   * Writes a copy of everything in the archive into a new folder inside
   * `location`, in formats any computer can open. The copy is not encrypted.
   * Always allowed: what is in the archive is the person's to take.
   */
  async exportEverything(location: string): Promise<{ ok: true; folder: string; files: number } | { ok: false; problems: string[] }> {
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    const archivePath = this.archivePath;
    const masterKey = this.masterKey;
    if (!archivePath || !masterKey) return stop('Open the archive first.');
    const inside = (folder: string, parent: string) => !path.relative(parent, folder).startsWith('..') && !path.isAbsolute(path.relative(parent, folder));
    if (!existsSync(location)) return stop('That folder is not there any more. Choose another.');
    if (inside(path.resolve(location), path.resolve(archivePath))) return stop('Choose a folder outside your Echo archive.');

    let folder = path.join(location, exportFolderName(new Date()));
    for (let n = 2; existsSync(folder); n += 1) folder = path.join(location, `${exportFolderName(new Date())} (${n})`);
    let files = 0;
    const write = async (relative: string, contents: string | Uint8Array) => {
      const target = path.join(folder, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
      files += 1;
    };
    const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

    try {
      const people = this.people();
      const hears = (audience: Audience) => audienceLabel(audience, people);
      const nameOf = (id: string | null) => people.find((person) => person.id === id)?.name ?? '';
      await write('people.json', json(people));
      const { schedule, retired } = this.memoryTimes();
      await write('memory-times.json', json({ schedule, retired }));

      const consent = this.consentStatus();
      await write('consent/consent.json', json(consent));
      const consentVideo = this.consentVideo();
      if (consentVideo) await write(`consent/consent-recording.${extensionFor(consentVideo.mimeType)}`, consentVideo.bytes);

      const stories = this.stories();
      const storyName = namer();
      await write('stories/stories.json', json(stories));
      for (const [index, story] of stories.entries()) {
        const base = `${numbered(index, stories.length)} ${safeName(story.title, 'story')}`;
        await write(`stories/${storyName(base, 'txt')}`, textFile([['Title', story.title], ['Prompt', story.prompt], ['Recorded', story.recordedAt], ['Who may hear it', hears(story.audience)]], story.text));
        const audio = this.storyAudio(story.id);
        if (audio) await write(`stories/${storyName(base, extensionFor(audio.mimeType))}`, audio.bytes);
        for (let picture = 0; picture < story.pictures; picture += 1) {
          const shown = this.storyPicture(story.id, picture);
          if (shown) await write(`stories/${storyName(`${base} picture ${picture + 1}`, extensionFor(shown.mimeType))}`, shown.bytes);
        }
      }

      const interview = loadInterview(archivePath, masterKey);
      await write('interview/interview.json', json(interview));
      const spoken: string[] = [];
      for (const topic of INTERVIEW_TOPICS) {
        const exchanges = interview[topic.id]?.exchanges ?? [];
        if (exchanges.length === 0) continue;
        spoken.push(topic.title.toUpperCase(), '');
        for (const exchange of exchanges) spoken.push(`Q: ${exchange.question}`, `A: ${exchange.answer}`, `   (${exchange.answeredAt}; who may hear it: ${hears(exchange.audience ?? EVERYONE)})`, '');
      }
      await write('interview/interview.txt', textFile([], spoken.join('\n')));

      const advice = this.advice();
      const adviceName = namer();
      await write('advice/advice.json', json(advice));
      for (const [index, item] of advice.entries()) {
        const base = `${numbered(index, advice.length)} ${safeName(`${nameOf(item.personId) || 'someone'} - ${item.occasion}`, 'advice')}`;
        await write(`advice/${adviceName(base, 'txt')}`, textFile([['For', nameOf(item.personId)], ['Occasion', item.occasion], ['When it is shared', item.kind === 'on-the-day' ? 'On the day' : 'When they ask'], ['Date', item.date], ['Saved', item.savedAt]], item.text));
        const audio = this.adviceAudio(item.id);
        if (audio) await write(`advice/${adviceName(base, extensionFor(audio.mimeType))}`, audio.bytes);
      }

      const letters = this.letters().reverse(); // oldest first
      const letterName = namer();
      await write('letters/letters.json', json(letters));
      for (const [index, letter] of letters.entries()) {
        const base = `${numbered(index, letters.length)} ${safeName(letter.title, 'letter')}`;
        await write(`letters/${letterName(base, 'txt')}`, textFile([['Title', letter.title], ['To', nameOf(letter.personId)], ['Written', letter.writtenOn], ['Who may hear it', hears(letter.audience)], ['Saved', letter.savedAt]], letter.text));
        for (let page = 0; page < letter.pages; page += 1) {
          const picture = this.letterPage(letter.id, page);
          if (picture) await write(`letters/${letterName(`${base} page ${page + 1}`, extensionFor(picture.mimeType))}`, picture.bytes);
        }
      }

      const captures = this.captures();
      const captureName = namer();
      await write('face-and-voice/captures.json', json(captures));
      for (const [index, capture] of captures.entries()) {
        const contents = this.captureContents(capture.id);
        if (contents) await write(`face-and-voice/${captureName(`${numbered(index, captures.length)} ${safeName(`${capture.group} ${capture.label}`, 'capture')}`, extensionFor(contents.mimeType))}`, contents.bytes);
      }

      const imports = loadImports(archivePath, masterKey);
      const importName = namer();
      await write('messages/imports.json', json(imports));
      for (const [index, summary] of imports.entries()) {
        const messages = loadImportedMessages(archivePath, masterKey, summary.id);
        const base = `${numbered(index, imports.length)} ${safeName(`${SERVICE_NAMES[summary.service]} - ${summary.label}`, 'conversation')}`;
        await write(`messages/${importName(base, 'json')}`, json(messages));
        await write(`messages/${importName(base, 'txt')}`, textFile([['Conversation', summary.label], ['From', SERVICE_NAMES[summary.service]], ['You are', summary.me]], messages.map((message) => `[${message.at}] ${message.thirdParty ? '(theirs) ' : ''}${message.sender}: ${message.text}`).join('\n')));
      }

      const memories = this.memories();
      await write('echo/what-it-remembers.json', json(memories));
      await write('echo/character-sheet.json', json(this.sheet('character')));
      await write('echo/style-profile.json', json(this.sheet('style')));
      const chats = loadChats(archivePath, masterKey);
      await write('echo/conversations.json', json(chats));
      const said: string[] = [];
      for (const [listener, sessions] of Object.entries(chats)) {
        for (const session of sessions) {
          said.push(`CONVERSATION WITH ${(listener === 'owner' ? 'the owner, trying it out' : listener === ASSISTANT_KEY ? "the owner's AI assistant" : nameOf(listener) || 'someone no longer in the list').toUpperCase()}, STARTED ${session.startedAt}`, '');
          for (const message of session.messages) said.push(`${message.role === 'echo' ? 'Echo' : 'Them'}: ${message.text}`);
          said.push('');
        }
      }
      await write('echo/conversations.txt', textFile([], said.join('\n')));
      await write('echo/blind-tests.json', json(loadBlindTests(archivePath, masterKey)));
      await write('echo/approved-from-assistant.json', json(loadNotes(archivePath, masterKey)));

      await write('activity-log.json', json(readAudit(archivePath, masterKey)));
      await write(
        'README.txt',
        exportReadme(consent.fullName ?? '', new Date().toISOString().slice(0, 10), {
          People: people.length,
          Stories: stories.length,
          'Pieces of advice': advice.length,
          Letters: letters.length,
          'Face and voice recordings': captures.length,
          'Imported conversations': imports.length,
          'Memory passages': memories.memories.length,
          'Files in this copy': files + 1,
        }),
      );
    } catch (error) {
      return stop(`Echo could not finish the copy${error instanceof Error && 'code' in error && error.code === 'ENOSPC' ? ': that drive is full' : ''}. What was written so far is in ${folder}.`);
    }
    this.record('archive.exported', { files });
    return { ok: true, folder, files };
  }

  /** Deletes every conversation had with the echo, for every listener. Allowed even without consent. */
  deleteConversations(): ActionResult {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const sessions = Object.values(loadChats(archivePath, this.masterKey)).reduce((total, list) => total + list.length, 0);
    saveChats(archivePath, this.masterKey, {});
    // The assistant's own copy goes too, or it would be copied back in.
    clearDoorConversations(this.doorFolder);
    this.record('chats.deleted', { conversations: sessions });
    return OK;
  }

  /**
   * Deletes the whole archive from this computer, and its backup if asked.
   * The passphrase is asked for again, so that someone who finds Echo left
   * open cannot do this. There is no undo.
   */
  async deleteEverything(passphrase: string, alsoBackup: boolean): Promise<{ ok: true; backup: 'deleted' | 'kept' | 'none' | 'unreachable' } | { ok: false; problems: string[] }> {
    const stop = (problem: string) => ({ ok: false as const, problems: [problem] });
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return stop('Open the archive first.');
    try {
      (await unlockVault(archivePath, passphrase)).fill(0);
    } catch {
      return stop('That passphrase is not right. Nothing has been deleted.');
    }
    // Only ever a folder Echo made itself: named as Echo names it, with Echo's key file in it.
    if (path.basename(archivePath) !== ARCHIVE_FOLDER_NAME || !existsSync(path.join(archivePath, VAULT_FILENAME))) {
      return stop('Echo will not delete that folder: it does not look like an archive Echo made. Nothing has been deleted.');
    }
    const settings = loadSettings(archivePath, this.masterKey).backup;
    const backupFolder = settings ? backupDirIn(settings.location) : null;

    // The assistant's store goes first, so that nothing of the person's is left readable anywhere.
    closeDoor(this.doorFolder);
    this.lock();
    rmSync(archivePath, { recursive: true, force: true });
    saveConfig(this.configFile, {});

    let backup: 'deleted' | 'kept' | 'none' | 'unreachable' = 'none';
    if (backupFolder) {
      if (!alsoBackup) backup = 'kept';
      else if (!existsSync(backupFolder)) backup = 'unreachable';
      else {
        rmSync(backupFolder, { recursive: true, force: true });
        backup = 'deleted';
      }
    }
    return { ok: true, backup };
  }

  /** Brings the backup up to date, then locks. Used whenever the person locks or closes Echo. */
  async lockAfterBackup(reason: 'asked' | 'app closed' = 'asked'): Promise<void> {
    await this.backUpQuietly();
    this.lock(reason);
  }

  backupStatus(): BackupStatus {
    const archivePath = this.archivePath;
    const none: BackupStatus = { configured: false, folder: null, reachable: false, lastAt: null, lastFiles: null, problem: null };
    if (!archivePath || !this.masterKey) return none;
    const backup = loadSettings(archivePath, this.masterKey).backup;
    if (!backup) return none;
    return {
      configured: true,
      folder: backupDirIn(backup.location),
      reachable: existsSync(backup.location),
      lastAt: backup.lastAt ?? null,
      lastFiles: backup.lastFiles ?? null,
      problem: backup.lastProblem ?? null,
    };
  }

  /**
   * Makes the backup match the archive. Runs twice on purpose: recording that
   * a backup was made changes the archive, and the second pass copies that
   * record across so the backup is complete when this returns.
   */
  private async runBackup(location: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const remember = (outcome: { lastAt?: string; lastFiles?: number; lastProblem?: string }) => {
      if (!this.masterKey) return;
      const settings = loadSettings(archivePath, this.masterKey);
      const before = settings.backup?.location === location ? settings.backup : undefined;
      saveSettings(archivePath, this.masterKey, {
        ...settings,
        backup: {
          location,
          // A success clears any earlier problem. A failure keeps the last good time.
          lastAt: outcome.lastAt ?? before?.lastAt,
          lastFiles: outcome.lastFiles ?? before?.lastFiles,
          lastProblem: outcome.lastProblem,
        },
      });
    };

    const problems = backupLocationProblems(archivePath, location, this.allowBackupOnSameDrive);
    if (problems.length > 0) {
      remember({ lastProblem: problems[0]! });
      return refuse(...problems);
    }
    const backupDir = backupDirIn(location);
    try {
      const first = await backupArchive(archivePath, backupDir);
      remember({ lastAt: new Date().toISOString(), lastFiles: first.files });
      if (first.copied > 0) this.record('backup.made', { filesCopied: first.copied });
      const second = await backupArchive(archivePath, backupDir);
      return { ok: true, problems: [], note: `${second.files} files backed up to ${backupDir}` };
    } catch (error) {
      const problem = error instanceof Error ? error.message : 'The backup did not finish.';
      remember({ lastProblem: problem });
      this.record('backup.failed');
      return refuse(problem);
    }
  }

  /** Sets where the backup is kept and makes the first backup there. */
  async setBackupLocation(location: string): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const earlier = loadSettings(archivePath, this.masterKey).backup;
    const result = await this.runBackup(location);
    if (!result.ok && this.masterKey) {
      // A folder that cannot hold the backup does not replace the one already chosen.
      const settings = loadSettings(archivePath, this.masterKey);
      saveSettings(archivePath, this.masterKey, { ...settings, backup: earlier });
    }
    return result;
  }

  async backUpNow(): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const backup = loadSettings(archivePath, this.masterKey).backup;
    if (!backup) return refuse('Choose where to keep the backup first.');
    return this.runBackup(backup.location);
  }

  /** Backs up if a backup folder is set. Never throws and never blocks on a missing drive. */
  private async backUpQuietly(): Promise<void> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return;
    try {
      const backup = loadSettings(archivePath, this.masterKey).backup;
      if (backup) await this.runBackup(backup.location);
    } catch {
      // A backup that cannot run must never stop the archive from opening or locking.
    }
  }

  /** Compares every file in the archive with its copy in the backup. */
  async checkBackup(): Promise<ActionResult> {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return refuse('Open the archive first.');
    const backup = loadSettings(archivePath, this.masterKey).backup;
    if (!backup) return refuse('Choose where to keep the backup first.');
    if (!existsSync(backup.location)) return refuse(`Echo cannot find ${backup.location}. Plug the drive in and try again.`);
    const check = await checkBackup(archivePath, backupDirIn(backup.location));
    if (check.ok) return { ok: true, problems: [], note: `All ${check.files} files in your archive match their backup copies.` };
    return refuse(
      `${check.missing.length + check.different.length} of ${check.files} files are missing from the backup or do not match. Press "Back up now" and check again.`,
    );
  }

  /** Copies a backup onto this computer as a new archive, and points Echo at it. It stays locked. */
  async restoreFromBackup(backupFolder: string, location: string): Promise<ActionResult> {
    if (this.masterKey) return refuse('An archive is already open. Lock it first.');
    if (!location || !existsSync(location)) return refuse(`The folder ${location} does not exist.`);
    const source = [backupFolder, backupDirIn(backupFolder)].find((candidate) => {
      try {
        return readVault(candidate) !== null;
      } catch {
        return false;
      }
    });
    if (!source) return refuse(`There is no Echo backup in ${backupFolder}. Look for the folder named "Echo Backup".`);
    const archivePath = path.join(location, ARCHIVE_FOLDER_NAME);
    try {
      await restoreArchive(source, archivePath);
    } catch (error) {
      return refuse(error instanceof Error ? error.message : 'The backup could not be restored.');
    }
    saveConfig(this.configFile, { archivePath });
    return { ok: true, problems: [], note: archivePath };
  }

  recentActivity(): ActivityReport {
    const archivePath = this.archivePath;
    if (!archivePath || !this.masterKey) return { items: [], intact: true };
    const reading = readAudit(archivePath, this.masterKey);
    const items = reading.events
      .slice(-ACTIVITY_SHOWN)
      .reverse()
      .map(({ at, type, detail }) => ({ at, type, detail }));
    return { items, intact: reading.intact };
  }
}
