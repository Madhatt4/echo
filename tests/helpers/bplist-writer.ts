// Writes Apple's binary property lists for tests, so Echo's reader is checked
// against the format and not against a writer that shares its mistakes. It
// writes only what an iPhone backup's records use.

export class Uid {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
}

export type Writable = null | boolean | number | string | Buffer | Uid | Writable[] | { [key: string]: Writable };

function sized(marker: number, length: number): Buffer {
  if (length < 15) return Buffer.from([marker | length]);
  const count = Buffer.alloc(4);
  count.writeUInt32BE(length);
  return Buffer.concat([Buffer.from([marker | 0x0f, 0x12]), count]);
}

export function writeBinaryPlist(root: Writable): Buffer {
  const objects: Buffer[] = [];
  const ref = (index: number) => {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16BE(index);
    return bytes;
  };
  const add = (value: Writable): number => {
    const index = objects.length;
    objects.push(Buffer.alloc(0)); // hold the place, so a parent comes before its children
    let bytes: Buffer;
    if (value === null) bytes = Buffer.from([0x00]);
    else if (typeof value === 'boolean') bytes = Buffer.from([value ? 0x09 : 0x08]);
    else if (typeof value === 'number') {
      bytes = Buffer.alloc(9);
      bytes[0] = 0x13;
      bytes.writeBigUInt64BE(BigInt(value), 1);
    } else if (typeof value === 'string') {
      const ascii = /^[\x00-\x7f]*$/.test(value);
      bytes = ascii ? Buffer.concat([sized(0x50, value.length), Buffer.from(value, 'latin1')]) : Buffer.concat([sized(0x60, value.length), Buffer.from(value, 'utf16le').swap16()]);
    } else if (Buffer.isBuffer(value)) bytes = Buffer.concat([sized(0x40, value.length), value]);
    else if (value instanceof Uid) bytes = Buffer.from([0x80, value.value]);
    else if (Array.isArray(value)) bytes = Buffer.concat([sized(0xa0, value.length), ...value.map((item) => ref(add(item)))]);
    else {
      const keys = Object.keys(value);
      const keyRefs = keys.map((key) => ref(add(key)));
      const valueRefs = keys.map((key) => ref(add(value[key] ?? null)));
      bytes = Buffer.concat([sized(0xd0, keys.length), ...keyRefs, ...valueRefs]);
    }
    objects[index] = bytes;
    return index;
  };
  add(root);

  const header = Buffer.from('bplist00', 'latin1');
  const offsets: number[] = [];
  let position = header.length;
  for (const object of objects) {
    offsets.push(position);
    position += object.length;
  }
  const table = Buffer.alloc(offsets.length * 4);
  offsets.forEach((offset, index) => table.writeUInt32BE(offset, index * 4));
  const trailer = Buffer.alloc(32);
  trailer[6] = 4; // bytes in each offset
  trailer[7] = 2; // bytes in each reference
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(position), 24);
  return Buffer.concat([header, ...objects, table, trailer]);
}
