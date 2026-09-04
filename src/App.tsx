import { useCallback, useEffect, useState } from 'react';
import { AppShell, type ShellSource, type View } from './components/AppShell';
import { ExporterPage } from './components/ExporterPage';
import type { ExporterDomain } from './domains/types';
import { ARENAS_EXPORTER } from './exporters/arenas';
import { HEROES_EXPORTER } from './exporters/heroes';
import { MATCH_TROPHY_EXPORTER } from './exporters/matchTrophy';
import { ArenaExporter } from './features/ArenaExporter';
import { LiveConfig } from './features/LiveConfig';
import { ParamReference } from './features/ParamReference';
import { SOURCE_LABELS, useWorkbookSources } from './hooks/useWorkbookSources';

const VIEWS: View[] = ['live', 'arena', 'heroes', 'arenas', 'matchTrophy', 'reference'];

/** Which workbook each page owns. Pages without one show no source in the shell. */
const DOMAIN_FOR_VIEW: Partial<Record<View, ExporterDomain>> = {
  arena: 'trophyRoad',
  heroes: 'heroes',
  arenas: 'arenas',
  matchTrophy: 'matchTrophy',
};

function viewFromHash(): View {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (VIEWS as string[]).includes(hash) ? (hash as View) : 'arena';
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const { sources, controllerFor } = useWorkbookSources();

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

  const domain = DOMAIN_FOR_VIEW[view];
  const shellSource: ShellSource | null =
    domain === undefined
      ? null
      : {
          label: SOURCE_LABELS[domain],
          workbook: sources[domain].workbook,
          onReset: () => controllerFor(domain).onReset(),
        };

  return (
    <AppShell view={view} onNavigate={navigate} source={shellSource}>
      {view === 'live' && <LiveConfig />}
      {view === 'arena' && (
        <ArenaExporter source={controllerFor('trophyRoad')} onNavigate={navigate} />
      )}
      {view === 'heroes' && (
        <ExporterPage
          definition={HEROES_EXPORTER}
          source={controllerFor('heroes')}
          onNavigate={navigate}
        />
      )}
      {view === 'arenas' && (
        <ExporterPage
          definition={ARENAS_EXPORTER}
          source={controllerFor('arenas')}
          onNavigate={navigate}
        />
      )}
      {view === 'matchTrophy' && (
        <ExporterPage
          definition={MATCH_TROPHY_EXPORTER}
          source={controllerFor('matchTrophy')}
          onNavigate={navigate}
        />
      )}
      {view === 'reference' && <ParamReference />}
    </AppShell>
  );
}
