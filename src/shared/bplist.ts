// Reads Apple's binary property lists ("bplist00"), the format an iPhone
// backup uses for its own records. Only reading is needed, and only the kinds
// of value a backup uses.

/** A reference from one part of an archived object to another. */
export interface PlistUid {
  UID: number;
}

export type PlistValue = null | boolean | number | string | Uint8Array | PlistUid | PlistValue[] | { [key: string]: PlistValue };

export function isPlistUid(value: unknown): value is PlistUid {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array) && typeof (value as PlistUid).UID === 'number' && Object.keys(value).length === 1;
}

function big(bytes: Uint8Array, at: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i += 1) value = value * 256 + (bytes[at + i] ?? 0);
  return value;
}

/** Reads a binary property list. Throws a plain-English error if the bytes are not one. */
export function readBinaryPlist(bytes: Uint8Array): PlistValue {
  const header = String.fromCharCode(...bytes.subarray(0, 8));
  if (!header.startsWith('bplist0') || bytes.length < 40) throw new Error('That is not a property list Echo can read.');
  const trailer = bytes.length - 32;
  const offsetSize = bytes[trailer + 6] ?? 0;
  const refSize = bytes[trailer + 7] ?? 0;
  const count = big(bytes, trailer + 8, 8);
  const top = big(bytes, trailer + 16, 8);
  const table = big(bytes, trailer + 24, 8);
  if (offsetSize < 1 || refSize < 1 || table + count * offsetSize > bytes.length) throw new Error('That property list is damaged.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reading = new Set<number>();

  const read = (index: number): PlistValue => {
    if (index >= count || reading.has(index)) throw new Error('That property list is damaged.');
    let at = big(bytes, table + index * offsetSize, offsetSize);
    const marker = bytes[at] ?? 0;
    const kind = marker >> 4;
    const info = marker & 0x0f;
    at += 1;

    /** For kinds that have a length: the length, moving past it when it is too big to sit in the marker. */
    const length = (): number => {
      if (info !== 0x0f) return info;
      const size = 1 << ((bytes[at] ?? 0) & 0x0f);
      const value = big(bytes, at + 1, size);
      at += 1 + size;
      return value;
    };

    switch (kind) {
      case 0x0:
        return info === 0x09 ? true : info === 0x08 ? false : null;
      case 0x1:
        return big(bytes, at, 1 << info);
      case 0x2:
        return info === 2 ? view.getFloat32(at) : view.getFloat64(at);
      case 0x3:
        // A moment, in seconds since the start of 2001. Given as the number of milliseconds since 1970.
        return view.getFloat64(at) * 1000 + 978_307_200_000;
      case 0x4: {
        const size = length();
        return bytes.slice(at, at + size);
      }
      case 0x5: {
        const size = length();
        return String.fromCharCode(...bytes.subarray(at, at + size));
      }
      case 0x6: {
        const size = length();
        let text = '';
        for (let i = 0; i < size; i += 1) text += String.fromCharCode(view.getUint16(at + i * 2));
        return text;
      }
      case 0x8:
        return { UID: big(bytes, at, info + 1) };
      case 0xa: {
        const size = length();
        reading.add(index);
        const items: PlistValue[] = [];
        for (let i = 0; i < size; i += 1) items.push(read(big(bytes, at + i * refSize, refSize)));
        reading.delete(index);
        return items;
      }
      case 0xd: {
        const size = length();
        reading.add(index);
        const dict: { [key: string]: PlistValue } = {};
        for (let i = 0; i < size; i += 1) {
          const key = read(big(bytes, at + i * refSize, refSize));
          dict[typeof key === 'string' ? key : String(i)] = read(big(bytes, at + (size + i) * refSize, refSize));
        }
        reading.delete(index);
        return dict;
      }
      default:
        throw new Error('That property list holds something Echo cannot read.');
    }
  };

  return read(top);
}
