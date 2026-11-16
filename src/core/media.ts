// Encrypted recordings (video, audio, photos) inside the archive.
//
// A recording is cut into pieces and each piece is encrypted on its own, so
// large files never have to be held in memory whole by later build steps.
// Every piece is tied to its file and its position, and the last piece is
// marked as last, so pieces cannot be swapped, dropped or cut off unnoticed.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { purposeKey } from './vault.ts';

const MEDIA_FOLDER = 'media';
const MAGIC = Buffer.from('ECHOMED1', 'ascii');
const FILE_ID_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PIECE_BYTES = 1024 * 1024;

function mediaKey(masterKey: Buffer): Buffer {
  return purposeKey(masterKey, 'echo/media/v1');
}

function mediaFile(archiveDir: string, mediaId: string): string {
  if (!/^[0-9a-f-]{36}$/.test(mediaId)) throw new Error('That is not a recording Echo made.');
  return path.join(archiveDir, MEDIA_FOLDER, `${mediaId}.echo`);
}

function pieceLabel(fileId: Buffer, index: number, last: boolean): Buffer {
  const label = Buffer.alloc(FILE_ID_BYTES + 5);
  fileId.copy(label, 0);
  label.writeUInt32BE(index, FILE_ID_BYTES);
  label.writeUInt8(last ? 1 : 0, FILE_ID_BYTES + 4);
  return label;
}

/** Encrypts a recording into the archive. Returns the id to find it by later. */
export function writeMedia(archiveDir: string, masterKey: Buffer, bytes: Uint8Array): string {
  const key = mediaKey(masterKey);
  try {
    const mediaId = randomUUID();
    const fileId = randomBytes(FILE_ID_BYTES);
    const parts: Buffer[] = [MAGIC, fileId];
    const pieces = Math.max(1, Math.ceil(bytes.length / PIECE_BYTES));
    for (let index = 0; index < pieces; index += 1) {
      const piece = bytes.subarray(index * PIECE_BYTES, (index + 1) * PIECE_BYTES);
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(pieceLabel(fileId, index, index === pieces - 1));
      const body = Buffer.concat([cipher.update(piece), cipher.final()]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(body.length, 0);
      parts.push(length, nonce, body, cipher.getAuthTag());
    }
    const file = mediaFile(archiveDir, mediaId);
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.writing`;
    writeFileSync(temporary, Buffer.concat(parts));
    renameSync(temporary, file);
    return mediaId;
  } finally {
    key.fill(0);
  }
}

/** Decrypts a recording. Throws if it is missing, altered, reordered or cut short. */
export function readMedia(archiveDir: string, masterKey: Buffer, mediaId: string): Buffer {
  const file = mediaFile(archiveDir, mediaId);
  if (!existsSync(file)) throw new Error('That recording is not in the archive.');
  const sealed = readFileSync(file);
  if (sealed.length < MAGIC.length + FILE_ID_BYTES || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('That file is not a recording Echo made.');
  }
  const fileId = sealed.subarray(MAGIC.length, MAGIC.length + FILE_ID_BYTES);
  const key = mediaKey(masterKey);
  try {
    const plain: Buffer[] = [];
    let offset = MAGIC.length + FILE_ID_BYTES;
    let index = 0;
    let sawLast = false;
    while (offset < sealed.length) {
      if (sawLast || offset + 4 + NONCE_BYTES + TAG_BYTES > sealed.length) throw new Error('The recording has been damaged.');
      const length = sealed.readUInt32BE(offset);
      const nonce = sealed.subarray(offset + 4, offset + 4 + NONCE_BYTES);
      const bodyStart = offset + 4 + NONCE_BYTES;
      const tagStart = bodyStart + length;
      if (tagStart + TAG_BYTES > sealed.length) throw new Error('The recording has been cut short.');
      const last = tagStart + TAG_BYTES === sealed.length;
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(pieceLabel(fileId, index, last));
      decipher.setAuthTag(sealed.subarray(tagStart, tagStart + TAG_BYTES));
      try {
        plain.push(Buffer.concat([decipher.update(sealed.subarray(bodyStart, tagStart)), decipher.final()]));
      } catch {
        throw new Error('The recording has been changed or damaged.');
      }
      sawLast = last;
      offset = tagStart + TAG_BYTES;
      index += 1;
    }
    if (!sawLast) throw new Error('The recording has been cut short.');
    return Buffer.concat(plain);
  } finally {
    key.fill(0);
  }
}

/** Removes a recording from the archive. Does nothing if it is already gone. */
export function removeMedia(archiveDir: string, mediaId: string): void {
  rmSync(mediaFile(archiveDir, mediaId), { force: true });
}
