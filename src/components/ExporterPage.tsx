import { useEffect, useMemo, useState } from 'react';
import { ActionBar } from './ActionBar';
import type { View } from './AppShell';
import { Icon } from './Icon';
import { JsonOutput } from './JsonOutput';
import { LiveGraphCheck, type LiveCheckResult } from './LiveGraphCheck';
import { PublishPanel } from './PublishPanel';
import { SourcePanel, type SourceController } from './SourcePanel';
import { Step, type StepStatus } from './Step';
import { IssueList } from './Summary';
import { TabPicker } from './TabPicker';
import { ENVIRONMENTS, liveEnvironment } from '../domains/account';
import { runAnalysis } from '../exporters/analysis';
import type { ExporterDefinition, TabSelection, TabSpec } from '../exporters/types';
import { detectDataset, type Dataset } from '../lib/sheetSelect';

interface ExporterPageProps<S extends TabSelection, TConfig, TRow> {
  definition: ExporterDefinition<S, TConfig, TRow>;
  source: SourceController;
  onNavigate: (view: View) => void;
}

/** Where a workbook of another kind should be taken instead. */
const VIEW_FOR_DATASET: Record<Dataset, { view: View; label: string }> = {
  arena: { view: 'arena', label: 'trophy road' },
  heroes: { view: 'heroes', label: 'hero stats' },
  arenas: { view: 'arenas', label: 'arenas' },
  matchTrophy: { view: 'matchTrophy', label: 'match trophies' },
  bots: { view: 'bots', label: 'bots' },
  heroUpgrade: { view: 'heroUpgrade', label: 'hero upgrades' },
  shop: { view: 'shop', label: 'shop' },
};

function emptySelection<S extends TabSelection>(tabs: TabSpec<S>[]): S {
  const selection: Record<string, string | null> = {};
  for (const tab of tabs) selection[tab.key] = null;
  return selection as S;
}

/**
 * The three-step exporter page every config shares: load the workbook, pick
 * the tabs, review and publish. Everything config-specific comes from the
 * definition.
 */
