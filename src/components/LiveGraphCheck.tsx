import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { IssueList } from './Summary';
import { ACCOUNT, environmentName } from '../domains/account';
import { DOMAIN_LABELS, SETTING_KEYS, type DomainId } from '../domains/types';
import {
  compareGraphReports,
  fetchValues,
  toConfigSet,
  withCandidate,
  type GraphComparison,
} from '../lib/liveConfig';
import { emptyRegistry, mergeRegistries, registryFromConfigs, type IdRegistry } from '../workspace/registry';
import { validateGraph } from '../workspace/graph';

export interface LiveCheckResult {
  comparison: GraphComparison;
  /** Domains the live config could not supply, so rules needing them were skipped. */
  missing: DomainId[];
  settingCount: number;
  environmentId: string;
  introducedErrors: number;
}

interface LiveGraphCheckProps {
  domain: DomainId;
  /** The generated payload, or null before generation. The check clears whenever it changes. */
  payload: unknown | null;
  environmentId: string;
  /** IDs known from the workbook (rewards, say), on top of what the live configs define. */
  extraRegistry?: IdRegistry;
  onResult?: (result: LiveCheckResult | null) => void;
}

type Status = 'idle' | 'loading' | 'done' | 'error';

/**
 * Cross-config validation of a payload *before* it is published.
 *
 * Fetches every live setting for the target environment, substitutes the
 * candidate for its own domain, and runs the same graph rules the Live config
 * page runs. The report is split against the live baseline so only issues
 * this change introduces are held against it.
 */
export function LiveGraphCheck({ domain, payload, environmentId, extraRegistry, onResult }: LiveGraphCheckProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<LiveCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);

  // A stale result must never outlive the payload it was computed for.
  useEffect(() => {
    setResult(null);
    setError(null);
    setStatus(payload === null ? 'idle' : 'loading');
    onResult?.(null);
    if (payload === null) return;

    let cancelled = false;
    (async () => {
      try {
        const values = await fetchValues(ACCOUNT.configId, environmentId);
        const live = toConfigSet(values);
        const baseline = validateGraph(live, registryFromConfigs(live));
        const candidateSet = withCandidate(live, domain, payload);
        const candidate = validateGraph(
          candidateSet,
          mergeRegistries(registryFromConfigs(candidateSet), extraRegistry ?? emptyRegistry()),
        );
        const comparison = compareGraphReports(baseline, candidate);
        const next: LiveCheckResult = {
          comparison,
          missing: candidate.missing as DomainId[],
          settingCount: values.settings.length,
          environmentId,
          introducedErrors: comparison.introduced.filter((issue) => issue.severity === 'error').length,
        };
        if (cancelled) return;
        setResult(next);
        setStatus('done');
        onResult?.(next);
      } catch (checkError) {
        if (cancelled) return;
        setError((checkError as Error).message);
        setStatus('error');
        onResult?.(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // onResult is deliberately not a dependency: a fresh callback identity per
    // render must not re-run a network check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, environmentId, domain, extraRegistry, runId]);

  const settingKey = SETTING_KEYS[domain];
  const introducedErrors = result?.comparison.introduced.filter((issue) => issue.severity === 'error') ?? [];
  const introducedWarnings = result?.comparison.introduced.filter((issue) => issue.severity === 'warning') ?? [];

  return (
    <div className="card">
      <div className="card__header">
        <h3 className="card__title">Check against live config</h3>
        <p className="card__hint">
          Runs the cross-config rules with this <span className="mono">{settingKey}</span> in place of
          the live one: arenas the trophy road names, bot counts against scoring places, rewards.
        </p>
      </div>

      <div className="card__body stack-md">
        {status === 'idle' && (
          <p className="field__note">Generate the JSON to check it against {environmentName(environmentId)}.</p>
        )}

        {status === 'loading' && (
          <p className="banner banner--info">
            <span className="spinner" aria-hidden="true" />
            <span>Reading {environmentName(environmentId)}...</span>
          </p>
        )}

        {status === 'error' && (
          <p className="banner banner--warn" role="alert">
            <Icon name="alert" size={14} className="banner__icon" />
            <span>
              Could not read the live config, so nothing was cross-checked: {error} Publishing is
              not blocked by this, but the diff step will need the same connection.
            </span>
          </p>
        )}

        {status === 'done' && result !== null && (
          <>
            <div className="stats">
              <div className={introducedErrors.length > 0 ? 'stat stat--danger' : 'stat stat--ok'}>
                <div className="stat__value">{introducedErrors.length}</div>
                <div className="stat__label">Errors introduced</div>
              </div>
              <div className={introducedWarnings.length > 0 ? 'stat stat--warn' : 'stat'}>
                <div className="stat__value">{introducedWarnings.length}</div>
                <div className="stat__label">Warnings introduced</div>
              </div>
              <div className="stat">
                <div className="stat__value">{result.comparison.resolved.length}</div>
                <div className="stat__label">Live issues fixed</div>
              </div>
            </div>

            {introducedErrors.length === 0 && introducedWarnings.length === 0 && (
              <p className="banner banner--ok">
                <Icon name="check" size={14} className="banner__icon" />
                <span>This change introduces no cross-config problems.</span>
              </p>
            )}

            {introducedErrors.length > 0 && (
              <div>
                <p className="step__section-title">
                  {introducedErrors.length} error{introducedErrors.length === 1 ? '' : 's'} this change
                  would introduce - publishing is blocked until they are fixed
                </p>
                <IssueList issues={introducedErrors} severity="error" />
              </div>
            )}

            {introducedWarnings.length > 0 && (
              <div>
                <p className="step__section-title">
                  {introducedWarnings.length} warning{introducedWarnings.length === 1 ? '' : 's'} this
                  change would introduce
                </p>
                <IssueList issues={introducedWarnings} severity="warning" />
              </div>
            )}

            {result.comparison.resolved.length > 0 && (
              <details className="disclosure">
                <summary>Live issues this change fixes ({result.comparison.resolved.length})</summary>
                <IssueList issues={result.comparison.resolved} severity="error" />
                <IssueList issues={result.comparison.resolved} severity="warning" />
              </details>
            )}

            {result.comparison.preexisting.length > 0 && (
              <details className="disclosure">
                <summary>
                  Already present in the live config ({result.comparison.preexisting.length}) - not caused
                  by this change
                </summary>
                <IssueList issues={result.comparison.preexisting} severity="error" />
                <IssueList issues={result.comparison.preexisting} severity="warning" />
              </details>
            )}

            {result.missing.length > 0 && (
              <p className="banner banner--info">
                <Icon name="info" size={14} className="banner__icon" />
                <span>
                  Not readable in {environmentName(result.environmentId)}:{' '}
                  {result.missing.map((missing) => DOMAIN_LABELS[missing]).join(', ')}. Rules needing
                  them were skipped rather than passed.
                </span>
              </p>
            )}

            <div className="row-between">
              <span className="field__note">
                Checked against {result.settingCount} setting{result.settingCount === 1 ? '' : 's'} in{' '}
                {environmentName(result.environmentId)} with your generated {settingKey} substituted.
              </span>
              <button type="button" className="btn btn--sm" onClick={() => setRunId((id) => id + 1)}>
                <Icon name="refresh" size={13} />
                Re-check
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
