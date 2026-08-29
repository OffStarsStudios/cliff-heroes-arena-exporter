import { useCallback, useId, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { RawWorkbook } from '../lib/types';

export type SourceMode = 'file' | 'url';

/** Everything the source step needs, owned by App so both exporters share it. */
export interface SourceController {
  workbook: RawWorkbook | null;
  busy: boolean;
  error: string | null;
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
  onReset: () => void;
  onClearError: () => void;
}

const ACCEPT = '.xlsx,.xlsm,.xls,.csv';

export function SourcePanel({ source }: { source: SourceController }) {
  const { workbook, busy, error, onFile, onUrl, onReset, onClearError } = source;
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<SourceMode>('file');
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

  if (workbook !== null) {
    return (
      <div className="stack-sm">
        <div className="banner banner--ok">
          <Icon name="check" size={15} className="banner__icon" />
          <span>
            <strong>{workbook.sourceName}</strong> is loaded with {workbook.sheets.length} tab
            {workbook.sheets.length === 1 ? '' : 's'}. Nothing was uploaded anywhere - the workbook is
            parsed in this browser.
          </span>
        </div>

        <div>
          <p className="step__section-title">Tabs in this workbook</p>
          <div className="param-list">
            {workbook.sheets.map((sheet) => (
              <span key={sheet.name} className="param">
                {sheet.name}
              </span>
            ))}
          </div>
        </div>

        <div>
          <button type="button" className="btn" onClick={onReset}>
            <Icon name="swap" size={14} />
            Use a different source
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      <div className="row-between">
        <p className="step__note" style={{ margin: 0 }}>
          Load the design workbook once - both exporters read from it.
        </p>
        <div className="segmented" role="group" aria-label="Spreadsheet source">
          <button
            type="button"
            aria-pressed={mode === 'file'}
            onClick={() => {
              setMode('file');
              onClearError();
            }}
          >
            Excel file
          </button>
          <button
            type="button"
            aria-pressed={mode === 'url'}
            onClick={() => {
              setMode('url');
              onClearError();
            }}
          >
            Google Sheet
          </button>
        </div>
      </div>

      {mode === 'file' ? (
        <>
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
            <span className="dropzone__icon">
              {busy ? <span className="spinner" /> : <Icon name="upload" size={24} />}
            </span>
            <span className="dropzone__title">
              {busy ? 'Reading workbook...' : 'Drop a workbook here'}
            </span>
            <span className="dropzone__hint">or click to browse - {ACCEPT}</span>
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
        <form
          className="url-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (url.trim() !== '') onUrl(url.trim());
          }}
        >
          <div className="field">
            <label className="field__label" htmlFor={urlId}>
              Google Sheets link
            </label>
            <input
              id={urlId}
              type="url"
              placeholder="https://docs.google.com/spreadsheets/d/.../edit"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={busy}
              aria-describedby={`${urlId}-note`}
            />
            <span className="field__note" id={`${urlId}-note`}>
              The sheet must be shared with <strong>Anyone with the link</strong>. No sign-in needed.
            </span>
          </div>
          <button type="submit" className="btn btn--primary" disabled={busy || url.trim() === ''}>
            {busy ? <span className="spinner spinner--on-accent" /> : <Icon name="link" size={14} />}
            {busy ? 'Loading' : 'Load sheet'}
          </button>
        </form>
      )}

      {error !== null && (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" size={15} className="banner__icon" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
