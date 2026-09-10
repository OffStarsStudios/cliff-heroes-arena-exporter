import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { IssueList } from './Summary';
import { TabPicker } from './TabPicker';
import { DOMAIN_LABELS } from '../domains/types';
import { runAnalysis } from '../exporters/analysis';
import { LIVEOPS_EXPORTERS } from '../exporters/liveops';
import type { TabSelection } from '../exporters/types';
import { useExporterSettings } from '../hooks/useExporterSettings';
import { useRelease } from '../hooks/useRelease';
import { GoogleSheetsError, loadGoogleSheet } from '../lib/googleSheets';
import type { LiveOpsDomain } from '../lib/liveops';
import { recallSheetUrl, rememberSheetUrl } from '../lib/recentSources';
import { detectDataset } from '../lib/sheetSelect';
import type { RawWorkbook } from '../lib/types';

/** What the booking form needs back: the config, where it came from, and why not. */
export interface EventConfig {
  /** The parsed config, or null while there is nothing publishable. */
  payload: unknown | null;
  /** The link it was exported from, kept on the event as provenance. */
  sourceUrl: string | null;
  /** One sentence saying what is missing, or null when the config is ready. */
  blocker: string | null;
}

interface EventConfigSourceProps {
  domain: LiveOpsDomain;
  /** Where the event will be published, so the cross-config check reads the right one. */
  environmentId: string;
  /** The event's window. Null while either date box is empty or unreadable. */
  opensAt: string | null;
  endsAt: string | null;
  /** Called whenever the answer changes. Must be stable - a state setter will do. */
  onResult: (result: EventConfig) => void;
}

const EMPTY_SELECTION: TabSelection = {};

/**
 * The config an event carries, taken from the sheet it is authored in.
 *
 * An event is a promise to publish something at a particular minute, and until
 * now the something was whatever the console happened to have recorded - last
 * published, or whatever is already live. That is fine for re-running a season
 * and useless for booking the next one, which exists only as a spreadsheet.
 *
 * So the form takes the link, and then does what the feature's own page does
 * with it: the same parser, the same tab mapping, the same issue list, the same
 * schema gate, the same cross-config check. Not a lighter version of them - a
 * season booked three weeks out is more worth checking than one published by
 * hand, because nobody is watching at the minute it goes live.
 *
 * What it does not do is re-read the sheet later. The payload is snapshotted
 * into the schedule when the event is booked, so a designer editing the sheet
 * next week cannot change what a booked event publishes. The link is kept as
 * provenance, and to reload from deliberately.
 */
