import { app, BrowserWindow, dialog, ipcMain, session as electronSession, shell } from 'electron';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ActionResult } from '../shared/api.ts';
import type { CaptureGroup } from '../shared/capture-guides.ts';
import type { Audience, PersonDetails } from '../shared/people.ts';
import type { AdviceDetails } from '../shared/advice.ts';
import type { LetterDetails } from '../shared/letters.ts';
import { TRAY_SERVICES } from '../shared/door.ts';
import type { PairVerdict } from '../shared/blind-test.ts';
import type { ImportChoice } from '../shared/imports.ts';
import type { MemoryChange } from '../shared/memories.ts';
import type { Listener } from '../shared/persona.ts';
import type { SheetKind, SheetLineChange } from '../shared/sheets.ts';
import type { StoryDetails } from '../shared/stories.ts';
import type { MemorySchedule, SessionMinutes, Weekday } from '../shared/memory-times.ts';
import { ArchiveSession } from './archive-session.ts';
import { runSmokeCheck, smokeInterviewer, smokeKeyCheck, writeSmokeChat, writeSmokeDiscord, writeSmokeIphoneBackup, writeSmokeMailbox, writeSmokeMessenger } from './smoke.ts';
import { Transcription } from './transcription.ts';

const SMOKE = process.argv.includes('--smoke');

// The automated check must never touch a real person's settings or archive,
// so it gets a throwaway settings folder and a throwaway place for the archive.
const smokeFolder = SMOKE ? mkdtempSync(path.join(tmpdir(), 'echo-smoke-')) : null;
if (smokeFolder) {
  app.setPath('userData', path.join(smokeFolder, 'settings'));
  // The machines that run the check have no camera. These give the page a
  // moving test pattern and a tone in place of one, so real recording runs.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  // Where the checks provide a spoken recording, it plays as the microphone,
  // so speech-to-text is tested on real words.
  if (process.env.ECHO_SPEECH_WAV) app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.ECHO_SPEECH_WAV);
}
// A folder that stands in for the external drive during the check.
const smokeDrive = smokeFolder ? path.join(smokeFolder, 'usb-drive') : null;
if (smokeDrive) mkdirSync(smokeDrive, { recursive: true });
const smokeExport = smokeFolder ? path.join(smokeFolder, 'exports') : null;
if (smokeExport) mkdirSync(smokeExport, { recursive: true });
// In the automated check, the chat that would be picked in the file window.
const smokeChat = smokeFolder ? writeSmokeChat(smokeFolder) : null;
const smokeMessenger = smokeFolder ? writeSmokeMessenger(smokeFolder) : null;
const smokeDiscord = smokeFolder ? writeSmokeDiscord(smokeFolder) : null;
const smokeMailbox = smokeFolder ? writeSmokeMailbox(smokeFolder) : null;
// In the automated check, the folder where iPhone backups are looked for, holding one small backup.
const smokeBackups = smokeFolder ? writeSmokeIphoneBackup(smokeFolder) : null;

let session: ArchiveSession;
let transcription: Transcription;
let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 720,
    minHeight: 560,
    show: !SMOKE,
    title: 'Echo',
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The check runs with the window hidden; recording must not slow down because of it.
      backgroundThrottling: !SMOKE,
    },
  });

  win.removeMenu();

  // Echo never opens web pages inside its own window. Links go to the
  // person's browser; everything else is refused.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Whatever the screen sends is treated as untrusted and rebuilt field by field. */
function personDetails(value: unknown): PersonDetails {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    name: text(given.name),
    relationship: text(given.relationship),
    callsMe: text(given.callsMe),
    mayTalkToEcho: given.mayTalkToEcho === true,
  };
}

function audience(value: unknown): Audience {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return given.kind === 'person' && typeof given.personId === 'string' ? { kind: 'person', personId: given.personId } : { kind: 'everyone' };
}

function listener(value: unknown): Listener {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return given.kind === 'person' ? { kind: 'person', personId: text(given.personId) } : { kind: 'owner' };
}

function pairVerdict(value: unknown): PairVerdict {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return { pick: given.pick === 'right' ? 'right' : 'left', leftScore: number(given.leftScore), rightScore: number(given.rightScore) };
}

function importChoice(value: unknown): ImportChoice {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    me: text(given.me),
    label: text(given.label),
    personId: typeof given.personId === 'string' && given.personId.length > 0 ? given.personId : null,
    audience: given.audience === null || given.audience === undefined ? null : audience(given.audience),
  };
}

