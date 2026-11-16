// Helpers for taking a copy of everything out of the archive in formats any
// computer can open: plain text, JSON, and the recordings and pictures as the
// ordinary files they are.
//
// The copy is NOT encrypted. That is the point of it, and the screens say so.

/** A name that is safe as a Windows file name, from something the person typed. */
export function safeName(text: string, fallback = 'untitled'): string {
  const cleaned = text
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/[. ]+$/, '');
  // Windows keeps a few names for itself.
  return cleaned.length === 0 || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) ? fallback : cleaned;
}

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** The ending a file of this kind should have, so other programs know how to open it. */
export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType.split(';')[0]?.trim().toLowerCase() ?? ''] ?? 'bin';
}

/** Gives out file names within one folder, adding a number where two things would have the same name. */
export function namer(): (base: string, extension: string) => string {
  const used = new Set<string>();
  return (base, extension) => {
    let name = `${base}.${extension}`;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} (${n}).${extension}`;
    used.add(name.toLowerCase());
    return name;
  };
}

/** "01", "02" … so files sort in the order they were made. */
export function numbered(index: number, total: number): string {
  return String(index + 1).padStart(Math.max(2, String(total).length), '0');
}

/** The folder name for an export made at this moment: "Echo export 2026-11-12 1730". */
export function exportFolderName(at: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `Echo export ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}${two(at.getMinutes())}`;
}

/** A plain-text file: a few "Name: value" lines, an empty line, then the words. */
export function textFile(facts: readonly [string, string][], words: string): string {
  const head = facts.filter(([, value]) => value.length > 0).map(([name, value]) => `${name}: ${value}`);
  return `${[...head, '', words.trim()].join('\r\n').replace(/(?<!\r)\n/g, '\r\n')}\r\n`;
}

/** The note that goes at the top of every export, so someone opening it years later knows what they are looking at. */
export function exportReadme(ownerName: string, madeAt: string, counts: Record<string, number>): string {
  const lines = [
    `This is a copy of everything in ${ownerName ? `${ownerName}'s` : 'an'} Echo archive, made on ${madeAt}.`,
    '',
    'NOTHING IN THIS FOLDER IS ENCRYPTED. Anyone who can open the folder can read, see and hear all of it.',
    'It includes other people\'s messages, in the "messages" folder, exactly as they were imported.',
    'Keep it somewhere safe, or delete it when you are done with it.',
    '',
    'Every file opens without Echo: .txt in any text editor, .json in any text editor or web browser,',
    'and recordings and pictures in any media player or picture viewer.',
    '',
    'What is where:',
    '  people.json            The people named in the archive, and whether each may talk to the echo.',
    '  consent/               What was consented to, and the recording of the consent being given.',
    '  stories/               Each story as a text file, with its recording where it was spoken.',
    '  interview/             The character interview: every question and answer.',
    '  advice/                Advice for named people and occasions, with recordings where spoken.',
    '  letters/               Letters the person wrote, with the pictures of their pages.',
    '  face-and-voice/        The selfies, face video and voice recordings.',
    '  messages/              Imported conversations. "theirs" marks other people\'s messages.',
    '  echo/                  What the echo is made from (memory passages, character sheet, style',
    '                         profile), the conversations had with it, the blind tests, and any',
    '                         write-ups from an assistant that were read and approved.',
    '  activity-log.json      The record of what was done in the archive, and when.',
    '',
    'What is not here: the passphrase, the recovery code and the AI key. They are not part of the archive\'s contents.',
    '',
    'How much is in it:',
    ...Object.entries(counts).map(([name, count]) => `  ${name}: ${count}`),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
