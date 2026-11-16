// `electron . --smoke` drives the real screens the way a person would and
// exits 0 only if every step behaved. The automated checks run it on every
// pull request, on Windows, against a throwaway folder.

import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SMS_FILE, backupFileName } from '../core/iphone.ts';
import { cryptoSelfCheck } from '../core/iphone-encrypted.ts';
import { suggestFile, suggestWords } from '../core/door-commands.ts';
import { askTheEcho } from '../core/door-ask.ts';
import type { ClaudeAnswer, ClaudeRequest, KeyCheck } from '../core/anthropic.ts';

const STEP_TIMEOUT_MS = 20_000;
const FIRST_PASSPHRASE = 'smoke test passphrase 2026';
const SECOND_PASSPHRASE = 'a different smoke passphrase';
const THIRD_PASSPHRASE = 'yet another smoke passphrase';
const GOOD_KEY = 'sk-ant-smoke-accepted-key';

/** Writes a small WhatsApp export, as an iPhone makes it, for the automated check to import. Returns its path. */
export function writeSmokeChat(folder: string): string {
  const file = path.join(folder, 'WhatsApp Chat - Smoke Daughter.txt');
  const lines = [
    '[11/12/2025, 18:03:11] Smoke Daughter: \u200eMessages and calls are end-to-end encrypted.',
    '[13/12/2025, 09:15:02] Smoke Daughter: Morning Pops, I have something private to tell you about the surprise party',
    '[13/12/2025, 09:16:40] Smoke Owner: Morning love, I always said the allotment was the best place to think',
    '[13/12/2025, 09:16:55] Smoke Owner: Ring me later',
    '[13/12/2025, 09:17:05] Smoke Daughter: \u200eimage omitted',
    '[13/12/2025, 21:05:59] Smoke Owner: Proud of you, always was',
  ];
  writeFileSync(file, `${lines.join('\r\n')}\r\n`, 'utf8');
  return file;
}

/** Writes one Messenger conversation, in the layout of Meta's standard export, for the automated check. Returns its path. */
export function writeSmokeMessenger(folder: string): string {
  const file = path.join(folder, 'message_1.json');
  // Older exports write accented letters as their UTF-8 bytes one by one. "\u00c3\u00a9" is how they write "\u00e9".
  const thread = {
    participants: [{ name: 'Smoke Son' }, { name: 'Smoke Owner' }],
    messages: [
      { sender_name: 'Smoke Owner', timestamp_ms: 1765617420000, content: 'Meet me at the caf\u00c3\u00a9 by the station at noon', type: 'Generic' },
      { sender_name: 'Smoke Son', timestamp_ms: 1765617360000, photos: [{ uri: 'photos/1.jpg' }], type: 'Generic' },
      { sender_name: 'Smoke Son', timestamp_ms: 1765617300000, content: 'Dad, please keep the news about my new job between us for now', type: 'Generic' },
    ],
    title: 'Smoke Son',
    thread_path: 'inbox/smokeson_1',
  };
  writeFileSync(file, JSON.stringify(thread), 'utf8');
  return file;
}

/**
 * Writes a small mailbox file as Gmail's export lays one out, for the automated
 * check: two emails the owner sent, and one sent to them. The owner's reply
 * quotes the other person's email underneath, in both its plain and HTML forms.
 */
export function writeSmokeMailbox(folder: string): string {
  const file = path.join(folder, 'Sent.mbox');
  const emails = [
    [
      'From 1@smoke Sat Dec 13 09:00:00 +0000 2025',
      'X-Gmail-Labels: Sent',
      'From: Smoke Owner <owner@example.com>',
      'To: Smoke Niece <niece@example.com>',
      'Subject: The allotment keys',
      'Date: Sat, 13 Dec 2025 09:00:00 +0000',
      'Message-ID: <1@example.com>',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'The spare keys are under the blue pot by the shed door.',
      '',
      '-- ',
      'Sent with a signature nobody needs to keep',
      '',
    ],
    [
      'From 2@smoke Sat Dec 13 09:30:00 +0000 2025',
      'X-Gmail-Labels: Inbox',
      'From: Smoke Niece <niece@example.com>',
      'To: owner@example.com',
      'Subject: Re: The allotment keys',
      'Date: Sat, 13 Dec 2025 09:30:00 +0000',
      'Message-ID: <2@example.com>',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Thanks Dad, I never would have found them on my own.',
      '',
    ],
    [
      'From 3@smoke Sat Dec 13 10:00:00 +0000 2025',
      'X-Gmail-Labels: Sent',
      'From: Smoke Owner <owner@example.com>',
      'To: Smoke Niece <niece@example.com>',
      'Subject: Re: The allotment keys',
      'In-Reply-To: <2@example.com>',
      'Date: Sat, 13 Dec 2025 10:00:00 +0000',
      'Message-ID: <3@example.com>',
      'Content-Type: multipart/alternative; boundary="smoke-boundary"',
      '',
      '--smoke-boundary',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Lock up after yourself and put them back in the caf=C3=A9 tin.',
      '',
      'On Sat, 13 Dec 2025 at 09:30, Smoke Niece <niece@example.com> wrote:',
      '> Thanks Dad, I never would have found them on my own.',
      '--smoke-boundary',
      'Content-Type: text/html; charset="UTF-8"',
      '',
      '<div>Lock up after yourself.</div><blockquote>Thanks Dad, I never would have found them on my own.</blockquote>',
      '--smoke-boundary--',
      '',
    ],
  ];
  writeFileSync(file, emails.map((lines) => lines.join('\r\n')).join('\r\n'), 'latin1');
  return file;
}

/** Writes one channel's messages file from a Discord data package, newest first, for the automated check. Returns its path. */
export function writeSmokeDiscord(folder: string): string {
  const channel = path.join(folder, 'discord', 'messages', 'c40000000000000001');
  mkdirSync(channel, { recursive: true });
  const file = path.join(channel, 'messages.json');
  const messages = [
    { ID: '1000000000000000003', Timestamp: '2025-12-13 09:20:00', Contents: '', Attachments: 'https://cdn.example/photo.png' },
    { ID: '1000000000000000002', Timestamp: '2025-12-13 09:16:30', Contents: 'bring the long drill bits too <:thumbsup:123456789012345678>', Attachments: '' },
    { ID: '1000000000000000001', Timestamp: '2025-12-13 09:15:00', Contents: '<@123456789012345678> the shed roof needs felting before winter', Attachments: '' },
  ];
  writeFileSync(file, JSON.stringify(messages), 'utf8');
  return file;
}

/**
 * Writes a small iPhone backup, laid out as Apple lays one out, for the
 * automated check. Returns the folder backups are looked for in. Building it
 * here also proves the app can read and write SQLite on its own.
 */