function sheetKind(value: unknown): SheetKind {
  return value === 'style' ? 'style' : 'character';
}

function sheetLineChange(value: unknown): SheetLineChange {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    ...(typeof given.text === 'string' ? { text: given.text } : {}),
    ...(given.checked === true ? { checked: true as const } : {}),
  };
}

function memoryChange(value: unknown): MemoryChange {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    ...(typeof given.words === 'string' ? { words: given.words } : {}),
    ...(given.audience !== undefined ? { audience: audience(given.audience) } : {}),
    ...(typeof given.leftOut === 'boolean' ? { leftOut: given.leftOut } : {}),
    ...(given.held === false ? { held: false as const } : {}),
  };
}

function adviceDetails(value: unknown): AdviceDetails {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    personId: text(given.personId),
    occasion: text(given.occasion),
    kind: given.kind === 'on-the-day' ? 'on-the-day' : 'when-asked',
    date: text(given.date),
    text: text(given.text),
  };
}

function letterDetails(value: unknown): LetterDetails {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    title: text(given.title),
    personId: typeof given.personId === 'string' && given.personId.length > 0 ? given.personId : null,
    writtenOn: text(given.writtenOn),
    text: text(given.text),
    audience: audience(given.audience),
    mine: given.mine === true,
    checked: given.checked === true,
  };
}

function letterPages(value: unknown): { bytes: Uint8Array; mimeType: string }[] {
  if (!Array.isArray(value)) return [];
  return value.map((page: unknown) => {
    const given = (typeof page === 'object' && page !== null ? page : {}) as Record<string, unknown>;
    return { bytes: given.bytes instanceof Uint8Array ? given.bytes : new Uint8Array(0), mimeType: text(given.mimeType) };
  });
}

/** Rebuilt field by field; anything odd is left for `scheduleProblems` to refuse. */
function memorySchedule(value: unknown): MemorySchedule {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const days = Array.isArray(given.days) ? given.days.filter((day): day is number => typeof day === 'number') : [];
  return { days: days as Weekday[], time: text(given.time), minutes: (typeof given.minutes === 'number' ? given.minutes : 0) as SessionMinutes };
}

function storyDetails(value: unknown): StoryDetails {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return { title: text(given.title), prompt: text(given.prompt), audience: audience(given.audience), text: text(given.text) };
}

const bytes = (value: unknown): Uint8Array => (value instanceof Uint8Array ? value : new Uint8Array(0));
const number = (value: unknown): number => (typeof value === 'number' ? value : 0);

async function pickFolder(title: string): Promise<string | null> {
  if (!mainWindow) return null;
  const picked = await dialog.showOpenDialog(mainWindow, { title, properties: ['openDirectory', 'createDirectory'] });
  return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]!;
}

// The page has print styles that leave only the recovery kit on the paper.
function printKit(): Promise<ActionResult> {
  return new Promise((resolve) => {
    if (!mainWindow) return resolve({ ok: false, problems: ['Echo has no window to print from.'] });
    mainWindow.webContents.print({ printBackground: true }, (success, failureReason) => {
      if (success) resolve({ ok: true, problems: [] });
      else if (!failureReason || /cancel/i.test(failureReason)) resolve({ ok: false, problems: [] });
      else resolve({ ok: false, problems: [`The kit did not print: ${failureReason}. Check the printer, or save it as a PDF and print that.`] });
    });
  });
}

