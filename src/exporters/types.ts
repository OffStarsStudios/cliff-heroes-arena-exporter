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

export interface ExporterDefinition<S extends TabSelection, TConfig, TRow> {
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
  /** Pure. Only called once every tab is chosen; `sheets` has a RawSheet per tab key. */
  analyze(sheets: Record<keyof S & string, RawSheet>): AnalysisResult<TConfig, TRow>;
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
