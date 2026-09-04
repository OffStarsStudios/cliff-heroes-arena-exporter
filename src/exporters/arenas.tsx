import { ArenasPreviewTable } from '../components/ArenasPreviewTable';
import { transformArenas } from '../lib/arenas';
import { buildLookup } from '../lib/lookups';
import { autoSelectArenaSheets, type ArenaSheetSelection } from '../lib/sheetSelect';
import { serializeArenasConfig, validateArenasConfig } from '../lib/validateArenas';
import type { ArenaPreviewRow, ArenasConfig } from '../lib/types';
import type { ExporterDefinition } from './types';

/** The Arenas exporter: `arenasSettings` from the Arenas Settings workbook. */
export const ARENAS_EXPORTER: ExporterDefinition<ArenaSheetSelection, ArenasConfig, ArenaPreviewRow> = {
  domain: 'arenas',
  dataset: 'arenas',
  view: 'arenas',
  title: 'Arenas',
  lead: (
    <>
      Turns the Arenas Settings workbook into <span className="mono">arenas.json</span> - the track
      count and bot line-up of every arena, with IDs joined from the Arenas lookup tab.
    </>
  ),
  icon: 'table',
  badge: 'arenas',
  downloadFilename: 'arenas.json',
  tabsHint: 'Arenas are joined from two tabs.',
  tabs: [
    {
      key: 'arenas',
      label: 'Arenas lookup',
      note: 'Maps each arena name to its arena ID.',
    },
    {
      key: 'settings',
      label: 'Arena settings',
      note: 'One row per arena: track count, then a "Bot N Level" column per bot.',
    },
  ],
  autoSelect: autoSelectArenaSheets,
  analyze({ arenas, settings }) {
    const lookup = buildLookup(arenas, 'arena');
    const result = transformArenas({ settings, arenas: lookup.table });
    return {
      config: result.config,
      preview: result.preview,
      issues: [...lookup.issues, ...result.issues],
      stats: [
        { label: 'Arenas', value: result.stats.arenas },
        { label: 'Bots', value: result.stats.bots },
      ],
      count: result.stats.arenas,
    };
  },
  validate: validateArenasConfig,
  serialize: serializeArenasConfig,
  PreviewTable: ArenasPreviewTable,
  noun: { singular: 'arena', plural: 'arenas' },
  errorContext: 'a lookup, a track count or a bot level is failing',
};
