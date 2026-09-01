import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Chip } from '../components/Step';
import { IssueList } from '../components/Summary';
import {
  ACCOUNT,
  ENVIRONMENTS,
  environmentName,
  isLiveEnvironment,
  liveEnvironment,
} from '../domains/account';
import { DOMAIN_LABELS, SETTING_KEYS, type DomainId } from '../domains/types';
import {
  domainForKey,
  fetchDrift,
  fetchValues,
  toConfigSet,
  unknownSettingKeys,
  type Drift,
  type DriftSetting,
  type SettingValue,
  type Unreadable,
  type Values,
} from '../lib/liveConfig';
import { registryFromConfigs } from '../workspace/registry';
import { validateGraph, type GraphReport } from '../workspace/graph';

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/* --------------------------------------------------------------- sections -- */

function EnvironmentPicker({
  selected,
  onSelect,
  busy,
}: {
  selected: string;
  onSelect: (environmentId: string) => void;
  busy: boolean;
}) {
  return (
    <div className="segmented" role="group" aria-label="Environment">
      {ENVIRONMENTS.map((environment) => (
        <button
          key={environment.environmentId}
          type="button"
          aria-pressed={selected === environment.environmentId}
          disabled={busy}
          onClick={() => onSelect(environment.environmentId)}
        >
          {environment.name}
          {environment.readByLiveGame && ' (live)'}
        </button>
      ))}
    </div>
  );
}