export function writeSmokeIphoneBackup(folder: string): string {
  const root = path.join(folder, 'MobileSync', 'Backup');
  const backup = path.join(root, '00008030-SMOKE');
  const name = backupFileName(SMS_FILE);
  mkdirSync(path.join(backup, name.slice(0, 2)), { recursive: true });
  writeFileSync(path.join(backup, 'Manifest.db'), 'not read by the check');
  writeFileSync(
    path.join(backup, 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n<key>Device Name</key>\n<string>Smoke iPhone</string>\n<key>Last Backup Date</key>\n<date>2026-11-10T08:00:00Z</date>\n</dict></plist>\n',
  );
  const sms = new DatabaseSync(path.join(backup, name.slice(0, 2), name));
  sms.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, handle_id INTEGER, date INTEGER, is_from_me INTEGER, associated_message_type INTEGER DEFAULT 0);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    INSERT INTO handle VALUES (1, '+447700900999');
    INSERT INTO chat VALUES (1, '+447700900999', '');
  `);
  // Newer iPhones leave the plain text empty and pack the words into a block, after the marker "NSString".
  const words = Buffer.from('I will bring the ladder round on Saturday morning', 'utf8');
  const block = Buffer.concat([Buffer.from('\u0004\u000bstreamtyped', 'latin1'), Buffer.from('NSString', 'latin1'), Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b, words.length]), words, Buffer.from([0x86])]);
  const at = (minutes: number) => BigInt(787_310_100 + minutes * 60) * 1_000_000_000n; // billionths of a second since the start of 2001
  const add = sms.prepare('INSERT INTO message (text, attributedBody, handle_id, date, is_from_me) VALUES (?, ?, ?, ?, ?)');
  add.run('Can you lend me your ladder, and please do not tell Mum why', null, 1, at(0), 0);
  add.run(null, block, 0, at(1), 1);
  add.run('\ufffc', null, 1, at(2), 0);
  sms.exec('INSERT INTO chat_message_join VALUES (1, 1), (1, 2), (1, 3)');
  sms.close();
  return root;
}

/**
 * Stands in for Claude as the interviewer during the automated check. It asks
 * two follow-up questions that quote the last answer, then finishes the topic.
 */
export async function smokeInterviewer(_key: string, request: ClaudeRequest): Promise<ClaudeAnswer> {
  // Reading a page of a letter: the picture must have been sent, made small, as a JPEG. One word comes back unread.
  if (request.system.includes('You are reading a letter')) {
    const picture = request.picture;
    if (!picture || picture.mimeType !== 'image/jpeg' || picture.base64.length < 1000) return { ok: false, problem: 'Smoke: no picture of the page was sent.' };
    return { ok: true, model: 'smoke', text: 'My dear girl,\n\nThe [?] in the hall is yours when I am gone.\n\nAll my love, Pops' };
  }
  // The checker: a draft that mentions 1994 claims a memory no passage holds.
  if (request.system.includes('You are the checker')) {
    const draft = (request.messages[0]?.content ?? '').split('DRAFT REPLY TO CHECK').at(-1) ?? '';
    return { ok: true, model: 'smoke', text: draft.includes('1994') ? '{"ok": false, "problems": ["Smoke: Wales in 1994 is in no passage."]}' : '{"ok": true, "problems": []}' };
  }
  // The echo: invents a memory when asked about Wales, and puts it right when told the draft was thrown away.
  if (request.system.includes('You are the AI echo of')) {
    const last = request.messages.at(-1)?.content ?? '';
    if (last.includes('NOT shown to them')) return { ok: true, model: 'smoke', text: '{"reply": "Smoke: I never got round to telling Echo about Wales.", "passages": []}' };
    if (last.includes('Wales')) return { ok: true, model: 'smoke', text: '{"reply": "Smoke: we went to Wales in 1994 and it rained.", "passages": []}' };
    return { ok: true, model: 'smoke', text: '{"reply": "Smoke: I remember that well.", "passages": [1]}' };
  }
  // A request to draft the character sheet or style profile. The answer holds one good line for each kind of
  // draft, and three lines that must be dropped: an unknown section, a passage that was never sent, and no passage.
  if (request.system.includes('{"lines": [')) {
    const lines = [
      { section: 'values', text: 'Smoke: I say what I think.', passages: [1] },
      { section: 'voice', text: 'Smoke: I talk plainly.', passages: [1] },
      { section: 'people', text: 'Smoke: I am gentler with her.', passages: [1] },
      { section: 'nonsense', text: 'Smoke: an unknown section.', passages: [1] },
      { section: 'values', text: 'Smoke: rests on a passage that was never sent.', passages: [99] },
      { section: 'values', text: 'Smoke: rests on nothing.', passages: [] },
    ];
    return { ok: true, model: 'smoke', text: JSON.stringify({ lines }) };
  }
  const answers = request.messages.filter((message) => message.role === 'user').slice(1);
  const last = answers.at(-1)?.content ?? '';
  if (last.startsWith('(They would rather not')) {
    return { ok: true, model: 'smoke', text: JSON.stringify({ done: false, question: 'Smoke: a different question instead?' }) };
  }
  if (answers.length >= 3) return { ok: true, model: 'smoke', text: JSON.stringify({ done: true, question: '' }) };
  return { ok: true, model: 'smoke', text: JSON.stringify({ done: false, question: `Smoke follow-up ${answers.length}: you said "${last}". Why?` }) };
}

/** Stands in for Anthropic during the automated check, which has no real key. */
export async function smokeKeyCheck(key: string): Promise<KeyCheck> {
  return key === GOOD_KEY ? { ok: true } : { ok: false, problem: 'Anthropic did not accept this key.' };
}

// Small helpers that run inside the page.
const PAGE_HELPERS = `
  // What was on the screen when a wait gave up, so a failure says why and not only where.
  const smokeSeen = () => {
    const screen = document.querySelector('[data-screen]');
    const problems = document.querySelector('[data-problems]');
    return ' (screen: ' + (screen ? screen.getAttribute('data-screen') + ' ' + (screen.getAttribute('data-mode') || '') : 'none')
      + '; problems shown: ' + (problems ? problems.textContent : 'none') + ')';
  };
  window.__smoke = {
    waitFor(selector, ms) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (document.querySelector(selector)) return resolve(true);
          if (Date.now() - started > ms) return reject(new Error('timed out waiting for ' + selector + smokeSeen()));
          setTimeout(tick, 50);
        };
        tick();
      });
    },
    type(selector, value) {
      const input = document.querySelector(selector);
      if (!input) throw new Error('no field ' + selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    click(selector) {
      const button = document.querySelector(selector);
      if (!button) throw new Error('no button ' + selector);
      // A click on a greyed-out button does nothing, and the wait after it would time out with no reason given.
      if (button.disabled) throw new Error('the button ' + selector + ' was greyed out' + smokeSeen());
      button.click();
    },
    count(selector) {
      return document.querySelectorAll(selector).length;
    },
    waitForText(selector, text, ms) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          const found = document.querySelector(selector);
          if (found && found.textContent.includes(text)) return resolve(true);
          if (Date.now() - started > ms) return reject(new Error('timed out waiting for "' + text + '" in ' + selector + smokeSeen()));
          setTimeout(tick, 50);
        };
        tick();
      });
    },
  };
  true; // the page must hand back something simple, not the helpers themselves
