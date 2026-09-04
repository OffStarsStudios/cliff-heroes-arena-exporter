import { useState } from 'react';
import { Icon } from './Icon';
import { ACCOUNT, ENVIRONMENTS, environmentName, isLiveEnvironment, liveEnvironment } from '../domains/account';
import { GIT_PATHS, SETTING_KEYS, type DomainId } from '../domains/types';
import {
  applyPublish,
  planPublish,
  type ApplyResponse,
  type Plan,
  type PlanEntry,
} from '../lib/liveConfig';

interface PublishPanelProps {
  domain: DomainId;
  /** The generated config object. Serialization belongs to the server. */
  payload: unknown;
  /** True when the exporter has outstanding errors, so publishing is refused. */
  blocked: boolean;
  blockedReason: string;
  /**
   * Controlled environment, for pages that share the picker with another
   * component (the live graph check). Uncontrolled when omitted.
   */
  environmentId?: string;
  onEnvironmentChange?: (environmentId: string) => void;
}

function ChangeList({ entry }: { entry: PlanEntry }) {
  if (entry.error !== undefined) {
    return (
      <p className="banner banner--error">
        <Icon name="alert" size={14} className="banner__icon" />
        <span>{entry.error}</span>
      </p>
    );
  }

  if (entry.unchanged === true) {
    return (
      <p className="banner banner--ok">
        <Icon name="check" size={14} className="banner__icon" />
        <span>The live value already matches this output. Nothing to publish.</span>
      </p>
    );
  }

  const summary = entry.summary;

  return (
    <div className="stack-sm">
      <p className="step__section-title">
        {summary?.total ?? 0} change{summary?.total === 1 ? '' : 's'}
        {summary !== undefined &&
          ` - ${summary.added} added, ${summary.removed} removed, ${summary.changed} changed${
            summary.reordered > 0 ? `, ${summary.reordered} reordered` : ''
          }`}
      </p>
      <ul className="param-list">
        {(entry.changes ?? []).map((change, index) => (
          <li key={`${change.path}-${index}`} className="param mono">
            {change.description}
          </li>
        ))}
        {(entry.truncated ?? 0) > 0 && <li className="param">and {entry.truncated} more</li>}
      </ul>
      <p className="field__note">
        {entry.bytesBefore ?? 0} B to {entry.bytesAfter ?? 0} B in ConfigCat.
      </p>
    </div>
  );
}

