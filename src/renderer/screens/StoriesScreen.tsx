import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { EVERYONE, audienceLabel } from '../../shared/people.ts';
import type { Audience, Person } from '../../shared/people.ts';
import { MAX_STORY_MINUTES } from '../../shared/stories.ts';
import { promptsFor, suggestPrompt } from '../../shared/story-prompts.ts';
import type { Story } from '../../shared/stories.ts';
import type { ModelDownload } from '../../shared/api.ts';
import type { MemoryTimesView } from '../../shared/memory-times.ts';
import { writeDown } from '../speech.ts';
import { AudiencePicker } from './AudiencePicker.tsx';
import { MemoryTimes } from './MemoryTimes.tsx';
import { PhonePanel } from './PhonePanel.tsx';
import { SoundRecorder, length } from './recorders.tsx';
import { Problems } from './Problems.tsx';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

/** Plays a saved story's sound, or its video, decrypted only for as long as it is on screen. */
function StoryAudio({ storyId }: { storyId: string }) {
  const [url, setUrl] = useState('');
  const [isVideo, setIsVideo] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let made = '';
    let gone = false;
    void window.echo.stories.audio(storyId).then((audio) => {
      if (!audio || gone) return;
      const type = audio.mimeType.split(';')[0]!.trim();
      made = URL.createObjectURL(new Blob([new Uint8Array(audio.bytes)], { type }));
      setIsVideo(type.startsWith('video/'));
      setUrl(made);
    });
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [storyId]);

  if (!url) return null;
  if (isVideo) {
    return (
      <video
        className="story-video"
        src={url}
        controls
        playsInline
        data-story-video
        data-playback-ready={ready ? 'yes' : undefined}
        onLoadedMetadata={() => setReady(true)}
      />
    );
  }
  return (
    <audio
      className="story-audio"
      src={url}
      controls
      data-story-audio
      data-playback-ready={ready ? 'yes' : undefined}
      onLoadedMetadata={() => setReady(true)}
    />
  );
}

/** The pictures that go with a story, decrypted only for as long as they are on screen. */
function StoryPictures({ story }: { story: Story }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    let made: string[] = [];
    let gone = false;
    void (async () => {
      const found: string[] = [];
      for (let index = 0; index < story.pictures; index += 1) {
        const picture = await window.echo.stories.picture(story.id, index);
        if (picture) found.push(URL.createObjectURL(new Blob([new Uint8Array(picture.bytes)], { type: picture.mimeType })));
      }
      made = found;
      if (gone) found.forEach((url) => URL.revokeObjectURL(url));
      else setUrls(found);
    })();
    return () => {
      gone = true;
      made.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [story.id, story.pictures]);
  if (urls.length === 0) return null;
  return (
    <div className="story-pictures" data-story-pictures={urls.length}>
      {urls.map((url, index) => (
        <img key={url} className="story-picture" src={url} alt={`Picture ${index + 1} of ${urls.length} with this story`} />
      ))}
    </div>
  );
}