async function saveKitPdf(): Promise<ActionResult> {
  if (!mainWindow) return { ok: false, problems: ['Echo has no window to save from.'] };
  let target: string;
  if (smokeFolder) {
    target = path.join(smokeFolder, 'Echo recovery kit.pdf');
  } else {
    const chosen = await dialog.showSaveDialog(mainWindow, {
      title: 'Save your recovery kit',
      defaultPath: path.join(app.getPath('desktop'), 'Echo recovery kit.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (chosen.canceled || !chosen.filePath) return { ok: false, problems: [] };
    target = chosen.filePath;
  }
  try {
    writeFileSync(target, await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }));
  } catch {
    return { ok: false, problems: [`Echo could not save the kit to ${target}. Choose another place.`] };
  }
  return { ok: true, problems: [], note: target };
}

function registerHandlers(): void {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('archive:status', () => session.status());
  ipcMain.handle('archive:suggestedLocation', () => smokeFolder ?? app.getPath('documents'));
  ipcMain.handle('archive:chooseLocation', () => pickFolder('Choose where to keep your Echo archive'));
  ipcMain.handle('archive:create', (_event, location: unknown, passphrase: unknown, confirmation: unknown) =>
    session.create(text(location), text(passphrase), text(confirmation)),
  );
  ipcMain.handle('archive:findExisting', async () => {
    const folder = await pickFolder('Find your Echo archive folder');
    return folder ? session.useExisting(folder) : { ok: false, problems: [] };
  });
  ipcMain.handle('archive:unlock', (_event, passphrase: unknown) => session.unlock(text(passphrase)));
  ipcMain.handle('archive:lock', () => session.lockAfterBackup('asked'));
  ipcMain.handle('archive:restoreFromBackup', async () => {
    const folder = smokeDrive ?? (await pickFolder('Find your Echo backup folder'));
    if (!folder) return { ok: false, problems: [] };
    return session.restoreFromBackup(folder, smokeFolder ?? app.getPath('documents'));
  });

  ipcMain.handle('backup:status', () => session.backupStatus());
  ipcMain.handle('backup:chooseLocation', async () => {
    const folder = smokeDrive ?? (await pickFolder('Choose a folder on another drive for your backup'));
    return folder ? session.setBackupLocation(folder) : { ok: false, problems: [] };
  });
  ipcMain.handle('backup:backUpNow', () => session.backUpNow());
  ipcMain.handle('backup:check', () => session.checkBackup());
  ipcMain.handle('archive:recentActivity', () => session.recentActivity());
  ipcMain.handle('archive:unlockWithRecoveryCode', (_event, code: unknown) => session.unlockWithRecoveryCode(text(code)));
  ipcMain.handle('archive:setNewPassphrase', (_event, passphrase: unknown, confirmation: unknown) =>
    session.setNewPassphrase(text(passphrase), text(confirmation)),
  );

  ipcMain.handle('settings:aiKeyStatus', () => session.aiKeyStatus());
  ipcMain.handle('settings:testAndSaveAiKey', (_event, key: unknown) => session.testAndSaveAiKey(text(key)));
  ipcMain.handle('settings:removeAiKey', () => session.removeAiKey());
  ipcMain.handle('settings:changePassphrase', (_event, current: unknown, next: unknown, confirmation: unknown) =>
    session.changePassphrase(text(current), text(next), text(confirmation)),
  );
  ipcMain.handle('settings:exportEverything', async () => {
    const folder = smokeExport ?? (await pickFolder('Choose where to put the copy of your archive'));
    return folder ? session.exportEverything(folder) : { ok: false, problems: [] };
  });
  ipcMain.handle('settings:deleteConversations', () => session.deleteConversations());
  ipcMain.handle('settings:doorStatus', () => session.doorStatus());
  ipcMain.handle('settings:turnDoorOn', () => session.turnDoorOn());
  ipcMain.handle('settings:turnDoorOff', () => session.turnDoorOff());
  // Installed, the command sits beside Echo.exe. Run from the source, it is the built script, run with Node.
  const doorScript = app.isPackaged ? path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'dist', 'core', 'door-cli.js') : path.join(__dirname, '..', 'core', 'door-cli.js');
  ipcMain.handle('settings:doorCommand', () => (app.isPackaged ? `"${path.join(path.dirname(process.execPath), 'echo-door.cmd')}"` : `node "${doorScript}"`));
  // As an MCP server the script is started directly on the Node inside Echo, because many assistants cannot start a .cmd file.
  ipcMain.handle('settings:doorMcpSettings', () =>
    JSON.stringify(
      { mcpServers: { echo: app.isPackaged ? { command: process.execPath, args: [doorScript, 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } } : { command: 'node', args: [doorScript, 'mcp'] } } },
      null,
      2,
    ),
  );
  ipcMain.handle('settings:deleteEverything', (_event, passphrase: unknown, alsoBackup: unknown) => session.deleteEverything(text(passphrase), alsoBackup === true));

  ipcMain.handle('people:list', () => session.people());
  ipcMain.handle('people:add', (_event, details: unknown) => session.addPerson(personDetails(details)));
  ipcMain.handle('people:change', (_event, id: unknown, details: unknown) => session.changePerson(text(id), personDetails(details)));
  ipcMain.handle('people:remove', (_event, id: unknown) => session.removePerson(text(id)));

  ipcMain.handle('transcription:ready', () => transcription.ready());
  ipcMain.handle('transcription:prepare', () => transcription.prepare());
  ipcMain.handle('transcription:transcribe', (_event, samples: unknown) =>
    samples instanceof Float32Array
      ? transcription.transcribe(samples)
      : { ok: false, problems: ['Echo was not given any sound to write down.'] },
  );

  ipcMain.handle('interview:state', () => session.interview());
  ipcMain.handle('interview:answer', (_event, topicId: unknown, answer: unknown, audio: unknown, mimeType: unknown) =>
    session.answerInterview(text(topicId), text(answer), audio instanceof Uint8Array ? audio : null, text(mimeType)),
  );
  ipcMain.handle('interview:another', (_event, topicId: unknown) => session.anotherQuestion(text(topicId)));
  ipcMain.handle('interview:retry', (_event, topicId: unknown) => session.retryInterview(text(topicId)));
  ipcMain.handle('interview:setDone', (_event, topicId: unknown, done: unknown) => session.setInterviewDone(text(topicId), done === true));
  ipcMain.handle('interview:setAudience', (_event, topicId: unknown, index: unknown, who: unknown) =>
    session.setInterviewAudience(text(topicId), number(index), audience(who)),
  );

  ipcMain.handle('advice:list', () => session.advice());
  ipcMain.handle('advice:add', (_event, details: unknown, audio: unknown, mimeType: unknown) =>
    session.addAdvice(adviceDetails(details), audio instanceof Uint8Array ? audio : null, text(mimeType)),
  );
  ipcMain.handle('advice:change', (_event, id: unknown, details: unknown) => session.changeAdvice(text(id), adviceDetails(details)));
  ipcMain.handle('advice:audio', (_event, id: unknown) => session.adviceAudio(text(id)));
  ipcMain.handle('advice:remove', (_event, id: unknown) => session.removeAdvice(text(id)));
  ipcMain.handle('letters:list', () => session.letters());
  ipcMain.handle('letters:readPage', (_event, picture: unknown, mimeType: unknown) =>
    session.readLetterPage(picture instanceof Uint8Array ? picture : new Uint8Array(0), text(mimeType)),
  );
  ipcMain.handle('letters:add', (_event, details: unknown, pages: unknown) => session.addLetter(letterDetails(details), letterPages(pages)));
  ipcMain.handle('letters:change', (_event, id: unknown, details: unknown) => session.changeLetter(text(id), letterDetails(details)));
  ipcMain.handle('letters:page', (_event, id: unknown, page: unknown) => session.letterPage(text(id), typeof page === 'number' ? page : 0));
  ipcMain.handle('letters:remove', (_event, id: unknown) => session.removeLetter(text(id)));
  ipcMain.handle('door:tray', () => session.doorTray());
  ipcMain.handle('door:discard', (_event, id: unknown) => session.discardTrayItem(text(id)));
  ipcMain.handle('door:openFile', (_event, id: unknown, service: unknown) => {
    const as = TRAY_SERVICES.find((one) => one === service);
    return as ? session.openTrayFile(text(id), as) : { ok: false, problems: ['Choose what kind of file it is.'] };
  });
  ipcMain.handle('door:approveWords', (_event, id: unknown, details: unknown) => {
    const given = (typeof details === 'object' && details !== null ? details : {}) as Record<string, unknown>;
    return session.approveTrayWords(text(id), { title: text(given.title), text: text(given.text), audience: audience(given.audience), mine: given.mine === true });
  });
  ipcMain.handle('door:notes', () => session.notes());
  ipcMain.handle('door:removeNote', (_event, id: unknown) => session.removeNote(text(id)));
  ipcMain.handle('door:conversations', () => session.doorConversations());
  ipcMain.handle('door:shareAiKey', (_event, shares: unknown) => session.setDoorSharesAiKey(shares === true));

  ipcMain.handle('memories:list', () => session.memories());
  ipcMain.handle('memories:change', (_event, id: unknown, change: unknown) => session.changeMemory(text(id), memoryChange(change)));

  ipcMain.handle('sheets:get', (_event, kind: unknown) => session.sheet(sheetKind(kind)));
  ipcMain.handle('sheets:draft', (_event, kind: unknown) => session.draftSheet(sheetKind(kind)));
  ipcMain.handle('sheets:change', (_event, kind: unknown, id: unknown, change: unknown) =>
    session.changeSheetLine(sheetKind(kind), text(id), sheetLineChange(change)),
  );
  ipcMain.handle('sheets:remove', (_event, kind: unknown, id: unknown) => session.removeSheetLine(sheetKind(kind), text(id)));
  ipcMain.handle('sheets:add', (_event, kind: unknown, section: unknown, words: unknown, who: unknown) =>
    session.addSheetLine(sheetKind(kind), text(section), text(words), audience(who)),
  );

  ipcMain.handle('chat:view', (_event, who: unknown) => session.chat(listener(who)));
  ipcMain.handle('chat:start', (_event, who: unknown) => session.startChat(listener(who)));
  ipcMain.handle('chat:say', (_event, who: unknown, said: unknown) => session.sayToEcho(listener(who), text(said)));
  ipcMain.handle('chat:retry', (_event, who: unknown) => session.retryEcho(listener(who)));

  ipcMain.handle('blindTest:view', () => session.blindTest());
  ipcMain.handle('blindTest:start', () => session.startBlindTest());
  ipcMain.handle('blindTest:saveAnswer', (_event, index: unknown, answer: unknown) => session.saveBlindAnswer(number(index), text(answer)));
  ipcMain.handle('blindTest:echoNext', () => session.blindEchoNext());
  ipcMain.handle('blindTest:pair', (_event, who: unknown) => session.blindPair(listener(who)));
  ipcMain.handle('blindTest:judge', (_event, who: unknown, verdict: unknown) => session.judgeBlindPair(listener(who), pairVerdict(verdict)));

  ipcMain.handle('imports:list', () => session.imports());
  ipcMain.handle('imports:choose', async (_event, service: unknown) => {
    const kind = service === 'messenger' || service === 'discord' || service === 'email' ? service : 'whatsapp';
    const picker = {
      whatsapp: { smoke: smokeChat, title: 'Choose a WhatsApp chat you exported', filter: { name: 'WhatsApp export', extensions: ['zip', 'txt'] } },
      messenger: { smoke: smokeMessenger, title: 'Choose the file you downloaded from Messenger or Facebook', filter: { name: 'Messenger download', extensions: ['zip', 'json'] } },
      discord: { smoke: smokeDiscord, title: 'Choose the data package you downloaded from Discord', filter: { name: 'Discord data package', extensions: ['zip', 'json', 'csv'] } },
      email: { smoke: smokeMailbox, title: 'Choose a mailbox file', filter: { name: 'Mailbox file', extensions: ['mbox'] } },
    }[kind];
    let file = picker.smoke;
    if (!file) {
      if (!mainWindow) return { ok: false, problems: [] };
      const picked = await dialog.showOpenDialog(mainWindow, { title: picker.title, properties: ['openFile'], filters: [picker.filter, { name: 'All files', extensions: ['*'] }] });
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false, problems: [] };
      file = picked.filePaths[0] ?? null;
    }
    if (!file) return { ok: false, problems: [] };
    if (kind === 'email') return session.chooseEmail(file);
    return kind === 'messenger' ? session.chooseMessenger(file) : kind === 'discord' ? session.chooseDiscord(file) : session.previewImport(file);
  });
  ipcMain.handle('imports:openThread', (_event, key: unknown) => session.openImportThread(text(key)));
  ipcMain.handle('imports:emailAddresses', (_event, mine: unknown) =>
    session.chooseEmailAddresses(Array.isArray(mine) ? mine.filter((address): address is string => typeof address === 'string') : []),
  );
  ipcMain.handle('imports:iphoneBackups', () => session.iphoneBackups());
  ipcMain.handle('imports:chooseBackup', async (_event, folder: unknown, password: unknown) => {
    const chosen = typeof folder === 'string' && folder.length > 0 ? folder : await pickFolder('Choose your iPhone backup folder');
    return chosen ? session.chooseIphoneBackup(chosen, typeof password === 'string' && password.length > 0 ? password : undefined) : { ok: false, problems: [] };
  });
  ipcMain.handle('imports:confirm', (_event, token: unknown, choice: unknown) => session.confirmImport(text(token), importChoice(choice)));
  ipcMain.handle('imports:messages', (_event, id: unknown, offset: unknown, limit: unknown) => session.importMessages(text(id), number(offset), number(limit)));
  ipcMain.handle('imports:remove', (_event, id: unknown) => session.removeImport(text(id)));

  ipcMain.handle('captures:list', () => session.captures());
  ipcMain.handle('captures:add', (_event, group: unknown, label: unknown, contents: unknown, mimeType: unknown, seconds: unknown) =>
    session.addCapture(text(group) as CaptureGroup, text(label), bytes(contents), text(mimeType), number(seconds)),
  );
  ipcMain.handle('captures:contents', (_event, id: unknown) => session.captureContents(text(id)));
  ipcMain.handle('captures:remove', (_event, id: unknown) => session.removeCapture(text(id)));

  ipcMain.handle('stories:list', () => session.stories());
  ipcMain.handle('stories:add', (_event, details: unknown, audio: unknown, mimeType: unknown, seconds: unknown) =>
    session.addStory(storyDetails(details), bytes(audio), text(mimeType), number(seconds)),
  );
  ipcMain.handle('stories:change', (_event, id: unknown, details: unknown) => session.changeStory(text(id), storyDetails(details)));
  ipcMain.handle('stories:audio', (_event, id: unknown) => session.storyAudio(text(id)));
  ipcMain.handle('stories:picture', (_event, id: unknown, index: unknown) => session.storyPicture(text(id), Math.trunc(number(index))));
  ipcMain.handle('stories:remove', (_event, id: unknown) => session.removeStory(text(id)));

  ipcMain.handle('phones:pair', () => session.startPhonePairing());
  ipcMain.handle('phones:cancel-pairing', () => session.cancelPhonePairing());
  ipcMain.handle('phones:list', () => session.phones());
  ipcMain.handle('phones:unpair', (_event, id: unknown) => session.unpairPhone(text(id)));

  ipcMain.handle('memory-times:view', () => session.memoryTimes());
  ipcMain.handle('memory-times:set', (_event, schedule: unknown) => session.setMemoryTimes(memorySchedule(schedule)));
  ipcMain.handle('memory-times:retire', (_event, prompt: unknown) => session.retirePrompt(text(prompt)));
  ipcMain.handle('memory-times:restore', (_event, prompt: unknown) => session.restorePrompt(text(prompt)));

  ipcMain.handle('consent:status', () => session.consentStatus());
  ipcMain.handle('consent:wording', (_event, fullName: unknown) => session.consentWordingFor(text(fullName)));
  ipcMain.handle('consent:give', (_event, fullName: unknown, video: unknown, mimeType: unknown, seconds: unknown) =>
    session.giveConsent(
      text(fullName),
      video instanceof Uint8Array ? video : new Uint8Array(0),
      text(mimeType),
      typeof seconds === 'number' ? seconds : 0,
    ),
  );
  ipcMain.handle('consent:video', () => session.consentVideo());
  ipcMain.handle('consent:withdraw', () => session.withdrawConsent());

  ipcMain.handle('recoveryKit:begin', () => session.beginRecoveryKit());
  ipcMain.handle('recoveryKit:confirm', (_event, first: unknown, second: unknown) =>
    session.confirmRecoveryKit(text(first), text(second)),
  );
  ipcMain.handle('recoveryKit:print', printKit);
  ipcMain.handle('recoveryKit:savePdf', saveKitPdf);
}

