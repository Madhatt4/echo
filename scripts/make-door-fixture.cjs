// Used only by the automated check of the installed app: makes an assistant
// door folder with one passage in it, using Echo's own built code, so the
// installed echo-door command has something real to read.
const door = require('../dist/core/door.js');

const folder = process.argv[2];
if (!folder) {
  console.error('usage: node scripts/make-door-fixture.cjs <folder>');
  process.exit(2);
}
door.openDoor(folder);
door.writeDoorStore(folder, {
  version: 1,
  writtenAt: new Date().toISOString(),
  owner: 'Check Owner',
  passages: [
    { id: 'p1', from: 'story', title: 'The caravan', context: '', text: 'We went to the caravan every summer and it always rained.', date: '2026-11-13T09:00:00.000Z' },
    { id: 'p2', from: 'interview', title: 'Work', context: 'What did you do for a living?', text: 'I drove lorries for thirty years.', date: '2026-11-12T09:00:00.000Z' },
  ],
  characterSheet: [{ section: 'How I talk', text: 'Plain speaker' }],
  styleProfile: [],
});
