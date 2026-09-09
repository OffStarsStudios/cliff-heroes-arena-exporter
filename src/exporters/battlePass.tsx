import { BattlePassPreviewTable } from '../components/BattlePassPreviewTable';
import { SeasonWindowPanel, readableUtc } from '../components/SeasonWindowPanel';
import {
  EMPTY_SCHEDULE,
  parseStartUtc,
  seasonEndUtc,
  transformBattlePass,
  validateSchedule,
  type BattlePassSchedule,
} from '../lib/battlePass';
import { buildLookup } from '../lib/lookups';
import { autoSelectBattlePassSheets, type BattlePassSheetSelection } from '../lib/sheetSelect';
import { serializeBattlePassConfig, validateBattlePassConfig } from '../lib/validateBattlePass';
import type { BattlePassConfig, BattlePassPreviewRow } from '../lib/types';
import { rewardRegistryFromLookup } from '../workspace/registry';
import type { ExporterDefinition } from './types';

/**
 * Reads a schedule out of anything shaped like a published `battlePassSettings`.
 *
 * Used both to seed the panel from the live season and to revive what was
 * stored locally, because the two want the same three fields checked the same
 * way. Anything that does not parse yields null, which the page reads as
 * "nothing usable here" and falls through to the next source.
 */
function scheduleFrom(payload: unknown): BattlePassSchedule | null {
  if (payload === null || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const start = typeof record.StartUtc === 'string' ? record.StartUtc : record.startUtc;
  const days = typeof record.DurationDays === 'number' ? record.DurationDays : record.durationDays;
  const art = typeof record.FinalRewardArt === 'string' ? record.FinalRewardArt : record.finalRewardArt;
  if (typeof start !== 'string' || typeof days !== 'number') return null;
  const canonical = parseStartUtc(start);
  if (canonical === null || !Number.isInteger(days) || days < 1) return null;
  return {
    startUtc: canonical,
    durationDays: days,
    finalRewardArt: typeof art === 'string' ? art : '',
  };
}

/** The Battle pass exporter: `battlePassSettings` from the Battle Pass Settings workbook. */
export const BATTLE_PASS_EXPORTER: ExporterDefinition<
  BattlePassSheetSelection,
  BattlePassConfig,
  BattlePassPreviewRow,
  BattlePassSchedule
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
      note: 'One row per season setting: the ID and name, tokens per tier, the premium product and the skip cost. The start, duration and final reward art are set on this page instead.',
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
  controls: {
    title: 'Set the season window',
    hint: 'Start, duration and final reward art',
    note: (
      <>
        These three are set here rather than in the sheet. When a season starts and how long it
        runs are decisions about the live game, and the art usually arrives after the ladder is
        already written, so none of them is worth a trip through Drive. Everything else on the
        pass still comes from the <span className="mono">Season</span> tab.
      </>
    ),
    initial: EMPTY_SCHEDULE,
    fromLive: scheduleFrom,
    revive: scheduleFrom,
    Panel: SeasonWindowPanel,
    validate: validateSchedule,
    summary: (schedule) => {
      const end = seasonEndUtc(schedule);
      if (end === null) return 'Not set';
      return `${readableUtc(schedule.startUtc)} for ${schedule.durationDays} day${schedule.durationDays === 1 ? '' : 's'}`;
    },
  },
  analyze({ season, tiers, rewards }, schedule) {
    const lookup = buildLookup(rewards, 'reward');
    const result = transformBattlePass({ season, tiers, rewards: lookup.table, schedule });
    const registry = rewardRegistryFromLookup(lookup.table, 'battlePass');
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
  errorContext: 'a season setting, the season window, a tier row or a reward lookup is failing',
};
