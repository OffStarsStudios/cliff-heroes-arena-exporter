import { useCallback, useEffect, useState } from 'react';
import { ConfigTable } from './ConfigTable';
import { Icon } from './Icon';
import { JsonOutput } from './JsonOutput';
import { ENVIRONMENTS, environmentName, isLiveEnvironment } from '../domains/account';
import { DOMAIN_LABELS, type DomainId } from '../domains/types';
import { fetchLiveConfig, type LiveConfigView } from '../lib/liveConfig';
import { localTime, relativeTime } from '../lib/schedule';

interface LiveInGameProps {
  domain: DomainId;
  environmentId: string;
  onEnvironmentChange: (environmentId: string) => void;
  downloadFilename: string;
}

function bytes(value: number | null): string {
  if (value === null) return '-';
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} kB`;
}

/**
 * What the game is serving for this config, read from ConfigCat every time.
 *
 * Deliberately not read from `config/<domain>.json`. That file records what the
 * back office last published, which is a different claim: anyone with ConfigCat
 * dashboard access can change a setting directly, and the moment they do, the
 * git file is stale without anything saying so. A console that answered "what
 * is live" from its own history would be confidently wrong precisely when
 * somebody had gone around it.
 *
 * So the git file appears here only as the thing to compare against, and the
 * comparison is the point of the page: a green line means the back office and
 * the live game agree, and a list of differences means somebody edited
 * ConfigCat by hand and this console does not know why.
 */
export function LiveInGame({ domain, environmentId, onEnvironmentChange, downloadFilename }: LiveInGameProps) {
  const [view, setView] = useState<LiveConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setView(await fetchLiveConfig(domain, environmentId));
      setFetchedAt(Date.now());
    } catch (reason) {
      setError((reason as Error).message);
      setView(null);
    } finally {
      setLoading(false);
    }
  }, [domain, environmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const drift = view?.drift;
  const targetsLive = isLiveEnvironment(environmentId);

  return (
    <div className="stack-md">
      <div className="row-between review__bar">
        <div className="segmented" role="group" aria-label="Environment">
          {ENVIRONMENTS.map((environment) => (
            <button
              key={environment.environmentId}
              type="button"
              aria-pressed={environmentId === environment.environmentId}
              onClick={() => onEnvironmentChange(environment.environmentId)}
            >
              {environment.name.replace(' Environment', '')}
              {environment.readByLiveGame && <span className="segmented__flag">live</span>}
            </button>
          ))}
        </div>
        <div className="row-gap">
          {fetchedAt !== null && !loading && (
            <span className="field__note">Read {relativeTime(fetchedAt - Date.now())}</span>
          )}
          <button type="button" className="btn btn--sm" onClick={() => void load()} disabled={loading}>
            {loading ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={13} />}
            Read it again
          </button>
        </div>
      </div>

      {loading && view === null && (
        <div className="review__loading">
          <span className="spinner" aria-hidden="true" />
          <span>Reading {environmentName(environmentId)} from ConfigCat...</span>
        </div>
      )}

      {error !== null && (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" size={15} className="banner__icon" />
          <span>{error}</span>
        </p>
      )}

      {view !== null && (
        <>
          {!view.live.present ? (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" size={15} className="banner__icon" />
              <span>
                ConfigCat has no setting called <span className="mono">{view.settingKey}</span> in{' '}
                {environmentName(environmentId)}. The game has nothing to read for{' '}
                {DOMAIN_LABELS[domain]}.
              </span>
            </p>
          ) : view.live.parseError !== null ? (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" size={15} className="banner__icon" />
              <span>
                <strong>The live value is not valid JSON.</strong> The game is being served something
                it cannot read: {view.live.parseError}
              </span>
            </p>
          ) : null}

          <div className="stats stats--tight">
            <div className="stat">
              <div className="stat__value">{bytes(view.live.bytes)}</div>
              <div className="stat__label">Served to every client</div>
            </div>
            <div className="stat">
              <div className="stat__value mono" style={{ fontSize: 13 }}>
                {view.settingKey}
              </div>
              <div className="stat__label">ConfigCat setting</div>
            </div>
            <div
              className={
                drift?.checked !== true ? 'stat' : drift.inSync === true ? 'stat stat--ok' : 'stat stat--warn'
              }
            >
              <div className="stat__value">
                {drift?.checked !== true ? '?' : drift.inSync === true ? 'In sync' : drift.summary?.total ?? 0}
              </div>
              <div className="stat__label">
                {drift?.checked !== true
                  ? 'Not compared'
                  : drift.inSync === true
                    ? 'With the back office'
                    : 'Changes made outside here'}
              </div>
            </div>
          </div>

          {/* The whole reason this tab reads ConfigCat rather than git. */}
          {drift?.checked === true && drift.inSync === true && (
            <p className="banner banner--ok">
              <Icon name="check" size={15} className="banner__icon" />
              <span>
                What the game is serving is exactly what the back office last published. Nobody has
                edited this setting in the ConfigCat dashboard.
              </span>
            </p>
          )}

          {drift?.checked === true && drift.inSync === false && (
            <>
              <div className="banner banner--warn">
                <Icon name="alert" size={15} className="banner__icon" />
                <span>
                  <strong>
                    This config has been changed outside the back office
                    {drift.summary === null ? '' : ` - ${drift.summary.total} difference${drift.summary.total === 1 ? '' : 's'}`}
                    .
                  </strong>{' '}
                  The live value no longer matches <span className="mono">{view.baseline.path}</span>,
                  which is what this console last published. Somebody edited it in the ConfigCat
                  dashboard. Publishing from a sheet here will overwrite their change, so find out
                  what it was for first.
                </span>
              </div>

              <div className="difflist">
                <p className="step__section-title">
                  What the dashboard changed, against the last back-office publish
                </p>
                <ul className="difflist__items">
                  {drift.changes.map((change, index) => (
                    <li key={`${change.path}-${index}`} className={`difflist__item difflist__item--${change.kind}`}>
                      <span className="difflist__kind">{change.kind}</span>
                      <span className="difflist__text mono">{change.description}</span>
                    </li>
                  ))}
                </ul>
                {drift.truncated > 0 && <p className="field__note">and {drift.truncated} more not listed.</p>}
              </div>
            </>
          )}

          {drift?.checked === false && drift.reason !== null && (
            <p className="banner banner--info">
              <Icon name="info" size={15} className="banner__icon" />
              <span>
                The live value is shown below, but it could not be compared against the back office's
                own record: {drift.reason}
              </span>
            </p>
          )}

          {targetsLive ? (
            <p className="field__note">
              {environmentName(environmentId)} is what the shipped game reads, so this is what players
              have right now.
            </p>
          ) : (
            <p className="field__note">
              Nothing reads {environmentName(environmentId)}. This is the rehearsal copy, not what
              players have.
            </p>
          )}

          {view.live.json !== null && (
            <div className="stack-md">
              <p className="step__section-title">What the game is serving</p>
              <ConfigTable value={view.live.json} nameHint={DOMAIN_LABELS[domain]} />
              <details className="disclosure">
                <summary>The same thing as JSON</summary>
                <JsonOutput json={JSON.stringify(view.live.json, null, 2)} filename={downloadFilename} />
              </details>
            </div>
          )}

          <div>
            <p className="step__section-title">Published through the back office</p>
            {view.historyError !== null ? (
              <p className="field__note">{view.historyError}</p>
            ) : view.history.length === 0 ? (
              <p className="field__note">
                Nothing has been published to <span className="mono">{view.baseline.path}</span> from
                here yet.
              </p>
            ) : (
              <ul className="param-list">
                {view.history.map((commit) => (
                  <li key={commit.sha} className="param">
                    <span className="mono">{commit.date === null ? '-' : localTime(commit.date)}</span>{' '}
                    {commit.message.split('\n')[0]}
                    {commit.author !== null && ` - ${commit.author}`}
                    {commit.url !== null && (
                      <>
                        {' '}
                        <a href={commit.url} target="_blank" rel="noreferrer">
                          {commit.sha.slice(0, 7)}
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="field__note">
              Only publishes made here appear in this list. A change made in the ConfigCat dashboard
              leaves no trace in git - it shows up as drift above instead.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
