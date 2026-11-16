// Pairing phones and taking in what they send. The inbox listens only while the
// archive is open and there is a phone paired or a pairing code showing; at any
// other time nothing on this computer is listening for a phone.

import { networkInterfaces } from 'node:os';
import type { NetworkInterfaceInfo } from 'node:os';
import QRCode from 'qrcode';
import type { ActionResult, PairingOffer, PhoneSummary } from '../shared/api.ts';
import type { AuditDetail } from '../core/audit.ts';
import { INBOX_PORT, envelopeSender, makePairingToken, openPairRequest, openRecording, pairingCodeText, receiptFor, sameToken, splitMedia } from '../core/phone-link.ts';
import type { PairRequest, RecordingHeader } from '../core/phone-link.ts';
import { addPhone, alreadyReceived, loadPhones, markReceived, pcLinkKeys, removePhone } from '../core/phones.ts';
import { isHomeAddress, startInbox } from './inbox-server.ts';
import type { InboxReply, RunningInbox } from './inbox-server.ts';

const OFFER_MINUTES = 10;
const OFFER_TRIES = 5;

export interface PhoneInboxOptions {
  /** Where to listen. Defaults to every home-network address on the inbox port. */
  host?: string;
  port?: number;
  /** The address put in the QR code. Defaults to this computer's first home-network address. */
  lanAddress?: () => string | null;
}

export interface PhoneInboxDeps extends PhoneInboxOptions {
  archive(): { dir: string; key: Buffer } | null;
  /** Files a recording, and any pictures with it, as a story. Refused, for example, when consent has been withdrawn. */
  fileStory(header: RecordingHeader, recording: Buffer, pictures: { bytes: Buffer; mimeType: string }[]): ActionResult;
  record(type: string, detail?: AuditDetail): void;
  now(): Date;
}


/** Home-network kinds in the order a phone on the Wi-Fi is most likely to reach them. */
function homeRank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  return 2;
}

/**
 * The address to put in the QR code: this computer's address on the home
 * network. A 169.254 address is never used: Windows gives one to an adapter
 * with no real network (Tailscale, a VPN, an unplugged cable), and no phone can
 * reach it.
 */
export function firstHomeAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string | null {
  const candidates: string[] = [];
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal && isHomeAddress(address.address) && !address.address.startsWith('169.254.')) {
        candidates.push(address.address);
      }
    }
  }
  return candidates.sort((x, y) => homeRank(x) - homeRank(y))[0] ?? null;
}