export function EventConfigSource({
  domain,
  environmentId,
  opensAt,
  endsAt,
  onResult,
}: EventConfigSourceProps) {
  const definition = LIVEOPS_EXPORTERS[domain];
  const label = DOMAIN_LABELS[domain];

  const [url, setUrl] = useState(() => recallSheetUrl(domain) ?? '');
  const [workbook, setWorkbook] = useState<RawWorkbook | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<TabSelection>(EMPTY_SELECTION);
  const [showMapping, setShowMapping] = useState(false);

  // A new workbook re-runs the definition's own guess at the tab mapping.
  useEffect(() => {
    setSelection(workbook === null ? EMPTY_SELECTION : definition.autoSelect(workbook));
  }, [workbook, definition]);

  const load = useCallback(async () => {
    const trimmed = url.trim();
    if (trimmed === '') return;
    setBusy(true);
    setLoadError(null);
    try {
      const loaded = await loadGoogleSheet(trimmed);
      // Remembered only after a successful load, and under the same key the
      // feature's own page uses: the two are the same sheet.
      rememberSheetUrl(domain, trimmed);
      setWorkbook(loaded);
      setLoadedUrl(trimmed);
    } catch (error) {
      setWorkbook(null);
      setLoadedUrl(null);
      setLoadError(
        error instanceof GoogleSheetsError
          ? error.message
          : `Could not load that sheet: ${(error as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }, [domain, url]);

  /**
   * The feature's own fields, collected here exactly as its page collects them.
   *
   * Seeded from the live season, so booking next season starts from this one
   * rather than from a blank form, and not written back to the page's memory:
   * what is set here is next season's header, and leaving it behind for
   * whoever opens the page to publish would be a worse surprise than typing it
   * twice. See `useExporterSettings`.
   */
  const [edited, setEdited] = useExporterSettings<unknown>({
    domain,
    controls: definition.controls,
    environmentId,
    persist: false,
  });

  /**
   * The same fields with the event's own window applied over them.
   *
   * The calendar already asked when the event opens and when it ends, so the
   * feature's window is derived rather than asked for again - and derived on
   * every render, so dragging the event's dates moves the season with them.
   */
  const settings = useMemo(() => {
    const { controls, eventSettings } = definition;
    if (controls === undefined) return undefined;
    if (eventSettings === undefined || opensAt === null || endsAt === null) return edited;
    return eventSettings(edited, { opensAt, endsAt });
  }, [definition, edited, opensAt, endsAt]);

  const analysis = useMemo(
    () => runAnalysis(definition, workbook, selection, settings),
    [definition, workbook, selection, settings],
  );
  const { result, issues, errors } = analysis;

  /**
   * The header's own problems, which the analysis also reports.
   *
   * They are the same issues - the transform validates the settings it is
   * handed - and they belong under the fields that cause them rather than in a
   * list of what is wrong with the spreadsheet. So they are shown there, and
   * subtracted here, while still counting towards what blocks the booking.
   */
  const settingsIssues = useMemo(
    () => (definition.controls === undefined || settings === undefined ? [] : definition.controls.validate(settings)),
    [definition, settings],
  );
  const sheetIssues = useMemo(() => {
    const own = new Set(settingsIssues.map((issue) => issue.message));
    return issues.filter((issue) => !own.has(issue.message));
  }, [issues, settingsIssues]);
  // Counted the same way they are listed, so a "1 warning" tile always has a
  // warning under it rather than one that is shown up in the panel.
  const sheetErrors = sheetIssues.filter((issue) => issue.severity === 'error').length;
  const sheetWarnings = sheetIssues.length - sheetErrors;

  /** The schema gate, run for the same reason the page runs it: before anything is promised. */
  const exportable = useMemo(() => {
    if (result === null || errors > 0 || result.count === 0) {
      return { config: null, schemaError: null as string | null };
    }
    const schemaIssues = definition.validate(result.config);
    if (schemaIssues.length > 0) {
      return { config: null, schemaError: schemaIssues.map((issue) => issue.message).join(' ') };
    }
    return { config: result.config as unknown, schemaError: null };
  }, [definition, result, errors]);

  // The cross-config check: what this payload would break in the live game.
  const release = useRelease({
    domain,
    payload: exportable.config,
    environmentId,
    extraRegistry: result?.registry,
  });

  const dataset = workbook === null ? null : detectDataset(workbook);
  const wrongDataset = dataset !== null && dataset !== definition.dataset;

  const blocker =
    workbook === null
      ? `Load the ${definition.title} sheet this event publishes.`
      : result === null
        ? 'Some tabs could not be matched. Pick them in the tab mapping.'
        : errors > 0
          ? `${errors} error${errors === 1 ? '' : 's'} to fix: nothing is booked while ${definition.errorContext}.`
          : result.count === 0
            ? `The sheet parsed without errors but produced no ${definition.noun.plural}.`
            : exportable.schemaError !== null
              ? `The config failed its schema check: ${exportable.schemaError}`
              : release.introducedErrors > 0
                ? `This config would introduce ${release.introducedErrors} error${
                    release.introducedErrors === 1 ? '' : 's'
                  } in the live game. They are listed above.`
                : null;

  const payload = blocker === null ? exportable.config : null;

  const answer = useMemo<EventConfig>(
    () => ({ payload, sourceUrl: loadedUrl, blocker }),
    [payload, loadedUrl, blocker],
  );

  useEffect(() => {
    onResult(answer);
  }, [answer, onResult]);

  const sheetNames = workbook?.sheets.map((sheet) => sheet.name) ?? [];
  const chosen = definition.tabs.filter((tab) => selection[tab.key] !== null).length;

  return (
    <div className="field stack-sm">
      {/* One label and a link box. What this step does - read the sheet now,
          publish this snapshot when the event opens - used to be a paragraph
          here; it is the tooltip and the result below instead. */}
      <span
        className="field__label"
        title={`The ${label} sheet is read and checked now. What comes out is published when the event opens; editing the sheet afterwards does not change a booked event.`}
      >
        The config it publishes
      </span>

      <div className="linkrow">
        <input
          type="url"
          value={url}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void load();
            }
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => void load()}
          disabled={busy || url.trim() === ''}
        >
          {busy ? 'Loading...' : workbook === null ? 'Load' : 'Reload'}
        </button>
      </div>

      {definition.controls !== undefined && settings !== undefined && (
        <details className="disclosure" open>
          <summary>
            {definition.controls.title} - <strong>{definition.controls.summary(settings)}</strong>
          </summary>
          <div className="stack-sm" style={{ marginTop: 8 }}>
            <definition.controls.Panel
              value={settings}
              onChange={setEdited}
              environmentId={environmentId}
              fromEvent
            />
            <IssueList issues={settingsIssues} severity="error" />
            <IssueList issues={settingsIssues} severity="warning" />
          </div>
        </details>
      )}

      {loadError !== null && (
        <p className="banner banner--error">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>{loadError}</span>
        </p>
      )}

      {wrongDataset && (
        <p className="banner banner--warn">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>That workbook does not look like a {definition.title} sheet.</span>
        </p>
      )}

      {workbook !== null && (
        <>
          <div className="mapping">
            <button
              type="button"
              className="mapping__toggle"
              aria-expanded={showMapping}
              onClick={() => setShowMapping((open) => !open)}
            >
              <Icon
                name="chevron"
                size={14}
                className={showMapping ? 'mapping__chevron mapping__chevron--open' : 'mapping__chevron'}
              />
              <span>
                {chosen === definition.tabs.length
                  ? `Tab mapping - all ${definition.tabs.length} matched automatically`
                  : `Tab mapping - ${definition.tabs.length - chosen} still to pick`}
              </span>
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

          {result !== null && (
            <div className="stats stats--tight">
              {result.stats.map((stat) => (
                <div key={stat.label} className="stat">
                  <div className="stat__value">{stat.value.toLocaleString()}</div>
                  <div className="stat__label">{stat.label}</div>
                </div>
              ))}
              {sheetErrors > 0 && (
                <div className="stat stat--danger">
                  <div className="stat__value">{sheetErrors}</div>
                  <div className="stat__label">Errors</div>
                </div>
              )}
              {sheetWarnings > 0 && (
                <div className="stat stat--warn">
                  <div className="stat__value">{sheetWarnings}</div>
                  <div className="stat__label">Warnings</div>
                </div>
              )}
            </div>
          )}

          <IssueList issues={sheetIssues} severity="error" />

          {sheetWarnings > 0 && (
            <details className="disclosure">
              <summary>
                {sheetWarnings} sheet warning{sheetWarnings === 1 ? '' : 's'} - published as-is
              </summary>
              <IssueList issues={sheetIssues} severity="warning" />
            </details>
          )}

          {/* The same cross-config check the page runs: a reward this pass hands
              out has to exist in the game it is published into. */}
          {exportable.config !== null && release.status === 'loading' && (
            <p className="field__note">
              <span className="spinner" aria-hidden="true" /> Checking against the live game...
            </p>
          )}
          {release.graph !== null && release.graph.introduced.length > 0 && (
            <div>
              <p className="step__section-title step__section-title--danger">
                {release.introducedErrors > 0
                  ? `${release.introducedErrors} error${
                      release.introducedErrors === 1 ? '' : 's'
                    } this event would introduce in the live game`
                  : 'Worth knowing before this goes live'}
              </p>
              <IssueList issues={release.graph.introduced} severity="error" />
              <IssueList issues={release.graph.introduced} severity="warning" />
            </div>
          )}
          {release.status === 'error' && (
            <p className="field__note" title={release.error ?? undefined}>
              Cross-config check skipped: the live game could not be read.
            </p>
          )}
        </>
      )}
    </div>
  );
}
