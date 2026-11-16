// Builds ZIP files by hand for tests, so Echo's ZIP reader is checked against
// the format itself and not against a writer that shares its mistakes.

import { deflateRawSync } from 'node:zlib';

export interface ZipFile {
  name: string;
  contents: Buffer;
  deflate?: boolean;
}

/** `big` writes the layout used for ZIPs over 4 GB (ZIP64), with every large figure moved to its second place. */
export function makeZip(files: readonly ZipFile[], big = false): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const packed = file.deflate ? deflateRawSync(file.contents) : file.contents;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.deflate ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(file.contents.length, 22);
    local.writeUInt16LE(name.length, 26);

    const extra = big ? Buffer.alloc(28) : Buffer.alloc(0);
    if (big) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(file.contents.length), 4);
      extra.writeBigUInt64LE(BigInt(packed.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(file.deflate ? 8 : 0, 10);
    header.writeUInt32LE(big ? 0xffffffff : packed.length, 20);
    header.writeUInt32LE(big ? 0xffffffff : file.contents.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(big ? 0xffffffff : offset, 42);
    locals.push(local, name, packed);
    central.push(header, name, extra);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(big ? 0xffff : files.length, 8);
  end.writeUInt16LE(big ? 0xffff : files.length, 10);
  end.writeUInt32LE(big ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(big ? 0xffffffff : offset, 16);
  if (!big) return Buffer.concat([...locals, directory, end]);

  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeBigUInt64LE(BigInt(files.length), 24);
  record.writeBigUInt64LE(BigInt(files.length), 32);
  record.writeBigUInt64LE(BigInt(directory.length), 40);
  record.writeBigUInt64LE(BigInt(offset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
  locator.writeUInt32LE(1, 16);
  return Buffer.concat([...locals, directory, record, locator, end]);
}
