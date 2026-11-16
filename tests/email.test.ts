import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  EMAIL_BYTES_KEPT,
  addressesIn,
  decodeHeader,
  emailWords,
  htmlToText,
  mailEntry,
  ownWords,
  readMailAt,
  readSentEmails,
  scanMailbox,
  senderAddresses,
  sentByRecipient,
  splitEmail,
} from '../src/core/email.ts';
import type { MailEntry } from '../src/core/email.ts';
import { emailText, mailbox } from './helpers/mailbox.ts';
import type { TestEmail } from './helpers/mailbox.ts';

async function entriesOf(file: string): Promise<MailEntry[]> {
  const entries: MailEntry[] = [];
  await scanMailbox(file, (start, offset) => {
    const entry = mailEntry(start.subarray(0, 64 * 1024).toString('latin1'), offset, start.length);
    if (entry) entries.push(entry);
  });
  return entries;
}

function tempFile(contents: Buffer): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'echo-mail-')), 'test.mbox');
  writeFileSync(file, contents);
  return file;
}

test('headers are read with folded lines joined, and coded names put right', () => {
  const { headers, body } = splitEmail('Subject: a long\r\n subject line\r\nFrom: =?UTF-8?B?UmVuw6k=?= <rene@example.com>\r\nFrom: second@example.com\r\n\r\nthe body\r\nmore');
  assert.equal(headers.get('subject'), 'a long subject line');
  assert.equal(body, 'the body\r\nmore');
  assert.deepEqual(addressesIn(headers.get('from')), [{ address: 'rene@example.com', name: 'René' }]); // the first From counts
  assert.equal(decodeHeader('=?ISO-8859-1?Q?Caf=E9_at?= =?ISO-8859-1?Q?_noon?='), 'Café at noon');
  assert.deepEqual(addressesIn('"Babbage, Ben" <Ben@Example.com>, vera@example.com; Ada <ada@example.com>'), [
    { address: 'ben@example.com', name: 'Babbage, Ben' },
    { address: 'vera@example.com', name: '' },
    { address: 'ada@example.com', name: 'Ada' },
  ]);
  assert.deepEqual(addressesIn(undefined), []);
});

test('a mailbox is walked email by email; "From " inside an email does not split it', async () => {
  const file = tempFile(mailbox([
    { from: 'Ada <ada@example.com>', to: 'ben@example.com', body: 'First email.\r\nFrom here on it gets easier.\r\n\r\nFrom the top of the hill you can see the sea.' },
    { from: 'ben@example.com', to: 'ada@example.com', body: 'Second email.', date: 'Sun, 14 Dec 2025 10:00:00 +0000 (GMT)' },
  ]));
  const entries = await entriesOf(file);
  assert.deepEqual(entries.map((entry) => [entry.from, entry.to[0]?.address]), [['ada@example.com', 'ben@example.com'], ['ben@example.com', 'ada@example.com']]);
  assert.equal(entries[1]!.at, Date.UTC(2025, 11, 14, 10, 0, 0));
  const first = readMailAt(file, entries[0]!.offset, entries[0]!.length);
  assert.ok(first.startsWith('From ') && first.includes('you can see the sea') && !first.includes('Second email'));
  assert.ok(readMailAt(file, entries[1]!.offset, entries[1]!.length).includes('Second email.'));
});

test('a mailbox bigger than one read is walked correctly, and a huge attachment is not held in memory', async () => {
  const attachment = `${'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='.repeat(2)}\r\n`.repeat(70_000); // about 5 MB of base64 lines
  const emails: TestEmail[] = [];
  for (let i = 0; i < 40; i += 1) emails.push({ from: 'ada@example.com', to: `person${i}@example.com`, body: `Email number ${i}. ${'padding words '.repeat(20_000)}` });
  emails.splice(3, 0, { from: 'ada@example.com', to: 'big@example.com', body: `Words before the attachment.\r\n${attachment}` });
  const file = tempFile(mailbox(emails));
  const entries = await entriesOf(file);
  assert.equal(entries.length, 41);
  assert.deepEqual(entries.map((entry) => entry.to[0]!.address).filter((address) => address.startsWith('person')), Array.from({ length: 40 }, (_unused, i) => `person${i}@example.com`));
  const big = entries.find((entry) => entry.to[0]!.address === 'big@example.com')!;
  assert.equal(big.length, EMAIL_BYTES_KEPT);
  assert.ok(readMailAt(file, big.offset, big.length).includes('Words before the attachment.'));
  for (const entry of entries) assert.ok(readMailAt(file, entry.offset, 5) === 'From ');
});

