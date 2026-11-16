import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wireMessages } from '../src/core/anthropic.ts';
import { READ_PAGE_INSTRUCTIONS, letterProblems, letterSourceTitle, readPageAnswer, tidyLetter, unreadCount } from '../src/shared/letters.ts';
import type { LetterDetails } from '../src/shared/letters.ts';
import type { Person } from '../src/shared/people.ts';

const JULIE = { id: 'p1', name: 'Julie', relationship: 'wife', callsMe: '', mayTalkToEcho: true } as Person;
const good: LetterDetails = { title: 'Before the wedding', personId: 'p1', writtenOn: '1998-06', text: 'My dear Julie, I am not a man for speeches.', audience: { kind: 'person', personId: 'p1' }, mine: true, checked: true };

test('a letter can be saved only if it is the owner\'s own, has words, has no unread marks, and has been checked', () => {
  assert.deepEqual(letterProblems(good, [JULIE]), []);
  assert.ok(letterProblems({ ...good, mine: false }, [JULIE])[0]!.includes('letters you wrote yourself'));
  assert.ok(letterProblems({ ...good, checked: false }, [JULIE])[0]!.includes('tick the box'));
  assert.ok(letterProblems({ ...good, title: '  ' }, [JULIE])[0]!.includes('name'));
  assert.ok(letterProblems({ ...good, text: ' \n ' }, [JULIE])[0]!.includes('Type the words'));
  assert.ok(letterProblems({ ...good, text: 'The [?] is yours and so is the [?].' }, [JULIE])[0]!.startsWith('2 places are still marked [?]'));
  assert.ok(letterProblems({ ...good, text: 'The [?] is yours.' }, [JULIE])[0]!.startsWith('One place is still marked [?]'));
  assert.ok(letterProblems({ ...good, personId: 'gone' }, [JULIE])[0]!.includes('who the letter was to'));
  assert.ok(letterProblems({ ...good, audience: { kind: 'person', personId: 'gone' } }, [JULIE])[0]!.includes('who may hear'));
  assert.deepEqual(letterProblems({ ...good, personId: null, audience: { kind: 'everyone' } }, []), []);
  assert.equal(unreadCount('no marks here'), 0);
});

test('when it was written can be a year, a month or a day, or left empty; nothing else', () => {
  for (const fine of ['', '1998', '1998-06', '1998-06-14', '1900']) assert.deepEqual(letterProblems({ ...good, writtenOn: fine }, [JULIE]), [], fine);
  for (const bad of ['98', 'June 1998', '1998-13', '1998-02-30', '1899', '2999', '14/06/1998']) assert.equal(letterProblems({ ...good, writtenOn: bad }, [JULIE]).length, 1, bad);
});

test('a letter is stored tidied, and named in the memory store with who it was to and when', () => {
  assert.deepEqual(tidyLetter({ ...good, title: '  Before the wedding ', text: 'One.  \r\n\r\n\r\n\r\nTwo.\n' }), {
    title: 'Before the wedding',
    personId: 'p1',
    writtenOn: '1998-06',
    text: 'One.\n\nTwo.',
    audience: { kind: 'person', personId: 'p1' },
  });
  assert.equal(letterSourceTitle({ title: 'Before the wedding', writtenOn: '1998-06' }, 'Julie'), 'Before the wedding (to Julie, written 1998-06)');
  assert.equal(letterSourceTitle({ title: 'Before the wedding', writtenOn: '' }, null), 'Before the wedding');
  assert.equal(letterSourceTitle({ title: 'From the rig', writtenOn: '1987' }, null), 'From the rig (written 1987)');
});

test('the reader is told to copy and never to guess, and an empty reading is refused', () => {
  assert.ok(READ_PAGE_INSTRUCTIONS.includes('Never guess a word you cannot read'));
  assert.ok(READ_PAGE_INSTRUCTIONS.includes('[?]'));
  assert.deepEqual(readPageAnswer('  My dear Julie,\r\n\r\nI am not a man for speeches.  '), { ok: true, text: 'My dear Julie,\n\nI am not a man for speeches.' });
  assert.equal(readPageAnswer('NOTHING').ok, false);
  assert.equal(readPageAnswer('nothing.').ok, false);
  assert.equal(readPageAnswer('   ').ok, false);
  assert.equal(readPageAnswer('Nothing would please me more than to see you.').ok, true); // a letter that starts with the word
});

test('a picture is sent in front of the words of the first message, and only when there is one', () => {
  const messages = [{ role: 'user' as const, content: 'Here is the page.' }, { role: 'assistant' as const, content: 'ok' }];
  assert.deepEqual(wireMessages({ system: 's', messages, maxTokens: 10 }), messages);
  assert.deepEqual(wireMessages({ system: 's', messages, maxTokens: 10, picture: { mimeType: 'image/jpeg', base64: 'QUJD' } }), [
    { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } }, { type: 'text', text: 'Here is the page.' }] },
    { role: 'assistant', content: 'ok' },
  ]);
});
