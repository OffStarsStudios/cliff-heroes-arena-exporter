import { HeroUpgradePreviewTable } from '../components/HeroUpgradePreviewTable';
import { transformHeroUpgrade } from '../lib/heroUpgrade';
import { autoSelectHeroUpgradeSheets, type HeroUpgradeSheetSelection } from '../lib/sheetSelect';
import { serializeHeroUpgradeConfig, validateHeroUpgradeConfig } from '../lib/validateHeroUpgrade';
import type { HeroUpgradeConfig, HeroUpgradePreviewRow } from '../lib/types';
import type { ExporterDefinition } from './types';

/** The Hero upgrades exporter: `heroUpgradeSettings` from the Hero Upgrade Settings workbook. */
export const HERO_UPGRADE_EXPORTER: ExporterDefinition<
  HeroUpgradeSheetSelection,
  HeroUpgradeConfig,
  HeroUpgradePreviewRow
> = {
  domain: 'heroUpgrade',
  dataset: 'heroUpgrade',
  view: 'heroUpgrade',
  title: 'Hero upgrades',
  lead: (
    <>
      Turns the Hero Upgrade Settings workbook into <span className="mono">hero-upgrade.json</span> -
      the growth factors the game rolls the upgrade cost curve out of, and the coin and card bases per
      rarity.
    </>
  ),
  icon: 'coins',
  badge: 'heroupgrade',
  downloadFilename: 'hero-upgrade.json',
  tabsHint: 'Hero upgrades are joined from two tabs.',
  tabs: [
    {
      key: 'growth',
      label: 'Growth',
      note: 'Setting | Value rows: the growth factors, roundings, reference rarity and payout modifier.',
    },
    {
      key: 'costs',
      label: 'Costs',
      note: 'One row per rarity: coin and card bases plus the cost and growth modifiers.',
    },
  ],
  autoSelect: autoSelectHeroUpgradeSheets,
  analyze({ growth, costs }) {
    const result = transformHeroUpgrade({ growth, costs });
    return {
      config: result.config,
      preview: result.preview,
      issues: result.issues,
      stats: [{ label: 'Rarities', value: result.stats.rarities }],
      count: result.stats.rarities,
    };
  },
  validate: validateHeroUpgradeConfig,
  serialize: serializeHeroUpgradeConfig,
  PreviewTable: HeroUpgradePreviewTable,
  noun: { singular: 'rarity', plural: 'rarities' },
  errorContext: 'a setting or a rarity row is failing',
};
