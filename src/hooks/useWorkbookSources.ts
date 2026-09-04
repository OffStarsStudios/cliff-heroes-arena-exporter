import { useCallback, useState } from 'react';
import type { SourceController } from '../components/SourcePanel';
import { EXPORTER_DOMAINS, type ExporterDomain } from '../domains/types';
import { GoogleSheetsError, loadGoogleSheet } from '../lib/googleSheets';
import { recallSheetUrl, rememberSheetUrl } from '../lib/recentSources';
import { readWorkbookFile } from '../lib/workbook';
import type { RawWorkbook } from '../lib/types';

/**
 * One workbook per exporter page.
 *
 * Every config lives in its own Google Sheet, so every page keeps its own
 * loaded workbook rather than sharing one and hinting when it is the wrong
 * kind. The state is owned above the pages so it survives navigation.
 */

export interface PageSource {
  workbook: RawWorkbook | null;
  busy: boolean;
  error: string | null;
  /** The Google Sheet link this page loaded last time, if any. */
  lastUrl: string | null;
}

/** How each page names its workbook, matching the sheet titles in Drive. */
export const SOURCE_LABELS: Record<ExporterDomain, string> = {
  heroes: 'Heroes Configuration',
  trophyRoad: 'Arena progression',
  arenas: 'Arenas Settings',
  matchTrophy: 'Match Trophy Settings',
  bots: 'Bots Settings',
};

type Sources = Record<ExporterDomain, PageSource>;

function initialSources(): Sources {
  const sources = {} as Sources;
  for (const domain of EXPORTER_DOMAINS) {
    sources[domain] = { workbook: null, busy: false, error: null, lastUrl: recallSheetUrl(domain) };
  }
  return sources;
}

export function useWorkbookSources() {
  const [sources, setSources] = useState<Sources>(initialSources);

  const update = useCallback((domain: ExporterDomain, patch: Partial<PageSource>) => {
    setSources((previous) => ({ ...previous, [domain]: { ...previous[domain], ...patch } }));
  }, []);

  const loadFile = useCallback(
    async (domain: ExporterDomain, file: File) => {
      update(domain, { busy: true, error: null });
      try {
        const workbook = await readWorkbookFile(file);
        update(domain, { workbook, busy: false });
      } catch (error) {
        update(domain, {
          busy: false,
          error: `Could not read "${file.name}": ${(error as Error).message}`,
        });
      }
    },
    [update],
  );

  const loadUrl = useCallback(
    async (domain: ExporterDomain, url: string) => {
      update(domain, { busy: true, error: null });
      try {
        const workbook = await loadGoogleSheet(url);
        // Remembered only after a successful load, so a mistyped link is not kept.
        rememberSheetUrl(domain, url);
        update(domain, { workbook, busy: false, lastUrl: url });
      } catch (error) {
        update(domain, {
          busy: false,
          error:
            error instanceof GoogleSheetsError
              ? error.message
              : `Could not load that sheet: ${(error as Error).message}`,
        });
      }
    },
    [update],
  );

  const controllerFor = useCallback(
    (domain: ExporterDomain): SourceController => {
      const source = sources[domain];
      return {
        label: SOURCE_LABELS[domain],
        workbook: source.workbook,
        busy: source.busy,
        error: source.error,
        lastUrl: source.lastUrl,
        onFile: (file) => void loadFile(domain, file),
        onUrl: (url) => void loadUrl(domain, url),
        onReloadLast: () => {
          if (source.lastUrl !== null) void loadUrl(domain, source.lastUrl);
        },
        onReset: () => update(domain, { workbook: null, error: null }),
        onClearError: () => update(domain, { error: null }),
      };
    },
    [sources, loadFile, loadUrl, update],
  );

  return { sources, controllerFor };
}
