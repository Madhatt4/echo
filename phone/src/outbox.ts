// Talking to the paired PC over the home network. Requests go through the
// phone's native HTTP so they reach a plain http:// address on the Wi-Fi.
// Everything sent is already sealed for the PC.

import { CapacitorHttp } from '@capacitor/core';
import { receiptChecks, sealPairRequest } from './link.ts';
import type { PairingCode } from './link.ts';
import { envelopeOf, pairedPc, phoneKeys, rememberPc, sent, waiting } from './store.ts';

const TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 10 * 60_000;

export type SendResult =
  | { kind: 'all-sent'; count: number }
  | { kind: 'nothing' }
  | { kind: 'not-paired' }
  | { kind: 'unreachable'; left: number }
  | { kind: 'locked'; left: number }
  | { kind: 'refused'; left: number; reason: string };

const address = (host: string, port: number, route: string): string => `http://${host.includes(':') ? `[${host}]` : host}:${port}${route}`;

function bodyOf(data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

/** What went wrong pairing, and whether the same code is worth trying again. */
export interface PairProblem {
  message: string;
  canRetry: boolean;
}

/** Pairs with the PC whose code was scanned. Returns the problem, or null when paired. */
export async function pair(code: PairingCode, name: string): Promise<PairProblem | null> {
  const keys = await phoneKeys();
  let response;
  try {
    response = await CapacitorHttp.post({
      url: address(code.host, code.port, '/pair'),
      headers: { 'Content-Type': 'application/json' },
      data: sealPairRequest(keys, code, name),
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
  } catch {
    return {
      message: 'The phone could not reach your computer. Check both are on the same Wi-Fi, and that Echo is open and unlocked on the computer with the pairing code still showing. Then press Try again.',
      canRetry: true,
    };
  }
  const body = bodyOf(response.data);
  // An expired or refused code fails the same way every time, so only a new code helps.
  if (response.status === 410) return { message: 'That code is no longer showing on the computer. Show a new one on the computer, then press Scan a new code.', canRetry: false };
  if (response.status === 403) return { message: 'The computer did not accept that code. Show a new one on the computer, then press Scan a new code.', canRetry: false };
  if (response.status >= 500) {
    return { message: 'Echo on your computer had a problem pairing. Check it is still open and unlocked, then press Try again.', canRetry: true };
  }
  const phoneId = typeof body.paired === 'string' ? body.paired : '';
  if (response.status !== 200 || !phoneId || !receiptChecks(keys, code.pc, `paired:${phoneId}`, body.receipt)) {
    return { message: 'Something answered, but it was not your Echo computer. Nothing was paired.', canRetry: false };
  }
  await rememberPc(code, phoneId, name, new Date());
  return null;
}

/** Sends everything waiting, oldest first. Stops at the first thing that means "not now". */
export async function sendWaiting(): Promise<SendResult> {
  const pc = await pairedPc();
  if (!pc) return { kind: 'not-paired' };
  const queue = await waiting();
  if (queue.length === 0) return { kind: 'nothing' };
  const keys = await phoneKeys();
  let count = 0;
  let broken = 0;
  for (const item of queue) {
    const left = queue.length - count;
    let response;
    try {
      response = await CapacitorHttp.post({
        url: address(pc.host, pc.port, '/recordings'),
        headers: { 'Content-Type': 'application/octet-stream' },
        data: await envelopeOf(item.id),
        dataType: 'file',
        connectTimeout: TIMEOUT_MS,
        readTimeout: SEND_TIMEOUT_MS,
      });
    } catch {
      return { kind: 'unreachable', left };
    }
    const body = bodyOf(response.data);
    if (response.status === 503) return { kind: 'locked', left };
    if (response.status === 200 && body.saved === item.id && receiptChecks(keys, pc.pc, item.id, body.receipt)) {
      await sent(item.id);
      count += 1;
      continue;
    }
    if (response.status === 403) return { kind: 'refused', left, reason: 'Your computer no longer knows this phone. Pair it again from the Stories screen on the computer.' };
    // One recording that will not open must not hold up the rest. It stays on the phone.
    if (response.status === 400) {
      broken += 1;
      continue;
    }
    const said = typeof body.error === 'string' ? body.error : 'Your computer did not save it.';
    return { kind: 'refused', left, reason: said };
  }
  if (broken > 0) {
    return { kind: 'refused', left: broken, reason: `Your computer could not open ${broken === 1 ? 'one recording' : `${broken} recordings`}. ${broken === 1 ? 'It stays' : 'They stay'} on this phone.` };
  }
  return { kind: 'all-sent', count };
}
