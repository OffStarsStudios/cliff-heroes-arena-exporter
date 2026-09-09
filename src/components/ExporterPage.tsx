import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { View } from './AppShell';
import { ChangeReview } from './ChangeReview';
import { Icon } from './Icon';
import { LiveInGame } from './LiveInGame';
import { SourcePanel, type SourceController } from './SourcePanel';
import { Step, type StepStatus } from './Step';
import { IssueList } from './Summary';
import { TabPicker } from './TabPicker';
import { ENVIRONMENTS, liveEnvironment } from '../domains/account';
import type { ExporterDomain } from '../domains/types';
import { runAnalysis } from '../exporters/analysis';
import type { ExporterControls, ExporterDefinition, TabSelection, TabSpec } from '../exporters/types';
import { useRelease } from '../hooks/useRelease';
import { recallSettings, rememberSettings } from '../lib/exporterSettings';
import { fetchLiveConfig } from '../lib/liveConfig';
import { detectDataset, type Dataset } from '../lib/sheetSelect';

interface ExporterPageProps<S extends TabSelection, TConfig, TRow, TSettings> {
  definition: ExporterDefinition<S, TConfig, TRow, TSettings>;
  source: SourceController;
  onNavigate: (view: View) => void;
}

/**
 * The value of a page's own fields, and where it came from.
 *
 * Three sources, in order of authority: what this browser last had, then the
 * live payload, then the definition's own starting point. Seeding from live
 * matters more than it looks - it means opening the page shows the season the
 * game is actually running, so publishing without touching the panel republishes
 * that window rather than silently replacing it with a default.
 */
