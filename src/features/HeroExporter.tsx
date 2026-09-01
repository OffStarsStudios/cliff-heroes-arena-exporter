import { useEffect, useMemo, useState } from 'react';
import { ActionBar } from '../components/ActionBar';
import { HeroPreviewTable } from '../components/HeroPreviewTable';
import { HeroSheetPicker } from '../components/HeroSheetPicker';
import { Icon } from '../components/Icon';
import { JsonOutput } from '../components/JsonOutput';
import { PublishPanel } from '../components/PublishPanel';
import { SourcePanel, type SourceController } from '../components/SourcePanel';
import { Step, type StepStatus } from '../components/Step';
import { HeroStats, IssueList } from '../components/Summary';
import { buildLookup } from '../lib/lookups';
import { autoSelectHeroSheets, detectDataset, type HeroSheetSelection } from '../lib/sheetSelect';
import { transformHeroes } from '../lib/heroes';
import { serializeHeroesConfig, validateHeroesConfig } from '../lib/validateHeroes';
import type { HeroTransformResult, Issue, RawSheet, RawWorkbook } from '../lib/types';
import type { View } from '../components/AppShell';

const DOWNLOAD_FILENAME = 'heroes.json';

interface HeroExporterProps {
  source: SourceController;
  onNavigate: (view: View) => void;
}

function findSheet(workbook: RawWorkbook | null, name: string | null): RawSheet | null {
  if (workbook === null || name === null) return null;
  return workbook.sheets.find((sheet) => sheet.name === name) ?? null;
}

const TAB_LABELS: Record<keyof HeroSheetSelection, string> = {
  heroes: 'Heroes lookup',
  baseStats: 'Base stats',
  levelFactors: 'Stats level factors',
  powerSettings: 'Power settings',
};

const EMPTY_SELECTION: HeroSheetSelection = {
  heroes: null,
  baseStats: null,
  levelFactors: null,
  powerSettings: null,
};

