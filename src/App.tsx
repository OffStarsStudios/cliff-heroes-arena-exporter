import { useCallback, useEffect, useState } from 'react';
import { AppShell, type View } from './components/AppShell';
import { ArenaExporter } from './features/ArenaExporter';
import { HeroExporter } from './features/HeroExporter';
import { ParamReference } from './features/ParamReference';
import { detectDataset } from './lib/sheetSelect';
import { readWorkbookFile } from './lib/workbook';
import { GoogleSheetsError, loadGoogleSheet } from './lib/googleSheets';
import type { RawWorkbook } from './lib/types';

const VIEWS: View[] = ['arena', 'heroes', 'reference'];

function viewFromHash(): View {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (VIEWS as string[]).includes(hash) ? (hash as View) : 'arena';
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<RawWorkbook | null>(null);

  // Deep-linkable sections, and a back button that goes where it looks like it will.
  useEffect(() => {
    const sync = () => setView(viewFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const navigate = useCallback((next: View) => {
    window.location.hash = `/${next}`;
    setView(next);
  }, []);

  const acceptWorkbook = (loaded: RawWorkbook) => {
    setWorkbook(loaded);
    setLoadError(null);
    // Only jump when the current page cannot use the workbook at all; on an
    // exporter page the user's choice wins and we surface a hint instead.
    if (view === 'reference') navigate(detectDataset(loaded));
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

  const source = {
    workbook,
    busy,
    error: loadError,
    onFile: handleFile,
    onUrl: handleUrl,
    onReset: reset,
    onClearError: () => setLoadError(null),
  };

  return (
    <AppShell view={view} onNavigate={navigate} workbook={workbook} onReset={reset}>
      {view === 'arena' && <ArenaExporter source={source} onNavigate={navigate} />}
      {view === 'heroes' && <HeroExporter source={source} onNavigate={navigate} />}
      {view === 'reference' && <ParamReference />}
    </AppShell>
  );
}