function useExporterSettings<TSettings>(
  domain: ExporterDomain,
  controls: ExporterControls<TSettings> | undefined,
  environmentId: string,
): [TSettings, (next: TSettings) => void] {
  const stored = controls === undefined ? null : controls.revive(recallSettings(domain));
  const [value, setValue] = useState<TSettings>(
    () => stored ?? (controls === undefined ? (undefined as TSettings) : controls.initial),
  );
  // Seeding is a one-shot: once somebody has typed in the panel, a slow live
  // response must not reach back and overwrite what they typed.
  const seeded = useRef(false);

  useEffect(() => {
    if (controls === undefined || seeded.current) return;
    // Something stored that still fits wins. Something stored that no longer
    // does counts as nothing, and falls through to the live season below.
    if (stored !== null) {
      seeded.current = true;
      return;
    }
    let cancelled = false;
    fetchLiveConfig(domain, environmentId)
      .then((view) => {
        if (cancelled || seeded.current) return;
        const fromLive = controls.fromLive(view.live.json);
        seeded.current = true;
        if (fromLive !== null) setValue(fromLive);
      })
      // A page whose fields have to be filled in by hand is a far better
      // outcome than one that will not load because ConfigCat is unreachable.
      .catch(() => {
        seeded.current = true;
      });
    return () => {
      cancelled = true;
    };
    // `stored` is read once, on the first run; `seeded` closes the effect after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, domain, environmentId]);

  const update = useCallback(
    (next: TSettings) => {
      seeded.current = true;
      setValue(next);
      rememberSettings(domain, next);
    },
    [domain],
  );

  return [value, update];
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
  battlePass: { view: 'battlePass', label: 'battle pass' },
};

function emptySelection<S extends TabSelection>(tabs: TabSpec<S>[]): S {
  const selection: Record<string, string | null> = {};
  for (const tab of tabs) selection[tab.key] = null;
  return selection as S;
}

/**
 * One config, start to finish: load the sheet, look at what changes, publish
 * or schedule it.
 *
 * There used to be a third step in the middle called "generate JSON", and it
 * was the console admitting it thought of itself as a file converter. Nobody
 * opening this page wants a file. They want to know what their spreadsheet
 * edit does to the running game, and then to make it happen. So the JSON is
 * produced silently, the diff against the live config computes itself the
 * moment the sheet parses, and the two things left to press are Publish and
 * Schedule.
 *
 * The tab mapping survives as a fold rather than a step, because it is right
 * automatically almost every time and is only interesting when it is not.
 */
export function ExporterPage<S extends TabSelection, TConfig, TRow, TSettings>({
  definition,
  source,
  onNavigate,
}: ExporterPageProps<S, TConfig, TRow, TSettings>) {
  const { workbook } = source;
  const [selection, setSelection] = useState<S>(() => emptySelection(definition.tabs));
  const [openStep, setOpenStep] = useState(1);
  const [showMapping, setShowMapping] = useState(false);
  const [outputTab, setOutputTab] = useState<'changes' | 'preview'>('changes');
  // Two things a person opens a config page to do: change it, or look at what
  // it currently is. They were the same page before, and the second one was
  // only reachable by loading a sheet you did not want to publish.
  const [pageTab, setPageTab] = useState<'update' | 'live'>('update');
  const tabsId = useId();
  const [environmentId, setEnvironmentId] = useState(
    () => liveEnvironment()?.environmentId ?? ENVIRONMENTS[0].environmentId,
  );
  const { controls } = definition;
  const [settings, setSettings] = useExporterSettings<TSettings>(
    definition.domain,
    controls,
    environmentId,
  );
  const settingsIssues = useMemo(
    () => (controls === undefined ? [] : controls.validate(settings)),
    [controls, settings],
  );
  // With a settings panel the review is the third step, not the second.
  const reviewIndex = controls === undefined ? 2 : 3;

  // A new workbook re-runs auto-selection from scratch.
  useEffect(() => {
    setSelection(workbook === null ? emptySelection(definition.tabs) : definition.autoSelect(workbook));
  }, [workbook, definition]);

  const analysis = useMemo(
    () => runAnalysis(definition, workbook, selection, settings),
    [definition, workbook, selection, settings],
  );
  const { result, issues, errors: errorCount, warnings: warningCount } = analysis;

  /**
   * The schema gate, which used to be attached to the Generate button.
   *
   * It still runs before anything can be published - it just runs on its own,
   * as part of parsing, rather than waiting to be asked.
   */
  const exportable = useMemo(() => {
    if (result === null || errorCount > 0 || result.count === 0) {
      return { config: null, json: null, schemaError: null as string | null };
    }
    const schemaIssues = definition.validate(result.config);
    if (schemaIssues.length > 0) {
      return { config: null, json: null, schemaError: schemaIssues.map((issue) => issue.message).join(' ') };
    }
    return { config: result.config, json: definition.serialize(result.config), schemaError: null };
  }, [definition, result, errorCount]);

  const release = useRelease({
    domain: definition.domain,
    payload: exportable.config,
    environmentId,
    extraRegistry: result?.registry,
  });

  const hasWorkbook = workbook !== null;
  const chosenTabs = definition.tabs.filter((tab) => selection[tab.key] !== null).length;
  const tabsReady = chosenTabs === definition.tabs.length;

  // The review step opens itself as soon as there is anything to review, which
  // is the whole point: load a sheet, see the changes.
  useEffect(() => {
    setOpenStep(hasWorkbook && tabsReady ? reviewIndex : 1);
  }, [hasWorkbook, tabsReady, reviewIndex]);

  // An auto-selection that came up short is the one case where the mapping is
  // worth showing without being asked for.
  useEffect(() => {
    if (hasWorkbook && !tabsReady) setShowMapping(true);
  }, [hasWorkbook, tabsReady]);

  const toggle = (index: number) => setOpenStep((current) => (current === index ? 0 : index));

  const sheetNames = workbook?.sheets.map((sheet) => sheet.name) ?? [];
  const dataset = workbook === null ? null : detectDataset(workbook);
  const wrongDataset = dataset !== null && dataset !== definition.dataset ? VIEW_FOR_DATASET[dataset] : null;

  const { singular, plural } = definition.noun;
  const countLabel = (count: number) => `${count} ${count === 1 ? singular : plural}`;

  const sheetBlocker =
    !hasWorkbook
      ? 'Load a sheet to see what would change.'
      : !tabsReady
        ? `Two tabs could not be matched automatically. Open the tab mapping below and pick them.`
        : errorCount > 0
          ? `${errorCount} error${errorCount === 1 ? '' : 's'} in the sheet stop this from being published. They are listed above.`
          : result !== null && result.count === 0
            ? `The chosen tabs parsed without errors but produced no ${plural}.`
            : exportable.schemaError !== null
              ? `The generated config failed its schema check, so nothing was produced: ${exportable.schemaError}`
              : null;

  const reviewStatus: StepStatus = !tabsReady
    ? 'pending'
    : sheetBlocker !== null || release.introducedErrors > 0
      ? 'blocked'
      : release.unchanged
        ? 'done'
        : release.status === 'ready'
          ? 'current'
          : 'pending';

  const reviewChip = !tabsReady
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
          <span className={`page__badge page__badge--${definition.badge}`} aria-hidden="true">
            <Icon name={definition.icon} size={17} />
          </span>
          {definition.title}
        </h1>
        <p className="page__lead">{definition.lead}</p>
      </header>

      <div className="pagetabs" role="tablist" aria-label="Config view">
        <button
          type="button"
          role="tab"
          id={`${tabsId}-update`}
          aria-selected={pageTab === 'update'}
          aria-controls={`${tabsId}-panel`}
          className={`pagetab${pageTab === 'update' ? ' pagetab--active' : ''}`}
          onClick={() => setPageTab('update')}
        >
          <Icon name="upload" size={14} />
          Update from a sheet
        </button>
        <button
          type="button"
          role="tab"
          id={`${tabsId}-live`}
          aria-selected={pageTab === 'live'}
          aria-controls={`${tabsId}-panel`}
          className={`pagetab${pageTab === 'live' ? ' pagetab--active' : ''}`}
          onClick={() => setPageTab('live')}
        >
          <Icon name="activity" size={14} />
          Live in game
        </button>
      </div>

      {/* Keyed so switching tabs replays the panel's entrance. */}
      <div
        className="tabpanel"
        key={pageTab}
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${pageTab}`}
      >

      {pageTab === 'live' && (
        <LiveInGame
          domain={definition.domain}
          environmentId={environmentId}
          onEnvironmentChange={setEnvironmentId}
          downloadFilename={definition.downloadFilename}
        />
      )}

      {pageTab === 'update' && wrongDataset !== null && (
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

      {pageTab === 'update' && (
      <div className="steps">
        <Step
          index={1}
          title="Load the sheet"
          hint="Excel file or a shared Google Sheet"
          status={hasWorkbook ? (tabsReady ? 'done' : 'blocked') : 'current'}
          statusLabel={
            !hasWorkbook
              ? 'Start here'
              : tabsReady
                ? `${chosenTabs} tab${chosenTabs === 1 ? '' : 's'} matched`
                : `${chosenTabs} of ${definition.tabs.length} tabs`
          }
          open={openStep === 1}
          onToggle={() => toggle(1)}
        >
          <div className="stack-sm">
            <SourcePanel source={source} />

            {hasWorkbook && (
              <div className="mapping">
                <button
                  type="button"
                  className="mapping__toggle"
                  aria-expanded={showMapping}
                  onClick={() => setShowMapping((open) => !open)}
                >
                  <Icon name="chevron" size={14} className={showMapping ? 'mapping__chevron mapping__chevron--open' : 'mapping__chevron'} />
                  <span>
                    {tabsReady
                      ? `Tab mapping - all ${definition.tabs.length} matched automatically`
                      : `Tab mapping - ${definition.tabs.length - chosenTabs} still to pick`}
                  </span>
                  {tabsReady && (
                    <span className="mapping__summary">
                      {definition.tabs
                        .map((tab) => selection[tab.key])
                        .filter((name) => name !== null)
                        .join(', ')}
                    </span>
                  )}
                </button>
                {showMapping && (
                  <div className="mapping__body">
                    <TabPicker
                      hint={definition.tabsHint}
                      tabs={definition.tabs}
                      sheetNames={sheetNames}
                      selection={selection}
                      onChange={setSelection}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </Step>

        {controls !== undefined && (
          <Step
            index={2}
            title={controls.title}
            hint={controls.hint}
            status={settingsIssues.length > 0 ? 'blocked' : 'done'}
            statusLabel={settingsIssues.length > 0 ? 'Not set' : controls.summary(settings)}
            open={openStep === 2}
            onToggle={() => toggle(2)}
          >
            <div className="stack-sm">
              <p className="field__note">{controls.note}</p>
              <controls.Panel value={settings} onChange={setSettings} />
              {settingsIssues.length > 0 && <IssueList issues={settingsIssues} severity="error" />}
            </div>
          </Step>
        )}

        <Step
          index={reviewIndex}
          title="Review and ship"
          hint="What this sheet changes in the live game"
          status={reviewStatus}
          statusLabel={reviewChip}
          open={openStep === reviewIndex}
          onToggle={() => toggle(reviewIndex)}
          locked={!hasWorkbook}
        >
          {result === null ? (
            <div className="stack-sm">
              <p className="empty">Pick the remaining tabs above to see what changes.</p>
              {issues.length > 0 && <IssueList issues={issues} severity="error" />}
            </div>
          ) : (
            <div className="stack-md">
              <div className="stats stats--tight">
                {result.stats.map((stat) => (
                  <div key={stat.label} className="stat">
                    <div className="stat__value">{stat.value.toLocaleString()}</div>
                    <div className="stat__label">{stat.label}</div>
                  </div>
                ))}
                {errorCount > 0 && <div className="stat stat--danger"><div className="stat__value">{errorCount}</div><div className="stat__label">Sheet errors</div></div>}
                {warningCount > 0 && <div className="stat stat--warn"><div className="stat__value">{warningCount}</div><div className="stat__label">Warnings</div></div>}
              </div>

              {errorCount > 0 && (
                <div>
                  <p className="step__section-title step__section-title--danger">
                    {errorCount} error{errorCount === 1 ? '' : 's'} - nothing is published while{' '}
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
                <details className="disclosure">
                  <summary>
                    {warningCount} warning{warningCount === 1 ? '' : 's'} - published as-is
                  </summary>
                  <IssueList issues={issues} severity="warning" />
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
                  Parsed {plural} ({countLabel(result.count)})
                </button>
              </div>

              <div className="tabpanel tabpanel--inner" key={outputTab}>
                {outputTab === 'preview' ? (
                  <definition.PreviewTable rows={result.preview} />
                ) : (
                  <ChangeReview
                    domain={definition.domain}
                    payload={exportable.config}
                    json={exportable.json}
                    downloadFilename={definition.downloadFilename}
                    release={release}
                    environmentId={environmentId}
                    onEnvironmentChange={setEnvironmentId}
                    sheetBlocker={sheetBlocker}
                  />
                )}
              </div>
            </div>
          )}
        </Step>
      </div>
      )}
      </div>
    </>
  );
}
