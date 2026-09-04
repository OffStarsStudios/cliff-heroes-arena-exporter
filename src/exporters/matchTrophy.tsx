import { MatchTrophyPreviewTable } from '../components/MatchTrophyPreviewTable';
import { transformMatchTrophy } from '../lib/matchTrophy';
import { autoSelectMatchTrophySheets, type MatchTrophySheetSelection } from '../lib/sheetSelect';
import { serializeMatchTrophyConfig, validateMatchTrophyConfig } from '../lib/validateMatchTrophy';
import type { MatchTrophyConfig, MatchTrophyPreviewRow } from '../lib/types';
import type { ExporterDefinition } from './types';

/** The Match trophies exporter: `matchTrophySettings` from the Match Trophy Settings workbook. */
export const MATCH_TROPHY_EXPORTER: ExporterDefinition<
  MatchTrophySheetSelection,
  MatchTrophyConfig,
  MatchTrophyPreviewRow
> = {
  domain: 'matchTrophy',
  dataset: 'matchTrophy',
  view: 'matchTrophy',
  title: 'Match trophies',
  lead: (
    <>
      Turns the Match Trophy Settings workbook into <span className="mono">match-trophy.json</span> -
      the trophies a racer wins or loses for each finishing place. The number of places is the
      racer count, so it has to match the bots every arena runs.
    </>
  ),
  icon: 'medal',
  badge: 'matchtrophy',
  downloadFilename: 'match-trophy.json',
  tabsHint: 'Match trophies come from one tab.',
  tabs: [
    {
      key: 'places',
      label: 'Trophies by place',
      note: 'One row per finishing place: the place number and the trophy delta (negative for a loss).',
    },
  ],
  autoSelect: autoSelectMatchTrophySheets,
  analyze({ places }) {
    const result = transformMatchTrophy({ places });
    return {
      config: result.config,
      preview: result.preview,
      issues: result.issues,
      stats: [{ label: 'Places', value: result.stats.places }],
      count: result.stats.places,
    };
  },
  validate: validateMatchTrophyConfig,
  serialize: serializeMatchTrophyConfig,
  PreviewTable: MatchTrophyPreviewTable,
  noun: { singular: 'place', plural: 'places' },
  errorContext: 'a place or a trophy value is failing',
};
