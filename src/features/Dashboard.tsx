import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import type { View } from '../components/AppShell';
import { ACCOUNT, ENVIRONMENTS, environmentName, liveEnvironment } from '../domains/account';
import { DOMAIN_LABELS, EXPORTER_DOMAINS, SETTING_KEYS, type DomainId, type ExporterDomain } from '../domains/types';
import { fetchDrift, fetchValues, type Drift, type Values } from '../lib/liveConfig';
import {
  STATE_LABELS,
  STATE_TONES,
  fetchGitStatus,
  fetchSchedule,
  localTime,
  relativeTime,
  type GitStatus,
  type ScheduleView,
} from '../lib/schedule';

/** Which exporter page each config is edited on. */
const VIEW_FOR_DOMAIN: Record<ExporterDomain, View> = {
  trophyRoad: 'arena',
  heroes: 'heroes',
  arenas: 'arenas',
  matchTrophy: 'matchTrophy',
  bots: 'bots',
  heroUpgrade: 'heroUpgrade',
  shop: 'shop',
  battlePass: 'battlePass',
};

const ICON_FOR_DOMAIN: Record<ExporterDomain, IconName> = {
  trophyRoad: 'trophy',
  heroes: 'spark',
  arenas: 'table',
  matchTrophy: 'medal',
  bots: 'bot',
  heroUpgrade: 'coins',
  shop: 'cart',
  battlePass: 'ticket',
};

interface HealthProps {
  icon: IconName;
  label: string;
  state: 'ok' | 'warn' | 'danger' | 'loading';
  value: string;
  detail?: string;
}

function Health({ icon, label, state, value, detail }: HealthProps) {
  return (
    <div className={`health health--${state}`}>
      <span className="health__icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className="health__text">
        <span className="health__label">{label}</span>
        <span className="health__value">{state === 'loading' ? 'Checking...' : value}</span>
        {detail !== undefined && <span className="health__detail">{detail}</span>}
      </div>
    </div>
  );
}