function SettingsTable({ values }: { values: Values }) {
  const rows = values.settings.map((setting) => ({
    setting,
    domain: domainForKey(setting.key),
  }));

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Setting</th>
            <th scope="col">Key</th>
            <th scope="col">Managed as</th>
            <th scope="col">Size</th>
            <th scope="col">Payload</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ setting, domain }) => (
            <tr key={setting.key ?? String(setting.settingId)}>
              <td>{setting.name ?? '-'}</td>
              <td className="mono">{setting.key ?? '-'}</td>
              <td>
                {domain === null ? (
                  <Chip tone="warn">Not managed here</Chip>
                ) : (
                  DOMAIN_LABELS[domain]
                )}
              </td>
              <td className="num">{formatBytes(setting.bytes)}</td>
              <td>
                {setting.parseError !== null ? (
                  <Chip tone="danger">Not valid JSON</Chip>
                ) : setting.json === null ? (
                  <Chip tone="neutral">Not JSON</Chip>
                ) : (
                  <Chip tone="ok">Parsed</Chip>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GraphSection({ report, missing }: { report: GraphReport; missing: DomainId[] }) {
  return (
    <div className="card">
      <div className="card__header">
        <h3 className="card__title">Cross-config checks</h3>
        <p className="card__hint">
          References between the settings: arenas named on the trophy road, rewards that grant a
          hero or an arena, bot counts against the number of scoring places.
        </p>
      </div>
      <div className="card__body stack-md">
        <div className="stats">
          <div className={report.errors > 0 ? 'stat stat--danger' : 'stat stat--ok'}>
            <div className="stat__value">{report.errors}</div>
            <div className="stat__label">Errors</div>
          </div>
          <div className={report.warnings > 0 ? 'stat stat--warn' : 'stat'}>
            <div className="stat__value">{report.warnings}</div>
            <div className="stat__label">Warnings</div>
          </div>
        </div>

        {missing.length > 0 && (
          <p className="banner banner--info">
            <Icon name="info" size={14} className="banner__icon" />
            <span>
              {missing.map((domain) => SETTING_KEYS[domain]).join(', ')} could not be read, so rules
              needing them were skipped rather than passed.
            </span>
          </p>
        )}

        {report.issues.length === 0 ? (
          <p className="banner banner--ok">
            <Icon name="check" size={14} className="banner__icon" />
            <span>Every cross-config reference resolves.</span>
          </p>
        ) : (
          <>
            <IssueList issues={report.issues} severity="error" />
            <IssueList issues={report.issues} severity="warning" />
          </>
        )}

        <p className="step__note">
          Reward IDs are only checked against the workbook&rsquo;s Rewards lookup tab. Load a
          workbook on an exporter page to include them.
        </p>
      </div>
    </div>
  );
}

function DriftRow({ setting }: { setting: DriftSetting }) {
  const [open, setOpen] = useState(false);

  if (setting.status === 'same') {
    return (
      <li className="issue">
        <Icon name="check" size={14} className="issue__icon" />
        <span>
          <span className="mono">{setting.key}</span> matches.
        </span>
      </li>
    );
  }

  if (setting.status !== 'different') {
    return (
      <li className="issue issue--warning">
        <Icon name="alert" size={14} className="issue__icon" />
        <span>
          <span className="mono">{setting.key}</span> exists in only one environment.
        </span>
      </li>
    );
  }

  const total = setting.summary?.total ?? 0;

  return (
    <li className="issue issue--warning">
      <Icon name="alert" size={14} className="issue__icon" />
      <span className="stack-sm">
        <span className="row-between">
          <span>
            <span className="mono">{setting.key}</span> differs - {total} change
            {total === 1 ? '' : 's'}
            {setting.comparedAs === 'raw' && ' (compared as raw text)'}
          </span>
          <button type="button" className="btn btn--sm" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </span>
        {open && (
          <ul className="param-list">
            {(setting.changes ?? []).map((change, index) => (
              <li key={`${change.path}-${index}`} className="param mono">
                {change.description}
              </li>
            ))}
            {(setting.truncated ?? 0) > 0 && (
              <li className="param">and {setting.truncated} more</li>
            )}
          </ul>
        )}
      </span>
    </li>
  );
}

/**
 * Shown when a response parsed but yielded nothing usable. Without this the
 * page renders an empty table and a row of zeroes, which reads as a clean bill
 * of health rather than as a failure to read anything at all.
 */
function UnreadableBanner({ unreadable }: { unreadable: Unreadable }) {
  return (
    <p className="banner banner--error" role="alert">
      <Icon name="alert" size={14} className="banner__icon" />
      <span className="stack-sm">
        <span>
          {unreadable.reason} Nothing below was actually checked. This is a response-shape
          mismatch, not an empty config.
        </span>
        <span className="mono">
          {unreadable.apiVersion} API, list key {unreadable.listKey ?? 'not found'}, response keys:{' '}
          {unreadable.responseKeys.join(', ') || 'none'}
          {unreadable.sampleEntryKeys.length > 0 &&
            `, entry keys: ${unreadable.sampleEntryKeys.join(', ')}`}
        </span>
      </span>
    </p>
  );
}

function DriftSection({ drift, from, to }: { drift: Drift; from: string; to: string }) {
  if (drift.unreadable !== null) {
    return (
      <div className="card">
        <div className="card__header">
          <h3 className="card__title">
            {environmentName(from)} vs {environmentName(to)}
          </h3>
        </div>
        <div className="card__body">
          <UnreadableBanner unreadable={drift.unreadable} />
        </div>
      </div>
    );
  }
  return <DriftComparison drift={drift} from={from} to={to} />;
}

function DriftComparison({ drift, from, to }: { drift: Drift; from: string; to: string }) {
  return (
    <div className="card">
      <div className="card__header">
        <h3 className="card__title">
          {environmentName(from)} vs {environmentName(to)}
        </h3>
        <p className="card__hint">
          Compared structurally, so formatting differences between the two do not register as
          changes.
        </p>
      </div>
      <div className="card__body stack-md">
        {drift.differing === 0 ? (
          <p className="banner banner--ok">
            <Icon name="check" size={14} className="banner__icon" />
            <span>The two environments hold the same config.</span>
          </p>
        ) : (
          <p className="banner banner--warn">
            <Icon name="alert" size={14} className="banner__icon" />
            <span>
              {drift.differing} of {drift.settings.length} settings differ.
            </span>
          </p>
        )}
        <ul className="issues">
          {drift.settings.map((setting) => (
            <DriftRow key={setting.key} setting={setting} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page -- */

/**
 * Read-only view of what is actually deployed.
 *
 * Nothing here writes. It answers three questions that previously needed the
 * ConfigCat dashboard and a lot of squinting: what is live, whether the config
 * set is internally consistent, and how far apart the two environments are.
 */
export function LiveConfig() {
  const live = liveEnvironment();
  const [environmentId, setEnvironmentId] = useState(
    live?.environmentId ?? ENVIRONMENTS[0].environmentId,
  );
  const [values, setValues] = useState<Values | null>(null);
  const [drift, setDrift] = useState<Drift | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const other = ENVIRONMENTS.find((environment) => environment.environmentId !== environmentId);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const loadedValues = await fetchValues(ACCOUNT.configId, environmentId);
      setValues(loadedValues);
      if (other !== undefined) {
        setDrift(await fetchDrift(ACCOUNT.configId, environmentId, other.environmentId));
      }
    } catch (loadError) {
      setError((loadError as Error).message);
      setValues(null);
      setDrift(null);
    } finally {
      setBusy(false);
    }
  }, [environmentId, other]);

  useEffect(() => {
    void load();
  }, [load]);

  // Graph validation is pure and runs in the browser, so it needs no round trip
  // and the payloads never have to leave the page to be checked.
  const graph = useMemo(() => {
    if (values === null) return null;
    const set = toConfigSet(values);
    return validateGraph(set, registryFromConfigs(set));
  }, [values]);

  const unmanaged = values === null ? [] : unknownSettingKeys(values);
  const unparsed = (values?.settings ?? []).filter(
    (setting: SettingValue) => setting.parseError !== null,
  );

  return (
    <div className="stack-md">
      <div className="page__head">
        <span className="page__badge">Live</span>
        <h2 className="page__title">Live config</h2>
        <p className="page__lead">
          What {ACCOUNT.productName} is serving right now, read straight from ConfigCat. This page
          never writes.
        </p>
      </div>

      <div className="toolbar row-between">
        <EnvironmentPicker selected={environmentId} onSelect={setEnvironmentId} busy={busy} />
        <button type="button" className="btn btn--sm" onClick={() => void load()} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={13} />}
          Refresh
        </button>
      </div>

      {isLiveEnvironment(environmentId) ? (
        <p className="banner banner--warn">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>
            The shipped game reads {environmentName(environmentId)}. A change here reaches players.
          </span>
        </p>
      ) : (
        <p className="banner banner--info">
          <Icon name="info" size={14} className="banner__icon" />
          <span>
            Nothing reads {environmentName(environmentId)} today, so it is the safe place to
            rehearse a change.
          </span>
        </p>
      )}

      {error !== null && (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>{error}</span>
        </p>
      )}

      {values !== null && (
        <>
          <div className="card">
            <div className="card__header">
              <h3 className="card__title">Settings</h3>
              <p className="card__hint">
                {values.settings.length} settings, {formatBytes(values.totalBytes)} in total, read
                through the {values.apiVersion} API.
              </p>
            </div>
            <div className="card__body stack-md">
              {values.unreadable !== null && <UnreadableBanner unreadable={values.unreadable} />}
              <SettingsTable values={values} />
              {unmanaged.length > 0 && (
                <p className="banner banner--info">
                  <Icon name="info" size={14} className="banner__icon" />
                  <span>
                    {unmanaged.join(', ')} {unmanaged.length === 1 ? 'is' : 'are'} in ConfigCat but
                    has no domain in this console yet, so nothing validates it.
                  </span>
                </p>
              )}
              {unparsed.length > 0 && (
                <p className="banner banner--error">
                  <Icon name="alert" size={14} className="banner__icon" />
                  <span>
                    {unparsed.map((setting) => setting.key).join(', ')} did not parse as JSON.
                  </span>
                </p>
              )}
            </div>
          </div>

          {graph !== null && values.unreadable === null && (
            <GraphSection report={graph} missing={graph.missing} />
          )}
        </>
      )}

      {drift !== null && other !== undefined && (
        <DriftSection drift={drift} from={environmentId} to={other.environmentId} />
      )}
    </div>
  );
}
