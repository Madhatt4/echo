import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

const LOOK_EVERY_MS = 200;

/** Shows the back camera and reports the first QR code it reads. */
export function Scanner({ onCode, onCancel }: { onCode: (text: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;
    const canvas = document.createElement('canvas');

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (opened) => {
        stream = opened;
        if (!video.current || done) return;
        video.current.srcObject = opened;
        await video.current.play();
        timer = setInterval(() => {
          const shown = video.current;
          if (!shown || shown.videoWidth === 0) return;
          canvas.width = shown.videoWidth;
          canvas.height = shown.videoHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return;
          context.drawImage(shown, 0, 0);
          const found = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
          if (found?.data && !done) {
            done = true;
            onCode(found.data);
          }
        }, LOOK_EVERY_MS);
      })
      .catch(() => setProblem('Echo needs the camera to read the code. Allow it in Settings, Echo, Camera, then try again.'));

    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onCode]);

  return (
    <section className="scanner">
      <h1>Scan the code</h1>
      <p>Point the phone at the square on your computer&apos;s screen.</p>
      {problem ? <p className="problem">{problem}</p> : <video ref={video} className="camera" playsInline muted />}
      <button type="button" className="quiet" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
