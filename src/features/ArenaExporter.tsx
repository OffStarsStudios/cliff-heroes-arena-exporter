import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionBar } from '../components/ActionBar';
import { ColumnMapper } from '../components/ColumnMapper';
import { Icon } from '../components/Icon';
import { JsonOutput } from '../components/JsonOutput';
import { PreviewTable } from '../components/PreviewTable';
import { PublishPanel } from '../components/PublishPanel';
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

export function ArenaExporter({ source, onNavigate }: ArenaExporterProps) {
  const { workbook } = source;
  const [selection, setSelection] = useState<SheetSelection>(EMPTY_SELECTION);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [uncertain, setUncertain] = useState<ColumnRole[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [generated, setGenerated] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState(1);
  const [outputTab, setOutputTab] = useState<'preview' | 'json'>('preview');

  // A new workbook resets the tab choices.
  useEffect(() => {
    setSelection(workbook === null ? EMPTY_SELECTION : autoSelectSheets(workbook));
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
    if (workbook === null || mapping === null) return { result: null, issues: [] };

    const progression = findSheet(workbook, selection.progression);
    const arenaSheet = findSheet(workbook, selection.arenas);
    const rewardSheet = findSheet(workbook, selection.rewards);

    const issues: Issue[] = [];
    if (progression === null) {
      issues.push({
        severity: 'error',
        code: 'missing-progression-tab',
        message: 'Select the progression tab in step 2 to continue.',
      });
    }
    if (arenaSheet === null) {
      issues.push({
        severity: 'error',
        code: 'missing-lookup-tab',
        message:
          'No Arenas lookup tab is selected. Pick the tab that maps arena names to ArenaIDs in step 2.',
      });
    }
    if (rewardSheet === null) {
      issues.push({
        severity: 'error',
        code: 'missing-lookup-tab',
        message:
          'No Rewards lookup tab is selected. Pick the tab that maps reward names to RewardIDs in step 2.',
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
  const canGenerate =
    analysis.result !== null && errorCount === 0 && analysis.result.stats.milestones > 0;

  /* ---- step state ------------------------------------------------------- */

  const hasWorkbook = workbook !== null;
  const chosenTabs = [selection.progression, selection.arenas, selection.rewards].filter(
    (name) => name !== null,
  ).length;
  const tabsReady = chosenTabs === 3;
  const mappingReady =
    mapping !== null && mapping.trophiesIndex !== null && mapping.arenaIndex !== null;

  const firstIncomplete = !hasWorkbook ? 1 : !tabsReady ? 2 : !mappingReady ? 3 : 4;

  // Advance the open step only when the furthest unfinished step actually
  // moves, so a step the user opened by hand is not yanked shut under them.
  useEffect(() => {
    setOpenStep(firstIncomplete);
  }, [firstIncomplete]);

  const toggle = (index: number) => setOpenStep((current) => (current === index ? 0 : index));

  const sheetNames = workbook?.sheets.map((sheet) => sheet.name) ?? [];

  const tabsStatus: StepStatus = !hasWorkbook ? 'pending' : tabsReady ? 'done' : 'blocked';
  const mapStatus: StepStatus = !tabsReady
    ? 'pending'
    : !mappingReady
      ? 'blocked'
      : uncertain.length > 0
        ? 'blocked'
        : 'done';
  const reviewStatus: StepStatus = !mappingReady
    ? 'pending'
    : errorCount > 0
      ? 'blocked'
      : generated !== null
        ? 'done'
        : 'current';

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
    setOutputTab('json');
  };

  const wrongDataset = workbook !== null && detectDataset(workbook) === 'heroes';

  const barTone = errorCount > 0 ? 'danger' : generated !== null ? 'ok' : 'neutral';
  const barMessage =
    !hasWorkbook
      ? 'Load a workbook to start.'
      : errorCount > 0
        ? `${errorCount} error${errorCount === 1 ? '' : 's'} block the export.`
        : generated !== null
          ? `JSON generated from ${analysis.result?.stats.milestones ?? 0} milestones.`
          : canGenerate
            ? `Ready - ${analysis.result?.stats.milestones ?? 0} milestones parsed.`
            : 'Finish the steps above to generate.';

  return (
    <>
      <header className="page__head">
        <h1 className="page__title">
          <span className="page__badge page__badge--arena" aria-hidden="true">
            <Icon name="trophy" size={17} />
          </span>
          Arena progress
        </h1>
        <p className="page__lead">
          Turns the progression sheet into <span className="mono">arena-progress.json</span> - trophy
          milestones with their arenas, arena unlocks and rewards, joined against the ID lookups.
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
          title="Load the workbook"
          hint="Excel file or a shared Google Sheet"
          status={hasWorkbook ? 'done' : 'current'}
          statusLabel={hasWorkbook ? 'Loaded' : 'Start here'}
          open={openStep === 1}
          onToggle={() => toggle(1)}
        >
          <SourcePanel source={source} />
        </Step>

        <Step
          index={2}
          title="Pick the tabs"
          hint="Progression plus the two ID lookups"
          status={tabsStatus}
          statusLabel={hasWorkbook ? `${chosenTabs} of 3 tabs` : 'Waiting'}
          open={openStep === 2}
          onToggle={() => toggle(2)}
          locked={!hasWorkbook}
        >
          <SheetPicker
            sheetNames={sheetNames}
            selection={selection}
            onChange={(next) => {
              setSelection(next);
              setGenerated(null);
            }}
          />
        </Step>

        <Step
          index={3}
          title="Map the columns"
          hint="Trophies, arena and the reward slots"
          status={mapStatus}
          statusLabel={
            !tabsReady
              ? 'Waiting'
              : uncertain.length > 0
                ? `${uncertain.length} to confirm`
                : mapping === null
                  ? 'No columns'
                  : `${mapping.rewardSlots.length} reward slot${mapping.rewardSlots.length === 1 ? '' : 's'}`
          }
          open={openStep === 3}
          onToggle={() => toggle(3)}
          locked={!tabsReady}
        >
          {mapping === null ? (
            <p className="empty">No header row was found in the progression tab.</p>
          ) : (
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
        </Step>

        <Step
          index={4}
          title="Review and export"
          hint="Check the parsed rows, then generate the JSON"
          status={reviewStatus}
          statusLabel={
            !mappingReady
              ? 'Waiting'
              : errorCount > 0
                ? `${errorCount} error${errorCount === 1 ? '' : 's'}`
                : generated !== null
                  ? 'Generated'
                  : 'Ready'
          }
          open={openStep === 4}
          onToggle={() => toggle(4)}
          locked={!mappingReady}
        >
          {analysis.result === null ? (
            <p className="empty">Finish steps 2 and 3 to see the parsed data.</p>
          ) : (
            <div className="stack-md">
              <ArenaStats result={analysis.result} />

              {schemaError !== null && (
                <div className="banner banner--error" role="alert">
                  <Icon name="alert" size={15} className="banner__icon" />
                  <span>{schemaError}</span>
                </div>
              )}

              {errorCount > 0 && (
                <div>
                  <p className="step__section-title">
                    {errorCount} error{errorCount === 1 ? '' : 's'} - nothing is exported while a join
                    is failing
                  </p>
                  <IssueList issues={analysis.issues} severity="error" />
                </div>
              )}

              {warningCount > 0 && (
                <div>
                  <p className="step__section-title">
                    {warningCount} warning{warningCount === 1 ? '' : 's'} - exported as-is
                  </p>
                  <IssueList issues={analysis.issues} severity="warning" />
                </div>
              )}

              <div>
                <div className="tabs" role="tablist" aria-label="Output">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={outputTab === 'preview'}
                    className={`tab${outputTab === 'preview' ? ' tab--active' : ''}`}
                    onClick={() => setOutputTab('preview')}
                  >
                    Parsed milestones ({analysis.result.preview.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={outputTab === 'json'}
                    className={`tab${outputTab === 'json' ? ' tab--active' : ''}`}
                    onClick={() => setOutputTab('json')}
                  >
                    JSON {generated === null ? '(not generated)' : ''}
                  </button>
                </div>

                {outputTab === 'preview' ? (
                  <PreviewTable rows={analysis.result.preview} />
                ) : generated === null ? (
                  <p className="empty">
                    Press <strong>Generate JSON</strong> below. The output is schema-checked first, so
                    a partial file is never produced.
                  </p>
                ) : (
                  <JsonOutput json={generated} filename={DOWNLOAD_FILENAME} />
                )}
              </div>

              {analysis.result !== null && (
                <PublishPanel
                  domain="trophyRoad"
                  payload={analysis.result.config}
                  blocked={!canGenerate}
                  blockedReason={
                    errorCount > 0
                      ? `${errorCount} error${errorCount === 1 ? '' : 's'} block publishing, the same way they block the download.`
                      : 'There is nothing to publish yet.'
                  }
                />
              )}
            </div>
          )}
        </Step>
      </div>

      <ActionBar tone={barTone} message={barMessage}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={generate}
          disabled={!canGenerate}
        >
          <Icon name="code" size={14} />
          {generated === null ? 'Generate JSON' : 'Regenerate'}
        </button>
      </ActionBar>
    </>
  );
}