void app.whenReady().then(() => {
  session = new ArchiveSession(
    path.join(app.getPath('userData'), 'config.json'),
    // The automated check has no real key and must not depend on the internet,
    // so it uses a stand-in for Anthropic. The real check is tested separately.
    SMOKE ? { checkKey: smokeKeyCheck, minConsentSeconds: 1, allowBackupOnSameDrive: true, minFaceVideoSeconds: 2, ask: smokeInterviewer, ...(smokeBackups ? { backupRoots: [smokeBackups] } : {}) } : {},
  );

  // The speech-to-text model is not secret and is kept outside the archive, so
  // it is downloaded once per computer and never backed up.
  transcription = new Transcription(process.env.ECHO_MODEL_DIR ?? path.join(app.getPath('userData'), 'models'), (progress) =>
    mainWindow?.webContents.send('transcription:download', progress),
  );

  // The only thing Echo's own page may ask the computer for is the camera
  // and microphone. Everything else is refused.
  electronSession.defaultSession.setPermissionRequestHandler((_contents, permission, allow) => allow(permission === 'media'));
  electronSession.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'media');
  registerHandlers();
  mainWindow = createWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (SMOKE && smokeFolder) void runSmokeCheck(mainWindow, smokeFolder);
});

// Closing the app always brings the backup up to date, then locks the archive
// and says so in the audit trail. Quitting waits for that to finish.
let readyToQuit = false;
app.on('before-quit', (event) => {
  if (readyToQuit || !session) return;
  event.preventDefault();
  void session
    .lockAfterBackup('app closed')
    .catch(() => session.lock('app closed'))
    .finally(() => {
      readyToQuit = true;
      app.quit();
    });
});
app.on('window-all-closed', () => app.quit());
