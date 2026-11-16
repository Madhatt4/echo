import type { Capture, CaptureGroup } from './capture-guides.ts';
import type { Advice, AdviceDetails } from './advice.ts';
import type { Letter, LetterDetails } from './letters.ts';
import type { DoorStatus, TrayItem, TrayService } from './door.ts';
import type { Note, NoteDetails } from './notes.ts';
import type { BlindPair, BlindTestView, PairVerdict } from './blind-test.ts';
import type { ChatView, ChatSession } from './chat.ts';
import type { Listener } from './persona.ts';
import type { ImportChoice, ImportChosen, ImportService, ImportSummary, ImportedMessage } from './imports.ts';
import type { InterviewState } from './interview.ts';
import type { IphoneBackup } from './iphone.ts';
import type { MemoryChange, MemoryStore } from './memories.ts';
import type { Audience, Person, PersonDetails } from './people.ts';
import type { SheetKind, SheetLineChange, SheetView } from './sheets.ts';
import type { Story, StoryDetails } from './stories.ts';
import type { MemorySchedule, MemoryTimesView } from './memory-times.ts';

/** What the screen shows while pairing: the QR code's text and when it stops working. */
export interface PairingOffer {
  code: string;
  /** The code drawn as a QR image, an SVG data URL ready for an <img>. */
  qr: string;
  expiresAt: string;
}

/** A paired phone, as the screen shows it. */
export interface PhoneSummary {
  id: string;
  name: string;
  pairedAt: string;
}

// The complete list of things the screen may ask the app to do. The screen has
// no other way to reach files, keys or the network.

export type ArchiveState =
  /** No archive has been set up on this computer. */
  | 'none'
  /** An archive was set up, but its folder cannot be found (for example an unplugged drive). */
  | 'missing'
  | 'locked'
  | 'unlocked';

export interface ArchiveStatus {
  state: ArchiveState;
  /** Full path of the archive folder, when one is known. */
  archivePath: string | null;
  /** True once a recovery kit has been made and proven. */
  recoveryKit: boolean;
  /** True after opening with the recovery kit, until a new passphrase is set. */
  needsNewPassphrase: boolean;
}

export type ConsentState = 'none' | 'given' | 'withdrawn';

export interface ConsentStatus {
  state: ConsentState;
  fullName: string | null;
  /** The exact statement that was read aloud. */
  wording: string | null;
  givenAt: string | null;
  withdrawnAt: string | null;
  seconds: number | null;
}

export interface ConsentVideo {
  bytes: Uint8Array;
  mimeType: string;
}

/** A decrypted recording, for playing back. */
export interface Recording {
  bytes: Uint8Array;
  mimeType: string;
}

/** What is printed on the recovery kit. */
export interface RecoveryKit {
  /** The recovery code in its printed groups. */
  groups: string[];
  createdAt: string;
  archivePath: string;
  /** Short identifier that ties this kit to one archive. */
  archiveId: string;
  /** Which two groups (counting from 1) the person is asked to type back. */
  challenge: [number, number];
}

export interface ActionResult {
  ok: boolean;
  /** Plain-English reasons, shown to the person as written. Empty when ok. */
  problems: string[];
  /** Something worth telling the person when it worked, such as where a file was saved. */
  note?: string;
}

export type ActivityDetail = Record<string, string | number | boolean>;

export interface ActivityItem {
  at: string;
  type: string;
  detail: ActivityDetail;
}

export interface ActivityReport {
  /** Newest first. */
  items: ActivityItem[];
  /** False if the record has been altered or damaged since it was written. */
  intact: boolean;
}

export interface BackupStatus {
  /** True once a backup folder has been chosen. */
  configured: boolean;
  /** Full path of the backup folder, when one is chosen. */
  folder: string | null;
  /** False when the drive holding the backup is not plugged in. */
  reachable: boolean;
  lastAt: string | null;
  lastFiles: number | null;
  /** Why the most recent attempt failed. Null when it worked. */
  problem: string | null;
}

/** How far the one-off download of the speech-to-text model has got. */
export interface ModelDownload {
  percent: number;
  loadedBytes: number;
  totalBytes: number;
}

export interface AiKeyStatus {
  saved: boolean;
  /** The last four characters of the saved key, so the person can tell which one it is. */
  ending: string | null;
  /** When the saved key last passed a live test. */
  testedAt: string | null;
}

