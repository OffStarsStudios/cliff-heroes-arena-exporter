import { useState } from 'react';
import { Icon } from './Icon';
import { JsonOutput } from './JsonOutput';
import { ScheduleDialog } from './ScheduleDialog';
import { Segmented } from './Segmented';
import { IssueList } from './Summary';
import { ACCOUNT, ENVIRONMENTS, environmentName, isLiveEnvironment } from '../domains/account';
import { DOMAIN_LABELS, GIT_PATHS, SETTING_KEYS, type DomainId } from '../domains/types';
import { applyPublish, type ApplyResponse } from '../lib/liveConfig';
import type { Release } from '../hooks/useRelease';

interface ChangeReviewProps {
  domain: DomainId;
  /** The parsed config. Serialisation is the server's business. */
  payload: unknown | null;
  /** Pretty-printed form, for the download and the raw view. */
  json: string | null;
  downloadFilename: string;
  release: Release;
  environmentId: string;
  onEnvironmentChange: (environmentId: string) => void;
  /** Set when the sheet itself is not exportable, with the reason. */
  sheetBlocker: string | null;
}

function CountTile({ value, label, tone }: { value: number; label: string; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className={tone === undefined ? 'stat' : `stat stat--${tone}`}>
      <div className="stat__value">{value.toLocaleString()}</div>
      <div className="stat__label">{label}</div>
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
            ? `${result.settingKey} is live and was read back correctly (${result.bytes} B).`
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
          <Icon name={commit.committed ? 'git' : 'info'} size={14} className="banner__icon" />
          <span>
            {commit.committed
              ? `Recorded in git at ${commit.path}.`
              : `Published, but not recorded in git: ${commit.reason}`}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * What publishing this sheet would do, and the button that does it.
 *
 * This is the whole middle of the console. It used to be three panels the user
 * had to trigger one after another - generate, plan, check - and it is now one
 * view that is already computed by the time they look at it. The diff is the
 * headline because the diff is what a live-ops change actually is; the JSON is
 * a detail, tucked away where somebody debugging can still find it.
 */
export function ChangeReview({
  domain,
  payload,
  json,
  downloadFilename,
  release,
  environmentId,
  onEnvironmentChange,
  sheetBlocker,
}: ChangeReviewProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [response, setResponse] = useState<ApplyResponse | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState(false);

  const settingKey = SETTING_KEYS[domain];
  const targetsLive = isLiveEnvironment(environmentId);
  const { entry, graph } = release;

  const introduced = graph?.introduced ?? [];
  const introducedErrors = introduced.filter((issue) => issue.severity === 'error');
  const introducedWarnings = introduced.filter((issue) => issue.severity === 'warning');

  const blocker =
    sheetBlocker !== null
      ? sheetBlocker
      : release.status === 'error'
        ? `The live config could not be read, so nothing has been compared: ${release.error}`
        : entry?.error !== undefined
          ? entry.error
          : introducedErrors.length > 0
            ? `This change would introduce ${introducedErrors.length} cross-config error${introducedErrors.length === 1 ? '' : 's'}. Fix the sheet and it re-checks itself.`
            : release.plan !== null && !release.plan.writable
              ? release.plan.blockers.join(' ')
              : null;

  const ready = release.status === 'ready' && blocker === null && !release.unchanged;
  const canPublish = ready && (!targetsLive || confirmed) && !publishing;

  const publish = async () => {
    if (entry?.baselineHash === undefined || payload === null) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await applyPublish({
        configId: ACCOUNT.configId,
        environmentId,
        productId: ACCOUNT.productId,
        entries: [
          {
            settingKey,
            payload,
            gitPath: GIT_PATHS[domain],
            baselineHash: entry.baselineHash,
            note: `Published ${settingKey} from the back office.`,
          },
        ],
      });
      setResponse(result);
      setConfirmed(false);
      // The live value has moved, so the diff on screen is now history.
      release.reload();
    } catch (error) {
      setPublishError((error as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="stack-md">
      <div className="row-between review__bar">
        <Segmented
          label="Target environment"
          value={environmentId}
          options={ENVIRONMENTS.map((environment) => ({
            value: environment.environmentId,
            label: (
              <>
                {environment.name.replace(' Environment', '')}
                {environment.readByLiveGame && <span className="segmented__flag">live</span>}
              </>
            ),
          }))}
          onChange={(next) => {
            onEnvironmentChange(next);
            setResponse(null);
            setConfirmed(false);
          }}
        />
        <button type="button" className="btn btn--sm" onClick={release.reload} disabled={release.status === 'loading'}>
          {release.status === 'loading' ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={13} />}
          Re-check
        </button>
      </div>

      {release.status === 'loading' && (
        <div className="review__loading">
          <span className="spinner" aria-hidden="true" />
          <span>Comparing against {environmentName(environmentId)}...</span>
        </div>
      )}

      {release.status === 'idle' && (
        <p className="empty">Load a sheet above and the changes appear here on their own.</p>
      )}

      {release.status === 'error' && (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" size={15} className="banner__icon" />
          <span>{release.error}</span>
        </p>
      )}

      {release.status === 'ready' && entry !== null && (
        <>
          {release.unchanged ? (
            <div className="banner banner--ok">
              <Icon name="check" size={15} className="banner__icon" />
              <span>
                <strong>Nothing to publish.</strong> {environmentName(environmentId)} already serves
                exactly this. The sheet and the live game agree.
              </span>
            </div>
          ) : entry.error !== undefined ? (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" size={15} className="banner__icon" />
              <span>{entry.error}</span>
            </p>
          ) : (
            <>
              <div className="stats stats--tight">
                <CountTile value={entry.summary?.added ?? 0} label="Added" tone="ok" />
                <CountTile value={entry.summary?.removed ?? 0} label="Removed" tone={entry.summary?.removed ? 'danger' : undefined} />
                <CountTile value={entry.summary?.changed ?? 0} label="Changed" tone={entry.summary?.changed ? 'warn' : undefined} />
                <CountTile value={entry.summary?.reordered ?? 0} label="Reordered" />
                <div className="stat">
                  <div className="stat__value">
                    {entry.bytesBefore ?? 0}
                    <span className="stat__delta"> to {entry.bytesAfter ?? 0} B</span>
                  </div>
                  <div className="stat__label">Payload size</div>
                </div>
              </div>

              <div className="difflist">
                <p className="step__section-title">
                  What changes in <span className="mono">{settingKey}</span>
                </p>
                <ul className="difflist__items">
                  {(entry.changes ?? []).map((change, index) => (
                    <li key={`${change.path}-${index}`} className={`difflist__item difflist__item--${change.kind}`}>
                      <span className="difflist__kind">{change.kind}</span>
                      <span className="difflist__text mono">{change.description}</span>
                    </li>
                  ))}
                </ul>
                {(entry.truncated ?? 0) > 0 && (
                  <p className="field__note">and {entry.truncated} more not listed.</p>
                )}
              </div>
            </>
          )}

          {/* The cross-config check only earns space when it has something to say. */}
          {introducedErrors.length > 0 && (
            <div>
              <p className="step__section-title step__section-title--danger">
                {introducedErrors.length} problem{introducedErrors.length === 1 ? '' : 's'} this change
                would create in other configs
              </p>
              <IssueList issues={introducedErrors} severity="error" />
            </div>
          )}

          {introducedWarnings.length > 0 && (
            <details className="disclosure">
              <summary>
                {introducedWarnings.length} cross-config warning{introducedWarnings.length === 1 ? '' : 's'}{' '}
                this change introduces
              </summary>
              <IssueList issues={introducedWarnings} severity="warning" />
            </details>
          )}

          {graph !== null && introducedErrors.length === 0 && !release.unchanged && (
            <p className="banner banner--ok">
              <Icon name="shield" size={14} className="banner__icon" />
              <span>
                Checked against the other {graph.settingCount - 1} live settings - no arena, hero or
                reward this config names goes missing.
                {graph.resolved.length > 0 && ` It also fixes ${graph.resolved.length} existing problem${graph.resolved.length === 1 ? '' : 's'}.`}
              </span>
            </p>
          )}

          {graph !== null && graph.missing.length > 0 && (
            <p className="banner banner--info">
              <Icon name="info" size={14} className="banner__icon" />
              <span>
                Not readable in {environmentName(environmentId)}:{' '}
                {graph.missing.map((missing) => DOMAIN_LABELS[missing]).join(', ')}. Rules needing them
                were skipped rather than passed.
              </span>
            </p>
          )}

          {json !== null && (
            <details className="disclosure">
              <summary>The JSON itself</summary>
              <JsonOutput json={json} filename={downloadFilename} />
            </details>
          )}
        </>
      )}

      {sheetBlocker !== null && (
        <p className="banner banner--warn">
          <Icon name="alert" size={15} className="banner__icon" />
          <span>{sheetBlocker}</span>
        </p>
      )}

      {publishError !== null && (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" size={15} className="banner__icon" />
          <span>{publishError}</span>
        </p>
      )}

      {scheduled && (
        <p className="banner banner--ok">
          <Icon name="calendar" size={14} className="banner__icon" />
          <span>
            Scheduled. It shows on the dashboard and in Scheduling until it goes live, and the back
            office publishes it without anyone here.
          </span>
        </p>
      )}

      {response !== null && <Results response={response} />}

      <div className="review__actions">
        {targetsLive && ready && (
          <label className="checkline checkline--warn">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I have read the diff and want this live in {environmentName(environmentId)}.
          </label>
        )}

        <div className="review__buttons">
          <button
            type="button"
            className="btn"
            onClick={() => setScheduling(true)}
            disabled={!ready}
            title={ready ? undefined : blocker ?? 'Nothing to schedule yet.'}
          >
            <Icon name="calendar" size={14} />
            Schedule it
          </button>
          <button type="button" className="btn btn--primary btn--lg" onClick={() => void publish()} disabled={!canPublish}>
            {publishing ? <span className="spinner spinner--on-accent" aria-hidden="true" /> : <Icon name="upload" size={15} />}
            Publish to {environmentName(environmentId).replace(' Environment', '')}
          </button>
        </div>
      </div>

      {scheduling && payload !== null && (
        <ScheduleDialog
          domain={domain}
          payload={payload}
          environmentId={environmentId}
          onClose={() => setScheduling(false)}
          onScheduled={() => setScheduled(true)}
        />
      )}
    </div>
  );
}
