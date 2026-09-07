import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChangeReview } from '../components/ChangeReview';
import { ColumnMapper } from '../components/ColumnMapper';
import { Icon } from '../components/Icon';
import { PreviewTable } from '../components/PreviewTable';
import { SheetPicker } from '../components/SheetPicker';
import { SourcePanel, type SourceController } from '../components/SourcePanel';
import { Step, type StepStatus } from '../components/Step';
import { ArenaStats, IssueList } from '../components/Summary';
import { detectColumns } from '../lib/columnDetect';
import { buildLookup } from '../lib/lookups';
import { autoSelectSheets, detectDataset, type SheetSelection } from '../lib/sheetSelect';
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
import type { View } from '../components/AppShell';
import { ENVIRONMENTS, liveEnvironment } from '../domains/account';
import { useRelease } from '../hooks/useRelease';

const DOWNLOAD_FILENAME = 'arena-progress.json';

interface ArenaExporterProps {
  source: SourceController;
  onNavigate: (view: View) => void;
}

function findSheet(workbook: RawWorkbook | null, name: string | null): RawSheet | null {
  if (workbook === null || name === null) return null;
  return workbook.sheets.find((sheet) => sheet.name === name) ?? null;
}

const EMPTY_SELECTION: SheetSelection = { progression: null, arenas: null, rewards: null };

/** A fold that opens itself when the thing inside needs a human. */
function Fold({
  title,
  summary,
  open,
  needsAttention,
  onToggle,
  children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  needsAttention?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={needsAttention === true ? 'mapping mapping--attention' : 'mapping'}>
      <button type="button" className="mapping__toggle" aria-expanded={open} onClick={onToggle}>
        <Icon name="chevron" size={14} className={open ? 'mapping__chevron mapping__chevron--open' : 'mapping__chevron'} />
        <span>{title}</span>
        {summary !== undefined && <span className="mapping__summary">{summary}</span>}
      </button>
      {open && <div className="mapping__body">{children}</div>}
    </div>
  );
}

/**
 * The trophy road, which is the one config whose sheet needs column mapping as
 * well as tab selection.
 *
 * Same shape as every other exporter now: load, look at the diff, ship it.
 * The two mapping controls are folds rather than steps, and they open
 * themselves only when detection came up short - which is the only time they
 * are worth a person's attention.
 */
