import type { LiveOpsDomain } from '../lib/liveops';
import { BATTLE_PASS_EXPORTER } from './battlePass';
import type { ExporterDefinition } from './types';

/**
 * Which exporter reads each live ops feature's sheet.
 *
 * The booking form needs it for one reason: an event carries a config, that
 * config is authored in a spreadsheet, and the sheet has to be checked exactly
 * as its own page checks it. Reusing the definition rather than re-implementing
 * "read a battle pass" in the dialog is what makes the two agree - there is one
 * parser, one set of issue messages and one schema gate per feature, whether
 * the config is published from its page or by an event.
 */

/**
 * An exporter with its four type parameters erased.
 *
 * The dialog is generic over features: it loads a workbook, hands it to the
 * definition, and renders whatever issues come back. It never touches a
 * `BattlePassConfig` or a `BattlePassSchedule` by name, so the concrete types
 * would only be there to be immediately widened. `any` rather than `unknown`
 * because the definition's own members are contravariant in them - a preview
 * table for `unknown` rows is not a preview table for battle pass rows.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyExporter = ExporterDefinition<any, any, any, any>;

export const LIVEOPS_EXPORTERS: Record<LiveOpsDomain, AnyExporter> = {
  battlePass: BATTLE_PASS_EXPORTER,
};
