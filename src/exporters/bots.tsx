import { BotsPreviewTable } from '../components/BotsPreviewTable';
import { transformBots } from '../lib/bots';
import { autoSelectBotsSheets, type BotsSheetSelection } from '../lib/sheetSelect';
import { serializeBotsConfig, validateBotsConfig } from '../lib/validateBots';
import type { BotPreviewRow, BotsConfig } from '../lib/types';
import type { ExporterDefinition } from './types';

/** The Bots exporter: `botsSettings` from the Bots Settings workbook. */
export const BOTS_EXPORTER: ExporterDefinition<BotsSheetSelection, BotsConfig, BotPreviewRow> = {
  domain: 'bots',
  dataset: 'bots',
  view: 'bots',
  title: 'Bots',
  lead: (
    <>
      Turns the Bots Settings workbook into <span className="mono">bots.json</span> - the jump, dodge,
      raycast and fire tuning of every bot difficulty level. The highest level becomes{' '}
      <span className="mono">BotLevel</span> automatically.
    </>
  ),
  icon: 'bot',
  badge: 'bots',
  downloadFilename: 'bots.json',
  tabsHint: 'Bots come from one tab.',
  tabs: [
    {
      key: 'bots',
      label: 'Bots',
      note: 'One row per level: the level number and the eight tuning values.',
    },
  ],
  autoSelect: autoSelectBotsSheets,
  analyze({ bots }) {
    const result = transformBots({ bots });
    return {
      config: result.config,
      preview: result.preview,
      issues: result.issues,
      stats: [{ label: 'Levels', value: result.stats.levels }],
      count: result.stats.levels,
    };
  },
  validate: validateBotsConfig,
  serialize: serializeBotsConfig,
  PreviewTable: BotsPreviewTable,
  noun: { singular: 'level', plural: 'levels' },
  errorContext: 'a level or a tuning value is failing',
};