export function HeroExporter({ source, onNavigate }: HeroExporterProps) {
  const { workbook } = source;
  const [selection, setSelection] = useState<HeroSheetSelection>(EMPTY_SELECTION);
  const [generated, setGenerated] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState(1);
  const [outputTab, setOutputTab] = useState<'preview' | 'json'>('preview');

  useEffect(() => {
    setSelection(workbook === null ? EMPTY_SELECTION : autoSelectHeroSheets(workbook));
    setGenerated(null);
    setSchemaError(null);
  }, [workbook]);

  const analysis: { result: HeroTransformResult | null; issues: Issue[] } = useMemo(() => {
    if (workbook === null) return { result: null, issues: [] };

    const sheets = {
      heroes: findSheet(workbook, selection.heroes),
      baseStats: findSheet(workbook, selection.baseStats),
      levelFactors: findSheet(workbook, selection.levelFactors),
      powerSettings: findSheet(workbook, selection.powerSettings),
    };

    const issues: Issue[] = [];
    for (const key of Object.keys(TAB_LABELS) as (keyof HeroSheetSelection)[]) {
      if (sheets[key] === null) {
        issues.push({
          severity: 'error',
          code: 'missing-hero-tab',
          message: `Select the ${TAB_LABELS[key]} tab in step 2 to continue.`,
        });
      }
    }
    if (
      sheets.heroes === null ||
      sheets.baseStats === null ||
      sheets.levelFactors === null ||
      sheets.powerSettings === null
    ) {
      return { result: null, issues };
    }

    const heroes = buildLookup(sheets.heroes, 'hero');
    const result = transformHeroes({
      baseStats: sheets.baseStats,
      levelFactors: sheets.levelFactors,
      powerSettings: sheets.powerSettings,
      heroes: heroes.table,
    });

    const combined = [...issues, ...heroes.issues, ...result.issues];
    const errors = combined.filter((issue) => issue.severity === 'error').length;

    return {
      result: {
        ...result,
        issues: combined,
        stats: { ...result.stats, errors, warnings: combined.length - errors },
      },
      issues: combined,
    };
  }, [workbook, selection]);

  const errorCount = analysis.issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = analysis.issues.length - errorCount;
  const canGenerate = analysis.result !== null && errorCount === 0 && analysis.result.stats.heroes > 0;

  /* ---- step state ------------------------------------------------------- */

  const hasWorkbook = workbook !== null;
  const chosenTabs = (Object.keys(TAB_LABELS) as (keyof HeroSheetSelection)[]).filter(
    (key) => selection[key] !== null,
  ).length;
  const tabsReady = chosenTabs === 4;
  const firstIncomplete = !hasWorkbook ? 1 : !tabsReady ? 2 : 3;

  useEffect(() => {
    setOpenStep(firstIncomplete);
  }, [firstIncomplete]);

  const toggle = (index: number) => setOpenStep((current) => (current === index ? 0 : index));

  const sheetNames = workbook?.sheets.map((sheet) => sheet.name) ?? [];

  const tabsStatus: StepStatus = !hasWorkbook ? 'pending' : tabsReady ? 'done' : 'blocked';
  const reviewStatus: StepStatus = !tabsReady
    ? 'pending'
    : errorCount > 0
      ? 'blocked'
      : generated !== null
        ? 'done'
        : 'current';

  const generate = () => {
    if (analysis.result === null) return;
    // Independent schema check before anything can be copied or downloaded.
    const schemaIssues = validateHeroesConfig(analysis.result.config);
    if (schemaIssues.length > 0) {
      setGenerated(null);
      setSchemaError(schemaIssues.map((issue) => issue.message).join(' '));
      return;
    }
    setSchemaError(null);
    setGenerated(serializeHeroesConfig(analysis.result.config));
    setOutputTab('json');
  };

  const wrongDataset = workbook !== null && detectDataset(workbook) === 'arena';

  const barTone = errorCount > 0 ? 'danger' : generated !== null ? 'ok' : 'neutral';
  const barMessage = !hasWorkbook
    ? 'Load a workbook to start.'
    : errorCount > 0
      ? `${errorCount} error${errorCount === 1 ? '' : 's'} block the export.`
      : generated !== null
        ? `JSON generated from ${analysis.result?.stats.heroes ?? 0} heroes.`
        : canGenerate
          ? `Ready - ${analysis.result?.stats.heroes ?? 0} heroes parsed.`
          : 'Finish the steps above to generate.';

  return (
    <>
      <header className="page__head">
        <h1 className="page__title">
          <span className="page__badge page__badge--heroes" aria-hidden="true">
            <Icon name="spark" size={17} />
          </span>
          Hero stats
        </h1>
        <p className="page__lead">
          Joins four tabs into <span className="mono">heroes.json</span> - base stats, the per-level
          curve, and each hero&apos;s power cooldown and special parameters.
        </p>
      </header>

      {wrongDataset && (
        <div className="banner banner--info" style={{ marginBottom: 12 }}>
          <Icon name="info" size={15} className="banner__icon" />
          <span>
            This workbook looks like an arena progression sheet.{' '}
            <button type="button" className="btn btn--sm" onClick={() => onNavigate('arena')}>
              Open the arena exporter
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
          hint="Heroes, base stats, level factors and power settings"
          status={tabsStatus}
          statusLabel={hasWorkbook ? `${chosenTabs} of 4 tabs` : 'Waiting'}
          open={openStep === 2}
          onToggle={() => toggle(2)}
          locked={!hasWorkbook}
        >
          <HeroSheetPicker
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
          title="Review and export"
          hint="Check the parsed heroes, then generate the JSON"
          status={reviewStatus}
          statusLabel={
            !tabsReady
              ? 'Waiting'
              : errorCount > 0
                ? `${errorCount} error${errorCount === 1 ? '' : 's'}`
                : generated !== null
                  ? 'Generated'
                  : 'Ready'
          }
          open={openStep === 3}
          onToggle={() => toggle(3)}
          locked={!tabsReady}
        >
          {analysis.result === null ? (
            <p className="empty">Finish step 2 to see the parsed heroes.</p>
          ) : (
            <div className="stack-md">
              <HeroStats result={analysis.result} />

              {schemaError !== null && (
                <div className="banner banner--error" role="alert">
                  <Icon name="alert" size={15} className="banner__icon" />
                  <span>{schemaError}</span>
                </div>
              )}

              {errorCount > 0 && (
                <div>
                  <p className="step__section-title">
                    {errorCount} error{errorCount === 1 ? '' : 's'} - nothing is exported while a
                    parameter name or lookup is failing
                  </p>
                  <IssueList issues={analysis.issues} severity="error" />
                  <p className="field__note" style={{ marginTop: 8 }}>
                    Unknown parameter name?{' '}
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => onNavigate('reference')}
                    >
                      See the accepted list
                    </button>
                  </p>
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
                    Parsed heroes ({analysis.result.preview.length})
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
                  <HeroPreviewTable rows={analysis.result.preview} />
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
                  domain="heroes"
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
        <button type="button" className="btn btn--primary" onClick={generate} disabled={!canGenerate}>
          <Icon name="code" size={14} />
          {generated === null ? 'Generate JSON' : 'Regenerate'}
        </button>
      </ActionBar>
    </>
  );
}
