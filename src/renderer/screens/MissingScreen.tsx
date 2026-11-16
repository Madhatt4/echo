import { useState } from 'react';
import { Problems } from './Problems.tsx';

export function MissingScreen({ archivePath, onDone }: { archivePath: string; onDone: () => Promise<void> }) {
  const [problems, setProblems] = useState<string[]>([]);

  async function findExisting() {
    setProblems([]);
    const result = await window.echo.archive.findExisting();
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  async function restore() {
    setProblems([]);
    const result = await window.echo.archive.restoreFromBackup();
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  return (
    <section className="panel panel-narrow" data-screen="missing">
      <h2>Echo cannot find your archive</h2>
      <p>It was last here:</p>
      <p>
        <code>{archivePath}</code>
      </p>
      <p>
        If it is on a drive that is unplugged, plug the drive in and press <strong>Look again</strong>.
        If you moved the folder, press <strong>Find my archive</strong> and choose it. If it is
        gone, press <strong>Restore from a backup</strong> and choose your backup folder. Nothing
        has been deleted by Echo.
      </p>

      <Problems problems={problems} />

      <div className="actions">
        <button type="button" className="button" onClick={() => void onDone()}>
          Look again
        </button>
        <button type="button" className="button-quiet" onClick={findExisting}>
          Find my archive
        </button>
        <button type="button" className="button-quiet" data-action="restore" onClick={restore}>
          Restore from a backup
        </button>
      </div>
    </section>
  );
}