export interface EchoApi {
  version(): Promise<string>;
  archive: {
    status(): Promise<ArchiveStatus>;
    /** The folder Echo suggests keeping the archive in. */
    suggestedLocation(): Promise<string>;
    /** Opens a folder picker. Resolves to null if the person cancels. */
    chooseLocation(): Promise<string | null>;
    create(location: string, passphrase: string, confirmation: string): Promise<ActionResult>;
    /** Opens a folder picker to point Echo at an archive that already exists. */
    findExisting(): Promise<ActionResult>;
    unlock(passphrase: string): Promise<ActionResult>;
    unlockWithRecoveryCode(code: string): Promise<ActionResult>;
    /** Sets a new passphrase after opening with the recovery kit. */
    setNewPassphrase(passphrase: string, confirmation: string): Promise<ActionResult>;
    lock(): Promise<void>;
    /** Opens a folder picker for a backup, and restores it onto this computer. */
    restoreFromBackup(): Promise<ActionResult>;
    recentActivity(): Promise<ActivityReport>;
  };
  settings: {
    aiKeyStatus(): Promise<AiKeyStatus>;
    /** Asks Anthropic whether the key is valid, and saves it only if it is. */
    testAndSaveAiKey(key: string): Promise<ActionResult>;
    removeAiKey(): Promise<void>;
    changePassphrase(current: string, next: string, confirmation: string): Promise<ActionResult>;
    /**
     * Opens a folder picker, then writes a copy of everything in the archive there, in formats any computer
     * can open. The copy is not encrypted. Gives back the folder it made.
     */
    exportEverything(): Promise<{ ok: true; folder: string; files: number } | { ok: false; problems: string[] }>;
    /** Deletes every conversation had with the echo. */
    deleteConversations(): Promise<ActionResult>;
    /** The assistant door: whether it is on, what its store holds, and what turning it on would share. */
    doorStatus(): Promise<DoorStatus>;
    /** Turns the assistant door on. Refused unless consent is in force. */
    turnDoorOn(): Promise<ActionResult>;
    /** Turns the assistant door off and deletes its store and key. */
    turnDoorOff(): Promise<ActionResult>;
    /** The command the assistant runs to use the door, as it is on this computer. */
    doorCommand(): Promise<string>;
    /** The settings block that adds the door to an assistant as an MCP server, as it is on this computer. */
    doorMcpSettings(): Promise<string>;
    /** Deletes the whole archive from this computer, and its backup if asked. The passphrase is asked for again. There is no undo. */
    deleteEverything(passphrase: string, alsoBackup: boolean): Promise<{ ok: true; backup: 'deleted' | 'kept' | 'none' | 'unreachable' } | { ok: false; problems: string[] }>;
  };
  backup: {
    status(): Promise<BackupStatus>;
    /** Opens a folder picker, then makes the first backup there. */
    chooseLocation(): Promise<ActionResult>;
    backUpNow(): Promise<ActionResult>;
    /** Compares every file in the archive with its backup copy. */
    check(): Promise<ActionResult>;
  };
  people: {
    list(): Promise<Person[]>;
    add(details: PersonDetails): Promise<ActionResult>;
    change(id: string, details: PersonDetails): Promise<ActionResult>;
    remove(id: string): Promise<void>;
  };
  transcription: {
    /** True if the speech-to-text model is already on this computer. */
    ready(): Promise<boolean>;
    /** Downloads the model if needed and gets it ready. */
    prepare(): Promise<ActionResult>;
    /** Turns sound (one channel, 16,000 samples a second) into words, returned in `note`. */
    transcribe(samples: Float32Array): Promise<ActionResult>;
    /** Calls back as the model downloads. Returns a function that stops the calls. */
    onDownload(listener: (progress: ModelDownload) => void): () => void;
  };
  interview: {
    state(): Promise<InterviewState>;
    /**
     * Saves an answer to the question that is waiting, then asks the
     * interviewer for the next one. `audio` is the recording of a spoken answer.
     */
    answer(topicId: string, text: string, audio: Uint8Array | null, mimeType: string): Promise<ActionResult>;
    /** Skips the question that is waiting and asks for a different one. */
    another(topicId: string): Promise<ActionResult>;
    /** Asks again for the next question, after a failure. */
    retry(topicId: string): Promise<ActionResult>;
    /** Marks a topic as finished, or opens a finished one again. */
    setDone(topicId: string, done: boolean): Promise<ActionResult>;
    /** Changes who may hear one answer. `index` counts the answers in the topic from 0. */
    setAudience(topicId: string, index: number, audience: Audience): Promise<ActionResult>;
  };
  advice: {
    list(): Promise<Advice[]>;
    /** Saves new advice. `audio` is the recording when it was spoken. Refused unless consent is in force. */
    add(details: AdviceDetails, audio: Uint8Array | null, mimeType: string): Promise<ActionResult>;
    change(id: string, details: AdviceDetails): Promise<ActionResult>;
    /** The recording of spoken advice, for playing back. Null when it was typed. */
    audio(id: string): Promise<Recording | null>;
    remove(id: string): Promise<void>;
  };
  /** The tray the person's assistant leaves things in, and what the person has approved from it. */
  door: {
    tray(): Promise<TrayItem[]>;
    discard(id: string): Promise<ActionResult>;
    /** Opens a file the assistant pointed out, through the normal import and its preview. */
    openFile(id: string, service: TrayService): Promise<ImportChosen>;
    /** Keeps a draft the assistant left, as the person's own words. Refused unless they tick that it is theirs. */
    approveWords(id: string, details: NoteDetails): Promise<ActionResult>;
    notes(): Promise<Note[]>;
    removeNote(id: string): Promise<void>;
    /** The conversations the assistant has had with the echo, newest first. */
    conversations(): Promise<ChatSession[]>;
    /** Lets the assistant's questions to the echo be paid for with the person's own AI key, or stops that. */
    shareAiKey(shares: boolean): Promise<ActionResult>;
  };
  letters: {
    list(): Promise<Letter[]>;
    /**
     * Sends a picture of one page to the AI service, under the person's own key, to have its words read.
     * Nothing is saved. Refused unless consent is in force.
     */
    readPage(picture: Uint8Array, mimeType: string): Promise<{ ok: true; text: string } | { ok: false; problems: string[] }>;
    /** Saves a letter the person wrote, with the pictures of its pages. Refused unless consent is in force. */
    add(details: LetterDetails, pages: { bytes: Uint8Array; mimeType: string }[]): Promise<ActionResult>;
    change(id: string, details: LetterDetails): Promise<ActionResult>;
    /** The picture of one page of a saved letter, counting from 0. */
    page(id: string, page: number): Promise<Recording | null>;
    remove(id: string): Promise<void>;
  };
  memories: {
    /** Brings the memory store up to date with what has been captured, then returns it. */
    list(): Promise<MemoryStore>;
    /** Corrects a passage's words, changes who may hear it, leaves it out or puts it back. */
    change(id: string, change: MemoryChange): Promise<ActionResult>;
  };
  sheets: {
    /** The character sheet or the style profile, with what stands behind each line. */
    get(kind: SheetKind): Promise<SheetView>;
    /** Asks Claude to draft it from the person's passages. Lines the person wrote or confirmed are kept. */
    draft(kind: SheetKind): Promise<ActionResult>;
    change(kind: SheetKind, id: string, change: SheetLineChange): Promise<ActionResult>;
    /** Strikes a line out. A drafted line that is struck out is not suggested again. */
    remove(kind: SheetKind, id: string): Promise<ActionResult>;
    /** Adds a line in the person's own words. */
    add(kind: SheetKind, section: string, text: string, audience: Audience): Promise<ActionResult>;
  };
  chat: {
    /** The current conversation with this listener. Starts one, with its opening line, if there is none. */
    view(listener: Listener): Promise<ChatView>;
    /** Starts a new conversation. Earlier ones are kept as what this listener has told the echo before. */
    start(listener: Listener): Promise<ActionResult>;
    /** Says something to the echo and waits for its checked reply. What was said is saved first. */
    say(listener: Listener, text: string): Promise<ActionResult>;
    /** Asks again for a reply that failed. */
    retry(listener: Listener): Promise<ActionResult>;
  };
  blindTest: {
    view(): Promise<BlindTestView>;
    /** Starts a new test with the twenty questions. An earlier test is kept. */
    start(): Promise<ActionResult>;
    /** Saves the person's own answer to one question. These answers are never given to the echo. */
    saveAnswer(index: number, text: string): Promise<ActionResult>;
    /** Has the echo answer the next question it has not answered. `remaining` is how many are left after it. */
    echoNext(): Promise<ActionResult & { remaining: number }>;
    /** The next pair for this judge, with no labels. Null when they have finished. Starts their run if needed. */
    pair(judge: Listener): Promise<BlindPair | null>;
    judge(judge: Listener, verdict: PairVerdict): Promise<ActionResult>;
  };
  imports: {
    list(): Promise<ImportSummary[]>;
    /**
     * Lets the person pick a file they exported from this service and reads it
     * on this computer. Gives back one conversation to check, or, for a
     * download that holds many, the list to pick from. Nothing is saved yet.
     */
    choose(service: ImportService): Promise<ImportChosen>;
    /** Opens one conversation from the list a download or backup gave. */
    openThread(key: string): Promise<ImportChosen>;
    /** Says which addresses in the mailbox just read are the owner's. Gives back who they wrote to. */
    emailAddresses(mine: string[]): Promise<ImportChosen>;
    /** The iPhone backups Echo can find on this computer, newest first. */
    iphoneBackups(): Promise<IphoneBackup[]>;
    /**
     * Reads the conversations in an iPhone backup. With no folder given, the
     * person picks one. An encrypted backup needs its password, which is used
     * to unlock it and is never stored.
     */
    chooseBackup(folder: string | null, password?: string): Promise<ImportChosen>;
    /** Saves the conversation that was previewed, with the person's choices. */
    confirm(token: string, choice: ImportChoice): Promise<ActionResult>;
    /** A page of one conversation, oldest first. */
    messages(id: string, offset: number, limit: number): Promise<{ messages: ImportedMessage[]; total: number }>;
    remove(id: string): Promise<void>;
  };
  captures: {
    /** Every face and voice master recording, without its contents. */
    list(): Promise<Capture[]>;
    /** Saves a photo, video or voice recording. Refused unless consent is in force. */
    add(group: CaptureGroup, label: string, contents: Uint8Array, mimeType: string, seconds: number): Promise<ActionResult>;
    /** The recording itself, for showing or playing back. Null when there is none. */
    contents(id: string): Promise<Recording | null>;
    remove(id: string): Promise<void>;
  };
  stories: {
    list(): Promise<Story[]>;
    /** Saves a new story with its sound. Refused unless consent is in force. */
    add(details: StoryDetails, audio: Uint8Array, mimeType: string, seconds: number): Promise<ActionResult>;
    change(id: string, details: StoryDetails): Promise<ActionResult>;
    /** The story's sound, or its video, for playing back. Null when there is none. */
    audio(id: string): Promise<Recording | null>;
    /** One of the story's pictures, counting from 0. Null when there is no such picture. */
    picture(id: string, index: number): Promise<Recording | null>;
    remove(id: string): Promise<void>;
  };
  phones: {
    /** Shows a one-time code for the phone to scan. It stops working after ten minutes or once used. */
    pair(): Promise<{ ok: true; offer: PairingOffer } | { ok: false; problems: string[] }>;
    cancelPairing(): Promise<void>;
    list(): Promise<PhoneSummary[]>;
    /** Unpairs a phone. Anything it still holds can no longer be sent here. */
    unpair(id: string): Promise<void>;
  };
  memoryTimes: {
    view(): Promise<MemoryTimesView>;
    /** Saves the days, time and length. No days turns memory times off. */
    set(schedule: MemorySchedule): Promise<ActionResult>;
    /** "I don't remember": puts the question away for good. */
    retire(prompt: string): Promise<ActionResult>;
    /** Brings back a question put away by mistake. */
    restore(prompt: string): Promise<void>;
  };
  consent: {
    status(): Promise<ConsentStatus>;
    /** The statement to read aloud, with this name and today's date filled in. */
    wording(fullName: string): Promise<string>;
    /** Saves the recording of the statement being read. Capture is allowed from then on. */
    give(fullName: string, video: Uint8Array, mimeType: string, seconds: number): Promise<ActionResult>;
    /** The saved recording, for playing back. Null when there is none. */
    video(): Promise<ConsentVideo | null>;
    /** Withdraws consent. Capture stops being allowed straight away. */
    withdraw(): Promise<void>;
  };
  recoveryKit: {
    /** Makes a fresh recovery code. It does not work until `confirm` succeeds. */
    begin(): Promise<RecoveryKit | null>;
    print(): Promise<ActionResult>;
    savePdf(): Promise<ActionResult>;
    /** Proves the person has the kit by typing back the two groups asked for. */
    confirm(first: string, second: string): Promise<ActionResult>;
  };
}