`;

export async function runSmokeCheck(win: BrowserWindow, smokeFolder: string): Promise<void> {
  const page = <T>(script: string): Promise<T> => win.webContents.executeJavaScript(script) as Promise<T>;
  const waitFor = (selector: string) => page(`window.__smoke.waitFor(${JSON.stringify(selector)}, ${STEP_TIMEOUT_MS})`);
  const type = (selector: string, value: string) => page(`window.__smoke.type(${JSON.stringify(selector)}, ${JSON.stringify(value)})`);
  const click = (selector: string) => page(`window.__smoke.click(${JSON.stringify(selector)})`);
  const count = (selector: string) => page<number>(`window.__smoke.count(${JSON.stringify(selector)})`);
  const waitForText = (selector: string, text: string) =>
    page(`window.__smoke.waitForText(${JSON.stringify(selector)}, ${JSON.stringify(text)}, ${STEP_TIMEOUT_MS})`);
  const pageLoaded = () =>
    new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', () => resolve());
      win.webContents.once('did-fail-load', (_e, code, description) => reject(new Error(`page failed to load (${code} ${description})`)));
    });
  /** Where the assistant's store was put, once the door has been turned on. */
  let doorFolderPath = '';
  const attribute = (selector: string, name: string) =>
    page<string | null>(`document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`);
  const expect = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const step = (message: string) => console.log(`SMOKE: ${message}`);

  const overall = setTimeout(() => {
    console.error('SMOKE FAIL: the whole check took too long');
    app.exit(1);
  }, 900_000);

  try {
    await pageLoaded();
    await page(PAGE_HELPERS);

    // A fresh computer shows setup, not the home screen.
    await waitFor('[data-screen="create-archive"]');
    step('create-archive screen shown on first run');
    // The cryptography used to open an encrypted iPhone backup must give the published answers inside the app itself.
    const cryptoProblem = await cryptoSelfCheck();
    expect(cryptoProblem === null, `encrypted-backup cryptography: ${cryptoProblem}`);
    step('key unwrapping matches the published test vector inside the app');

    // A weak passphrase is refused.
    await type('#passphrase', 'short');
    await type('#passphrase-confirm', 'short');
    await click('[data-action="create"]');
    await waitFor('[data-problems]');
    expect((await count('[data-screen="create-archive"]')) === 1, 'a weak passphrase got past setup');
    step('weak passphrase refused');

    // A good passphrase creates the archive. The recovery kit comes next, not the home screen.
    await type('#passphrase', FIRST_PASSPHRASE);
    await type('#passphrase-confirm', FIRST_PASSPHRASE);
    await click('[data-action="create"]');
    await waitFor('[data-screen="recovery-kit"][data-stage="show"]');
    expect((await count('[data-tile]')) === 0, 'the home screen was reachable before the recovery kit');
    const printed = await attribute('[data-kit-code]', 'data-kit-code');
    expect(typeof printed === 'string' && /^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/.test(printed), `the kit shows no usable code (${printed})`);
    const groups = (printed as string).split('-');
    step('archive created, recovery kit shown before anything else');

    // The kit can be saved as a real PDF.
    await click('[data-action="kit-pdf"]');
    await waitFor('[data-kit-saved]');
    const pdf = readFileSync(path.join(smokeFolder, 'Echo recovery kit.pdf'));
    expect(pdf.length > 1000 && pdf.subarray(0, 4).toString('latin1') === '%PDF', 'the saved kit is not a PDF');
    step(`kit saved as a PDF (${pdf.length} bytes)`);

    // Moving on hides the code, and the wrong groups are refused.
    await click('[data-action="kit-next"]');
    await waitFor('[data-screen="recovery-kit"][data-stage="prove"]');
    expect((await count('[data-kit-code]')) === 0, 'the code is still on screen while being asked for');
    const wrongGroup = groups[0] === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
    await type('#kit-group-a', wrongGroup);
    await type('#kit-group-b', wrongGroup);
    await click('[data-action="kit-confirm"]');
    await waitFor('[data-problems]');
    expect((await count('[data-screen="recovery-kit"]')) === 1, 'wrong groups were accepted as proof');
    step('wrong groups refused as proof');

    // The right two groups confirm the kit and open the home screen.
    const a = Number(await attribute('[data-challenge-a]', 'data-challenge-a'));
    const b = Number(await attribute('[data-challenge-b]', 'data-challenge-b'));
    expect(a >= 1 && b >= 1 && a !== b && a <= 6 && b <= 6, `the kit asked for groups ${a} and ${b}`);
    await type('#kit-group-a', groups[a - 1]!.toLowerCase());
    await type('#kit-group-b', groups[b - 1]!);
    await click('[data-action="kit-confirm"]');
    await waitFor('[data-screen="home"]');
    expect((await count('[data-tile]')) === 10, 'the home screen did not draw ten tiles');
    step(`kit confirmed with groups ${a} and ${b}, home screen drew 10 tiles`);

    // Setup opens from its tile. A rejected AI key is not saved; an accepted one is.
    expect((await attribute('[data-setup-status]', 'data-setup-status')) !== null, 'the setup tile has no status');
    await click('[data-action="open-setup"]');
    await waitFor('[data-screen="settings"]');
    await waitFor('[data-section="ai-key"][data-ai-key="none"]');
    await type('#ai-key', 'sk-ant-smoke-rejected-key');
    await click('[data-action="test-ai-key"]');
    await waitFor('[data-section="ai-key"] [data-problems]');
    expect((await count('[data-ai-key-saved]')) === 0, 'a rejected AI key was saved');
    await type('#ai-key', GOOD_KEY);
    await click('[data-action="test-ai-key"]');
    await waitFor('[data-section="ai-key"][data-ai-key="saved"]');
    expect((await page<string>('document.body.innerText')).includes(GOOD_KEY) === false, 'the saved AI key is shown on screen');
    step('rejected AI key refused, accepted AI key saved and not shown');

    // Changing the passphrase needs the current one.
    await type('#current-passphrase', 'not the current passphrase');
    await type('#changed-passphrase', THIRD_PASSPHRASE);
    await type('#changed-passphrase-confirm', THIRD_PASSPHRASE);
    await click('[data-action="change-passphrase"]');
    await waitFor('[data-section="passphrase"] [data-problems]');
    await type('#current-passphrase', FIRST_PASSPHRASE);
    await click('[data-action="change-passphrase"]');
    await waitFor('[data-passphrase-changed]');
    step('passphrase changed from the setup screen');

    // Backup: choosing a folder makes the first backup, and the check confirms every file matches.
    const backupFolder = path.join(smokeFolder, 'usb-drive', 'Echo Backup');
    await waitFor('[data-section="backup"][data-backup="none"]');
    await click('[data-action="choose-backup"]');
    await waitFor('[data-section="backup"][data-backup="ok"]');
    expect(existsSync(path.join(backupFolder, 'vault.json')), 'no backup was written to the drive');
    await click('[data-action="check-backup"]');
    await waitForText('[data-backup-note]', 'match');
    step('first backup made to the drive, and every file checked against the archive');

    // A replacement kit: the old code stops working once the new one is confirmed.
    await click('[data-action="new-kit"]');
    await waitFor('[data-screen="recovery-kit"][data-stage="show"]');
    const replacement = await attribute('[data-kit-code]', 'data-kit-code');
    expect(typeof replacement === 'string' && replacement !== printed, 'the replacement kit has no new code');
    const newGroups = (replacement as string).split('-');
    await click('[data-action="kit-next"]');
    await waitFor('[data-screen="recovery-kit"][data-stage="prove"]');
    const c = Number(await attribute('[data-challenge-a]', 'data-challenge-a'));
    const d = Number(await attribute('[data-challenge-b]', 'data-challenge-b'));
    await type('#kit-group-a', newGroups[c - 1]!);
    await type('#kit-group-b', newGroups[d - 1]!);
    await click('[data-action="kit-confirm"]');
    await waitFor('[data-screen="settings"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    step('replacement recovery kit confirmed');

    // People: a name is required, people can be added, changed and removed, and the home tile counts them.
    await click('[data-action="open-people"]');
    await waitFor('[data-screen="people"][data-people-count="0"]');
    await click('[data-action="add-person"]');
    await waitFor('[data-section="add-person"] [data-problems]');
    await type('#new-person-name', 'Smoke Daughter');
    await type('#new-person-relationship', 'daughter');
    await type('#new-person-calls-me', 'Dad');
    await click('[data-action="add-person"]');
    await waitFor('[data-screen="people"][data-people-count="1"]');
    await type('#new-person-name', 'Smoke Son');
    await click('[data-action="add-person"]');
    await waitFor('[data-screen="people"][data-people-count="2"]');
    await type('#new-person-name', 'smoke son');
    await click('[data-action="add-person"]');
    await waitFor('[data-section="add-person"] [data-problems]');
    expect((await count('[data-person]')) === 2, 'the same name was accepted twice');
    await click('[data-person="Smoke Daughter"] [data-action="edit-person"]');
    await type('#edit-person-calls-me', 'Pops');
    await click('[data-action="save-person"]');
    await waitForText('[data-person="Smoke Daughter"] .person-line', 'Pops');
    await click('[data-person="Smoke Son"] [data-action="remove-person"]');
    await click('[data-action="confirm-remove-person"]');
    await waitFor('[data-screen="people"][data-people-count="1"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-people-status="1"]');
    step('people added, duplicate refused, changed, removed, and counted on the home screen');

    // Before consent, every capture tile says so.
    const tileLabel = (tile: string) => page<string>(`document.querySelector('[data-tile="${tile}"] [data-tile-status]')?.textContent ?? ''`);
    await waitFor('[data-consent-status="none"]');
    // A new archive says what to do first.
    await waitFor('[data-next-step="consent"]');
    expect((await tileLabel('stories')).includes('consent'), 'a capture tile does not ask for consent first');

    // Consent needs a name, then a real recording from the camera and microphone.
    await click('[data-action="open-consent"]');
    await waitFor('[data-screen="consent"][data-consent="none"]');
    await click('[data-action="consent-begin"]');
    await waitFor('[data-screen="consent"] [data-problems]');
    await type('#consent-name', 'Smoke Tester');
    await click('[data-action="consent-begin"]');
    await waitFor('[data-screen="consent"][data-stage="record"][data-camera="live"]');
    const wording = await page<string>(`document.querySelector('[data-wording]')?.textContent ?? ''`);
    expect(wording.startsWith('I, Smoke Tester, on ') && wording.includes('never as me being alive'), `the statement shown is wrong: ${wording.slice(0, 60)}`);
    await click('[data-action="consent-start"]');
    await page('new Promise((resolve) => setTimeout(() => resolve(true), 2500))');
    await click('[data-action="consent-stop"]');
    await waitFor('[data-screen="consent"][data-stage="review"]');
    await click('[data-action="consent-keep"]');
    await waitFor('[data-screen="consent"][data-consent="given"]');
    await waitFor('[data-saved-video][data-playback-ready="yes"]');
    const mediaFolder = path.join(smokeFolder, 'Echo Archive', 'media');
    const recordings = readdirSync(mediaFolder);
    expect(recordings.length === 1, `expected one recording in the archive, found ${recordings.length}`);
    const recording = readFileSync(path.join(mediaFolder, recordings[0]!));
    expect(recording.subarray(0, 8).toString('latin1') === 'ECHOMED1', 'the consent recording is not in Echo\'s encrypted format');
    expect(!recording.includes(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'the consent recording is readable on disk');
    step(`consent recorded from the camera, saved encrypted (${recording.length} bytes), and played back`);

    // With consent, capture tiles stop asking for it.
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-consent-status="given"]');
    expect(!(await tileLabel('stories')).includes('onsent'), 'a capture tile still asks for consent after it was given');

    // A story: title required, recorded from the microphone, marked for one person, saved encrypted, played back, written down.
    await click('[data-action="open-stories"]');
    await waitFor('[data-screen="stories"][data-story-count="0"]');
    await click('[data-action="story-new"]');
    await waitFor('[data-recorder][data-microphone="live"]');
    const daughterId = await page<string>(`[...document.querySelectorAll('#story-audience option')].find((o) => o.textContent.includes('Smoke Daughter'))?.value ?? ''`);
    expect(daughterId.length > 0, 'the people list is not offered in the "who is this for" picker');
    await page(`(() => { const s = document.querySelector('#story-audience'); const id = [...s.options].find((o) => o.textContent.includes('Smoke Daughter')).value; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, id); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    // Where the checks provide a spoken recording as the microphone, record long enough to catch it.
    const spoken = Boolean(process.env.ECHO_SPEECH_WAV);
    await click('[data-action="sound-start"]');
    await page(`new Promise((resolve) => setTimeout(() => resolve(true), ${spoken ? 12_000 : 2500}))`);
    await click('[data-action="sound-stop"]');
    await waitFor('[data-story-review]');
    await click('[data-action="story-save"]');
    await waitFor('[data-section="new-story"] [data-problems]');
    await type('#story-title', 'Smoke Story');
    await click('[data-action="story-save"]');
    // A story that has just been recorded opens straight away and Echo starts writing it down.
    await waitFor('[data-screen="stories"][data-mode="detail"][data-story-count="1"]');
    expect(readdirSync(mediaFolder).length === 2, 'the story recording was not saved in the archive');
    await waitFor('[data-story-audio][data-playback-ready="yes"]');
    const writingStage = () => page<string>(`document.querySelector('[data-writing]')?.getAttribute('data-writing') ?? ''`);
    const settle = async (ms: number): Promise<string> => {
      const started = Date.now();
      for (;;) {
        const stage = await writingStage();
        if (stage !== 'downloading' && stage !== 'listening') return stage;
        if (Date.now() - started > ms) throw new Error(`speech-to-text was still ${stage} after ${Math.round(ms / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    };
    if (spoken) {
      // Real words were spoken into the microphone, so Echo must write real words down.
      if ((await settle(300_000)) === 'ask-download') {
        await click('[data-action="story-download"]');
        await settle(300_000);
      }
      expect((await writingStage()) === 'done', `speech-to-text finished as "${await writingStage()}": ${await page<string>(`document.querySelector('[data-writing] [data-problems]')?.textContent ?? ''`)}`);
      const heard = (await page<string>(`document.querySelector('#detail-text').value`)).toLowerCase();
      const wanted = ['grandmother', 'chickens', 'garden', 'fox', 'dog'];
      const found = wanted.filter((word) => heard.includes(word));
      expect(found.length >= 2, `Echo wrote down "${heard}", which has too few of the words that were spoken`);
      step(`speech-to-text wrote the story down on this computer: "${heard}"`);
    } else {
      // No spoken recording here, so the words are typed, as a person would if Echo misheard.
      await settle(120_000);
      await page(`(() => { const t = document.querySelector('#detail-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'It rained all week.'); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    }
    await click('[data-action="story-change"]');
    await waitFor('[data-story-saved]');
    await click('[data-action="story-close"]');
    await waitFor('[data-screen="stories"][data-mode="list"]');
    await waitFor('[data-story="Smoke Story"] [data-story-words="yes"]');
    const storyAudience = await page<string>(`document.querySelector('[data-story="Smoke Story"] [data-story-audience]')?.textContent ?? ''`);
    expect(storyAudience === 'Only Smoke Daughter', `the story is marked "${storyAudience}", not for the person chosen`);
    step('story recorded from the microphone, marked for one person, saved encrypted, played back and written down');

    // Face masters: a selfie from the camera, then the guided video, both saved encrypted and shown back.
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-stories-status="1"]');
    await waitFor('[data-face-status="loaded"]');
    expect((await tileLabel('face')).startsWith('0 of 8 photos'), `the face tile says "${await tileLabel('face')}"`);
    await click('[data-action="open-face"]');
    await waitFor('[data-screen="face"][data-photo-count="0"]');
    await click('[data-pose="front-neutral"] [data-action="pose-take"]');
    await waitFor('[data-section="take-photo"] [data-camera="live"]');
    await page('new Promise((resolve) => setTimeout(() => resolve(true), 1500))');
    await click('[data-action="photo-take"]');
    await waitFor('[data-screen="face"][data-doing="nothing"][data-photo-count="1"]');
    await waitFor('[data-pose="front-neutral"] [data-saved-capture="photo"][data-playback-ready="yes"]');
    await click('[data-action="video-new"]');
    await waitFor('[data-section="record-video"] [data-camera="live"]');
    await click('[data-action="video-start"]');
    await page('new Promise((resolve) => setTimeout(() => resolve(true), 3500))');
    const cue = await page<string>(`document.querySelector('[data-video-cue]')?.textContent ?? ''`);
    expect(cue.startsWith('Look at the camera'), `the video guide shows "${cue}" at the start`);
    await click('[data-action="video-stop"]');
    await waitFor('[data-section="review-video"]');
    await click('[data-action="video-keep"]');
    await waitFor('[data-screen="face"][data-doing="nothing"][data-video-count="1"]');
    await waitFor('[data-saved-video-item] [data-saved-capture="video"][data-playback-ready="yes"]');
    step('selfie taken and guided video recorded from the camera, saved encrypted and shown back');

    // Voice masters: a guided recording, saved encrypted, played back, and counted on the meter.
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-voice-status="loaded"]');
    await click('[data-action="open-voice"]');
    await waitFor('[data-screen="voice"][data-voice-count="0"]');
    await click('[data-passage-id="read-plain"] [data-action="voice-record"]');
    await waitFor('[data-section="record-voice"] [data-recorder][data-microphone="live"]');
    const passageShown = await page<string>(`document.querySelector('[data-passage]')?.textContent ?? ''`);
    expect(passageShown.startsWith('I woke before the alarm'), 'the passage to read is not shown');
    await click('[data-action="sound-start"]');
    await page('new Promise((resolve) => setTimeout(() => resolve(true), 3500))');
    await click('[data-action="sound-stop"]');
    await waitFor('[data-section="review-voice"]');
    await click('[data-action="voice-keep"]');
    await waitFor('[data-screen="voice"][data-doing="nothing"][data-voice-count="1"]');
    await waitFor('[data-voice-sample] [data-saved-capture="sound"][data-playback-ready="yes"]');
    const voiceSeconds = Number(await attribute('[data-screen="voice"]', 'data-voice-seconds'));
    expect(voiceSeconds >= 2, `the voice meter counted ${voiceSeconds} seconds`);
    expect(readdirSync(mediaFolder).length === 5, `expected 5 recordings in the archive, found ${readdirSync(mediaFolder).length}`);
    step('voice passage recorded, saved encrypted, played back and counted on the meter');

    // Character interview: a typed answer, a spoken answer, a skipped question, and the interviewer finishing the topic.
    const setAnswer = (value: string) =>
      page(`(() => { const t = document.querySelector('#interview-answer'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(value)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const question = () => page<string>(`document.querySelector('[data-question]')?.textContent ?? ''`);
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-interview-status="0"]');
    expect((await tileLabel('interview')) === 'Not started', `the interview tile says "${await tileLabel('interview')}"`);
    await click('[data-action="open-interview"]');
    await waitFor('[data-screen="interview"][data-mode="list"][data-interview-answers="0"]');
    expect((await count('[data-interview-no-key]')) === 0, 'the interview says there is no AI key when one is saved');
    expect((await count('[data-topic-id]')) === 12, `the interview lists ${await count('[data-topic-id]')} parts, not 12`);
    await click('[data-topic-id="childhood"] [data-action="interview-open"]');
    await waitFor('[data-section="interview-topic"][data-topic-state="waiting"][data-answers="0"]');
    expect((await question()).startsWith('Where did you grow up'), `the first question is "${await question()}"`);
    await setAnswer('Above a shop in Luton');
    await click('[data-action="interview-send"]');
    await waitFor('[data-section="interview-topic"][data-topic-state="waiting"][data-answers="1"]');
    expect((await question()).includes('Above a shop in Luton'), `the follow-up does not react to the answer: "${await question()}"`);
    expect((await page<string>(`document.querySelector('#interview-answer').value`)) === '', 'the answer box was not cleared after sending');

    if (spoken) {
      await click('[data-action="speak"]');
      await waitFor('[data-speaking="recording"] [data-recorder][data-microphone="live"]');
      await click('[data-action="sound-start"]');
      await page('new Promise((resolve) => setTimeout(() => resolve(true), 9000))');
      await click('[data-action="sound-stop"]');
      await waitFor('#interview-answer[data-spoken="yes"]');
      const said = await page<string>(`document.querySelector('#interview-answer').value`);
      expect(said.trim().length > 10, `the spoken answer was written down as "${said}"`);
      step(`spoken interview answer written down on this computer: "${said}"`);
    } else {
      await setAnswer('My mum, my dad and two brothers');
    }
    await click('[data-action="interview-send"]');
    await waitFor('[data-section="interview-topic"][data-topic-state="waiting"][data-answers="2"]');
    expect(readdirSync(mediaFolder).length === (spoken ? 6 : 5), `expected ${spoken ? 6 : 5} recordings after the interview answers, found ${readdirSync(mediaFolder).length}`);

    await click('[data-action="interview-another"]');
    await waitForText('[data-question]', 'a different question');
    expect((await attribute('[data-section="interview-topic"]', 'data-answers')) === '2', 'skipping a question saved an answer');
    await setAnswer('We played in the yard behind the shop');
    await click('[data-action="interview-send"]');
    await waitFor('[data-section="interview-topic"][data-topic-state="done"][data-answers="3"]');
    expect((await count('[data-exchange]')) === 3, 'the finished part does not show its three answers');
    // An answer can be marked for one person alone.
    await page(`(() => { const s = document.querySelector('[data-exchange] [data-audience-select]'); const id = [...s.options].find((o) => o.textContent.includes('Smoke Daughter')).value; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, id); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor('[data-exchange][data-for-one-person="yes"]');
    await click('[data-action="interview-topics"]');
    await waitFor('[data-screen="interview"][data-mode="list"][data-interview-finished="1"]');
    await waitForText('[data-topic-id="childhood"] [data-topic-status]', 'Finished');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-interview-status="3"]');
    expect((await tileLabel('interview')) === '1 of 12 parts finished', `the interview tile says "${await tileLabel('interview')}"`);
    step('interview: typed and spoken answers saved, follow-ups react to them, a question skipped, a part finished');

    // Advice: for one named person and one occasion, kept for the day, then changed, and a second piece deleted.
    const fill = (selector: string, value: string) =>
      page(`(() => { const t = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(value)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const choosePerson = () =>
      page(`(() => { const s = document.querySelector('#advice-person'); const id = [...s.options].find((o) => o.textContent.includes('Smoke Daughter')).value; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, id); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor('[data-advice-status="0"]');
    expect((await tileLabel('advice')) === 'No advice yet', `the advice tile says "${await tileLabel('advice')}"`);
    await click('[data-action="open-advice"]');
    await waitFor('[data-screen="advice"][data-mode="list"][data-advice-count="0"]');
    await click('[data-action="advice-new"]');
    await waitFor('[data-section="advice-form"]');
    await type('#advice-occasion', 'Your wedding day');
    await fill('#advice-words', 'Marry someone who makes you laugh');
    await click('[data-action="advice-save"]');
    await waitFor('[data-section="advice-form"] [data-problems]');
    expect((await count('[data-screen="advice"][data-advice-count="0"]')) === 1, 'advice was saved without saying who it is for');
    await choosePerson();
    await click('[data-kind="on-the-day"]');
    await waitFor('#advice-date');
    await click('[data-action="advice-save"]');
    await waitFor('[data-screen="advice"][data-mode="list"][data-advice-count="1"]');
    await waitFor('[data-advice-for="Smoke Daughter"] [data-advice="Your wedding day"] [data-advice-kind="on-the-day"]');

    await click('[data-action="advice-new"]');
    await waitFor('[data-section="advice-form"]');
    await choosePerson();
    await type('#advice-occasion', 'Losing a job');
    await fill('#advice-words', 'It is only a job');
    await click('[data-action="advice-save"]');
    await waitFor('[data-screen="advice"][data-mode="list"][data-advice-count="2"]');
    await waitFor('[data-advice="Losing a job"] [data-advice-kind="when-asked"]');

    await click('[data-advice="Your wedding day"] [data-action="advice-open"]');
    await waitFor('[data-section="advice-form"][data-advice-editing="yes"]');
    expect((await page<string>(`document.querySelector('#advice-words').value`)) === 'Marry someone who makes you laugh', 'saved advice does not come back with its words');
    await fill('#advice-words', 'Marry someone who makes you laugh, and laugh back');
    await click('[data-action="advice-save"]');
    await waitFor('[data-screen="advice"][data-mode="list"]');
    await waitForText('[data-advice="Your wedding day"] .advice-preview', 'and laugh back');

    await click('[data-advice="Losing a job"] [data-action="advice-open"]');
    await waitFor('[data-section="advice-form"][data-advice-editing="yes"]');
    await click('[data-action="advice-remove"]');
    await click('[data-action="advice-remove-confirm"]');
    await waitFor('[data-screen="advice"][data-mode="list"][data-advice-count="1"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-advice-status="1"]');
    expect((await tileLabel('advice')) === '1 piece of advice', `the advice tile says "${await tileLabel('advice')}"`);
    step('advice saved for one person and one occasion, refused without a person, changed, deleted and counted');

    // What the echo remembers: built from the story, the interview answers and the advice above.
    const stored = await page<number>(`Number(document.querySelector('[data-built-memories]').getAttribute('data-built-memories') || 0)`);
    await click('[data-action="open-memories"]');
    await waitFor('[data-screen="memories"]');
    const passages = Number(await attribute('[data-screen="memories"]', 'data-memory-count'));
    expect(passages >= 5, `expected at least 5 passages (a story, 3 interview answers and 1 piece of advice), found ${passages}`);
    expect((await count('[data-memory="interview"]')) === 3, `expected 3 interview passages, found ${await count('[data-memory="interview"]')}`);
    expect((await count('[data-memory="interview"][data-memory-audience="person"]')) === 1, 'the answer marked for one person is not private in the memory store');
    expect((await count('[data-memory="advice"][data-memory-state="for-the-day"]')) === 1, 'advice kept for the day is not held back from conversation');
    expect((await count('[data-memory="story"]')) >= 1, 'the story that was written down is not in the memory store');
    // Leave one out, then correct the words of another.
    await click('[data-memory="interview"][data-memory-audience="everyone"] [data-action="memory-leave-out"]');
    await waitFor('[data-screen="memories"][data-memory-left-out="1"]');
    await click('[data-memory="interview"][data-memory-state="usable"][data-memory-audience="everyone"] [data-action="memory-correct"]');
    await waitFor('[data-memory-words-box]');
    await page(`(() => { const t = document.querySelector('[data-memory-words-box]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'We played football in the yard behind the shop'); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await click('[data-action="memory-save"]');
    await waitFor('[data-memory="interview"][data-memory-corrected="yes"]');
    await waitForText('[data-memory-corrected="yes"] [data-memory-words]', 'We played football');
    await type('#memory-search', 'football');
    await waitFor('[data-memories-showing="1"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor(`[data-built-memories="${passages}"]`);
    step(`memory store: ${passages} passages built from what was captured (${stored} before opening), one left out, one corrected, found by search`);

    // Character sheet: drafted from passages, a line confirmed, a line added, a line struck out and not brought back.
    await waitFor('[data-built-sheet="character"][data-built-lines="0"]');
    await click('[data-action="open-character"]');
    await waitFor('[data-screen="sheet"][data-sheet-kind="character"][data-sheet-lines="0"]');
    expect((await count('[data-sheet-no-key]')) === 0 && (await count('[data-sheet-nothing]')) === 0, 'the character sheet says it cannot be drafted');
    await click('[data-action="sheet-draft"]');
    await waitFor('[data-screen="sheet"][data-sheet-lines="1"][data-sheet-drafting="no"]');
    expect((await count('[data-line="values"][data-line-origin="drafted"][data-line-checked="no"][data-line-in-use="yes"]')) === 1, 'the drafted line is not on the sheet as an unchecked draft');
    expect((await count('[data-line] .support')) === 1, 'the drafted line does not show the passage it rests on');
    await click('[data-line="values"] [data-action="line-confirm"]');
    await waitFor('[data-line="values"][data-line-checked="yes"]');
    await type('[data-add-section="never"] input', 'I would never talk down to a waiter');
    await click('[data-add-section="never"] [data-action="line-add"]');
    await waitFor('[data-screen="sheet"][data-sheet-lines="2"]');
    await waitFor('[data-line="never"][data-line-origin="yours"]');
    await click('[data-line="values"] [data-action="line-strike"]');
    await waitFor('[data-screen="sheet"][data-sheet-lines="1"]');
    await click('[data-action="sheet-draft"]');
    await waitFor('[data-sheet-note]');
    expect((await attribute('[data-screen="sheet"]', 'data-sheet-lines')) === '1', 'a line that was struck out came back in the next draft');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-built-sheet="character"][data-built-lines="1"]');

    // Style profile: one general line, and one about a named person drafted from what was recorded for them.
    await click('[data-action="open-style"]');
    await waitFor('[data-screen="sheet"][data-sheet-kind="style"][data-sheet-lines="0"]');
    await click('[data-action="sheet-draft"]');
    await waitFor('[data-screen="sheet"][data-sheet-lines="2"][data-sheet-drafting="no"]');
    expect((await count('[data-line="voice"][data-line-audience="everyone"]')) === 1, 'the style profile has no general line');
    expect((await count('[data-line="people"][data-line-audience="person"]')) === 1, 'the style profile has no line about the named person');
    expect((await count('[data-sheet-measure]')) === 1, 'the style profile does not show what was measured');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-built-sheet="style"][data-built-lines="2"]');
    step('character sheet and style profile drafted from passages, lines confirmed, added, struck out and kept out');

    // Talking to the echo: the fixed opening line, a checked reply with its passage, an invented memory caught,
    // and a separate conversation for a named person.
    const speakAs = (label: string) =>
      page(`(() => { const s = document.querySelector('#chat-speaking-as'); const id = [...s.options].find((o) => o.textContent.includes(${JSON.stringify(label)})).value; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, id); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    expect((await tileLabel('chat')) === 'Ready', `the chat tile says "${await tileLabel('chat')}"`);
    await click('[data-action="open-chat"]');
    await waitFor('[data-screen="chat"][data-chat-listener="owner"][data-chat-messages="1"]');
    expect((await count('[data-chat-blocked]')) === 0 && (await count('[data-chat-no-key]')) === 0, 'the chat says the echo cannot talk');
    await waitForText('[data-message="opening"] [data-message-text]', "I'm an AI echo of");
    await fill('#chat-say', 'Tell me about the yard behind the shop');
    await click('[data-action="chat-send"]');
    await waitFor('[data-screen="chat"][data-chat-messages="3"][data-chat-thinking="no"]');
    expect((await count('[data-message="echo"][data-check="passed"]')) === 1, 'the reply is not marked as having passed the check');
    expect((await count('[data-message="echo"][data-check="passed"] [data-source]')) === 1, 'the reply does not show the passage it drew on');
    await fill('#chat-say', 'Do you remember our holiday in Wales?');
    await click('[data-action="chat-send"]');
    await waitFor('[data-screen="chat"][data-chat-messages="5"][data-chat-thinking="no"]');
    await waitForText('[data-message="echo"][data-check="redrafted"] [data-message-text]', 'never got round to telling Echo');
    const shown = await page<string>(`[...document.querySelectorAll('[data-message-text]')].map((p) => p.textContent).join(' | ')`);
    expect(!shown.includes('1994'), `an invented memory was shown: ${shown}`);
    expect((await count('[data-check="redrafted"] [data-sources-redrafted]')) === 1, 'the sources do not say a draft was thrown away');

    await speakAs('Smoke Daughter');
    await waitFor('[data-screen="chat"]:not([data-chat-listener="owner"])[data-chat-messages="1"]');
    await fill('#chat-say', 'Hello Pops');
    await click('[data-action="chat-send"]');
    await waitFor('[data-screen="chat"]:not([data-chat-listener="owner"])[data-chat-messages="3"][data-chat-thinking="no"]');
    await speakAs('Myself');
    await waitFor('[data-screen="chat"][data-chat-listener="owner"][data-chat-messages="5"]');
    await click('[data-action="chat-new"]');
    await waitFor('[data-screen="chat"][data-chat-listener="owner"][data-chat-messages="1"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    step('echo: opening line, a checked reply with its passage, an invented memory thrown away before it was shown, separate conversations');

    // The blind test: own answers, the echo's answers, two judges who never see labels, then the result.
    await waitFor('[data-built-blind="none"]');
    await click('[data-action="open-blind-test"]');
    await waitFor('[data-screen="blind-test"][data-blind-stage="none"]');
    await click('[data-action="blind-start"]');
    await waitFor('[data-screen="blind-test"][data-blind-stage="writing"]');
    for (let question = 1; question <= 20; question += 1) {
      await waitFor(`[data-blind-question="${question}"]`);
      await fill('#blind-answer', `Smoke: my own answer ${question}`);
      await click('[data-action="blind-save"]');
    }
    await waitFor('[data-screen="blind-test"][data-blind-stage="echo"]');
    await click('[data-action="blind-echo"]');
    await waitFor('[data-screen="blind-test"][data-blind-stage="judging"]');
    const judgeAll = async (button: string) => {
      await click(button);
      for (let pair = 1; pair <= 20; pair += 1) {
        await waitFor(`[data-blind-pair="${pair}"]`);
        const labels = await page<string>(`document.querySelector('[data-section="blind-judging"]').textContent`);
        expect(!/\b(real answer|echo's answer)\b/i.test(labels), 'the judging screen says which answer is which');
        await click('[data-score="left-5"]');
        await click('[data-score="right-3"]');
        await click('[data-pick="left"]');
        await click('[data-action="blind-next"]');
      }
      await waitFor('[data-blind-judge-finished]');
      await click('[data-action="blind-judge-done"]');
      await waitFor('[data-section="blind-judges"]');
    };
    await judgeAll('[data-action="blind-judge-as"][data-judge="owner"]');
    expect((await count('[data-blind-verdict]')) === 0 && (await count('[data-blind-incomplete]')) === 1, 'results were shown before a second judge had finished');
    await judgeAll('[data-action="blind-judge-as"]:not([data-judge="owner"])');
    await waitFor('[data-blind-verdict]');
    expect((await count('[data-blind-breakdown] [data-blind-item]')) === 20, 'the results do not list all 20 questions');
    expect((await count('[data-blind-judge-result]')) === 2, 'the results do not show both judges');
    const verdict = await attribute('[data-section="blind-results"]', 'data-blind-verdict');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-built-blind="judging"]:not([data-built-blind-passed=""])');
    step(`blind test: 20 own answers, 20 echo answers, two judges with no labels, result shown only when both finished (${verdict})`);

    // Messages: a WhatsApp export read on this computer, the owner and everyone else kept apart.
    await waitFor('[data-messages-status="0"]');
    expect((await tileLabel('messages')) === 'Nothing imported yet', `the messages tile says "${await tileLabel('messages')}"`);
    const passagesBeforeImport = Number(await attribute('[data-built-memories]', 'data-built-memories'));
    await click('[data-action="open-messages"]');
    await waitFor('[data-screen="messages"][data-mode="list"][data-import-count="0"]');
    await click('[data-action="import-choose"]');
    await waitFor('[data-section="import-preview"][data-import-messages="4"]');
    expect((await count('[data-sender]')) === 2, `the preview lists ${await count('[data-sender]')} senders, not 2`);
    expect((await page<string>(`document.querySelector('#import-label').value`)) === 'Smoke Daughter', 'the conversation was not named from the file');
    await click('[data-sender="Smoke Owner"]');
    await page(`(() => { const s = document.querySelector('#import-person'); const id = [...s.options].find((o) => o.textContent.includes('Smoke Daughter')).value; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, id); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor('[data-hears="person"]');
    await click('[data-action="import-save"]');
    await waitFor('[data-screen="messages"][data-mode="list"][data-import-count="1"]');
    await waitFor('[data-import="Smoke Daughter"] [data-import-heard-by="person"]');
    await waitForText('[data-import="Smoke Daughter"] [data-import-counts]', '3 from you · 1 from other people');
    await click('[data-import="Smoke Daughter"] [data-action="import-open"]');
    await waitFor('[data-section="import-conversation"][data-import-total="4"]');
    expect((await count('[data-imported="mine"]')) === 3 && (await count('[data-imported="theirs"]')) === 1, 'the conversation does not keep the owner and other people apart');
    await click('[data-action="import-close"]');
    // Importing the same export again is refused.
    await click('[data-action="import-choose"]');
    await waitFor('[data-import-duplicate]');
    await click('[data-action="import-cancel"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-messages-status="1"]');
    // The owner's words reached the memory store as two passages. The other person's words are nowhere in it.
    await waitFor(`[data-built-memories="${passagesBeforeImport + 2}"]`);
    await click('[data-action="open-memories"]');
    await waitFor('[data-screen="memories"]');
    expect((await count('[data-memory="message"][data-memory-audience="person"]')) === 2, 'the imported words are not in the memory store for the person they were said to');
    const remembered = await page<string>(`document.querySelector('[data-screen="memories"]').textContent`);
    expect(remembered.includes('allotment') && !remembered.includes('surprise party'), "someone else's words are in the memory store");
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    step("WhatsApp export imported: owner and others kept apart, duplicate refused, only the owner's words in the memory store");

    // Messenger: one conversation in Meta's standard layout, with a broken accent put right and the owner already known.
    await click('[data-action="open-messages"]');
    await waitFor('[data-screen="messages"][data-mode="list"][data-import-count="1"]');
    await click('[data-action="import-choose-messenger"]');
    await waitFor('[data-section="import-preview"][data-import-messages="2"]');
    expect((await page<string>(`document.querySelector('#import-label').value`)) === 'Smoke Son', 'the Messenger conversation was not named from its title');
    expect((await page<boolean>(`document.querySelector('[data-sender="Smoke Owner"]').checked`)) === true, 'Echo did not recognise the owner from the earlier import');
    const sample = await page<string>(`document.querySelector('[data-import-sample]').textContent`);
    expect(sample.includes('caf\u00e9') && !sample.includes('\u00c3'), `the broken accent was not put right: ${sample}`);
    await click('[data-hears="everyone"]');
    await click('[data-action="import-save"]');
    await waitFor('[data-screen="messages"][data-mode="list"][data-import-count="2"]');
    await waitFor('[data-import="Smoke Son"] [data-import-heard-by="everyone"]');
    await waitForText('[data-import="Smoke Son"] [data-import-counts]', '1 from you · 1 from other people');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-messages-status="2"]');
    await waitFor(`[data-built-memories="${passagesBeforeImport + 3}"]`);
    step('Messenger conversation imported: accents repaired, owner recognised, one more passage in the memory store');

    // iPhone texts: a backup found on this computer, its conversations listed, one read and imported.
    await click('[data-action="open-messages"]');
    await waitFor('[data-screen="messages"][data-mode="list"][data-import-count="2"]');
    await click('[data-action="import-choose-iphone"]');
    await waitFor('[data-section="import-backups"][data-backup-count="1"]');
    await waitFor('[data-backup="Smoke iPhone"]');
    await click('[data-action="backup-open"]');
    await waitFor('[data-section="import-threads"][data-thread-count="1"]');
    await waitForText('[data-thread] .status', '3 messages');
    await click('[data-action="thread-open"]');
    await waitFor('[data-section="import-preview"][data-import-messages="2"]');
    expect((await page<number>(`document.querySelectorAll('[data-sender]:checked').length`)) === 1, 'Echo did not mark which sender is the phone\'s owner');
    const texts = await page<string>(`document.querySelector('[data-import-sample]').textContent`);
    expect(texts.includes('bring the ladder round'), `the words packed in the newer layout were not read: ${texts}`);
    await click('[data-hears="everyone"]');
    await click('[data-action="import-save"]');
    await waitFor('[data-screen="messages"][data-mode="threads"]');
    await waitFor('[data-import-done]');
    await click('[data-action="threads-close"]');
    await waitFor('[data-screen="messages"][data-mode="list"][data-import-count="3"]');
    await waitForText('[data-import="+447700900999"] [data-import-counts]', '1 from you · 1 from other people');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor(`[data-built-memories="${passagesBeforeImport + 4}"]`);
    step('iPhone texts imported from a backup: conversations listed, packed words read, owner known, one more passage');

    // Discord: one channel's messages file. Only the owner's messages are in it, newest first, with Discord's codes in the words.
    await click('[data-action="open-messages"]');
    await waitFor('[data-screen="messages"][data-mode="list"][data-import-count="3"]');
    await click('[data-action="import-choose-discord"]');
    await waitFor('[data-section="import-preview"][data-import-messages="2"]');
    expect((await page<number>(`document.querySelectorAll('[data-sender]').length`)) === 1, 'a Discord package should show one sender, the owner');
    expect((await page<number>(`document.querySelectorAll('[data-sender]:checked').length`)) === 1, 'Echo did not mark the owner in a Discord package');
    const discord = await page<string>(`document.querySelector('[data-import-sample]').textContent`);
    expect(discord.includes(':thumbsup:') && !discord.includes('123456789012345678'), `Discord's codes were left in the words: ${discord}`);
    expect(discord.indexOf('shed roof') < discord.indexOf('drill bits'), `the Discord messages were not put oldest first: ${discord}`);
    await click('[data-hears="everyone"]');
    await click('[data-action="import-save"]');
    await waitFor('[data-screen="messages"][data-mode="list"][data-import-count="4"]');
    await waitForText('[data-import="Discord c40000000000000001"] [data-import-counts]', '2 from you · only your side is in a Discord package');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor(`[data-built-memories="${passagesBeforeImport + 5}"]`);
    step('Discord messages imported: only the owner in it, codes cleaned, oldest first, one more passage');

    // Email: a mailbox file. The owner says which address is theirs; only what they sent is read, and what they quoted is cut off.
    await click('[data-action="open-messages"]');
    await waitFor('[data-screen="messages"][data-mode="list"][data-import-count="4"]');
    await click('[data-action="import-choose-email"]');
    await waitFor('[data-section="import-addresses"][data-address-count="2"]');
    expect((await page<boolean>(`document.querySelector('[data-address="owner@example.com"]').checked`)) === true, "Echo did not tick the owner's address from Gmail's Sent label");
    expect((await page<boolean>(`document.querySelector('[data-address="niece@example.com"]').checked`)) === false, "Echo ticked someone else's address as the owner's");
    await click('[data-action="addresses-save"]');
    await waitFor('[data-section="import-threads"][data-thread-count="1"]');
    await waitForText('[data-thread] .status', '2 messages');
    await click('[data-action="thread-open"]');
    await waitFor('[data-section="import-preview"][data-import-messages="2"]');
    const mail = await page<string>(`document.querySelector('[data-import-sample]').textContent`);
    expect(mail.includes('blue pot') && mail.includes('caf\u00e9 tin'), `the owner's emails were not read: ${mail}`);
    expect(!mail.includes('never would have found'), `the email the owner was replying to was kept: ${mail}`);
    expect(!mail.includes('signature nobody needs'), `the signature was kept: ${mail}`);
    await click('[data-hears="everyone"]');
    await click('[data-action="import-save"]');
    await waitFor('[data-screen="messages"][data-mode="threads"]');
    await waitFor('[data-import-done]');
    await click('[data-action="threads-close"]');
    await waitFor('[data-screen="messages"][data-mode="list"][data-import-count="5"]');
    await waitForText('[data-import="Smoke Niece"] [data-import-counts]', '2 from you · only the emails you sent are kept');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor(`[data-built-memories="${passagesBeforeImport + 7}"]`);
    step("Email imported from a mailbox: owner's address picked out, only sent mail read, quoted reply and signature cut off, two more passages");

    // Letters: a picture of a page is made small, read by the AI service, and must be corrected and checked by hand before it is kept.
    await click('[data-action="open-messages"]');
    await waitFor('[data-screen="messages"][data-mode="list"]');
    await click('[data-action="open-letters"]');
    await waitFor('[data-screen="letters"][data-mode="list"][data-letter-count="0"]');
    await click('[data-action="letter-new"]');
    await waitFor('[data-section="letter-form"][data-page-count="0"]');
    await page(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 3000; canvas.height = 1500;
      const pen = canvas.getContext('2d');
      pen.fillStyle = '#ffffff'; pen.fillRect(0, 0, 3000, 1500);
      pen.fillStyle = '#000000'; pen.font = '90px serif'; pen.fillText('My dear girl, the clock in the hall is yours', 100, 300);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const holder = new DataTransfer();
      holder.items.add(new File([blob], 'page.png', { type: 'image/png' }));
      const input = document.querySelector('#letter-page-file');
      input.files = holder.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor('[data-section="letter-form"][data-page-count="1"]');
    await page(`new Promise((resolve) => { const img = document.querySelector('[data-page="1"] img'); if (img.complete && img.naturalWidth > 0) resolve(true); else img.addEventListener('load', () => resolve(true)); })`);
    const pageWidth = await page<number>(`document.querySelector('[data-page="1"] img').naturalWidth`);
    expect(pageWidth === 2000, `the page picture should be made 2000 dots wide before it is kept or sent, not ${pageWidth}`);
    expect((await page<boolean>(`document.querySelector('[data-action="page-read"]').disabled`)) === true, 'a page could be sent for reading before the owner said the letter is theirs');
    await click('#letter-mine');
    await click('[data-action="page-read"]');
    await waitFor('#letter-text[data-unread="1"]');
    const fillLetter = (value: string) =>
      page(`(() => { const t = document.querySelector('#letter-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(value)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await type('#letter-title', 'Smoke letter about the clock');
    await type('#letter-written', '1998');
    // Not yet checked, and a word still unread: it cannot be saved.
    await click('[data-action="letter-save"]');
    await waitForText('[data-section="letter-form"] [data-problems]', 'still marked [?]');
    await waitForText('[data-section="letter-form"] [data-problems]', 'tick the box');
    await fillLetter('My dear girl,\n\nThe clock in the hall is yours when I am gone.\n\nAll my love, Pops');
    await waitFor('#letter-text[data-unread="0"]');
    await click('#letter-checked');
    await click('[data-action="letter-save"]');
    await waitFor('[data-screen="letters"][data-mode="list"][data-letter-count="1"]');
    await waitForText('[data-letter="Smoke letter about the clock"] [data-letter-facts]', 'written 1998 · 1 page pictured');
    // The picture was kept, encrypted, and can be seen again beside the words.
    await click('[data-action="letter-edit"]');
    await waitFor('[data-section="letter-form"][data-letter-editing="yes"] [data-saved-pages="1"]');
    await click('[data-action="letter-cancel"]');
    await click('[data-action="back-messages"]');
    await waitFor('[data-screen="messages"][data-mode="list"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor(`[data-built-memories="${passagesBeforeImport + 8}"]`);
    step('letter added: page picture made small, read by the AI service, not saved until corrected and checked, one more passage');

    // The assistant door: off until asked for, a store of its own beside the settings, encrypted, and gone when consent is withdrawn.
    await click('[data-action="open-setup"]');
    await waitFor('[data-section="door"][data-door="off"]');
    await click('[data-action="door-on"]');
    await click('[data-action="door-on-confirm"]');
    await waitFor('[data-section="door"][data-door="on"]');
    const doorPassageCount = Number(await attribute('[data-section="door"]', 'data-door-passages'));
    expect(doorPassageCount > 0, 'the door was turned on but its store holds none of the owner\'s words');
    doorFolderPath = await page<string>(`document.querySelector('[data-door-folder]').textContent`);
    expect(!doorFolderPath.includes('Echo Archive') && path.basename(doorFolderPath) === 'assistant-door', `the assistant's store is not beside the settings: ${doorFolderPath}`);
    expect(readdirSync(doorFolderPath).sort().join(',') === 'door-key.json,store.sealed', `unexpected files in the assistant's store: ${readdirSync(doorFolderPath).join(', ')}`);
    expect(!readFileSync(path.join(doorFolderPath, 'store.sealed'), 'utf8').includes('clock in the hall'), "the assistant's store is readable without its key");
    const doorCommand = await page<string>(`document.querySelector('[data-door-command]').textContent`);
    expect(/door/.test(doorCommand), `Setup does not show the command the assistant runs: ${doorCommand}`);
    const doorMcp = JSON.parse(await page<string>(`document.querySelector('[data-door-mcp]').textContent`)) as { mcpServers?: { echo?: { command?: string; args?: string[] } } };
    expect(typeof doorMcp.mcpServers?.echo?.command === 'string' && doorMcp.mcpServers.echo.args?.at(-1) === 'mcp', 'Setup does not show a usable MCP settings block');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    step("assistant door turned on: a store of the owner's words with its own key, outside the archive, encrypted");

    // The tray: the assistant leaves a draft and points out a file. Neither is part of the echo until the owner deals with it.
    const assistantFile = path.join(smokeFolder, 'from-assistant.txt');
    writeFileSync(assistantFile, '[14/12/2025, 10:00:00] Smoke Cousin: Are you coming on Sunday?\n[14/12/2025, 10:02:00] Smoke Owner: Wild horses would not keep me away\n', 'utf8');
    expect(suggestWords(doorFolderPath, { title: 'Smoke write-up', text: 'We went to the caravan every August and it rained every time.', note: 'Said on Sunday' }).exit === 0, 'the assistant could not leave a draft');
    expect(suggestFile(doorFolderPath, { path: assistantFile, service: 'whatsapp', note: 'A chat worth keeping' }).exit === 0, 'the assistant could not point out a file');
    await click('[data-action="open-setup"]');
    await waitFor('[data-screen="settings"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"] [data-tray-waiting="2"]');
    await waitFor(`[data-built-memories="${passagesBeforeImport + 8}"]`); // waiting, so not yet something the echo can draw on
    await click('[data-action="open-tray"]');
    await waitFor('[data-screen="tray"][data-tray-count="2"]');
    // A draft cannot be kept until the owner says the words are theirs.
    await click('[data-tray-item="words"] [data-action="tray-approve"]');
    await waitForText('[data-tray-item="words"] [data-problems]', 'tick the box');
    await click('[data-tray-item="words"] [data-tray-mine]');
    await click('[data-tray-item="words"] [data-action="tray-approve"]');
    await waitFor('[data-screen="tray"][data-tray-count="1"][data-note-count="1"]');
    // The file goes through the ordinary import, preview first.
    await click('[data-action="tray-open-whatsapp"]');
    await waitFor('[data-screen="messages"] [data-section="import-preview"][data-import-messages="2"]');
    await click('[data-action="import-cancel"]');
    await waitFor('[data-screen="messages"][data-mode="list"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"] [data-tray-waiting="1"]');
    await waitFor(`[data-built-memories="${passagesBeforeImport + 9}"]`);
    await click('[data-action="open-tray"]');
    await waitFor('[data-screen="tray"][data-tray-count="1"]');
    await click('[data-tray-item="file"] [data-action="tray-discard"]');
    await waitFor('[data-screen="tray"][data-tray-count="0"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"] [data-kept-notes="1"]');
    step("assistant's tray: a draft kept only after the owner said it was theirs, a file opened through the normal preview, the rest thrown away");

    // Asking the echo through the door: only with a key, the owner's only if they tick the box, and the owner can read what was said.
    const noKey = await askTheEcho(doorFolderPath, 'What were the caravan holidays like?', false, { env: {} });
    expect(noKey.exit === 1 && JSON.stringify(noKey.output).includes('ANTHROPIC_API_KEY'), `the assistant could ask the echo with no key: ${JSON.stringify(noKey.output)}`);
    await click('[data-action="open-setup"]');
    await waitFor('[data-section="door"][data-door="on"] [data-door-share-key]');
    expect((await page<boolean>(`document.querySelector('[data-door-share-key]').checked`)) === false, "the owner's AI key was shared with the assistant without being asked");
    await click('[data-door-share-key]');
    await waitFor('[data-door-share-key]:checked');
    const asked = await askTheEcho(doorFolderPath, 'What were the caravan holidays like?', false, { env: {}, ask: smokeInterviewer });
    expect(asked.exit === 0 && typeof (asked.output as { reply?: unknown }).reply === 'string', `the assistant could not ask the echo: ${JSON.stringify(asked.output)}`);
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"] [data-asked-sessions="1"]');
    await click('[data-action="open-tray"]');
    await waitFor('[data-screen="tray"][data-asked-count="1"] [data-asked-role="them"]');
    await waitForText('[data-section="assistant-asked"]', 'What were the caravan holidays like?');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    step("assistant asked the echo through the door: refused with no key, answered once the owner shared theirs, and the owner can read it");

    // Withdrawing consent puts the block back.
    await waitFor('[data-stories-status="1"]');
    await click('[data-action="open-consent"]');
    await waitFor('[data-screen="consent"][data-consent="given"]');
    await click('[data-action="consent-withdraw"]');
    await click('[data-action="consent-withdraw-confirm"]');
    await waitFor('[data-screen="consent"][data-consent="withdrawn"]');
    await click('[data-action="back-home"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-consent-status="withdrawn"]');
    expect((await tileLabel('stories')).includes('withdrawn'), 'a capture tile is not blocked after consent was withdrawn');
    expect((await page<boolean>(`document.querySelector('[data-action="open-stories"]')?.disabled === true`)) === true, 'stories can still be opened after consent was withdrawn');
    await waitFor('[data-next-step="consent-again"]');
    expect(doorFolderPath.length > 0 && !existsSync(doorFolderPath), "withdrawing consent left the assistant's store in place");
    step('consent withdrawn, capture blocked again, assistant door closed and its store deleted');

    // Locking hides everything, and the wrong passphrase is refused.
    await click('[data-action="lock"]');
    await waitFor('[data-screen="lock"]');
    expect((await count('[data-tile]')) === 0, 'tiles are still visible while locked');
    await type('#unlock-passphrase', 'definitely not the passphrase');
    await click('[data-action="unlock"]');
    await waitFor('[data-problems]');
    expect((await count('[data-screen="lock"]')) === 1, 'a wrong passphrase unlocked the archive');
    step('locked, wrong passphrase refused');

    // The first passphrase was replaced, so it is refused too.
    await type('#unlock-passphrase', FIRST_PASSPHRASE);
    await click('[data-action="unlock"]');
    await waitFor('[data-problems]');
    expect((await count('[data-screen="lock"]')) === 1, 'a replaced passphrase unlocked the archive');

    // The first kit was replaced, so its code is refused.
    await click('[data-action="use-recovery"]');
    await waitFor('#recovery-code');
    await type('#recovery-code', printed as string);
    await click('[data-action="recover"]');
    await waitFor('[data-problems]');
    expect((await count('[data-screen="lock"]')) === 1, 'a replaced recovery code unlocked the archive');
    step('replaced passphrase and replaced recovery code both refused');

    // The current code opens the archive and demands a new passphrase.
    await type('#recovery-code', (replacement as string).toLowerCase().replace(/-/g, ' '));
    await click('[data-action="recover"]');
    await waitFor('[data-screen="new-passphrase"]');
    expect((await count('[data-tile]')) === 0, 'the home screen was reachable before a new passphrase was set');
    await type('#new-passphrase', SECOND_PASSPHRASE);
    await type('#new-passphrase-confirm', SECOND_PASSPHRASE);
    await click('[data-action="set-passphrase"]');
    await waitFor('[data-screen="home"]');
    step('recovery code opened the archive, new passphrase set');

    // The old passphrase no longer works. The new one does.
    await click('[data-action="lock"]');
    await waitFor('[data-screen="lock"]');
    await type('#unlock-passphrase', THIRD_PASSPHRASE);
    await click('[data-action="unlock"]');
    await waitFor('[data-problems]');
    expect((await count('[data-screen="lock"]')) === 1, 'the old passphrase still works after being replaced');
    await type('#unlock-passphrase', SECOND_PASSPHRASE);
    await click('[data-action="unlock"]');
    await waitFor('[data-screen="home"]');
    step('old passphrase refused, new passphrase accepted');

    // The audit trail shows what happened and reports itself intact.
    await waitFor('[data-activity-item]');
    const recorded = await count('[data-activity-item]');
    expect(recorded >= 8, `expected at least 8 audit entries, found ${recorded}`);
    expect((await count('[data-activity-broken]')) === 0, 'the audit trail reports itself as damaged');
    step(`audit trail shows ${recorded} entries`);

    // Lose the archive, then get it back from the backup.
    await click('[data-action="lock"]');
    await waitFor('[data-screen="lock"]');
    const archiveFolder = path.join(smokeFolder, 'Echo Archive');
    renameSync(archiveFolder, path.join(smokeFolder, 'Echo Archive (lost)'));
    const reloaded = pageLoaded();
    win.webContents.reload();
    await reloaded;
    await page(PAGE_HELPERS);
    await waitFor('[data-screen="missing"]');
    await click('[data-action="restore"]');
    await waitFor('[data-screen="lock"]');
    expect(existsSync(path.join(archiveFolder, 'vault.json')), 'the archive was not restored to its folder');
    await type('#unlock-passphrase', SECOND_PASSPHRASE);
    await click('[data-action="unlock"]');
    await waitFor('[data-screen="home"]');
    await waitFor('[data-people-status="1"]');
    await waitFor('[data-consent-status="withdrawn"]');
    await waitFor('[data-activity-item]');
    expect((await count('[data-activity-broken]')) === 0, 'the restored audit trail reports itself as damaged');
    step('archive lost, restored from the backup, and opened with everything in it');

    // A copy of everything: ordinary files that open without Echo, and a plain warning that they are not encrypted.
    await click('[data-action="open-setup"]');
    await waitFor('[data-screen="settings"] [data-section="export"]');
    await click('[data-action="export-everything"]');
    await waitFor('[data-export-done]');
    const exported = await page<string>(`document.querySelector('[data-export-folder]').textContent`);
    expect(exported.startsWith(path.join(smokeFolder, 'exports', 'Echo export ')), `the copy was not put in the chosen folder: ${exported}`);
    for (const file of ['README.txt', 'people.json', 'consent/consent.json', 'echo/what-it-remembers.json', 'activity-log.json']) {
      expect(existsSync(path.join(exported, file)), `the copy has no ${file}`);
    }
    expect(readFileSync(path.join(exported, 'README.txt'), 'utf8').includes('NOTHING IN THIS FOLDER IS ENCRYPTED'), 'the copy does not say it is not encrypted');
    const lettersOut = readdirSync(path.join(exported, 'letters'));
    const letterFile = lettersOut.find((name) => name.endsWith('.txt'));
    expect(letterFile !== undefined && readFileSync(path.join(exported, 'letters', letterFile), 'utf8').includes('The clock in the hall is yours'), 'the letter is not readable in the copy');
    expect(lettersOut.some((name) => name.endsWith('page 1.jpg')), 'the picture of the letter is not in the copy');
    step('copy of everything written as ordinary files, with the warning that it is not encrypted');

    // Deleting the conversations, then everything. The passphrase is asked for again, and a wrong one deletes nothing.
    await click('[data-action="delete-chats"]');
    await click('[data-action="delete-chats-confirm"]');
    await waitFor('[data-delete-note]');
    await click('[data-action="delete-everything"]');
    await waitFor('#delete-passphrase');
    await type('#delete-passphrase', 'definitely not the passphrase');
    await click('[data-action="delete-everything-confirm"]');
    await waitForText('[data-section="delete"] [data-problems]', 'Nothing has been deleted');
    expect(existsSync(path.join(archiveFolder, 'vault.json')), 'a wrong passphrase deleted the archive');
    await type('#delete-passphrase', SECOND_PASSPHRASE);
    await click('[data-action="delete-everything-confirm"]');
    await waitFor('[data-section="deleted"][data-backup-outcome="deleted"]');
    expect(!existsSync(archiveFolder), 'the archive folder is still there after deleting everything');
    expect(!existsSync(path.join(smokeFolder, 'usb-drive', 'Echo Backup')), 'the backup is still there after deleting everything');
    expect(existsSync(path.join(exported, 'README.txt')), 'deleting everything also deleted the copy the owner took');
    await click('[data-action="deleted-close"]');
    await waitFor('[data-screen="create-archive"]');
    step('conversations deleted; everything deleted after the passphrase, backup too; Echo is ready to start afresh');

    clearTimeout(overall);
    console.log('SMOKE OK');
    app.exit(0);
  } catch (error) {
    clearTimeout(overall);
    console.error('SMOKE FAIL:', error instanceof Error ? error.message : error);
    app.exit(1);
  }
}
