import { useCallback, useEffect, useMemo, useState } from 'react';
import { SheetPicker } from '../components/SheetPicker';
import { ColumnMapper } from '../components/ColumnMapper';
import { IssueList, SummaryCard } from '../components/SummaryCard';
import { PreviewTable } from '../components/PreviewTable';
import { JsonOutput } from '../components/JsonOutput';
import { detectColumns } from '../lib/columnDetect';
import { buildLookup } from '../lib/lookups';
import { autoSelectSheets, type SheetSelection } from '../lib/sheetSelect';
import { transform } from '../lib/transform';
import { serializeConfig, validateConfig } from '../lib/validate';
import type {
  ColumnMapping,
  ColumnRole,
  Issue,
  RawSheet,
  RawWorkbook,
  TransformResult,
} from '../lib/types';

const DOWNLOAD_FILENAME = 'arena-progress.json';

interface ArenaExporterProps {
  workbook: RawWorkbook;
  onReset: () => void;
}

function findSheet(workbook: RawWorkbook, name: string | null): RawSheet | null {
  if (name === null) return null;
  return workbook.sheets.find((sheet) => sheet.name === name) ?? null;
}

export function ArenaExporter({ workbook, onReset }: ArenaExporterProps) {
  const [selection, setSelection] = useState<SheetSelection>(() => autoSelectSheets(workbook));
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [uncertain, setUncertain] = useState<ColumnRole[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [generated, setGenerated] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  // A new workbook resets the tab choices.
  useEffect(() => {
    setSelection(autoSelectSheets(workbook));
    setGenerated(null);
    setSchemaError(null);
  }, [workbook]);

  /** Re-runs automatic column detection for the currently selected progression sheet. */
  const redetect = useCallback((sheet: RawSheet | null) => {
    if (sheet === null) {
      setMapping(null);
      setHeaders([]);
      setUncertain([]);
      setHeaderRowIndex(0);
      return;
    }
    const detection = detectColumns(sheet);
    setMapping(detection.mapping);
    setHeaders(detection.headers);
    setUncertain(detection.uncertain);
    setHeaderRowIndex(detection.headerRowIndex);
  }, []);

  // Re-detect whenever the progression sheet changes.
  useEffect(() => {
    redetect(findSheet(workbook, selection.progression));
    setGenerated(null);
  }, [workbook, selection.progression, redetect]);

  // Live analysis: everything except the JSON itself updates as selections change.
  const analysis: { result: TransformResult | null; issues: Issue[] } = useMemo(() => {
    if (mapping === null) return { result: null, issues: [] };

    const progression = findSheet(workbook, selection.progression);
    const arenaSheet = findSheet(workbook, selection.arenas);
    const rewardSheet = findSheet(workbook, selection.rewards);

    const issues: Issue[] = [];
    if (progression === null) {
      issues.push({
        severity: 'error',
        code: 'missing-progression-tab',
        message: 'Select the progression sheet to continue.',
      });
    }
    if (arenaSheet === null) {
      issues.push({
        severity: 'error',
        code: 'missing-lookup-tab',
        message: 'This workbook has no Arenas lookup tab selected. Pick the tab that maps arena names to ArenaIDs.',
      });
    }
    if (rewardSheet === null) {
      issues.push({
        severity: 'error',
        code: 'missing-lookup-tab',
        message: 'This workbook has no Rewards lookup tab selected. Pick the tab that maps reward names to RewardIDs.',
      });
    }
    if (progression === null || arenaSheet === null || rewardSheet === null) {
      return { result: null, issues };
    }

    const arenas = buildLookup(arenaSheet, 'arena');
    const rewards = buildLookup(rewardSheet, 'reward');
    const result = transform({
      progression,
      headerRowIndex,
      mapping,
      arenas: arenas.table,
      rewards: rewards.table,
    });

    const combined = [...issues, ...arenas.issues, ...rewards.issues, ...result.issues];
    const errors = combined.filter((issue) => issue.severity === 'error').length;

    return {
      result: {
        ...result,
        issues: combined,
        stats: { ...result.stats, errors, warnings: combined.length - errors },
      },
      issues: combined,
    };
  }, [workbook, selection, mapping, headerRowIndex]);

  const errorCount = analysis.issues.filter((issue) => issue.severity === 'error').length;
  const canGenerate = analysis.result !== null && errorCount === 0 && analysis.result.stats.milestones > 0;

  const generate = () => {
    if (analysis.result === null) return;
    // Independent schema check before anything can be copied or downloaded.
    const schemaIssues = validateConfig(analysis.result.config);
    if (schemaIssues.length > 0) {
      setGenerated(null);
      setSchemaError(schemaIssues.map((issue) => issue.message).join(' '));
      return;
    }
    setSchemaError(null);
    setGenerated(serializeConfig(analysis.result.config));
  };

  return (
    <div className="columns">
      <div className="stack">
        <SheetPicker
          sheetNames={workbook.sheets.map((sheet) => sheet.name)}
          selection={selection}
          onChange={(next) => {
            setSelection(next);
            setGenerated(null);
          }}
          sourceName={workbook.sourceName}
          onReset={onReset}
        />

        {mapping !== null && (
          <ColumnMapper
            headers={headers}
            mapping={mapping}
            uncertain={uncertain}
            onChange={(next) => {
              setMapping(next);
              setGenerated(null);
            }}
            onRedetect={() => redetect(findSheet(workbook, selection.progression))}
          />
        )}

        {analysis.result !== null && <SummaryCard result={analysis.result} />}

        {schemaError !== null && <p className="error-text">{schemaError}</p>}

        <IssueList issues={analysis.issues} severity="error" title="Validation errors" />
        <IssueList issues={analysis.issues} severity="warning" title="Warnings" />

        <button type="button" className="btn btn--primary btn--large" onClick={generate} disabled={!canGenerate}>
          {errorCount > 0 ? `Fix ${errorCount} error${errorCount === 1 ? '' : 's'} to generate` : 'Generate JSON'}
        </button>
      </div>

      <div className="stack">
        {generated !== null ? (
          <JsonOutput json={generated} filename={DOWNLOAD_FILENAME} />
        ) : (
          <section className="card card--muted">
            <header className="card__header">
              <h2 className="card__title">Generated JSON</h2>
            </header>
            <div className="card__body">
              <p className="empty">
                {errorCount > 0
                  ? 'Resolve the validation errors on the left - no partial JSON is produced while a join is failing.'
                  : 'Review the parsed milestones below, then press Generate JSON.'}
              </p>
            </div>
          </section>
        )}

        {analysis.result !== null && <PreviewTable rows={analysis.result.preview} />}
      </div>
    </div>
  );
}
