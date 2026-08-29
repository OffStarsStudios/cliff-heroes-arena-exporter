import { useState } from 'react';
import { SourceCard, type SourceMode } from './components/SourceCard';
import { ArenaExporter } from './features/ArenaExporter';
import { HeroExporter } from './features/HeroExporter';
import { detectDataset, type Dataset } from './lib/sheetSelect';
import { readWorkbookFile } from './lib/workbook';
import { GoogleSheetsError, loadGoogleSheet } from './lib/googleSheets';
import type { RawWorkbook } from './lib/types';

const DATASETS: { id: Dataset; label: string; blurb: string }[] = [
  { id: 'arena', label: 'Arena progress', blurb: 'Trophy milestones, arenas and rewards.' },
  { id: 'heroes', label: 'Hero stats', blurb: 'Base stats, level curves and power settings.' },
];

export function App() {
  const [mode, setMode] = useState<SourceMode>('file');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<RawWorkbook | null>(null);
  const [dataset, setDataset] = useState<Dataset>('arena');

  const acceptWorkbook = (loaded: RawWorkbook) => {
    setWorkbook(loaded);
    // Open the exporter the workbook looks like it is for; still switchable.
    setDataset(detectDataset(loaded));
    setLoadError(null);
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setLoadError(null);
    try {
      acceptWorkbook(await readWorkbookFile(file));
    } catch (error) {
      setLoadError(`Could not read "${file.name}": ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleUrl = async (url: string) => {
    setBusy(true);
    setLoadError(null);
    try {
      acceptWorkbook(await loadGoogleSheet(url));
    } catch (error) {
      setLoadError(
        error instanceof GoogleSheetsError
          ? error.message
          : `Could not load that sheet: ${(error as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setWorkbook(null);
    setLoadError(null);
  };

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__titles">
          <span className="masthead__mark" aria-hidden="true">
            {'{}'}
          </span>
          <div>
            <h1>Cliff Heroes JSON Exporter</h1>
            <p className="masthead__subtitle">Convert Cliff Heroes design sheets into game-ready JSON.</p>
          </div>
        </div>
      </header>

      {workbook === null ? (
        <div className="columns">
          <div className="stack">
            <SourceCard
              mode={mode}
              onModeChange={(next) => {
                setMode(next);
                setLoadError(null);
              }}
              onFile={handleFile}
              onUrl={handleUrl}
              busy={busy}
              error={loadError}
            />
          </div>

          <div className="stack">
            <section className="card card--muted">
              <header className="card__header">
                <h2 className="card__title">Output</h2>
              </header>
              <div className="card__body">
                <p className="empty">
                  Upload a workbook or paste a public Google Sheets link to get started. The exporter
                  reads the tabs it needs and picks the matching converter automatically - arena
                  progression or hero stats.
                </p>
              </div>
            </section>
          </div>
        </div>
      ) : (
        <>
          <div className="dataset-tabs" role="tablist" aria-label="Exporter">
            {DATASETS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={dataset === entry.id}
                className={`dataset-tab${dataset === entry.id ? ' dataset-tab--active' : ''}`}
                onClick={() => setDataset(entry.id)}
              >
                <span className="dataset-tab__label">{entry.label}</span>
                <span className="dataset-tab__blurb">{entry.blurb}</span>
              </button>
            ))}
          </div>

          {dataset === 'arena' ? (
            <ArenaExporter workbook={workbook} onReset={reset} />
          ) : (
            <HeroExporter workbook={workbook} onReset={reset} />
          )}
        </>
      )}
    </div>
  );
}
