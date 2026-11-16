import { useEffect, useRef, useState } from 'react';
import type { Picture } from './link.ts';
import { MAX_PHOTOS, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, preparePhoto, videoSeconds, videoType } from './media.ts';

export interface ChosenVideo {
  bytes: Uint8Array;
  mimeType: string;
  seconds: number;
}

interface PickerProps {
  /** Photos chosen: next the person says what they are about. */
  onPhotos: (pictures: Picture[]) => void;
  /** A video chosen and kept: it is the memory itself. */
  onVideo: (video: ChosenVideo) => Promise<void>;
  onCancel: () => void;
}

interface Shown {
  picture: Picture;
  url: string;
}

/** Some picks arrive with no type at all, so the file name decides. */
function isVideo(file: File): boolean {
  return file.type.startsWith('video/') || (file.type === '' && /\.(mov|mp4|m4v)$/i.test(file.name));
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/** Choosing photos, or one video, from the camera or the Photos app. iOS offers both from the one button. */
export function Picker({ onPhotos, onVideo, onCancel }: PickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Shown[]>([]);
  const [video, setVideo] = useState<{ file: File; url: string; seconds: number } | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  // Thumbnails are let go of only when the picker closes; adding a photo must not blank the earlier ones.
  const shownUrls = useRef<string[]>([]);
  useEffect(() => () => shownUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => () => {
    if (video) URL.revokeObjectURL(video.url);
  }, [video]);

  async function chosen(files: File[]) {
    setProblem('');
    if (files.length === 0) return;
    const videos = files.filter(isVideo);
    if (videos.length > 0) {
      if (files.length > 1 || photos.length > 0) {
        setProblem('Choose photos, or one video on its own.');
        return;
      }
      await choseVideo(videos[0]!);
      return;
    }
    if (photos.length + files.length > MAX_PHOTOS) {
      setProblem(`One memory can have up to ${MAX_PHOTOS} photos. Tell the rest in another memory.`);
      return;
    }
    setBusy(true);
    const added: Shown[] = [];
    try {
      for (const file of files) {
        const picture = await preparePhoto(file);
        added.push({ picture, url: URL.createObjectURL(new Blob([new Uint8Array(picture.bytes)], { type: picture.mimeType })) });
      }
      shownUrls.current.push(...added.map((photo) => photo.url));
      setPhotos([...photos, ...added]);
    } catch {
      added.forEach((photo) => URL.revokeObjectURL(photo.url));
      setProblem('Echo could not open one of those photos. Try choosing it again.');
    } finally {
      setBusy(false);
    }
  }

  async function choseVideo(file: File) {
    if (file.size > MAX_VIDEO_BYTES) {
      setProblem('That video is too large to send. In the Photos app, trim it shorter, then choose it again.');
      return;
    }
    let seconds: number;
    try {
      seconds = await videoSeconds(file);
    } catch {
      setProblem('Echo could not play that video. Try another.');
      return;
    }
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setProblem('Echo could not tell how long that video is. Try another.');
      return;
    }
    if (seconds > MAX_VIDEO_SECONDS) {
      setProblem(`A video can be up to ${MAX_VIDEO_SECONDS / 60} minutes. Trim it in the Photos app, or tell the memory as sound instead.`);
      return;
    }
    setVideo({ file, url: URL.createObjectURL(file), seconds });
  }

  function choose(accept: string) {
    if (!input.current) return;
    input.current.accept = accept;
    input.current.value = '';
    input.current.click();
  }

  const fileInput = (
    <input
      ref={input}
      type="file"
      multiple
      hidden
      onChange={(event) => {
        void chosen(Array.from(event.target.files ?? []));
      }}
    />
  );

  if (video) {
    return (
      <section className="picker">
        <video className="chosen-video" src={video.url} controls playsInline />
        <p>That video is {clock(video.seconds)} long.</p>
        {problem && <p className="problem">{problem}</p>}
        <button
          type="button"
          className="big"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setProblem('');
            try {
              const bytes = new Uint8Array(await video.file.arrayBuffer());
              await onVideo({ bytes, mimeType: videoType(video.file), seconds: Math.max(1, Math.round(video.seconds)) });
            } catch {
              setProblem('Echo could not keep that video. The phone may be short of space or memory. Try a shorter video.');
              setBusy(false);
            }
          }}
        >
          {busy ? 'Keeping it…' : 'Keep it'}
        </button>
        <button type="button" className="quiet" disabled={busy} onClick={() => setVideo(null)}>
          Throw it away
        </button>
      </section>
    );
  }

  if (photos.length > 0) {
    return (
      <section className="picker">
        {fileInput}
        <div className="chosen-photos">
          {photos.map((photo, index) => (
            <img key={photo.url} src={photo.url} alt={`Photo ${index + 1}`} />
          ))}
        </div>
        {problem && <p className="problem">{problem}</p>}
        <button type="button" className="big" disabled={busy} onClick={() => onPhotos(photos.map((photo) => photo.picture))}>
          Now tell me about {photos.length === 1 ? 'it' : 'them'}
        </button>
        {photos.length < MAX_PHOTOS && (
          <button type="button" className="quiet" disabled={busy} onClick={() => choose('image/*')}>
            {busy ? 'Getting the photo ready…' : 'Add another photo'}
          </button>
        )}
        <button type="button" className="quiet" disabled={busy} onClick={onCancel}>
          Start again
        </button>
      </section>
    );
  }

  return (
    <section className="picker">
      {fileInput}
      <h1>A photo or video</h1>
      <p>Take one now, or choose from your Photos. An old family photo is perfect: choose it, then tell the story behind it.</p>
      <p className="hint">A video can be up to {MAX_VIDEO_SECONDS / 60} minutes.</p>
      {problem && <p className="problem">{problem}</p>}
      <button type="button" className="big" disabled={busy} onClick={() => choose('image/*,video/*')}>
        {busy ? 'Getting the photos ready…' : 'Choose a photo or video'}
      </button>
      <button type="button" className="quiet" disabled={busy} onClick={onCancel}>
        Back
      </button>
    </section>
  );
}

/** The photos a memory is about, kept in view while the person talks. */
export function PhotoStrip({ pictures }: { pictures: readonly Picture[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const made = pictures.map((picture) => URL.createObjectURL(new Blob([new Uint8Array(picture.bytes)], { type: picture.mimeType })));
    setUrls(made);
    return () => made.forEach((url) => URL.revokeObjectURL(url));
  }, [pictures]);
  return (
    <div className="chosen-photos">
      {urls.map((url, index) => (
        <img key={url} src={url} alt={`Photo ${index + 1}`} />
      ))}
    </div>
  );
}