export function ExporterPage<S extends TabSelection, TConfig, TRow>({
  definition,
  source,
  onNavigate,
}: ExporterPageProps<S, TConfig, TRow>) {
  const { workbook } = source;
  const [selection, setSelection] = useState<S>(() => emptySelection(definition.tabs));
  const [generated, setGenerated] = useState<string | null>(null);
  const [generatedConfig, setGeneratedConfig] = useState<TConfig | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState(1);
  const [outputTab, setOutputTab] = useState<'preview' | 'json'>('preview');
  const [environmentId, setEnvironmentId] = useState(
    () => liveEnvironment()?.environmentId ?? ENVIRONMENTS[0].environmentId,
  );
  const [liveCheck, setLiveCheck] = useState<LiveCheckResult | null>(null);

  const invalidate = () => {
    setGenerated(null);
    setGeneratedConfig(null);
  };

  // A new workbook resets the tab choices and anything generated from the old one.
  useEffect(() => {
    setSelection(workbook === null ? emptySelection(definition.tabs) : definition.autoSelect(workbook));
    setGenerated(null);
    setGeneratedConfig(null);
    setSchemaError(null);
  }, [workbook, definition]);

  // Live analysis: everything except the JSON itself updates as selections change.
  const analysis = useMemo(() => runAnalysis(definition, workbook, selection), [definition, workbook, selection]);
  const { result, issues, errors: errorCount, warnings: warningCount } = analysis;
  const canGenerate = result !== null && errorCount === 0 && result.count > 0;

  /* ---- step state ------------------------------------------------------- */

  const hasWorkbook = workbook !== null;
  const chosenTabs = definition.tabs.filter((tab) => selection[tab.key] !== null).length;
  const tabsReady = chosenTabs === definition.tabs.length;
  const firstIncomplete = !hasWorkbook ? 1 : !tabsReady ? 2 : 3;

  // Advance the open step only when the furthest unfinished step actually
  // moves, so a step the user opened by hand is not yanked shut under them.
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
    if (result === null) return;
    // Independent schema check before anything can be copied or downloaded.
    const schemaIssues = definition.validate(result.config);
    if (schemaIssues.length > 0) {
      invalidate();
      setSchemaError(schemaIssues.map((issue) => issue.message).join(' '));
      return;
    }
    setSchemaError(null);
    setGenerated(definition.serialize(result.config));
    setGeneratedConfig(result.config);
    setOutputTab('json');
  };

  const dataset = workbook === null ? null : detectDataset(workbook);
  const wrongDataset = dataset !== null && dataset !== definition.dataset ? VIEW_FOR_DATASET[dataset] : null;

  const { singular, plural } = definition.noun;
  const countLabel = (count: number) => `${count} ${count === 1 ? singular : plural}`;
  const introducedErrors = liveCheck?.introducedErrors ?? 0;

  const barTone = errorCount > 0 ? 'danger' : generated !== null ? 'ok' : 'neutral';
  const barMessage = !hasWorkbook
    ? 'Load a workbook to start.'
    : errorCount > 0
      ? `${errorCount} error${errorCount === 1 ? '' : 's'} block the export.`
      : generated !== null
        ? `JSON generated from ${countLabel(result?.count ?? 0)}.`
        : canGenerate
          ? `Ready - ${countLabel(result?.count ?? 0)} parsed.`
          : 'Finish the steps above to generate.';

  return (
    <>
      <header className="page__head">
        <h1 className="page__title">
          <span className={`page__badge page__badge--${definition.badge}`} aria-hidden="true">
            <Icon name={definition.icon} size={17} />
          </span>
          {definition.title}
        </h1>
        <p className="page__lead">{definition.lead}</p>
      </header>

      {wrongDataset !== null && (
        <div className="banner banner--info" style={{ marginBottom: 12 }}>
          <Icon name="info" size={15} className="banner__icon" />
          <span>
            This workbook looks like a {wrongDataset.label} sheet.{' '}
            <button type="button" className="btn btn--sm" onClick={() => onNavigate(wrongDataset.view)}>
              Open the {wrongDataset.label} exporter
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
          hint={definition.tabs.map((tab) => tab.label).join(', ')}
          status={tabsStatus}
          statusLabel={hasWorkbook ? `${chosenTabs} of ${definition.tabs.length} tabs` : 'Waiting'}
          open={openStep === 2}
          onToggle={() => toggle(2)}
          locked={!hasWorkbook}
        >
          <TabPicker
            hint={definition.tabsHint}
            tabs={definition.tabs}
            sheetNames={sheetNames}
            selection={selection}
            onChange={(next) => {
              setSelection(next);
              invalidate();
            }}
          />
        </Step>

        <Step
          index={3}
          title="Review and export"
          hint={`Check the parsed ${plural}, then generate and publish`}
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
          {result === null ? (
            <div className="stack-sm">
              <p className="empty">Finish step 2 to see the parsed {plural}.</p>
              {issues.length > 0 && <IssueList issues={issues} severity="error" />}
            </div>
          ) : (
            <div className="stack-md">
              <div className="stats">
                {result.stats.map((stat) => (
                  <div key={stat.label} className="stat">
                    <div className="stat__value">{stat.value.toLocaleString()}</div>
                    <div className="stat__label">{stat.label}</div>
                  </div>
                ))}
                <div className={errorCount > 0 ? 'stat stat--danger' : 'stat stat--ok'}>
                  <div className="stat__value">{errorCount}</div>
                  <div className="stat__label">Errors</div>
                </div>
                <div className={warningCount > 0 ? 'stat stat--warn' : 'stat'}>
                  <div className="stat__value">{warningCount}</div>
                  <div className="stat__label">Warnings</div>
                </div>
              </div>

              {schemaError !== null && (
                <div className="banner banner--error" role="alert">
                  <Icon name="alert" size={15} className="banner__icon" />
                  <span>{schemaError}</span>
                </div>
              )}

              {errorCount > 0 && (
                <div>
                  <p className="step__section-title">
                    {errorCount} error{errorCount === 1 ? '' : 's'} - nothing is exported while{' '}
                    {definition.errorContext}
                  </p>
                  <IssueList issues={issues} severity="error" />
                  {definition.errorFooter !== undefined && (
                    <p className="field__note" style={{ marginTop: 8 }}>
                      {definition.errorFooter(onNavigate)}
                    </p>
                  )}
                </div>
              )}

              {warningCount > 0 && (
                <div>
                  <p className="step__section-title">
                    {warningCount} warning{warningCount === 1 ? '' : 's'} - exported as-is
                  </p>
                  <IssueList issues={issues} severity="warning" />
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
                    Parsed {plural} ({result.preview.length})
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
                  <definition.PreviewTable rows={result.preview} />
                ) : generated === null ? (
                  <p className="empty">
                    Press <strong>Generate JSON</strong> below. The output is schema-checked first, so a
                    partial file is never produced.
                  </p>
                ) : (
                  <JsonOutput json={generated} filename={definition.downloadFilename} />
                )}
              </div>

              <LiveGraphCheck
                domain={definition.domain}
                payload={generatedConfig}
                environmentId={environmentId}
                extraRegistry={result.registry}
                onResult={setLiveCheck}
              />

              <PublishPanel
                domain={definition.domain}
                payload={generatedConfig ?? result.config}
                blocked={!canGenerate || generated === null || introducedErrors > 0}
                blockedReason={
                  errorCount > 0
                    ? `${errorCount} error${errorCount === 1 ? '' : 's'} block publishing, the same way they block the download.`
                    : introducedErrors > 0
                      ? `The check against the live config found ${introducedErrors} error${introducedErrors === 1 ? '' : 's'} this change would introduce. Fix the sheet and regenerate.`
                      : generated === null
                        ? 'Generate the JSON first - publishing sends exactly what was generated and checked.'
                        : 'There is nothing to publish yet.'
                }
                environmentId={environmentId}
                onEnvironmentChange={setEnvironmentId}
              />
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
