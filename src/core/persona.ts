// The persona engine: makes one reply as the echo, and does not let it out
// until it has passed the source check.
//
//   draft -> check -> (redraft -> check) -> reply, or the "nothing" line
//
// A draft that claims a memory no passage supports is never shown. If the
// second draft fails too, the person is given the plain "I never got round
// to telling Echo about that one" line instead.

import {
  NOTHING_LINE,
  checkerInstructions,
  checkerMessage,
  echoInstructions,
  echoMessages,
  readCheck,
  readEchoDraft,
} from '../shared/persona.ts';
import type { CheckOutcome, EchoContext, EchoTurn } from '../shared/persona.ts';
import type { ClaudeAnswer, ClaudeRequest } from './anthropic.ts';

export type Ask = (request: ClaudeRequest) => Promise<ClaudeAnswer>;

export type ComposedReply =
  | {
      ok: true;
      reply: string;
      /** Ids of the passages the reply drew on. */
      sources: string[];
      check: CheckOutcome;
      /** What the checker objected to in drafts that were not shown. Never shown to family. */
      rejected: string[];
    }
  | { ok: false; problem: string };

/** How many of the latest turns are sent with each request. */
export const TURNS_SENT = 20;

/**
 * Makes one reply. `turns` is the conversation so far, ending with what the
 * person just said. Every call to Claude that fails comes back as a problem,
 * and nothing unchecked is ever returned as a reply.
 */
export async function composeReply(
  ask: Ask,
  context: EchoContext,
  turns: readonly EchoTurn[],
  /** A check made on this computer before the draft goes to the checker. Returns what is wrong, or null. */
  localCheck: (reply: string) => string | null = () => null,
): Promise<ComposedReply> {
  const recent = turns.slice(-TURNS_SENT);
  const system = echoInstructions(context);
  const rejected: string[] = [];
  let redraft: { draft: string; problems: string[] } | null = null;

  for (const attempt of [1, 2] as const) {
    const answer = await ask({ system, messages: echoMessages(recent, redraft), maxTokens: 1000, timeoutMs: 90_000 });
    if (!answer.ok) return { ok: false, problem: answer.problem };
    const draft = readEchoDraft(answer.text, context.passages.length);
    if (!draft) {
      redraft = { draft: '', problems: ['The reply was empty or not in the JSON shape asked for.'] };
      rejected.push(...redraft.problems);
      continue;
    }

    // Checked here, on this computer, before anything else: a draft that repeats someone else's message goes no further.
    const forbidden = localCheck(draft.reply);
    if (forbidden) {
      rejected.push(forbidden);
      redraft = { draft: draft.reply, problems: [forbidden] };
      continue;
    }

    const verdict = await ask({
      system: checkerInstructions(context.ownerName),
      messages: [{ role: 'user', content: checkerMessage(context.passages, recent, draft.reply) }],
      maxTokens: 600,
      timeoutMs: 90_000,
    });
    if (!verdict.ok) return { ok: false, problem: verdict.problem };
    const check = readCheck(verdict.text) ?? { ok: false, problems: ['The checker could not be read, so the draft was not trusted.'] };
    if (check.ok) {
      return {
        ok: true,
        reply: draft.reply,
        sources: draft.passages.map((index) => context.passages[index]).filter((memory) => memory !== undefined).map((memory) => memory.id),
        check: attempt === 1 ? 'passed' : 'redrafted',
        rejected,
      };
    }
    rejected.push(...check.problems);
    redraft = { draft: draft.reply, problems: check.problems };
  }

  return { ok: true, reply: NOTHING_LINE, sources: [], check: 'fallback', rejected };
}
