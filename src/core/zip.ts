// Reads one file out of a ZIP without unpacking the rest. A WhatsApp export
// with photos can be hundreds of megabytes; only the chat text is needed, so
// only the list of contents and that one file are read from disk.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  headerOffset: number;
}

function read(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const got = readSync(fd, buffer, done, length - done, position + done);
    if (got === 0) break;
    done += got;
  }
  return buffer.subarray(0, done);
}

/** The list of files in a ZIP. Throws a plain-English error if the file is not a ZIP this reader can handle. */
export function listZip(fd: number): ZipEntry[] {
  const size = fstatSync(fd).size;
  const tailLength = Math.min(size, 65_557);
  const tail = read(fd, size - tailLength, tailLength);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('That file is not a ZIP.');
  let count = tail.readUInt16LE(end + 10);
  let directorySize = tail.readUInt32LE(end + 12);
  let directoryOffset = tail.readUInt32LE(end + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    // A big ZIP (over 4 GB, or over 65,535 files) keeps its real figures in a second, longer record.
    const locator = end - 20;
    if (locator < 0 || tail.readUInt32LE(locator) !== 0x07064b50) throw new Error('That ZIP is damaged.');
    const record = read(fd, Number(tail.readBigUInt64LE(locator + 8)), 56);
    if (record.length < 56 || record.readUInt32LE(0) !== 0x06064b50) throw new Error('That ZIP is damaged.');
    count = Number(record.readBigUInt64LE(32));
    directorySize = Number(record.readBigUInt64LE(40));
    directoryOffset = Number(record.readBigUInt64LE(48));
  }

  const directory = read(fd, directoryOffset, directorySize);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count && at + 46 <= directory.length; i += 1) {
    if (directory.readUInt32LE(at) !== 0x02014b50) break;
    const nameLength = directory.readUInt16LE(at + 28);
    const extraLength = directory.readUInt16LE(at + 30);
    const commentLength = directory.readUInt16LE(at + 32);
    let compressedSize = directory.readUInt32LE(at + 20);
    let size = directory.readUInt32LE(at + 24);
    let headerOffset = directory.readUInt32LE(at + 42);
    // In a big ZIP, a figure too large for its usual place is in the entry's extra data instead, in this order.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = directory.readUInt16LE(extra);
      const length = directory.readUInt16LE(extra + 2);
      if (id === 0x0001) {
        let field = extra + 4;
        const next = () => {
          const value = Number(directory.readBigUInt64LE(field));
          field += 8;
          return value;
        };
        if (size === 0xffffffff) size = next();
        if (compressedSize === 0xffffffff) compressedSize = next();
        if (headerOffset === 0xffffffff) headerOffset = next();
      }
      extra += 4 + length;
    }
    entries.push({
      name: directory.subarray(at + 46, at + 46 + nameLength).toString('utf8'),
      method: directory.readUInt16LE(at + 10),
      compressedSize,
      size,
      headerOffset,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The contents of one file in a ZIP. `maxBytes` guards against a file that unpacks to something enormous. */
export function readZipEntry(fd: number, entry: ZipEntry, maxBytes: number): Buffer {
  if (entry.size > maxBytes || entry.compressedSize > maxBytes) throw new Error('That file is too big for Echo to read.');
  const header = read(fd, entry.headerOffset, 30);
  if (header.length < 30 || header.readUInt32LE(0) !== 0x04034b50) throw new Error('That ZIP is damaged.');
  const dataOffset = entry.headerOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const packed = read(fd, dataOffset, entry.compressedSize);
  if (entry.method === 0) return packed;
  if (entry.method === 8) return inflateRawSync(packed, { maxOutputLength: maxBytes });
  throw new Error('That ZIP is packed in a way Echo cannot read.');
}

/** The names and sizes of the files in a ZIP. */
export function namesInZip(zipPath: string): { name: string; size: number }[] {
  const fd = openSync(zipPath, 'r');
  try {
    return listZip(fd).map((entry) => ({ name: entry.name, size: entry.size }));
  } finally {
    closeSync(fd);
  }
}

/** Opens a ZIP and returns the contents of the named files, in the order asked for. `maxBytes` is the limit for all of them together. */
export function readManyFromZip(zipPath: string, names: readonly string[], maxBytes: number): Buffer[] {
  const fd = openSync(zipPath, 'r');
  try {
    const entries = listZip(fd);
    let left = maxBytes;
    return names.map((name) => {
      const entry = entries.find((candidate) => candidate.name === name);
      if (!entry) throw new Error('That ZIP no longer holds the file Echo was looking for.');
      const contents = readZipEntry(fd, entry, left);
      left -= contents.length;
      return contents;
    });
  } finally {
    closeSync(fd);
  }
}

/** Opens a ZIP, picks one file from its list of names, and returns that file's contents. */
export function readFromZip(zipPath: string, pick: (names: string[]) => string | null, maxBytes: number): { name: string; contents: Buffer } {
  const fd = openSync(zipPath, 'r');
  try {
    const entries = listZip(fd);
    const name = pick(entries.map((entry) => entry.name));
    const entry = entries.find((candidate) => candidate.name === name);
    if (!name || !entry) throw new Error('There is no chat text file inside that ZIP.');
    return { name, contents: readZipEntry(fd, entry, maxBytes) };
  } finally {
    closeSync(fd);
  }
}
