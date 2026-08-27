import { useCallback, useId, useRef, useState } from 'react';

export type SourceMode = 'file' | 'url';

interface SourceCardProps {
  mode: SourceMode;
  onModeChange: (mode: SourceMode) => void;
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
  busy: boolean;
  error: string | null;
}

const ACCEPT = '.xlsx,.xlsm,.xls,.csv';

export function SourceCard({ mode, onModeChange, onFile, onUrl, busy, error }: SourceCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState('');
  const urlId = useId();

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <section className="card">
      <header className="card__header">
        <h2 className="card__title">Spreadsheet source</h2>
        <div className="segmented" role="group" aria-label="Spreadsheet source">
          <button type="button" aria-pressed={mode === 'file'} onClick={() => onModeChange('file')}>
            Upload Excel
          </button>
          <button type="button" aria-pressed={mode === 'url'} onClick={() => onModeChange('url')}>
            Google Sheets
          </button>
        </div>
      </header>

      <div className="card__body">
        {mode === 'file' ? (
          <>
            <p className="card__hint">
              Drop an .xlsx workbook here, or pick one from disk. Nothing leaves your machine - the
              file is parsed in the browser.
            </p>
            <button
              type="button"
              className={dragging ? 'dropzone dropzone--active' : 'dropzone'}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              disabled={busy}
            >
              <span className="dropzone__icon" aria-hidden="true">
                {busy ? <span className="spinner" /> : '⬆'}
              </span>
              <span className="dropzone__title">
                {busy ? 'Reading workbook...' : 'Drop your workbook here'}
              </span>
              <span className="dropzone__hint">or click to browse ({ACCEPT})</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept={ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
                event.target.value = '';
              }}
            />
          </>
        ) : (
          <>
            <p className="card__hint">
              Paste a Google Sheets link. The sheet must be shared with <strong>Anyone with the link</strong>{' '}
              - no sign-in or Google Cloud project needed.
            </p>
            <form
              className="url-row"
              onSubmit={(event) => {
                event.preventDefault();
                if (url.trim() !== '') onUrl(url.trim());
              }}
            >
              <div className="field">
                <label className="field__label" htmlFor={urlId}>
                  Sheet URL
                </label>
                <input
                  id={urlId}
                  type="url"
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  disabled={busy}
                />
              </div>
              <button type="submit" className="btn btn--primary" disabled={busy || url.trim() === ''}>
                {busy ? <span className="spinner" /> : null}
                {busy ? 'Loading' : 'Load Sheet'}
              </button>
            </form>
          </>
        )}

        {error !== null && (
          <div className="banner banner--error" role="alert" style={{ marginTop: 16 }}>
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </div>
        )}
      </div>
    </section>
  );
}
