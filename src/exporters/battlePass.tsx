import { BattlePassPreviewTable } from '../components/BattlePassPreviewTable';
import { transformBattlePass } from '../lib/battlePass';
import { buildLookup } from '../lib/lookups';
import { autoSelectBattlePassSheets, type BattlePassSheetSelection } from '../lib/sheetSelect';
import { serializeBattlePassConfig, validateBattlePassConfig } from '../lib/validateBattlePass';
import type { BattlePassConfig, BattlePassPreviewRow } from '../lib/types';
import { emptyRegistry, idsFromLookup } from '../workspace/registry';
import type { ExporterDefinition } from './types';

/** The Battle pass exporter: `battlePassSettings` from the Battle Pass Settings workbook. */
export const BATTLE_PASS_EXPORTER: ExporterDefinition<
  BattlePassSheetSelection,
  BattlePassConfig,
  BattlePassPreviewRow
> = {
  domain: 'battlePass',
  dataset: 'battlePass',
  view: 'battlePass',
  title: 'Battle pass',
  lead: (
    <>
      The season header and every tier's free and premium reward, joined against the Rewards
      lookup tab and published to <span className="mono">battlePassSettings</span>. Tier order is
      the ladder the player climbs, so the numbers have to run 1 upwards with no gaps.
    </>
  ),
  icon: 'ticket',
  badge: 'battlepass',
  downloadFilename: 'battle-pass.json',
  tabsHint: 'The pass is joined from three tabs.',
  tabs: [
    {
      key: 'season',
      label: 'Season',
      note: 'One row per season setting: the ID and name, the start time, duration, tokens per tier, the premium product and the skip cost.',
    },
    {
      key: 'tiers',
      label: 'Tiers',
      note: 'One row per tier: the tier number, then the free and premium reward with its amount. Either track may be left empty.',
    },
    {
      key: 'rewards',
      label: 'Rewards lookup',
      note: 'Maps each reward name to its reward ID.',
    },
  ],
  autoSelect: autoSelectBattlePassSheets,
  analyze({ season, tiers, rewards }) {
    const lookup = buildLookup(rewards, 'reward');
    const result = transformBattlePass({ season, tiers, rewards: lookup.table });
    const registry = emptyRegistry();
    for (const id of idsFromLookup(lookup.table)) registry.rewards.add(id);
    if (registry.rewards.size > 0) registry.sources.rewards.push('Rewards lookup tab');
    return {
      config: result.config,
      preview: result.preview,
      issues: [...lookup.issues, ...result.issues],
      stats: [
        { label: 'Tiers', value: result.stats.tiers },
        { label: 'Free rewards', value: result.stats.free },
        { label: 'Premium rewards', value: result.stats.premium },
      ],
      count: result.stats.tiers,
      registry,
    };
  },
  validate: validateBattlePassConfig,
  serialize: serializeBattlePassConfig,
  PreviewTable: BattlePassPreviewTable,
  noun: { singular: 'tier', plural: 'tiers' },
  errorContext: 'a season setting, a tier row or a reward lookup is failing',
};