test("what the owner quoted from someone else's email is cut off, in every common layout", () => {
  assert.equal(ownWords('Sounds good, see you then.\n\nOn Mon, 1 Dec 2025 at 10:00, Ben <ben@example.com> wrote:\n> Shall we meet at noon?\n> Ben'), 'Sounds good, see you then.');
  assert.equal(ownWords('Yes.\n\nOn Mon, 1 Dec 2025 at 10:00, Ben Babbage\n<ben@example.com> wrote:\n\nShall we meet?'), 'Yes.'); // the line wrapped
  assert.equal(ownWords('Fine by me.\n\n-----Original Message-----\nFrom: Ben\nShall we meet?'), 'Fine by me.');
  assert.equal(ownWords('See below.\n\n---------- Forwarded message ---------\nFrom: Vera\nSecret plans'), 'See below.');
  assert.equal(ownWords('Agreed.\n\n________________________________\nFrom: Ben\nSent: Monday\nShall we meet?'), 'Agreed.');
  assert.equal(ownWords('Agreed.\n\nFrom: Ben Babbage <ben@example.com>\nSent: 01 December 2025 10:00\nTo: Ada\nSubject: Noon\n\nShall we meet?'), 'Agreed.');
  assert.equal(ownWords('Oui.\n\nLe lun. 1 déc. 2025 à 10:00, Ben <ben@example.com> a écrit :\n> On se voit ?'), 'Oui.');
  // Replies written in between the quoted lines: everything from the first quoted line is dropped, the owner's words with it. Safe, not complete.
  assert.equal(ownWords('> Shall we meet at noon?\nYes, noon is fine.\n> Where?\nThe café.'), '');
  assert.equal(ownWords('On reflection I think we should wait.\nFrom: what I hear, it will rain.'), 'On reflection I think we should wait.\nFrom: what I hear, it will rain.'); // ordinary sentences are left alone
});

test('signatures are cut off', () => {
  assert.equal(ownWords('See you Sunday.\n\n-- \nAda Lovelace\n07700 900000'), 'See you Sunday.');
  assert.equal(ownWords('On my way.\n\nSent from my iPhone'), 'On my way.');
  assert.equal(ownWords('line one\n\n\n\nline two   \n'), 'line one\n\nline two');
});