interface NewStoryProps {
  people: Person[];
  /** The prompts already answered in earlier stories, or put away, so they are not suggested again. */
  asked: string[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
}

function NewStory({ people, asked, onSaved, onCancel }: NewStoryProps) {
  const groups = useMemo(() => promptsFor(people), [people]);
  const [turn, setTurn] = useState(0);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState(() => suggestPrompt(promptsFor(people), asked)?.text ?? '');
  // Put away in this sitting. Kept here too so the next suggestion skips them straight away.
  const [putAway, setPutAway] = useState<string[]>([]);
  const [justPutAway, setJustPutAway] = useState('');
  const skipped = [...asked, ...putAway];
  const fromDeck = groups.some((group) => group.prompts.includes(prompt));
  const another = suggestPrompt(groups, [...skipped, prompt], turn);

  function askAnother() {
    if (!another) return;
    setTurn(turn + 1);
    setJustPutAway('');
    setPrompt(another.text);
  }

  /** "I don't remember" is a proper answer: the question goes away for good, with no follow-up. */
  async function dontRemember() {
    const result = await window.echo.memoryTimes.retire(prompt);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    const after = [...skipped, prompt];
    setPutAway([...putAway, prompt]);
    setJustPutAway(prompt);
    setPrompt(suggestPrompt(groups, after, turn)?.text ?? '');
  }

  async function undoPutAway() {
    await window.echo.memoryTimes.restore(justPutAway);
    setPutAway(putAway.filter((question) => question !== justPutAway));
    setPrompt(justPutAway);
    setJustPutAway('');
  }
  const [audience, setAudience] = useState<Audience>(EVERYONE);
  const [take, setTake] = useState<{ blob: Blob; seconds: number } | null>(null);
  const [reviewUrl, setReviewUrl] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!take) return;
    const url = URL.createObjectURL(take.blob);
    setReviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [take]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!take) {
      setProblems(['Record the story first.']);
      return;
    }
    setBusy(true);
    setProblems([]);
    const audio = new Uint8Array(await take.blob.arrayBuffer());
    const result = await window.echo.stories.add({ title, prompt, audience, text: '' }, audio, take.blob.type || 'audio/webm', take.seconds);
    setBusy(false);
    if (result.ok) await onSaved();
    else setProblems(result.problems);
  }

  return (
    <section className="panel" data-section="new-story">
      <h2>Tell a story</h2>
      <p>
        Talk the way you would to someone you love. There is no right length. One memory told
        properly is worth more than a list of facts.
      </p>

      <form onSubmit={save}>
        <div className="field">
          <label className="label" htmlFor="story-prompt">
            Need somewhere to start?
          </label>
          <select id="story-prompt" value={prompt} onChange={(e) => { setJustPutAway(''); setPrompt(e.target.value); }}>
            <option value="">I know what I want to say</option>
            {groups.map((group) => (
              <optgroup key={group.stage} label={group.stage}>
                {group.prompts.filter((question) => !putAway.includes(question)).map((question) => (
                  <option key={question} value={question}>
                    {question}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {prompt && <blockquote className="story-prompt">{prompt}</blockquote>}
          <div className="actions">
            <button type="button" className="button-quiet" data-action="ask-another" onClick={askAnother} disabled={!another}>
              Ask me something else
            </button>
            {fromDeck && (
              <button type="button" className="button-quiet" data-action="dont-remember" onClick={() => void dontRemember()}>
                I don&apos;t remember
              </button>
            )}
          </div>
          {justPutAway && (
            <p className="hint" data-prompt-put-away>
              That one is put away. It will not come up again.{' '}
              <button type="button" className="button-quiet" data-action="undo-put-away" onClick={() => void undoPutAway()}>
                Undo
              </button>
            </p>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="story-title">
            A short title
          </label>
          <p className="hint">So you can find it again: The caravan in Wales, My first lorry.</p>
          <input id="story-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
        </div>

        <AudiencePicker id="story-audience" audience={audience} people={people} onChange={setAudience} />

        <div className="field">
          <span className="label">The recording</span>
          {take ? (
            <div data-story-review>
              <audio className="story-audio" src={reviewUrl} controls />
              <p className="hint">{length(take.seconds)} recorded. Listen back, then save it or record it again.</p>
              <div className="actions">
                <button type="button" className="button-quiet" data-action="story-again" onClick={() => setTake(null)} disabled={busy}>
                  Record it again
                </button>
              </div>
            </div>
          ) : (
            <SoundRecorder onTaken={setTake} maxSeconds={MAX_STORY_MINUTES * 60} />
          )}
        </div>

        <Problems problems={problems} />
        <div className="actions">
          <button type="submit" className="button" data-action="story-save" disabled={busy || !take}>
            {busy ? 'Saving…' : 'Save this story'}
          </button>
          <button type="button" className="button-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

type Writing =
  | { stage: 'idle' }
  | { stage: 'ask-download' }
  | { stage: 'downloading'; download: ModelDownload | null }
  | { stage: 'listening'; done: number; total: number }
  | { stage: 'ask-replace'; text: string }
  | { stage: 'done' };

function StoryDetail({
  story,
  people,
  writeDownAtOnce,
  onChanged,
  onClose,
}: {
  story: Story;
  people: Person[];
  /** True for a story that has just been recorded: start writing it down straight away. */
  writeDownAtOnce: boolean;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(story.title);
  const [text, setText] = useState(story.text);
  const [writing, setWriting] = useState<Writing>({ stage: 'idle' });
  const [writingProblems, setWritingProblems] = useState<string[]>([]);
  const textRef = useRef(story.text);
  textRef.current = text;

  /** Writes the recording down. `download` is true once the person has agreed to the one-off download. */
  async function startWriting(download: boolean) {
    setWritingProblems([]);
    if (!download && !(await window.echo.transcription.ready())) {
      setWriting({ stage: 'ask-download' });
      return;
    }
    setWriting({ stage: 'downloading', download: null });
    const stopListening = window.echo.transcription.onDownload((progress) => setWriting({ stage: 'downloading', download: progress }));
    const prepared = await window.echo.transcription.prepare();
    stopListening();
    if (!prepared.ok) {
      setWriting({ stage: 'idle' });
      setWritingProblems(prepared.problems);
      return;
    }
    const audio = await window.echo.stories.audio(story.id);
    if (!audio) {
      setWriting({ stage: 'idle' });
      setWritingProblems(['This story has no recording to write down.']);
      return;
    }
    setWriting({ stage: 'listening', done: 0, total: 1 });
    const result = await writeDown(audio.bytes, (done, total) => setWriting({ stage: 'listening', done, total }));
    if (!result.ok) {
      setWriting({ stage: 'idle' });
      setWritingProblems(result.problems);
      return;
    }
    if (result.text.length === 0) {
      setWriting({ stage: 'idle' });
      setWritingProblems(['Echo did not hear any words in this recording. Play it back to check, or type the words yourself.']);
      return;
    }
    if (textRef.current.trim().length > 0 && textRef.current.trim() !== result.text) {
      setWriting({ stage: 'ask-replace', text: result.text });
      return;
    }
    setText(result.text);
    setWriting({ stage: 'done' });
  }

  useEffect(() => {
    if (writeDownAtOnce && story.text.trim().length === 0) void startWriting(false);
    // Runs once, when a just-recorded story is first shown.
  }, []);

  const [audience, setAudience] = useState<Audience>(story.audience);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setProblems([]);
    setSaved(false);
    const result = await window.echo.stories.change(story.id, { title, prompt: story.prompt, audience, text });
    if (result.ok) {
      setSaved(true);
      await onChanged();
    } else {
      setProblems(result.problems);
    }
  }

  async function remove() {
    await window.echo.stories.remove(story.id);
    await onChanged();
    onClose();
  }

  return (
    <section className="panel" data-section="story-detail">
      <h2>{story.title}</h2>
      <p className="hint">
        Recorded {day(story.recordedAt)} · {length(story.seconds)}
      </p>
      {story.prompt && <blockquote className="story-prompt">{story.prompt}</blockquote>}
      <StoryPictures story={story} />
      <StoryAudio storyId={story.id} />

      <form onSubmit={save}>
        <div className="field">
          <label className="label" htmlFor="detail-title">
            Title
          </label>
          <input id="detail-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
        </div>
        <AudiencePicker id="detail-audience" audience={audience} people={people} onChange={setAudience} />
        <div className="field">
          <label className="label" htmlFor="detail-text">
            The story in words
          </label>
          <p className="hint">
            Your echo reads this, not the sound. Echo can write it down for you. Read it through
            afterwards and correct anything it misheard, then save.
          </p>

          <div className="writing" data-writing={writing.stage}>
            {(writing.stage === 'idle' || writing.stage === 'done') && (
              <button type="button" className="button-quiet" data-action="story-write-down" onClick={() => void startWriting(false)}>
                {text.trim().length > 0 ? 'Write it down again' : 'Write it down for me'}
              </button>
            )}
            {writing.stage === 'done' && (
              <span className="hint" data-written-down>
                Written down below. Check it, correct it, then press Save changes.
              </span>
            )}
            {writing.stage === 'ask-download' && (
              <div className="warning">
                <p>
                  <strong>One download first.</strong> To write your stories down, Echo needs its
                  speech-to-text model, which it downloads once from Hugging Face and keeps on this
                  computer. Your recordings are not sent anywhere, now or later.
                </p>
                <div className="actions">
                  <button type="button" className="button" data-action="story-download" onClick={() => void startWriting(true)}>
                    Download it and write this down
                  </button>
                  <button type="button" className="button-quiet" onClick={() => setWriting({ stage: 'idle' })}>
                    Not now
                  </button>
                </div>
              </div>
            )}
            {writing.stage === 'downloading' && (
              <p className="saved" role="status">
                {writing.download && writing.download.totalBytes > 0
                  ? `Getting speech-to-text ready: ${writing.download.percent}% (${megabytes(writing.download.loadedBytes)} of ${megabytes(writing.download.totalBytes)})`
                  : 'Getting speech-to-text ready…'}
              </p>
            )}
            {writing.stage === 'listening' && (
              <p className="saved" role="status">
                {writing.total > 1 ? `Writing it down: part ${Math.min(writing.done + 1, writing.total)} of ${writing.total}…` : 'Writing it down…'}
              </p>
            )}
            {writing.stage === 'ask-replace' && (
              <div className="warning">
                <p>Echo has written it down. You already have words here. Replace them with what Echo heard?</p>
                <div className="actions">
                  <button
                    type="button"
                    className="button"
                    data-action="story-replace"
                    onClick={() => {
                      setText(writing.text);
                      setWriting({ stage: 'done' });
                    }}
                  >
                    Replace my words
                  </button>
                  <button type="button" className="button-quiet" onClick={() => setWriting({ stage: 'idle' })}>
                    Keep my words
                  </button>
                </div>
              </div>
            )}
            <Problems problems={writingProblems} />
          </div>

          <textarea id="detail-text" value={text} onChange={(e) => setText(e.target.value)} rows={12} />
        </div>
        <Problems problems={problems} />
        {saved && (
          <p className="saved" data-story-saved>
            Saved.
          </p>
        )}
        <div className="actions">
          <button type="submit" className="button" data-action="story-change">
            Save changes
          </button>
          <button type="button" className="button-quiet" data-action="story-close" onClick={onClose}>
            Back to my stories
          </button>
        </div>
      </form>

      <div className="remove-row">
        {removing ? (
          <div className="actions">
            <span className="remove-warning">This deletes the recording and its words from your archive for good.</span>
            <button type="button" className="button button-stop" data-action="story-remove-confirm" onClick={() => void remove()}>
              Delete this story
            </button>
            <button type="button" className="button-quiet" onClick={() => setRemoving(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button type="button" className="button-quiet" data-action="story-remove" onClick={() => setRemoving(true)}>
            Delete this story
          </button>
        )}
      </div>
    </section>
  );
}

export function StoriesScreen({ onBack }: { onBack: () => void }) {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [memoryTimes, setMemoryTimes] = useState<MemoryTimesView | null>(null);
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'detail'; id: string; justRecorded: boolean }>({ kind: 'list' });

  async function refresh() {
    const [latestStories, latestPeople, latestTimes] = await Promise.all([window.echo.stories.list(), window.echo.people.list(), window.echo.memoryTimes.view()]);
    setStories(latestStories);
    setPeople(latestPeople);
    setMemoryTimes(latestTimes);
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!stories || !memoryTimes) return null;

  const open = mode.kind === 'detail' ? stories.find((story) => story.id === mode.id) : undefined;

  return (
    <div data-screen="stories" data-mode={mode.kind} data-story-count={stories.length}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      {mode.kind === 'new' && (
        <NewStory
          people={people}
          asked={[...stories.map((story) => story.prompt), ...memoryTimes.retired]}
          onSaved={async () => {
            // Open the story that was just saved, and start writing it down.
            const latest = await window.echo.stories.list();
            await refresh();
            const newest = latest[latest.length - 1];
            setMode(newest ? { kind: 'detail', id: newest.id, justRecorded: true } : { kind: 'list' });
          }}
          onCancel={() => setMode({ kind: 'list' })}
        />
      )}

      {mode.kind === 'detail' && open && (
        <StoryDetail
          key={open.id}
          story={open}
          people={people}
          writeDownAtOnce={mode.justRecorded}
          onChanged={refresh}
          onClose={() => setMode({ kind: 'list' })}
        />
      )}

      {mode.kind === 'list' && (
        <section className="panel">
          <h2>Your life stories</h2>
          <p>
            Each story is kept as sound, so your family can hear you tell it, and as words, so your
            echo can draw on it.
          </p>
          <div className="actions">
            <button type="button" className="button" data-action="story-new" onClick={() => setMode({ kind: 'new' })}>
              Tell a new story
            </button>
          </div>

          {stories.length === 0 ? (
            <p className="hint" data-stories-empty>
              No stories yet.
            </p>
          ) : (
            <ul className="people">
              {stories.map((story) => (
                <li key={story.id} data-story={story.title}>
                  <div className="person-head">
                    <strong>{story.title}</strong>
                    <span className="status" data-story-audience>
                      {audienceLabel(story.audience, people)}
                    </span>
                    <span className="status" data-story-words={story.text.trim() ? 'yes' : 'no'}>
                      {story.text.trim() ? 'Written down' : 'Not written down yet'}
                    </span>
                  </div>
                  <p className="person-line">
                    {day(story.recordedAt)} · {length(story.seconds)}
                    {story.pictures > 0 && ` · ${story.pictures === 1 ? 'one picture' : `${story.pictures} pictures`}`}
                  </p>
                  <div className="actions">
                    <button type="button" className="button-quiet" data-action="story-open" onClick={() => setMode({ kind: 'detail', id: story.id, justRecorded: false })}>
                      Open
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {mode.kind === 'list' && <MemoryTimes view={memoryTimes} onChanged={refresh} onTellStory={() => setMode({ kind: 'new' })} />}
      {mode.kind === 'list' && <PhonePanel />}
    </div>
  );
}
