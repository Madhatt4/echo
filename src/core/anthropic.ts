// Talking to Anthropic: checking a key is good (which costs the person
// nothing), and asking Claude something (which uses the person's own credit).

const MODELS_URL = 'https://api.anthropic.com/v1/models';
const API_VERSION = '2023-06-01';

export type KeyCheck = { ok: true } | { ok: false; problem: string };

/** The small part of `fetch` this file uses, so tests can stand in for the network. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal; body?: string },
) => Promise<{ status: number; json?: () => Promise<unknown> }>;

/**
 * Asks Anthropic whether a key is valid by listing the models it can use.
 * This does not use any of the person's credit, and it cannot tell whether
 * the account has credit left.
 */
export async function checkAnthropicKey(
  rawKey: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 15_000,
): Promise<KeyCheck> {
  const key = rawKey.trim();
  if (key.length === 0) return { ok: false, problem: 'Paste your key first.' };
  if (/\s/.test(key)) return { ok: false, problem: 'That has a space or line break in the middle. Copy the key again in one piece.' };

  let status: number;
  try {
    const response = await fetchImpl(MODELS_URL, {
      method: 'GET',
      headers: { 'x-api-key': key, 'anthropic-version': API_VERSION },
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
  } catch {
    return { ok: false, problem: 'Echo could not reach Anthropic. Check this computer is online, then try again.' };
  }

  if (status === 200) return { ok: true };
  if (status === 401) {
    const hint = key.startsWith('sk-ant-') ? '' : ' Anthropic keys start with sk-ant-.';
    return {
      ok: false,
      problem: `Anthropic did not accept this key. Copy it again from the Claude Console and make sure you have all of it.${hint}`,
    };
  }
  if (status === 403) {
    return { ok: false, problem: 'Anthropic recognised this key but will not let it be used. Check in the Claude Console that the key is still active.' };
  }
  if (status === 429) {
    return { ok: false, problem: 'Anthropic is limiting requests on this account right now. Wait a minute, then try again.' };
  }
  if (status >= 500) {
    return { ok: false, problem: 'Anthropic is having trouble at its end. Your key may be fine. Try again in a few minutes.' };
  }
  return { ok: false, problem: `Anthropic answered in a way Echo did not expect (code ${status}). Try again later.` };
}

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

/** The Claude model Echo asks for first. If the key cannot use it, the newest Sonnet it can use is chosen. */
export const PREFERRED_MODEL = 'claude-sonnet-5-5';

export interface ClaudeRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  /** How long to wait for an answer. Long pieces of writing need more than the usual minute. */
  timeoutMs?: number;
  /** A picture for Claude to look at, sent with the first message. */
  picture?: { mimeType: string; base64: string };
}

/** The messages as the service wants them: a picture, if there is one, goes in front of the words of the first message. */
export function wireMessages(request: ClaudeRequest): unknown[] {
  const picture = request.picture;
  if (!picture) return request.messages;
  return request.messages.map((message, index) =>
    index === 0
      ? {
          role: message.role,
          content: [
            { type: 'image', source: { type: 'base64', media_type: picture.mimeType, data: picture.base64 } },
            { type: 'text', text: message.content },
          ],
        }
      : message,
  );
}

export type ClaudeAnswer = { ok: true; text: string; model: string } | { ok: false; problem: string };

function headers(key: string): Record<string, string> {
  return { 'x-api-key': key, 'anthropic-version': API_VERSION, 'content-type': 'application/json' };
}

async function body(response: { json?: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const parsed = await response.json?.();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorMessage(parsed: Record<string, unknown>): string {
  const error = parsed.error;
  return typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : '';
}

/** From the models a key can use, the one Echo should ask: the preferred one, else the newest Sonnet, else the newest of any. */
export function chooseModel(models: readonly { id: string; created_at?: string }[]): string | null {
  if (models.length === 0) return null;
  if (models.some((model) => model.id === PREFERRED_MODEL)) return PREFERRED_MODEL;
  const newestFirst = [...models].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return (newestFirst.find((model) => model.id.includes('sonnet')) ?? newestFirst[0]!).id;
}

async function availableModel(key: string, fetchImpl: FetchLike, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetchImpl(MODELS_URL, { method: 'GET', headers: headers(key), signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 200) return null;
    const data = (await body(response)).data;
    return Array.isArray(data) ? chooseModel(data.filter((m): m is { id: string; created_at?: string } => typeof m?.id === 'string')) : null;
  } catch {
    return null;
  }
}

/**
 * Asks Claude one thing and returns what it said. Every failure comes back
 * as a plain-English reason the person can act on. Nothing is thrown.
 */
export async function askClaude(
  key: string,
  request: ClaudeRequest,
  model: string = PREFERRED_MODEL,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 60_000,
): Promise<ClaudeAnswer> {
  const send = async (useModel: string) =>
    fetchImpl(MESSAGES_URL, {
      method: 'POST',
      headers: headers(key),
      signal: AbortSignal.timeout(request.timeoutMs ?? timeoutMs),
      body: JSON.stringify({ model: useModel, max_tokens: request.maxTokens, system: request.system, messages: wireMessages(request) }),
    });

  let used = model;
  let response: { status: number; json?: () => Promise<unknown> };
  try {
    response = await send(used);
    if (response.status === 404) {
      // This key cannot use that model. Ask which ones it can, and try the best of those once.
      const other = await availableModel(key, fetchImpl, timeoutMs);
      if (other && other !== used) {
        used = other;
        response = await send(used);
      }
    }
  } catch {
    return { ok: false, problem: 'Echo could not reach Anthropic. Check this computer is online, then try again. Nothing you said has been lost.' };
  }

  const parsed = await body(response);
  if (response.status === 200) {
    const content = Array.isArray(parsed.content) ? parsed.content : [];
    const text = content
      .map((part) => (typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text' ? String((part as { text?: unknown }).text ?? '') : ''))
      .join('')
      .trim();
    if (text.length === 0) return { ok: false, problem: 'Claude answered with nothing. Try again.' };
    return { ok: true, text, model: used };
  }

  const said = errorMessage(parsed).toLowerCase();
  if (said.includes('credit balance') || response.status === 402) {
    return { ok: false, problem: 'Your Anthropic account has run out of credit. Add credit in the Claude Console under Settings, then Billing, and try again. Nothing you said has been lost.' };
  }
  if (response.status === 401) {
    return { ok: false, problem: 'Anthropic no longer accepts your AI key. Open Setup and save a new one. Nothing you said has been lost.' };
  }
  if (response.status === 403) {
    return { ok: false, problem: 'Anthropic will not let your AI key be used for this. Check in the Claude Console that the key is still active.' };
  }
  if (response.status === 404) {
    return { ok: false, problem: 'Your AI key cannot use any Claude model Echo knows how to talk to. Check your account in the Claude Console.' };
  }
  if (response.status === 429) {
    return { ok: false, problem: 'Anthropic is limiting requests on your account right now. Wait a minute, then try again.' };
  }
  if (response.status >= 500) {
    return { ok: false, problem: 'Anthropic is having trouble at its end. Try again in a few minutes. Nothing you said has been lost.' };
  }
  return { ok: false, problem: `Anthropic answered in a way Echo did not expect (code ${response.status}). Try again later.` };
}