function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} kB`;
}

/**
 * The page this console should have opened on all along.
 *
 * A back office is not a set of converters, it is an answer to "what is the
 * game serving, and what is about to change". So: what is live in every
 * config, what is scheduled, and whether the three things this all depends on
 * - ConfigCat, the GitHub token, the scheduler's heartbeat - are actually
 * working. The last one matters most, because a broken heartbeat is silent by
 * nature: nothing happens, and nothing is what it looks like when a schedule
 * is simply empty.
 */
export function Dashboard({ onNavigate }: { onNavigate: (view: View) => void }) {
  const live = liveEnvironment() ?? ENVIRONMENTS[0];
  const other = ENVIRONMENTS.find((environment) => environment.environmentId !== live.environmentId) ?? null;

  const [values, setValues] = useState<Values | null>(null);
  const [valuesError, setValuesError] = useState<string | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [schedule, setSchedule] = useState<ScheduleView | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [drift, setDrift] = useState<Drift | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setValuesError(null);
    setScheduleError(null);

    // Independent reads, so one failing service does not blank the whole page.
    const [valuesResult, gitResult, scheduleResult, driftResult] = await Promise.allSettled([
      fetchValues(ACCOUNT.configId, live.environmentId),
      fetchGitStatus(),
      fetchSchedule(),
      other === null
        ? Promise.resolve(null)
        : fetchDrift(ACCOUNT.configId, live.environmentId, other.environmentId),
    ]);

    if (valuesResult.status === 'fulfilled') setValues(valuesResult.value);
    else setValuesError(valuesResult.reason?.message ?? String(valuesResult.reason));

    setGit(gitResult.status === 'fulfilled' ? gitResult.value : null);

    if (scheduleResult.status === 'fulfilled') setSchedule(scheduleResult.value);
    else setScheduleError(scheduleResult.reason?.message ?? String(scheduleResult.reason));

    setDrift(driftResult.status === 'fulfilled' ? driftResult.value : null);
    setLoading(false);
  }, [live.environmentId, other]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = schedule?.entries ?? [];
  const upcoming = entries
    .filter((entry) => entry.state === 'scheduled' || entry.state === 'active')
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const needsAttention = entries.filter((entry) => entry.state === 'failed' || entry.state === 'missed');

  const activeByDomain = new Map(entries.filter((entry) => entry.state === 'active').map((entry) => [entry.domain, entry]));
  const nextByDomain = new Map<DomainId, (typeof entries)[number]>();
  for (const entry of upcoming) {
    if (entry.state === 'scheduled' && !nextByDomain.has(entry.domain)) nextByDomain.set(entry.domain, entry);
  }

  const settingFor = (domain: ExporterDomain) =>
    values?.settings.find((setting) => setting.key === SETTING_KEYS[domain]) ?? null;
  const driftFor = (domain: ExporterDomain) =>
    drift?.settings.find((setting) => setting.key === SETTING_KEYS[domain]) ?? null;

  return (
    <>
      <header className="page__head">
        <h1 className="page__title">
          <span className="page__badge page__badge--live" aria-hidden="true">
            <Icon name="grid" size={17} />
          </span>
          Live ops
        </h1>
        <p className="page__lead">
          What {ACCOUNT.productName} is serving right now, what is booked to change, and whether the
          machinery that does it is working.
        </p>
      </header>

      <div className="healthrow">
        <Health
          icon="link"
          label="ConfigCat"
          state={loading && values === null ? 'loading' : valuesError !== null ? 'danger' : 'ok'}
          value={valuesError !== null ? 'Unreachable' : `${values?.settings.length ?? 0} settings, ${bytes(values?.totalBytes)}`}
          detail={valuesError ?? `${environmentName(live.environmentId)} - read by the shipped game`}
        />
        <Health
          icon="git"
          label="Git history"
          state={git === null ? (loading ? 'loading' : 'danger') : git.ok ? 'ok' : 'danger'}
          value={git === null ? 'Unknown' : git.ok ? 'Read and write' : git.tokenPresent ? 'Refused' : 'No token'}
          detail={git?.problem ?? (git === null ? undefined : `${git.repo} on ${git.branch}`)}
        />
        <Health
          icon="clock"
          label="Scheduler"
          state={
            schedule === null
              ? loading
                ? 'loading'
                : 'danger'
              : schedule.unavailable !== undefined
                ? 'danger'
                : schedule.heartbeatStale
                ? entries.some((entry) => entry.state === 'scheduled' || entry.state === 'active')
                  ? 'danger'
                  : 'warn'
                : 'ok'
          }
          value={
            schedule === null
              ? scheduleError === null
                ? 'Unknown'
                : 'Unreachable'
              : schedule.unavailable !== undefined
                ? 'Unavailable'
                : schedule.lastTickAt === null
                  ? 'Never run'
                  : `Last beat ${relativeTime(Date.parse(schedule.lastTickAt) - Date.now())}`
          }
          detail={
            schedule === null
              ? scheduleError ?? undefined
              : schedule.unavailable !== undefined
                ? schedule.unavailable
                : schedule.heartbeatStale
                ? 'The heartbeat has not been heard from in over an hour. Scheduled changes are not going live. Check the Scheduler heartbeat workflow in GitHub Actions.'
                : `${upcoming.length} window${upcoming.length === 1 ? '' : 's'} open or booked`
          }
        />
      </div>

      {needsAttention.length > 0 && (
        <div className="banner banner--error" role="alert" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={15} className="banner__icon" />
          <span>
            <strong>
              {needsAttention.length} scheduled window{needsAttention.length === 1 ? '' : 's'} did not
              run as booked.
            </strong>{' '}
            <button type="button" className="btn btn--sm" onClick={() => onNavigate('schedule')}>
              Open scheduling
            </button>
          </span>
        </div>
      )}

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Icon name="calendar" size={15} />
            Coming up
          </h2>
          <button type="button" className="btn btn--sm" onClick={() => onNavigate('schedule')}>
            All schedules
            <Icon name="arrowRight" size={13} />
          </button>
        </div>

        {upcoming.length === 0 ? (
          <p className="empty">
            Nothing is scheduled. Open a config, load its sheet, and press <strong>Schedule it</strong>{' '}
            instead of Publish to book a window.
          </p>
        ) : (
          <ul className="timeline">
            {upcoming.slice(0, 6).map((entry) => (
              <li key={entry.id} className={`timeline__row timeline__row--${entry.state}`}>
                <span className="timeline__marker" aria-hidden="true">
                  <Icon name={entry.state === 'active' ? 'dot' : 'clock'} size={12} />
                </span>
                <span className="timeline__body">
                  <span className="timeline__title">
                    {entry.label === '' ? DOMAIN_LABELS[entry.domain] : entry.label}
                    <span className={`chip chip--${STATE_TONES[entry.state]}`}>{STATE_LABELS[entry.state]}</span>
                  </span>
                  <span className="timeline__meta">
                    {DOMAIN_LABELS[entry.domain]} - {entry.environmentName ?? environmentName(entry.environmentId)}
                    {' - '}
                    {entry.state === 'active'
                      ? entry.endsAt === null
                        ? 'up until something replaces it'
                        : `down ${relativeTime(entry.endsInMs ?? 0)}, ${localTime(entry.endsAt)}`
                      : `${relativeTime(entry.startsInMs)}, ${localTime(entry.startsAt)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Icon name="activity" size={15} />
            Every config
          </h2>
          <button type="button" className="btn btn--sm" onClick={() => void load()} disabled={loading}>
            {loading ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={13} />}
            Refresh
          </button>
        </div>

        {valuesError !== null && (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" size={15} className="banner__icon" />
            <span>{valuesError}</span>
          </p>
        )}

        <div className="cardgrid">
          {EXPORTER_DOMAINS.map((domain) => {
            const setting = settingFor(domain);
            const domainDrift = driftFor(domain);
            const active = activeByDomain.get(domain);
            const next = nextByDomain.get(domain);
            const hasDefault = schedule?.defaults?.[domain]?.present === true;

            return (
              <button
                key={domain}
                type="button"
                className="configcard"
                onClick={() => onNavigate(VIEW_FOR_DOMAIN[domain])}
              >
                <span className="configcard__head">
                  <span className={`configcard__badge page__badge--${domain.toLowerCase()}`} aria-hidden="true">
                    <Icon name={ICON_FOR_DOMAIN[domain]} size={15} />
                  </span>
                  <span className="configcard__name">{DOMAIN_LABELS[domain]}</span>
                  {active !== undefined && <span className="chip chip--ok">Window live</span>}
                </span>

                <span className="configcard__stats">
                  <span className="configcard__stat">
                    <span className="configcard__value">{bytes(setting?.bytes)}</span>
                    <span className="configcard__key">in {environmentName(live.environmentId).replace(' Environment', '')}</span>
                  </span>
                  {other !== null && (
                    <span className="configcard__stat">
                      <span className="configcard__value">
                        {domainDrift === null
                          ? '-'
                          : domainDrift.status === 'same'
                            ? 'matches'
                            : domainDrift.status === 'different'
                              ? `${domainDrift.summary?.total ?? 0} apart`
                              : domainDrift.status.replace('only-in-', 'only in ')}
                      </span>
                      <span className="configcard__key">vs {other.name.replace(' Environment', '')}</span>
                    </span>
                  )}
                </span>

                <span className="configcard__foot">
                  {setting?.parseError !== null && setting?.parseError !== undefined ? (
                    <span className="configcard__flag configcard__flag--danger">
                      <Icon name="alert" size={12} /> the live value does not parse
                    </span>
                  ) : next !== undefined ? (
                    <span className="configcard__flag configcard__flag--info">
                      <Icon name="clock" size={12} /> next window {relativeTime(next.startsInMs)}
                    </span>
                  ) : hasDefault ? (
                    <span className="configcard__flag">
                      <Icon name="shield" size={12} /> default recorded
                    </span>
                  ) : (
                    <span className="configcard__flag configcard__flag--muted">
                      <Icon name="shield" size={12} /> no default recorded
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
