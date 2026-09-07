import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import type { View } from '../components/AppShell';
import { ACCOUNT, ENVIRONMENTS, environmentName, liveEnvironment } from '../domains/account';
import { DOMAIN_LABELS, EXPORTER_DOMAINS, SETTING_KEYS, type DomainId } from '../domains/types';
import { fetchValues } from '../lib/liveConfig';
import {
  STATE_LABELS,
  STATE_TONES,
  cancelWindow,
  fetchSchedule,
  localTime,
  previewWindow,
  relativeTime,
  saveDefault,
  type ScheduleEntry,
  type ScheduleView,
  type SchedulePreview,
} from '../lib/schedule';

const OPEN_STATES = new Set(['scheduled', 'active']);

/** Where each config is edited, so a window can be traced back to its sheet. */
const VIEW_FOR_DOMAIN: Partial<Record<DomainId, View>> = {
  trophyRoad: 'arena',
  heroes: 'heroes',
  arenas: 'arenas',
  matchTrophy: 'matchTrophy',
  bots: 'bots',
  heroUpgrade: 'heroUpgrade',
  shop: 'shop',
  battlePass: 'battlePass',
};

function WindowRow({
  entry,
  onCancel,
  busy,
}: {
  entry: ScheduleEntry;
  onCancel: (entry: ScheduleEntry) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const expand = async () => {
    const next = !open;
    setOpen(next);
    if (!next || preview !== null) return;
    try {
      setPreview(await previewWindow(entry.id));
    } catch (error) {
      setPreviewError((error as Error).message);
    }
  };

  const cancellable = OPEN_STATES.has(entry.state);

  return (
    <li className={`window window--${entry.state}`}>
      <div className="window__head">
        <button type="button" className="window__expand" aria-expanded={open} onClick={() => void expand()}>
          <Icon name="chevron" size={14} className={open ? 'mapping__chevron mapping__chevron--open' : 'mapping__chevron'} />
          <span className="window__name">{entry.label === '' ? DOMAIN_LABELS[entry.domain] : entry.label}</span>
          <span className={`chip chip--${STATE_TONES[entry.state]}`}>{STATE_LABELS[entry.state]}</span>
        </button>

        {cancellable && (
          <button type="button" className="btn btn--sm btn--danger" onClick={() => onCancel(entry)} disabled={busy}>
            <Icon name="stop" size={13} />
            {entry.state === 'active' ? 'Take it down now' : 'Cancel'}
          </button>
        )}
      </div>

      <div className="window__meta">
        <span>
          <Icon name="table" size={12} /> {DOMAIN_LABELS[entry.domain]}
        </span>
        <span>
          <Icon name="link" size={12} /> {entry.environmentName ?? environmentName(entry.environmentId)}
        </span>
        <span>
          <Icon name="play" size={12} /> {localTime(entry.startsAt)}
          {entry.state === 'scheduled' && ` (${relativeTime(entry.startsInMs)})`}
        </span>
        <span>
          <Icon name="stop" size={12} />{' '}
          {entry.endsAt === null ? 'no end - stays until replaced' : localTime(entry.endsAt)}
          {entry.state === 'active' && entry.endsInMs !== null && ` (${relativeTime(entry.endsInMs)})`}
        </span>
        <span className="mono">{(entry.payloadBytes / 1024).toFixed(1)} kB</span>
        {entry.attempts > 0 && entry.state !== 'failed' && (
          <span className="window__retry">
            <Icon name="refresh" size={12} /> retrying, {entry.attempts} attempt
            {entry.attempts === 1 ? '' : 's'} so far
          </span>
        )}
      </div>

      {open && (
        <div className="window__body stack-sm">
          {entry.note !== null && entry.note !== '' && <p className="field__note">{entry.note}</p>}

          <div>
            <p className="step__section-title">What it would change if it ran now</p>
            {previewError !== null ? (
              <p className="banner banner--warn">
                <Icon name="alert" size={14} className="banner__icon" />
                <span>{previewError}</span>
              </p>
            ) : preview === null ? (
              <p className="field__note">
                <span className="spinner" aria-hidden="true" /> Comparing against the live value...
              </p>
            ) : preview.summary.total === 0 ? (
              <p className="field__note">Nothing - the live value already matches this window's payload.</p>
            ) : (
              <ul className="difflist__items">
                {preview.changes.slice(0, 12).map((change, index) => (
                  <li key={`${change.path}-${index}`} className={`difflist__item difflist__item--${change.kind}`}>
                    <span className="difflist__kind">{change.kind}</span>
                    <span className="difflist__text mono">{change.description}</span>
                  </li>
                ))}
                {preview.summary.total > 12 && (
                  <li className="field__note">and {preview.summary.total - 12} more.</li>
                )}
              </ul>
            )}
          </div>

          {entry.history.length > 0 && (
            <div>
              <p className="step__section-title">History</p>
              <ul className="param-list">
                {entry.history.map((line, index) => (
                  <li key={`${line.at}-${index}`} className={line.ok ? 'param' : 'param param--danger'}>
                    <span className="mono">{localTime(line.at)}</span> {line.action}
                    {line.message !== null && ` - ${line.message}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Everything the scheduler is holding, and the two things that make it
 * trustworthy: the fallback recorded for each config, and proof that the
 * heartbeat is arriving.
 *
 * Windows are created from an exporter page, where the payload and its diff
 * are already on screen. There is deliberately no "create" form here, because
 * a window created without looking at what it publishes is exactly the mistake
 * the console exists to prevent.
 */
export function Schedule({ onNavigate }: { onNavigate: (view: View) => void }) {
  const live = liveEnvironment() ?? ENVIRONMENTS[0];
  const [view, setView] = useState<ScheduleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<DomainId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setView(await fetchSchedule());
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (entry: ScheduleEntry) => {
    const live = entry.state === 'active';
    const message = live
      ? `Take "${entry.label || entry.id}" down now? ${DOMAIN_LABELS[entry.domain]} goes back to its default immediately.`
      : `Cancel "${entry.label || entry.id}"? It will not run.`;
    if (!window.confirm(message)) return;

    setBusyId(entry.id);
    setNotice(null);
    try {
      await cancelWindow(entry.id, 'Cancelled from the scheduling page.');
      setNotice(live ? `${DOMAIN_LABELS[entry.domain]} is back on its default.` : 'That window was cancelled.');
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const captureDefault = async (domain: DomainId) => {
    setCapturing(domain);
    setNotice(null);
    try {
      const values = await fetchValues(ACCOUNT.configId, live.environmentId);
      const setting = values.settings.find((candidate) => candidate.key === SETTING_KEYS[domain]);
      if (setting === undefined || setting.json === null) {
        throw new Error(`${SETTING_KEYS[domain]} could not be read from ${environmentName(live.environmentId)}.`);
      }
      await saveDefault(domain, setting.json, `Captured from ${environmentName(live.environmentId)}.`);
      setNotice(`${DOMAIN_LABELS[domain]} now has a default to fall back to.`);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setCapturing(null);
    }
  };

  const entries = view?.entries ?? [];
  const open = entries
    .filter((entry) => OPEN_STATES.has(entry.state))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const closed = entries
    .filter((entry) => !OPEN_STATES.has(entry.state))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const problems = closed.filter((entry) => entry.state === 'failed' || entry.state === 'missed');

  return (
    <>
      <header className="page__head">
        <h1 className="page__title">
          <span className="page__badge page__badge--schedule" aria-hidden="true">
            <Icon name="calendar" size={17} />
          </span>
          Scheduling
        </h1>
        <p className="page__lead">
          Windows the back office opens and closes on its own. A window is booked from a config page,
          where its diff is already on screen - so nothing is ever scheduled sight unseen.
        </p>
      </header>

      {error !== null && (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" size={15} className="banner__icon" />
          <span>{error}</span>
        </p>
      )}

      {notice !== null && (
        <p className="banner banner--ok">
          <Icon name="check" size={15} className="banner__icon" />
          <span>{notice}</span>
        </p>
      )}

      {view?.unavailable !== undefined && (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" size={15} className="banner__icon" />
          <span>
            <strong>Scheduling is not available.</strong> {view.unavailable}
          </span>
        </div>
      )}

      {view !== null && view.unavailable === undefined && view.heartbeatStale && (
        <div className={open.length > 0 ? 'banner banner--error' : 'banner banner--warn'} role="alert">
          <Icon name="alert" size={15} className="banner__icon" />
          <span>
            <strong>The heartbeat is not arriving.</strong>{' '}
            {view.lastTickAt === null
              ? 'The scheduler has never run.'
              : `Last beat ${relativeTime(Date.parse(view.lastTickAt) - Date.now())}.`}{' '}
            {open.length > 0
              ? `${open.length} window${open.length === 1 ? '' : 's'} will not open or close until it does.`
              : 'Nothing is booked, so nothing is being missed yet.'}{' '}
            The heartbeat is the <span className="mono">Scheduler heartbeat</span> workflow in this
            repository's GitHub Actions; it needs <span className="mono">BACK_OFFICE_URL</span> set as
            an Actions secret. Vercel's own daily cron is only a backstop.
          </span>
        </div>
      )}

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Icon name="clock" size={15} />
            Open and booked ({open.length})
          </h2>
          <button type="button" className="btn btn--sm" onClick={() => void load()} disabled={loading}>
            {loading ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={13} />}
            Refresh
          </button>
        </div>

        {open.length === 0 ? (
          <p className="empty">
            Nothing is booked. Open a config, load its sheet, and press <strong>Schedule it</strong>{' '}
            instead of Publish.
          </p>
        ) : (
          <ul className="windows">
            {open.map((entry) => (
              <WindowRow key={entry.id} entry={entry} onCancel={(target) => void cancel(target)} busy={busyId === entry.id} />
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Icon name="shield" size={15} />
            Fallbacks
          </h2>
        </div>
        <p className="field__note" style={{ marginBottom: 12 }}>
          What each config returns to when a window ends and nothing else is due. A window with an end
          time cannot be booked until its config has one, because taking a config away from a running
          game with nothing to replace it is not a state the game can be in.
        </p>

        <div className="defaults">
          {EXPORTER_DOMAINS.map((domain) => {
            const status = view?.defaults?.[domain];
            const present = status?.present === true;
            return (
              <div key={domain} className={present ? 'defaults__row' : 'defaults__row defaults__row--missing'}>
                <span className="defaults__name">
                  <Icon name={present ? 'shield' : 'alert'} size={14} />
                  {DOMAIN_LABELS[domain]}
                </span>
                <span className="defaults__state">
                  {present ? (
                    <>
                      recorded <span className="mono">{status?.hash}</span>
                    </>
                  ) : (
                    'none recorded'
                  )}
                </span>
                <span className="defaults__actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void captureDefault(domain)}
                    disabled={capturing === domain}
                  >
                    {capturing === domain ? <span className="spinner" aria-hidden="true" /> : <Icon name="download" size={13} />}
                    {present ? 'Replace with the live value' : 'Use the live value'}
                  </button>
                  {VIEW_FOR_DOMAIN[domain] !== undefined && (
                    <button type="button" className="btn btn--sm" onClick={() => onNavigate(VIEW_FOR_DOMAIN[domain] as View)}>
                      Open
                      <Icon name="arrowRight" size={13} />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {closed.length > 0 && (
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">
              <Icon name="history" size={15} />
              Finished ({closed.length})
              {problems.length > 0 && <span className="chip chip--danger">{problems.length} did not run</span>}
            </h2>
          </div>
          <ul className="windows">
            {closed.slice(0, 25).map((entry) => (
              <WindowRow key={entry.id} entry={entry} onCancel={() => {}} busy={false} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
