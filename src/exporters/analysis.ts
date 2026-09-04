import type { Issue, RawSheet, RawWorkbook } from '../lib/types';
import type { AnalysisResult, ExporterDefinition, TabSelection } from './types';

/** The page's live analysis: the definition's result plus the missing-tab issues. */
export interface Analysis<TConfig, TRow> {
  /** Null until every tab is chosen. */
  result: AnalysisResult<TConfig, TRow> | null;
  issues: Issue[];
  errors: number;
  warnings: number;
}

export function findSheet(workbook: RawWorkbook | null, name: string | null): RawSheet | null {
  if (workbook === null || name === null) return null;
  return workbook.sheets.find((sheet) => sheet.name === name) ?? null;
}

/**
 * Runs an exporter definition over the chosen tabs.
 *
 * Pure and React-free so it can be tested without a page: missing tabs become
 * errors (the same wording every exporter has used), and only when all tabs
 * are present is the definition's own analysis run.
 */
export function runAnalysis<S extends TabSelection, TConfig, TRow>(
  definition: ExporterDefinition<S, TConfig, TRow>,
  workbook: RawWorkbook | null,
  selection: S,
): Analysis<TConfig, TRow> {
  if (workbook === null) return { result: null, issues: [], errors: 0, warnings: 0 };

  const issues: Issue[] = [];
  const sheets: Partial<Record<keyof S & string, RawSheet>> = {};
  for (const tab of definition.tabs) {
    const sheet = findSheet(workbook, selection[tab.key]);
    if (sheet === null) {
      issues.push({
        severity: 'error',
        code: 'missing-tab',
        message: `Select the ${tab.label} tab in step 2 to continue.`,
      });
      continue;
    }
    sheets[tab.key] = sheet;
  }

  if (issues.length > 0) {
    return { result: null, issues, errors: issues.length, warnings: 0 };
  }

  const result = definition.analyze(sheets as Record<keyof S & string, RawSheet>);
  const errors = result.issues.filter((issue) => issue.severity === 'error').length;
  return {
    result,
    issues: result.issues,
    errors,
    warnings: result.issues.length - errors,
  };
}