/** The pairing code as an SVG image. Drawn here so the screen needs no QR code of its own. */
export async function qrImage(code: string): Promise<string> {
  const svg = await QRCode.toString(code, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const refused = (status: number, error: string): InboxReply => ({ status, body: { error } });

function headerProblem(header: RecordingHeader): boolean {
  return (
    typeof header?.id !== 'string' ||
    !/^[A-Za-z0-9_-]{8,64}$/.test(header.id) ||
    typeof header.recordedAt !== 'string' ||
    Number.isNaN(Date.parse(header.recordedAt)) ||
    typeof header.prompt !== 'string' ||
    header.prompt.length > 500 ||
    typeof header.seconds !== 'number' ||
    typeof header.mimeType !== 'string'
  );
}

export class PhoneInbox {
  private offer: { token: string; expiresAt: Date; tries: number } | null = null;
  private running: RunningInbox | null = null;
  private change: Promise<void> = Promise.resolve();

  private readonly deps: PhoneInboxDeps;

  constructor(deps: PhoneInboxDeps) {
    this.deps = deps;
  }

  /** The port actually listened on, or null when not listening. */
  get listeningOn(): number | null {
    return this.running?.port ?? null;
  }

  /** Shows a fresh pairing code. Any earlier one stops working. */
  async startPairing(): Promise<{ ok: true; offer: PairingOffer } | { ok: false; problems: string[] }> {
    const archive = this.deps.archive();
    if (!archive) return { ok: false, problems: ['Open the archive first.'] };
    const host = (this.deps.lanAddress ?? firstHomeAddress)();
    if (!host) return { ok: false, problems: ['This computer is not on a home network. Connect it to your Wi-Fi or router, then try again.'] };
    const expiresAt = new Date(this.deps.now().getTime() + OFFER_MINUTES * 60 * 1000);
    this.offer = { token: makePairingToken(), expiresAt, tries: 0 };
    try {
      await this.sync();
    } catch {
      this.offer = null;
      return { ok: false, problems: ['Echo could not start listening for the phone. Another program may be using the same port.'] };
    }
    const keys = pcLinkKeys(archive.dir, archive.key);
    const code = pairingCodeText({ v: 1, host, port: this.running?.port ?? INBOX_PORT, pc: keys.publicKey, token: this.offer.token });
    return { ok: true, offer: { code, qr: await qrImage(code), expiresAt: expiresAt.toISOString() } };
  }

  cancelPairing(): Promise<void> {
    this.offer = null;
    return this.sync();
  }

  phones(): PhoneSummary[] {
    const archive = this.deps.archive();
    if (!archive) return [];
    return loadPhones(archive.dir, archive.key).map(({ publicKey: _publicKey, ...phone }) => phone);
  }

  /** Unpairs a phone. Anything it still holds can no longer be sent here. */
  async unpair(id: string): Promise<void> {
    const archive = this.deps.archive();
    if (!archive) return;
    if (removePhone(archive.dir, archive.key, id)) this.deps.record('phone.unpaired');
    await this.sync();
  }

  pair(body: Buffer): InboxReply {
    const archive = this.deps.archive();
    const offer = this.offer;
    if (!archive || !offer || this.deps.now() > offer.expiresAt) return refused(410, 'No pairing code is showing on the PC. Show a new one and scan it again.');
    let request: PairRequest;
    try {
      request = JSON.parse(body.toString('utf8')) as PairRequest;
    } catch {
      return refused(400, 'That is not a pairing request.');
    }
    const keys = pcLinkKeys(archive.dir, archive.key);
    const opened = openPairRequest(keys, request);
    if (!opened || !sameToken(opened.token, offer.token)) {
      offer.tries += 1;
      if (offer.tries >= OFFER_TRIES) this.offer = null;
      return refused(403, 'That pairing code is not the one on the PC.');
    }
    const name = opened.name.trim().slice(0, 60) || 'Phone';
    const phone = addPhone(archive.dir, archive.key, opened.phone, name, this.deps.now());
    this.offer = null;
    this.deps.record('phone.paired');
    return { status: 200, body: { paired: phone.id, receipt: receiptFor(keys, opened.phone, `paired:${phone.id}`) } };
  }

  receive(body: Buffer): InboxReply {
    const archive = this.deps.archive();
    if (!archive) return refused(503, 'The archive is locked. The phone will try again later.');
    const sender = envelopeSender(body);
    if (!sender || !loadPhones(archive.dir, archive.key).some((phone) => phone.publicKey === sender)) {
      return refused(403, 'That phone is not paired with this PC.');
    }
    const keys = pcLinkKeys(archive.dir, archive.key);
    const opened = openRecording(keys, body);
    const parts = opened && !headerProblem(opened.header) ? splitMedia(opened.header, opened.media) : null;
    if (!opened || !parts) return refused(400, 'That recording did not arrive whole. The phone will send it again.');
    const { header } = opened;
    const saved = { status: 200, body: { saved: header.id, receipt: receiptFor(keys, sender, header.id) } };
    if (alreadyReceived(archive.dir, archive.key, header.id)) return saved;
    const filed = this.deps.fileStory(header, parts.recording, parts.pictures);
    if (!filed.ok) return { status: 422, body: { error: filed.problems.join(' ') } };
    markReceived(archive.dir, archive.key, header.id);
    this.deps.record('phone.recording-received', { seconds: Math.round(header.seconds), pictures: parts.pictures.length });
    return saved;
  }

  /** Listens when there is something to listen for, and stops when there is not. */
  sync(): Promise<void> {
    this.change = this.change.catch(() => undefined).then(() => this.apply());
    return this.change;
  }

  /** For locking: the pairing code is dropped and the inbox stops at once. */
  stop(): Promise<void> {
    this.offer = null;
    return this.sync();
  }

  private async apply(): Promise<void> {
    const archive = this.deps.archive();
    const wanted = archive !== null && (this.offer !== null || loadPhones(archive.dir, archive.key).length > 0);
    if (wanted && !this.running) {
      this.running = await startInbox({ pair: (body) => this.pair(body), receive: (body) => this.receive(body) }, this.deps.host ?? '0.0.0.0', this.deps.port ?? INBOX_PORT);
    } else if (!wanted && this.running) {
      const running = this.running;
      this.running = null;
      await running.close();
    }
  }
}
