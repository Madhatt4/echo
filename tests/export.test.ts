import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportFolderName, exportReadme, extensionFor, namer, numbered, safeName, textFile } from '../src/core/export.ts';

test('names the person typed become safe Windows file names', () => {
  assert.equal(safeName('  To Julie: before the wedding?  '), 'To Julie before the wedding');
  assert.equal(safeName('a/b\\c*d"e<f>g|h'), 'a b c d e f g h');
  assert.equal(safeName('ends with dots...'), 'ends with dots');
  assert.equal(safeName('   '), 'untitled');
  assert.equal(safeName('CON', 'story'), 'story'); // a name Windows keeps for itself
  assert.equal(safeName('x'.repeat(200)).length, 60);
  assert.equal(safeName('line\none\ttwo'), 'line one two');
});

test('files get the ending other programs expect, and no two files in a folder share a name', () => {
  assert.equal(extensionFor('audio/webm;codecs=opus'), 'webm');
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(extensionFor('video/mp4'), 'mp4');
  assert.equal(extensionFor('something/else'), 'bin');
  const name = namer();
  assert.deepEqual([name('01 The caravan', 'txt'), name('01 The caravan', 'webm'), name('01 the Caravan', 'txt'), name('01 The caravan', 'txt')], [
    '01 The caravan.txt',
    '01 The caravan.webm',
    '01 the Caravan (2).txt', // Windows does not tell capitals apart
    '01 The caravan (3).txt',
  ]);
  assert.deepEqual([numbered(0, 5), numbered(11, 12), numbered(4, 250)], ['01', '12', '005']);
  assert.equal(exportFolderName(new Date(2026, 10, 12, 9, 5)), 'Echo export 2026-11-12 0905');
});

test('a text file has its facts first, leaves out the empty ones, and uses Windows line endings', () => {
  assert.equal(textFile([['Title', 'The caravan'], ['Prompt', ''], ['Recorded', '2026-11-12']], '  We went every summer.\nIt rained.  '), 'Title: The caravan\r\nRecorded: 2026-11-12\r\n\r\nWe went every summer.\r\nIt rained.\r\n');
  assert.equal(textFile([], 'Just words.'), '\r\nJust words.\r\n');
});

test('the note at the top of an export says plainly that nothing in it is encrypted', () => {
  const readme = exportReadme('Ada Lovelace', '2026-11-12', { Stories: 3 });
  assert.ok(readme.startsWith("This is a copy of everything in Ada Lovelace's Echo archive, made on 2026-11-12."));
  assert.ok(readme.includes('NOTHING IN THIS FOLDER IS ENCRYPTED'));
  assert.ok(readme.includes("other people's messages"));
  assert.ok(readme.includes('Stories: 3'));
});
