import type { ComponentType, ReactNode } from 'react';
import type { IconName } from '../components/Icon';
import type { View } from '../components/AppShell';
import type { DomainId } from '../domains/types';
import type { Dataset } from '../lib/sheetSelect';
import type { Issue, RawSheet, RawWorkbook } from '../lib/types';
import type { IdRegistry } from '../workspace/registry';

/**
 * Everything that differs between two exporter pages.
 *
 * The pages themselves are identical in shape - load a workbook, pick the
 * tabs, review and publish - so that shape lives once in `ExporterPage` and
 * each config contributes only its parsing, its validation and its preview.
 * Adding a config is a definition, not a page.
 */

/** A tab selection: one sheet name (or null) per logical tab. */
export type TabSelection = Record<string, string | null>;

export interface TabSpec<S extends TabSelection> {
  key: keyof S & string;
  /** Short label for the picker, e.g. "Arenas lookup". */
  label: string;
  /** Plain-language description of what the tab has to contain. */
  note: string;
}

export interface Stat {
  label: string;
  value: number;
}

export interface AnalysisResult<TConfig, TRow> {
  config: TConfig;
  preview: TRow[];
  /** Transform-time and lookup issues. Error/warning counts are appended by the page. */
  issues: Issue[];
  /** Counts shown above the issues. Errors and warnings are added by the page. */
  stats: Stat[];
  /** Number of exported entries; the export is refused while it is zero. */
  count: number;
  /**
   * IDs the workbook defines (a Rewards lookup tab, say), so the live graph
   * check can judge references the published configs alone cannot.
   */
  registry?: IdRegistry;
}

/**
 * Fields the console sets itself, instead of reading them from the sheet.
 *
 * Most of a config is a description of content and belongs in a spreadsheet a
 * designer owns. A few fields are not: they are decisions about a live season -
 * when it starts, how long it runs - that somebody wants to change in the
 * minute before publishing, without opening Drive, editing a cell and
 * re-exporting. Those live here instead, as a step on the page.
 *
 * The value is remembered per config in `localStorage` and seeded from the live
 * payload the first time, so the panel opens on what the game is actually
 * serving rather than on a blank form.
 */
export interface ControlsPanelProps<TSettings> {
  value: TSettings;
  onChange: (next: TSettings) => void;
  /**
   * Which environment's live configs the panel may offer choices from - the
   * shop's actual products, say. A panel that only holds free text ignores it.
   */
  environmentId: string;
  /**
   * True when a live ops event owns the fields `eventSettings` derives, so the
   * panel shows those as already decided instead of inviting a second answer.
   */
  fromEvent?: boolean;
}

export interface ExporterControls<TSettings> {
  /** Step title, e.g. "Set the season window". */
  title: string;
  /** Step subtitle. */
  hint: string;
  /** Shown above the fields: why these are here and not in the sheet. */
  note: ReactNode;
  /** Opened on when nothing is stored and the live payload cannot supply one. */
  initial: TSettings;
  /** Reads the settings back out of a live payload, or null when it cannot. */
  fromLive(payload: unknown): TSettings | null;
  /** Revives a stored value, or null when what was stored no longer fits. */
  revive(stored: unknown): TSettings | null;
  Panel: ComponentType<ControlsPanelProps<TSettings>>;
  /** The step's status chip, e.g. "1 Sep - 1 Oct". */
  summary(value: TSettings): string;
  /** Problems with the settings themselves, listed beside the sheet's. */
  validate(value: TSettings): Issue[];
}

export interface ExporterDefinition<S extends TabSelection, TConfig, TRow, TSettings = void> {
  /** Publish target, localStorage key and graph-check substitution key. */
  domain: DomainId;
  /** Which `detectDataset` answer means "this workbook is for me". */
  dataset: Dataset;
  /** The page's own route, so other pages can offer a link to it. */
  view: View;
  title: string;
  lead: ReactNode;
  icon: IconName;
  /** CSS modifier for the title badge, e.g. `arenas` for `.page__badge--arenas`. */
  badge: string;
  downloadFilename: string;
  /** One-line summary for the tab picker, e.g. "Two tabs: the lookup and the settings." */
  tabsHint: string;
  tabs: TabSpec<S>[];
  autoSelect(workbook: RawWorkbook): S;
  /** Fields the page collects itself. Absent for a config the sheet fully describes. */
  controls?: ExporterControls<TSettings>;
  /**
   * The same fields, worked out from a live ops event's window instead of
   * being typed in.
   *
   * A config published by an event is published for exactly as long as the
   * event runs, so asking for the season window a second time in the booking
   * form would be asking somebody to keep two answers agreeing. The event's
   * own times are the answer; this maps them onto whatever the config calls
   * them. `base` is what the page last had, so fields the event says nothing
   * about - the final reward art, say - are carried over rather than blanked.
   *
   * Absent for a config whose page fields have nothing to do with a window.
   */
  eventSettings?(base: TSettings, window: { opensAt: string; endsAt: string }): TSettings;
  /** Pure. Only called once every tab is chosen; `sheets` has a RawSheet per tab key. */
  analyze(sheets: Record<keyof S & string, RawSheet>, settings: TSettings): AnalysisResult<TConfig, TRow>;
  /** Independent schema gate, run on "Generate JSON". */
  validate(config: TConfig): Issue[];
  serialize(config: TConfig): string;
  PreviewTable: ComponentType<{ rows: TRow[] }>;
  /** Noun for the preview tab and the action bar, e.g. `{ singular: 'arena', plural: 'arenas' }`. */
  noun: { singular: string; plural: string };
  /** What an error blocks, for the "N errors - nothing is exported while ..." heading. */
  errorContext: string;
  /** Optional extra help under the error list, e.g. a link to a reference page. */
  errorFooter?: (navigate: (view: View) => void) => ReactNode;
}
