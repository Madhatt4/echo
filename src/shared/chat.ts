// Conversations with the echo. Each listener's conversations are kept apart
// from everyone else's, and nothing said in them ever changes what the person
// captured.

import type { CheckOutcome, Listener } from './persona.ts';
import type { Support } from './sheets.ts';

export interface ChatMessage {
  id: string;
  role: 'them' | 'echo';
  text: string;
  at: string;
  /** True for the fixed line that opens every conversation. */
  opening?: true;
  /** For an echo reply: the passages it drew on. */
  sources?: string[];
  /** For an echo reply: how it got through the source check. */
  check?: CheckOutcome;
  /** For an echo reply: what the checker objected to in drafts that were never shown. */
  rejected?: string[];
}

export interface ChatSession {
  startedAt: string;
  messages: ChatMessage[];
}

/** Every listener's conversations, oldest first, under the listener's key. */
export type StoredChats = Record<string, ChatSession[]>;

export const MAX_MESSAGE_LENGTH = 4_000;
/** How much of what a listener said in earlier conversations is given to the echo, in characters. */
export const TOLD_BEFORE_BUDGET = 3_000;

/** What a listener said to the echo in earlier conversations, oldest first, as much of the latest as fits. */
export function toldBefore(earlier: readonly ChatSession[], budget = TOLD_BEFORE_BUDGET): string[] {
  const said = earlier.flatMap((session) => session.messages.filter((message) => message.role === 'them').map((message) => message.text));
  const kept: string[] = [];
  let used = 0;
  for (const text of said.reverse()) {
    if (used + text.length > budget) break;
    kept.unshift(text);
    used += text.length;
  }
  return kept;
}

/** A message as the screen shows it, with the passages behind an echo reply. */
export interface ChatMessageView extends ChatMessage {
  support: Support[];
}

export interface ChatView {
  listener: Listener;
  /** Who the echo can be spoken to as: the owner, and each person allowed to talk to it. */
  speakingAs: { listener: Listener; label: string }[];
  messages: ChatMessageView[];
  /** True when the last thing said has had no reply, because a reply failed. */
  waiting: boolean;
  keyReady: boolean;
  /** How many passages the echo may draw on for this listener. */
  passages: number;
  earlierConversations: number;
  /** Why the echo cannot talk right now, in plain words. Null when it can. */
  blocked: string | null;
}
