import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ChatMessageView, ChatView } from '../../shared/chat.ts';
import { OWNER, listenerKey } from '../../shared/persona.ts';
import type { Listener } from '../../shared/persona.ts';
import { Problems } from './Problems.tsx';

/** What stands behind one reply: how it got through the check, and the passages it drew on. */
function Sources({ message, open }: { message: ChatMessageView; open: boolean }) {
  return (
    <details className="support chat-sources" open={open} data-sources>
      <summary>Where this came from</summary>
      {message.check === 'passed' && <p>Checked before you saw it. Nothing in it claims a memory that is not in your passages.</p>}
      {message.check === 'redrafted' && (
        <p data-sources-redrafted>
          The first draft was thrown away before you saw it, because the check found this in it. What you see is the second draft, which passed.
        </p>
      )}
      {message.check === 'fallback' && (
        <p data-sources-fallback>
          Two drafts failed the check, so your echo said it had nothing rather than risk making something up.
        </p>
      )}
      {message.rejected && message.rejected.length > 0 && (
        <ul>
          {message.rejected.map((problem, index) => (
            <li key={index}>{problem}</li>
          ))}
        </ul>
      )}
      {message.support.length > 0 ? (
        <>
          <p>{message.support.length === 1 ? 'It drew on this passage:' : `It drew on these ${message.support.length} passages:`}</p>
          <ul>
            {message.support.map((support) => (
              <li key={support.memoryId} data-source>
                <strong>{support.title}:</strong> {support.excerpt}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p data-no-sources>It drew on no passages. It gave a view, or said it had nothing.</p>
      )}
    </details>
  );
}

export function ChatScreen({ onBack, onOpenSetup }: { onBack: () => void; onOpenSetup: () => void }) {
  const [listener, setListener] = useState<Listener>(OWNER);
  const [view, setView] = useState<ChatView | null>(null);
  const [saying, setSaying] = useState('');
  const [thinking, setThinking] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const end = useRef<HTMLDivElement | null>(null);

  async function refresh(who: Listener = listener) {
    setView(await window.echo.chat.view(who));
  }

  useEffect(() => {
    setProblems([]);
    void refresh(listener);
  }, [listenerKey(listener)]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [view?.messages.length, thinking]);

  if (!view) return null;

  /** Runs something that makes the echo think, and shows what went wrong if it could not answer. */
  async function ask(action: () => Promise<{ ok: boolean; problems: string[] }>) {
    setThinking(true);
    setProblems([]);
    const result = await action();
    await refresh();
    setThinking(false);
    if (!result.ok) setProblems(result.problems);
  }

  async function send() {
    const said = saying.trim();
    if (said.length === 0 || thinking) return;
    setSaying('');
    // What was said shows at once, while the echo thinks.
    setView((current) => (current ? { ...current, messages: [...current.messages, { id: 'sending', role: 'them', text: said, at: new Date().toISOString(), support: [] }] } : current));
    await ask(() => window.echo.chat.say(listener, said));
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const who = view.speakingAs.find((option) => listenerKey(option.listener) === listenerKey(listener));
  const lastEcho = [...view.messages].reverse().find((message) => message.role === 'echo' && !message.opening);

  return (
    <div
      data-screen="chat"
      data-chat-listener={listenerKey(listener)}
      data-chat-messages={view.messages.length}
      data-chat-thinking={thinking ? 'yes' : 'no'}
      data-chat-waiting={view.waiting ? 'yes' : 'no'}
    >
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      <section className="panel panel-wide">
        <h2>Talk to your echo</h2>
        <div className="field">
          <label className="label" htmlFor="chat-speaking-as">
            Speaking as
          </label>
          <p className="hint">
            {listener.kind === 'owner'
              ? 'As yourself, your echo answers the way it would to any of your family. It uses only what you marked for everyone.'
              : `Your echo answers the way it would to ${who?.label ?? 'them'}: what is for everyone, and what you marked for ${who?.label ?? 'them'} alone. Their conversations are kept apart from everyone else's.`}
          </p>
          <select
            id="chat-speaking-as"
            value={listenerKey(listener)}
            disabled={thinking}
            onChange={(event) => {
              const chosen = view.speakingAs.find((option) => listenerKey(option.listener) === event.target.value);
              if (chosen) setListener(chosen.listener);
            }}
          >
            {view.speakingAs.map((option) => (
              <option key={listenerKey(option.listener)} value={listenerKey(option.listener)}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {view.blocked && (
          <p className="warning" data-chat-blocked>
            {view.blocked}
          </p>
        )}
        {!view.blocked && !view.keyReady && (
          <div className="warning" data-chat-no-key>
            <p>
              <strong>Your echo needs your AI key to talk.</strong>
            </p>
            <div className="actions">
              <button type="button" className="button" data-action="chat-setup" onClick={onOpenSetup}>
                Open Setup
              </button>
            </div>
          </div>
        )}
        {!view.blocked && view.passages === 0 && (
          <p className="warning" data-chat-nothing>
            Your echo has nothing to draw on for this person yet, so it will say it has nothing. Tell some stories or answer some interview questions first.
          </p>
        )}

        {!view.blocked && (
          <>
            <ol className="chat" data-chat>
              {view.messages.map((message) => (
                <li
                  key={message.id}
                  className={message.opening ? 'chat-opening' : message.role === 'them' ? 'chat-them' : 'chat-echo'}
                  data-message={message.opening ? 'opening' : message.role}
                  data-check={message.check}
                >
                  <p data-message-text>{message.text}</p>
                  {message.role === 'echo' && !message.opening && <Sources message={message} open={message.id === lastEcho?.id} />}
                </li>
              ))}
              {thinking && (
                <li className="chat-echo chat-thinking" role="status">
                  <p>Thinking, then checking what it wrote against your passages…</p>
                </li>
              )}
            </ol>
            <div ref={end} />

            {view.waiting && !thinking && (
              <div className="warning" data-chat-unanswered>
                <p>Your echo has not answered that yet. What you said is saved.</p>
                <div className="actions">
                  <button type="button" className="button" data-action="chat-retry" onClick={() => void ask(() => window.echo.chat.retry(listener))}>
                    Try again
                  </button>
                </div>
              </div>
            )}
            <Problems problems={problems} />

            <div className="field">
              <label className="label" htmlFor="chat-say">
                Say something
              </label>
              <textarea id="chat-say" rows={3} value={saying} onChange={(event) => setSaying(event.target.value)} onKeyDown={onKey} disabled={thinking || !view.keyReady} />
              <p className="hint">Enter sends. Shift and Enter starts a new line. Each reply uses your AI key twice: once to write it and once to check it.</p>
            </div>
            <div className="actions">
              <button type="button" className="button" data-action="chat-send" onClick={() => void send()} disabled={thinking || !view.keyReady || saying.trim().length === 0}>
                Send
              </button>
              <button
                type="button"
                className="button-quiet"
                data-action="chat-new"
                disabled={thinking}
                onClick={() => {
                  setProblems([]);
                  void window.echo.chat.start(listener).then(() => refresh());
                }}
              >
                Start a new conversation
              </button>
            </div>
            {view.earlierConversations > 0 && (
              <p className="hint">
                {view.earlierConversations === 1 ? '1 earlier conversation is' : `${view.earlierConversations} earlier conversations are`} kept. Your echo remembers what was said to it in them.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