export function ArenaExporter({ source, onNavigate }: ArenaExporterProps) {
  const { workbook } = source;
  const [selection, setSelection] = useState<SheetSelection>(EMPTY_SELECTION);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [uncertain, setUncertain] = useState<ColumnRole[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [openStep, setOpenStep] = useState(1);
  const [showTabs, setShowTabs] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [outputTab, setOutputTab] = useState<'changes' | 'preview'>('changes');
  const [environmentId, setEnvironmentId] = useState(
    () => liveEnvironment()?.environmentId ?? ENVIRONMENTS[0].environmentId,
  );

  useEffect(() => {
    setSelection(workbook === null ? EMPTY_SELECTION : autoSelectSheets(workbook));
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

  useEffect(() => {
    redetect(findSheet(workbook, selection.progression));
  }, [workbook, selection.progression, redetect]);

  const analysis: { result: TransformResult | null; issues: Issue[] } = useMemo(() => {
    if (workbook === null || mapping === null) return { result: null, issues: [] };

    const progression = findSheet(workbook, selection.progression);
    const arenaSheet = findSheet(workbook, selection.arenas);
    const rewardSheet = findSheet(workbook, selection.rewards);

    const issues: Issue[] = [];
    if (progression === null) {
      issues.push({
        severity: 'error',
        code: 'missing-progression-tab',
        message: 'Select the progression tab in the tab mapping to continue.',
      });
    }
    if (arenaSheet === null) {
      issues.push({
        severity: 'error',
        code: 'missing-lookup-tab',
        message:
          'No Arenas lookup tab is selected. Pick the tab that maps arena names to ArenaIDs in the tab mapping.',
      });
    }
    if (rewardSheet === null) {
      issues.push({
        severity: 'error',
        code: 'missing-lookup-tab',
        message:
          'No Rewards lookup tab is selected. Pick the tab that maps reward names to RewardIDs in the tab mapping.',
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
  const warningCount = analysis.issues.length - errorCount;

  /** The schema gate, run as part of parsing rather than on a button. */
  const exportable = useMemo(() => {
    const result = analysis.result;
    if (result === null || errorCount > 0 || result.stats.milestones === 0) {
      return { config: null, json: null, schemaError: null as string | null };
    }
    const schemaIssues = validateConfig(result.config);
    if (schemaIssues.length > 0) {
      return { config: null, json: null, schemaError: schemaIssues.map((issue) => issue.message).join(' ') };
    }
    return { config: result.config, json: serializeConfig(result.config), schemaError: null };
  }, [analysis.result, errorCount]);

  const release = useRelease({ domain: 'trophyRoad', payload: exportable.config, environmentId });

  const hasWorkbook = workbook !== null;
  const chosenTabs = [selection.progression, selection.arenas, selection.rewards].filter(
    (name) => name !== null,
  ).length;
  const tabsReady = chosenTabs === 3;
  const mappingReady = mapping !== null && mapping.trophiesIndex !== null && mapping.arenaIndex !== null;
  const setupReady = tabsReady && mappingReady && uncertain.length === 0;

  useEffect(() => {
    setOpenStep(hasWorkbook && tabsReady && mappingReady ? 2 : 1);
  }, [hasWorkbook, tabsReady, mappingReady]);

  // Only unfold what actually needs looking at.
  useEffect(() => {
    if (hasWorkbook && !tabsReady) setShowTabs(true);
  }, [hasWorkbook, tabsReady]);
  useEffect(() => {
    if (hasWorkbook && tabsReady && (!mappingReady || uncertain.length > 0)) setShowColumns(true);
  }, [hasWorkbook, tabsReady, mappingReady, uncertain.length]);

  const toggle = (index: number) => setOpenStep((current) => (current === index ? 0 : index));

  const sheetNames = workbook?.sheets.map((sheet) => sheet.name) ?? [];
  const wrongDataset = workbook !== null && detectDataset(workbook) === 'heroes';

  const sheetBlocker = !hasWorkbook
    ? 'Load a sheet to see what would change.'
    : !tabsReady
      ? 'Pick the remaining tabs in the tab mapping above.'
      : !mappingReady
        ? 'The trophies and arena columns have to be mapped before anything can be published.'
        : errorCount > 0
          ? `${errorCount} error${errorCount === 1 ? '' : 's'} in the sheet stop this from being published. They are listed above.`
          : analysis.result !== null && analysis.result.stats.milestones === 0
            ? 'The chosen tabs parsed without errors but produced no milestones.'
            : exportable.schemaError !== null
              ? `The generated config failed its schema check, so nothing was produced: ${exportable.schemaError}`
              : null;

  const reviewStatus: StepStatus = !mappingReady
    ? 'pending'
    : sheetBlocker !== null || release.introducedErrors > 0
      ? 'blocked'
      : release.unchanged
        ? 'done'
        : release.status === 'ready'
          ? 'current'
          : 'pending';

  const reviewChip = !mappingReady
    ? 'Waiting'
    : sheetBlocker !== null
      ? 'Blocked'
      : release.status === 'loading'
        ? 'Checking'
        : release.unchanged
          ? 'Already live'
          : release.entry?.summary !== undefined
            ? `${release.entry.summary.total} change${release.entry.summary.total === 1 ? '' : 's'}`
            : 'Ready';

  return (
    <>
      <header className="page__head">
        <h1 className="page__title">
          <span className="page__badge page__badge--arena" aria-hidden="true">
            <Icon name="trophy" size={17} />
          </span>
          Trophy road
        </h1>
        <p className="page__lead">
          Trophy milestones with their arenas, arena unlocks and rewards, joined against the ID
          lookups and published to <span className="mono">trophyRoadSettings</span>.
        </p>
      </header>

      {wrongDataset && (
        <div className="banner banner--info" style={{ marginBottom: 12 }}>
          <Icon name="info" size={15} className="banner__icon" />
          <span>
            This workbook looks like a hero stats sheet.{' '}
            <button type="button" className="btn btn--sm" onClick={() => onNavigate('heroes')}>
              Open the hero exporter
            </button>
          </span>
        </div>
      )}

      <div className="steps">
        <Step
          index={1}
          title="Load the sheet"
          hint="Excel file or a shared Google Sheet"
          status={hasWorkbook ? (setupReady ? 'done' : 'blocked') : 'current'}
          statusLabel={
            !hasWorkbook
              ? 'Start here'
              : setupReady
                ? 'Mapped automatically'
                : !tabsReady
                  ? `${chosenTabs} of 3 tabs`
                  : `${uncertain.length} column${uncertain.length === 1 ? '' : 's'} to confirm`
          }
          open={openStep === 1}
          onToggle={() => toggle(1)}
        >
          <div className="stack-sm">
            <SourcePanel source={source} />

            {hasWorkbook && (
              <>
                <Fold
                  title={tabsReady ? 'Tab mapping - all 3 matched automatically' : `Tab mapping - ${3 - chosenTabs} still to pick`}
                  summary={
                    tabsReady
                      ? [selection.progression, selection.arenas, selection.rewards].filter(Boolean).join(', ')
                      : undefined
                  }
                  open={showTabs}
                  needsAttention={!tabsReady}
                  onToggle={() => setShowTabs((open) => !open)}
                >
                  <SheetPicker sheetNames={sheetNames} selection={selection} onChange={setSelection} />
                </Fold>

                <Fold
                  title={
                    mapping === null
                      ? 'Column mapping - no header row found'
                      : uncertain.length > 0
                        ? `Column mapping - ${uncertain.length} to confirm`
                        : `Column mapping - ${mapping.rewardSlots.length} reward slot${mapping.rewardSlots.length === 1 ? '' : 's'} detected`
                  }
                  open={showColumns}
                  needsAttention={mapping === null || uncertain.length > 0 || !mappingReady}
                  onToggle={() => setShowColumns((open) => !open)}
                >
                  {mapping === null ? (
                    <p className="empty">No header row was found in the progression tab.</p>
                  ) : (
                    <ColumnMapper
                      headers={headers}
                      mapping={mapping}
                      uncertain={uncertain}
                      onChange={setMapping}
                      onRedetect={() => redetect(findSheet(workbook, selection.progression))}
                    />
                  )}
                </Fold>
              </>
            )}
          </div>
        </Step>

        <Step
          index={2}
          title="Review and ship"
          hint="What this sheet changes in the live game"
          status={reviewStatus}
          statusLabel={reviewChip}
          open={openStep === 2}
          onToggle={() => toggle(2)}
          locked={!hasWorkbook}
        >
          {analysis.result === null ? (
            <div className="stack-sm">
              <p className="empty">Finish the tab and column mapping above to see what changes.</p>
              {analysis.issues.length > 0 && <IssueList issues={analysis.issues} severity="error" />}
            </div>
          ) : (
            <div className="stack-md">
              <ArenaStats result={analysis.result} />

              {errorCount > 0 && (
                <div>
                  <p className="step__section-title step__section-title--danger">
                    {errorCount} error{errorCount === 1 ? '' : 's'} - nothing is published while a join
                    is failing
                  </p>
                  <IssueList issues={analysis.issues} severity="error" />
                </div>
              )}

              {warningCount > 0 && (
                <details className="disclosure">
                  <summary>
                    {warningCount} warning{warningCount === 1 ? '' : 's'} - published as-is
                  </summary>
                  <IssueList issues={analysis.issues} severity="warning" />
                </details>
              )}

              <div className="tabs" role="tablist" aria-label="Review">
                <button
                  type="button"
                  role="tab"
                  aria-selected={outputTab === 'changes'}
                  className={`tab${outputTab === 'changes' ? ' tab--active' : ''}`}
                  onClick={() => setOutputTab('changes')}
                >
                  What changes live
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={outputTab === 'preview'}
                  className={`tab${outputTab === 'preview' ? ' tab--active' : ''}`}
                  onClick={() => setOutputTab('preview')}
                >
                  Parsed milestones ({analysis.result.preview.length})
                </button>
              </div>

              {outputTab === 'preview' ? (
                <PreviewTable rows={analysis.result.preview} />
              ) : (
                <ChangeReview
                  domain="trophyRoad"
                  payload={exportable.config}
                  json={exportable.json}
                  downloadFilename={DOWNLOAD_FILENAME}
                  release={release}
                  environmentId={environmentId}
                  onEnvironmentChange={setEnvironmentId}
                  sheetBlocker={sheetBlocker}
                />
              )}
            </div>
          )}
        </Step>
      </div>
    </>
  );
}
