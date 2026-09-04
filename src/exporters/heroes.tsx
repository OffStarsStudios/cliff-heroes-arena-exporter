import { HeroPreviewTable } from '../components/HeroPreviewTable';
import { transformHeroes } from '../lib/heroes';
import { buildLookup } from '../lib/lookups';
import { autoSelectHeroSheets, type HeroSheetSelection } from '../lib/sheetSelect';
import { serializeHeroesConfig, validateHeroesConfig } from '../lib/validateHeroes';
import type { HeroPreviewRow, HeroesConfig } from '../lib/types';
import type { ExporterDefinition } from './types';

/** The Hero stats exporter: `heroesSettings` from the Heroes Configuration workbook. */
export const HEROES_EXPORTER: ExporterDefinition<HeroSheetSelection, HeroesConfig, HeroPreviewRow> = {
  domain: 'heroes',
  dataset: 'heroes',
  view: 'heroes',
  title: 'Hero stats',
  lead: (
    <>
      Joins four tabs into <span className="mono">heroes.json</span> - base stats, the per-level
      curve, and each hero&apos;s power cooldown and special parameters.
    </>
  ),
  icon: 'spark',
  badge: 'heroes',
  downloadFilename: 'heroes.json',
  tabsHint: 'Hero stats are joined from four tabs.',
  tabs: [
    { key: 'heroes', label: 'Heroes lookup', note: 'Maps each hero name to its hero ID.' },
    { key: 'baseStats', label: 'Base stats', note: 'Level 1 health, speed and grip per hero, plus rarity.' },
    {
      key: 'levelFactors',
      label: 'Stats level factors',
      note: 'Per-level multipliers applied on top of the base stats.',
    },
    {
      key: 'powerSettings',
      label: 'Power settings',
      note: "Cooldown and the special parameters each hero's power uses.",
    },
  ],
  autoSelect: autoSelectHeroSheets,
  analyze({ heroes, baseStats, levelFactors, powerSettings }) {
    const lookup = buildLookup(heroes, 'hero');
    const result = transformHeroes({ baseStats, levelFactors, powerSettings, heroes: lookup.table });
    return {
      config: result.config,
      preview: result.preview,
      issues: [...lookup.issues, ...result.issues],
      stats: [
        { label: 'Heroes', value: result.stats.heroes },
        { label: 'Levels', value: result.stats.levels },
        { label: 'Power params', value: result.stats.powerParams },
      ],
      count: result.stats.heroes,
    };
  },
  validate: validateHeroesConfig,
  serialize: serializeHeroesConfig,
  PreviewTable: HeroPreviewTable,
  noun: { singular: 'hero', plural: 'heroes' },
  errorContext: 'a parameter name or lookup is failing',
  errorFooter: (navigate) => (
    <>
      Unknown parameter name?{' '}
      <button type="button" className="btn btn--sm" onClick={() => navigate('reference')}>
        See the accepted list
      </button>
    </>
  ),
};