function Results({ response }: { response: ApplyResponse }) {
  return (
    <div className="stack-sm">
      {response.results.map((result) => {
        const tone =
          result.status === 'written'
            ? 'ok'
            : result.status === 'unchanged'
              ? 'info'
              : result.status === 'conflict'
                ? 'warn'
                : 'error';
        const text =
          result.status === 'written'
            ? `${result.settingKey} published and read back correctly (${result.bytes} B via the ${result.apiVersion} API).`
            : result.status === 'unchanged'
              ? `${result.settingKey} was already identical.`
              : `${result.settingKey}: ${result.message}`;
        return (
          <p key={result.settingKey} className={`banner banner--${tone}`}>
            <Icon name={tone === 'ok' ? 'check' : 'alert'} size={14} className="banner__icon" />
            <span>{text}</span>
          </p>
        );
      })}

      {response.git.commits.map((commit) => (
        <p key={commit.path} className={`banner banner--${commit.committed ? 'ok' : 'warn'}`}>
          <Icon name={commit.committed ? 'check' : 'info'} size={14} className="banner__icon" />
          <span>
            {commit.committed
              ? `Recorded in git at ${commit.path}.`
              : `Published, but not recorded in git: ${commit.reason}`}
          </span>
        </p>
      ))}

      {!response.git.available && response.written > 0 && (
        <p className="banner banner--info">
          <Icon name="info" size={14} className="banner__icon" />
          <span>
            GITHUB_TOKEN is not set, so this publish is live but has no entry in the config history.
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Publish straight to ConfigCat, replacing download-and-paste.
 *
 * Deliberately three steps rather than one button. A plan is computed and
 * shown first, and applying sends back the baseline hash that plan was built
 * against, so a value that moved in between produces a conflict rather than a
 * silent overwrite. Publishing to the environment the game actually reads
 * needs one more explicit confirmation on top.
 */
export function PublishPanel({
  domain,
  payload,
  blocked,
  blockedReason,
  environmentId: controlledEnvironmentId,
  onEnvironmentChange,
}: PublishPanelProps) {
  const live = liveEnvironment();
  const [ownEnvironmentId, setOwnEnvironmentId] = useState(
    live?.environmentId ?? ENVIRONMENTS[0].environmentId,
  );
  const environmentId = controlledEnvironmentId ?? ownEnvironmentId;
  const setEnvironmentId = (next: string) => {
    setOwnEnvironmentId(next);
    onEnvironmentChange?.(next);
  };
  const [plan, setPlan] = useState<Plan | null>(null);
  const [response, setResponse] = useState<ApplyResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settingKey = SETTING_KEYS[domain];
  const targetsLive = isLiveEnvironment(environmentId);

  const reset = () => {
    setPlan(null);
    setResponse(null);
    setConfirmed(false);
    setError(null);
  };

  const runPlan = async () => {
    setBusy(true);
    setError(null);
    setResponse(null);
    try {
      setPlan(
        await planPublish({
          configId: ACCOUNT.configId,
          environmentId,
          productId: ACCOUNT.productId,
          entries: [{ settingKey, payload }],
        }),
      );
    } catch (planError) {
      setError((planError as Error).message);
      setPlan(null);
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    if (plan === null) return;
    const entry = plan.entries[0];
    setBusy(true);
    setError(null);
    try {
      setResponse(
        await applyPublish({
          configId: ACCOUNT.configId,
          environmentId,
          productId: ACCOUNT.productId,
          entries: [
            {
              settingKey,
              payload,
              gitPath: GIT_PATHS[domain],
              baselineHash: entry.baselineHash,
              note: `Published ${settingKey} from the ${domain} exporter.`,
            },
          ],
        }),
      );
      setPlan(null);
      setConfirmed(false);
    } catch (applyError) {
      setError((applyError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const entry = plan?.entries[0];
  const nothingToDo = entry?.unchanged === true;
  const canApply =
    plan !== null &&
    plan.writable &&
    !nothingToDo &&
    entry?.baselineHash !== undefined &&
    (!targetsLive || confirmed);

  return (
    <div className="card">
      <div className="card__header">
        <h3 className="card__title">Publish to ConfigCat</h3>
        <p className="card__hint">
          Writes <span className="mono">{settingKey}</span> directly, replacing download-and-paste.
          A diff is always shown first.
        </p>
      </div>

      <div className="card__body stack-md">
        <div className="row-between">
          <div className="segmented" role="group" aria-label="Target environment">
            {ENVIRONMENTS.map((environment) => (
              <button
                key={environment.environmentId}
                type="button"
                aria-pressed={environmentId === environment.environmentId}
                disabled={busy}
                onClick={() => {
                  setEnvironmentId(environment.environmentId);
                  reset();
                }}
              >
                {environment.name}
                {environment.readByLiveGame && ' (live)'}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => void runPlan()} disabled={busy || blocked}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={14} />}
            {plan === null ? 'Show what would change' : 'Re-check'}
          </button>
        </div>

        {blocked && (
          <p className="banner banner--warn">
            <Icon name="alert" size={14} className="banner__icon" />
            <span>{blockedReason}</span>
          </p>
        )}

        {targetsLive ? (
          <p className="banner banner--warn">
            <Icon name="alert" size={14} className="banner__icon" />
            <span>
              {environmentName(environmentId)} is what the shipped game reads. Publishing here
              reaches players at the next SDK poll.
            </span>
          </p>
        ) : (
          <p className="banner banner--info">
            <Icon name="info" size={14} className="banner__icon" />
            <span>Nothing reads {environmentName(environmentId)}, so this is a safe rehearsal.</span>
          </p>
        )}

        {error !== null && (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" size={14} className="banner__icon" />
            <span>{error}</span>
          </p>
        )}

        {plan !== null && entry !== undefined && (
          <>
            {plan.pending.blocking && (
              <p className="banner banner--error">
                <Icon name="alert" size={14} className="banner__icon" />
                <span>{plan.pending.message}</span>
              </p>
            )}
            <ChangeList entry={entry} />
            {targetsLive && !nothingToDo && plan.writable && (
              <label className="field__label" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I have read the diff and want this live in {environmentName(environmentId)}.
              </label>
            )}
            <div className="row-between">
              <span className="field__note">
                Applying re-checks that the live value has not moved since this diff.
              </span>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void runApply()}
                disabled={!canApply || busy}
              >
                {busy ? (
                  <span className="spinner spinner--on-accent" aria-hidden="true" />
                ) : (
                  <Icon name="upload" size={14} />
                )}
                Publish
              </button>
            </div>
          </>
        )}

        {response !== null && <Results response={response} />}
      </div>
    </div>
  );
}