test('the words are found in plain, coded and multi-part emails; an HTML-only email loses its quoted part', () => {
  const plain = emailText({ from: 'ada@example.com', subject: 'Sunday lunch', body: 'Come at one. Bring nothing.' });
  assert.equal(emailWords(plain), 'Sunday lunch\nCome at one. Bring nothing.'); // a subject the sender chose is kept
  const reply = emailText({ from: 'ada@example.com', subject: 'Re: Secret birthday plans', body: 'I will be there.' });
  assert.equal(emailWords(reply), 'I will be there.'); // a reply's subject was someone else's
  const answered = emailText({ from: 'ada@example.com', subject: 'Plans', headers: ['In-Reply-To: <x@test>'], body: 'I will be there.' });
  assert.equal(emailWords(answered), 'I will be there.');

  const base64 = emailText({ from: 'ada@example.com', subject: 'Re: x', headers: ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64'], body: Buffer.from('Meet me at the café.', 'utf8').toString('base64') });
  assert.equal(emailWords(base64), 'Meet me at the café.');
  const latin = emailText({ from: 'ada@example.com', subject: 'Re: x', headers: ['Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable'], body: 'Meet me at the caf=E9, it is a long=\r\n way.' });
  assert.equal(emailWords(latin), 'Meet me at the café, it is a long way.');

  const multi = emailText({
    from: 'ada@example.com',
    subject: 'Re: x',
    headers: ['Content-Type: multipart/mixed; boundary="outer"'],
    body: [
      '--outer',
      'Content-Type: multipart/alternative; boundary="inner"',
      '',
      '--inner',
      'Content-Type: text/html; charset="UTF-8"',
      '',
      '<p>The HTML form.</p>',
      '--inner',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'The plain form.',
      '--inner--',
      '--outer',
      'Content-Type: text/plain; name="notes.txt"',
      'Content-Disposition: attachment; filename="notes.txt"',
      '',
      'An attached file, not the email.',
      '--outer--',
    ].join('\r\n'),
  });
  assert.equal(emailWords(multi), 'The plain form.');

  const html = emailText({
    from: 'ada@example.com',
    subject: 'Re: x',
    headers: ['Content-Type: text/html; charset="UTF-8"'],
    body: '<html><head><style>p{color:red}</style></head><body><p>Tea &amp; cake at four,<br>don&#39;t be late.</p><div class="gmail_quote">On Monday Ben wrote:<blockquote>Secret plans</blockquote></div></body></html>',
  });
  assert.equal(emailWords(html), "Tea & cake at four,\ndon't be late.");
  assert.equal(htmlToText('<p>Mine</p><hr><b>From:</b> Ben<br>Theirs'), 'Mine\n');
  assert.equal(emailWords(emailText({ from: 'ada@example.com', subject: 'Fwd: x', body: '---------- Forwarded message ---------\nFrom: Vera\nAll hers' })), ''); // nothing of the sender's
});

test("the owner's addresses are suggested from Gmail's Sent label, or from a mailbox that is all one sender", async () => {
  const gmail = await entriesOf(tempFile(mailbox([
    { from: 'Ada <ada@example.com>', to: 'ben@example.com', labels: 'Sent,Important', body: 'a' },
    { from: 'ada@example.com', to: 'vera@example.com', labels: 'Sent', body: 'b' },
    { from: 'News <news@example.com>', to: 'ada@example.com', labels: 'Inbox', body: 'c' },
    { from: 'news@example.com', to: 'ada@example.com', labels: 'Inbox', body: 'd' },
    { from: 'news@example.com', to: 'ada@example.com', labels: 'Inbox', body: 'e' },
  ])));
  const found = senderAddresses(gmail);
  assert.deepEqual(found.suggested, ['ada@example.com']);
  assert.deepEqual(found.addresses, [{ address: 'ada@example.com', name: 'Ada', count: 2 }, { address: 'news@example.com', name: 'News', count: 3 }]);

  const sentFolder = await entriesOf(tempFile(mailbox([{ from: 'ada@example.com', to: 'ben@example.com', body: 'a' }, { from: 'ada@example.com', to: 'vera@example.com', body: 'b' }])));
  assert.deepEqual(senderAddresses(sentFolder).suggested, ['ada@example.com']);
  const mixed = await entriesOf(tempFile(mailbox([{ from: 'ada@example.com', to: 'ben@example.com', body: 'a' }, { from: 'ben@example.com', to: 'ada@example.com', body: 'b' }])));
  assert.deepEqual(senderAddresses(mixed).suggested, []); // no way to tell: the owner says
});

test("only the owner's sent email is grouped; drafts, binned mail, automatic replies and repeats are left out", async () => {
  const file = tempFile(mailbox([
    { from: 'ada@example.com', to: 'Ben Babbage <ben@example.com>, vera@example.com', labels: 'Sent', date: 'Sun, 14 Dec 2025 10:00:00 +0000', body: 'Second to Ben.' },
    { from: 'ada@example.com', to: 'ben@example.com', labels: 'Sent', date: 'Sat, 13 Dec 2025 10:00:00 +0000', body: 'First to Ben.\r\n\r\nOn Friday Ben wrote:\r\n> Something private Ben said' },
    { from: 'ben@example.com', to: 'ada@example.com', labels: 'Inbox', body: 'Something private Ben said' },
    { from: 'ada@example.com', to: 'ben@example.com', labels: 'Drafts', body: 'Never sent.' },
    { from: 'ada@example.com', to: 'ben@example.com', labels: 'Sent,Trash', body: 'Thrown away.' },
    { from: 'ada@example.com', to: 'ben@example.com', labels: 'Sent', headers: ['Auto-Submitted: auto-replied'], body: 'I am away until Monday.' },
    { from: 'ada@example.com', to: 'ben@example.com', labels: 'Sent', headers: ['Message-ID: <same@test>'], date: 'Mon, 15 Dec 2025 10:00:00 +0000', body: 'Third to Ben.' },
    { from: 'ada@example.com', to: 'ben@example.com', labels: 'Sent', headers: ['Message-ID: <same@test>'], date: 'Mon, 15 Dec 2025 10:00:00 +0000', body: 'Third to Ben.' },
    { from: 'ada@example.com', labels: 'Sent', body: 'Blind copies only.' },
    { from: 'ada@example.com', to: 'vera@example.com', labels: 'Sent', date: 'not a date', body: 'When?' },
  ]));
  const groups = sentByRecipient(await entriesOf(file), new Set(['ada@example.com']));
  assert.deepEqual([...groups.keys()].sort(), ['(nobody on the To line)', 'ben@example.com']);
  const ben = groups.get('ben@example.com')!;
  assert.equal(ben.name, 'Ben Babbage');
  const read = readSentEmails(file, ben.emails, 'Ada Lovelace');
  assert.deepEqual(read.messages.map((message) => message.text), ['Hello\nFirst to Ben.', 'Hello\nSecond to Ben.', 'Hello\nThird to Ben.']); // oldest first, each under the subject its sender chose
  assert.ok(read.messages.every((message) => message.sender === 'Ada Lovelace'));
  assert.ok(!JSON.stringify(read).includes('private')); // Ben's words are nowhere in what is kept
  assert.equal(sentByRecipient(await entriesOf(file), new Set(['nobody@example.com'])).size, 0);
});
