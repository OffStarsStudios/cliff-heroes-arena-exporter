import { BattlePassPreviewTable } from '../components/BattlePassPreviewTable';
import { SeasonPanel, readableUtc } from '../components/SeasonPanel';
import {
  EMPTY_SEASON,
  parseStartUtc,
  transformBattlePass,
  validateSeason,
  type BattlePassSeason,
} from '../lib/battlePass';
import { buildLookup } from '../lib/lookups';
import { autoSelectBattlePassSheets, type BattlePassSheetSelection } from '../lib/sheetSelect';
import { serializeBattlePassConfig, validateBattlePassConfig } from '../lib/validateBattlePass';
import type { BattlePassConfig, BattlePassPreviewRow } from '../lib/types';
import { rewardRegistryFromLookup } from '../workspace/registry';
import type { ExporterDefinition } from './types';

/**
 * Reads a season header out of anything shaped like a published
 * `battlePassSettings`.
 *
 * Used both to seed the panel from the live season and to revive what was
 * stored locally, because the two want the same fields checked the same way.
 * Every field is read leniently and defaulted, except the two that decide
 * whether this is a season at all: a payload with no usable start or duration
 * yields null, which both callers read as "nothing usable here" and fall
 * through to the next source.
 *
 * The camelCase spellings are accepted because that is how a stored panel
 * value comes back, and the payload spellings because that is how the live
 * season arrives. One reader for both keeps the two from drifting apart.
 */
function seasonFrom(payload: unknown): BattlePassSeason | null {
  if (payload === null || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  const text = (published: string, stored: string): string => {
    const value = record[published] ?? record[stored];
    return typeof value === 'string' ? value : '';
  };
  const count = (published: string, stored: string): number => {
    const value = record[published] ?? record[stored];
    return typeof value === 'number' ? value : 0;
  };

  const canonical = parseStartUtc(text('StartUtc', 'startUtc'));
  const days = count('DurationDays', 'durationDays');
  if (canonical === null || !Number.isInteger(days) || days < 1) return null;

  return {
    seasonId: text('SeasonID', 'seasonId'),
    seasonName: text('SeasonName', 'seasonName'),
    startUtc: canonical,
    durationDays: days,
    tokensPerTier: count('TokensPerTier', 'tokensPerTier'),
    premiumProductId: text('PremiumProductID', 'premiumProductId'),
    skipTierCost: count('SkipTierCost', 'skipTierCost'),
    skipCurrencyId: text('SkipCurrencyID', 'skipCurrencyId'),
    finalRewardArt: text('FinalRewardArt', 'finalRewardArt'),
  };
}

/**
 * An ISO instant as the `YYYY-MM-DD HH:mm` UTC stamp the season speaks.
 *
 * ISO is already UTC, so the wall clock is a slice rather than a conversion -
 * which is the point: no timezone maths sits between the event's opening time
 * and the season's start.
 */
function utcStamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

/** The Battle pass exporter: `battlePassSettings` from the Battle Pass Settings workbook. */
export const BATTLE_PASS_EXPORTER: ExporterDefinition<
  BattlePassSheetSelection,
  BattlePassConfig,
  BattlePassPreviewRow,
  BattlePassSeason
> = {
  domain: 'battlePass',
  dataset: 'battlePass',
  view: 'battlePass',
  title: 'Battle pass',
  lead: (
    <>
      The season header, set here, and the ladder, read from the sheet, published together as{' '}
      <span className="mono">battlePassSettings</span>. Tier numbers have to run 1 upwards with no
      gaps - the array is the ladder.
    </>
  ),
  icon: 'ticket',
  badge: 'battlepass',
  downloadFilename: 'battle-pass.json',
  tabsHint: 'Two tabs. The season header is set on this page.',
  tabs: [
    {
      key: 'tiers',
      label: 'Tiers',
      note: 'One row per tier: the number, then the free and premium reward with its amount.',
    },
    {
      key: 'rewards',
      label: 'Rewards lookup',
      note: 'Maps each reward name to its reward ID.',
    },
  ],
  autoSelect: autoSelectBattlePassSheets,
  controls: {
    title: 'Set the season',
    hint: 'The whole header: IDs, window, prices',
    note: (
      <>
        Set here, not on a <span className="mono">Season</span> tab: the product comes from what the
        shop sells and the ID follows the live season.
      </>
    ),
    initial: EMPTY_SEASON,
    fromLive: seasonFrom,
    revive: seasonFrom,
    Panel: SeasonPanel,
    validate: validateSeason,
    summary: (season) => {
      if (season.seasonId.trim() === '') return 'Not set';
      const days = `${season.durationDays} day${season.durationDays === 1 ? '' : 's'}`;
      return season.startUtc.trim() === ''
        ? `${season.seasonId}, no start`
        : `${season.seasonId}, ${readableUtc(season.startUtc)} for ${days}`;
    },
  },
  eventSettings(base, { opensAt, endsAt }) {
    // The season the client reads and the event the calendar draws are the
    // same span, so the pass takes its start and length from the booking.
    // Whole days is the client's unit, so a window that is not a whole number
    // of them is rounded here and the rounding is shown in the form rather
    // than discovered later in the payload.
    const days = Math.round((Date.parse(endsAt) - Date.parse(opensAt)) / 86400000);
    return {
      ...base,
      startUtc: utcStamp(opensAt),
      durationDays: Number.isFinite(days) ? Math.max(1, days) : base.durationDays,
    };
  },
  analyze({ tiers, rewards }, season) {
    const lookup = buildLookup(rewards, 'reward');
    const result = transformBattlePass({ tiers, rewards: lookup.table, season });
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
  errorContext: 'a season setting, a tier row or a reward lookup is failing',
};
