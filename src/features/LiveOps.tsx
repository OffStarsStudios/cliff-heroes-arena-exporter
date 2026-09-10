import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { LiveOpsDialog } from '../components/LiveOpsDialog';
import { LiveOpsGantt } from '../components/LiveOpsGantt';
import { Segmented } from '../components/Segmented';
import type { View } from '../components/AppShell';
import { ENVIRONMENTS, liveEnvironment } from '../domains/account';
import { DOMAIN_LABELS, type DomainId } from '../domains/types';
import {
  CATEGORY_COLOURS,
  CATEGORY_LABELS,
  FEATURE_SOURCE,
  LIVEOPS_DOMAINS,
  PHASE_LABELS,
  PHASE_TONES,
  durationLabel,
  isLiveOpsEntry,
  phaseOf,
  previewHoursOf,
  type EventPhase,
  type LiveOpsEntry,
} from '../lib/liveops';
import { cancelWindow, fetchSchedule, localTime, relativeTime, type ScheduleView } from '../lib/schedule';

type Mode = 'table' | 'calendar';

/** How far the calendar looks, in days either side of today. */
const RANGES = {
  '6w': { label: '6 weeks', back: 7, forward: 35 },
  '3m': { label: '3 months', back: 14, forward: 76 },
  '6m': { label: '6 months', back: 30, forward: 150 },
} as const;

type RangeKey = keyof typeof RANGES;

const DAY_MS = 86400000;

/**
 * The live ops calendar.
 *
 * Two views of one list, because the same events answer two different
 * questions. The table answers "what exactly is this event and is it right" -
 * the configuring view. The calendar answers "what is running when, and does
 * anything collide" - the view you look at before you book something.
 *
 * Both read the scheduler's own entries rather than a second store. An event
 * *is* a scheduling window; it just knows what kind of thing it is, and what
 * should happen to the feature when it is over.
 */
export function LiveOps({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [mode, setMode] = useState<Mode>('calendar');
  const [range, setRange] = useState<RangeKey>('3m');
  const [view, setView] = useState<ScheduleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const environment = liveEnvironment() ?? ENVIRONMENTS[0];
  const [environmentId, setEnvironmentId] = useState(environment.environmentId);

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

  const now = view === null ? Date.now() : Date.parse(view.now);

  const events = useMemo<LiveOpsEntry[]>(() => {
    if (view === null) return [];
    return view.entries
      .filter(isLiveOpsEntry)
      .filter((entry) => entry.environmentId === environmentId)
      .sort((a, b) => Date.parse(a.liveops.opensAt) - Date.parse(b.liveops.opensAt));
  }, [view, environmentId]);

  const { back, forward } = RANGES[range];
  const from = now - back * DAY_MS;
  const to = now + forward * DAY_MS;

  const cancel = async (entry: LiveOpsEntry) => {
    const phase = phaseOf(entry, now);
    const question =
      phase === 'active' || phase === 'ending' || phase === 'preview'
        ? `End "${entry.label}" now? ${DOMAIN_LABELS[entry.domain]} is taken out of the game immediately.`
        : `Cancel "${entry.label}"? It has not started, so nothing is published.`;
    if (!window.confirm(question)) return;
    setBusyId(entry.id);
    try {
      await cancelWindow(entry.id, 'Cancelled from the live ops calendar.');
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  /** Features with no off state cannot be scheduled at all, so say it up front. */
  const notReady = (LIVEOPS_DOMAINS as readonly DomainId[]).filter(
    (domain) => view !== null && view.off?.[domain]?.present !== true,
  );

  return (
    <section className="page stack-md">
      <header className="page__head">
        <div>
          <h1 className="page__title">
            Live ops calendar
            <span className="page__badge page__badge--schedule" aria-hidden="true">
              <Icon name="calendar" size={16} />
            </span>
          </h1>
          <p className="page__lead">
            Features that are not always in the game. An event publishes its config when it opens and removes the
            feature when it ends - unlike{' '}
            <button type="button" className="linklike" onClick={() => onNavigate('schedule')}>scheduling</button>, which
            goes back to a previous version.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setComposing(true)}>
          <Icon name="plus" size={14} /> Schedule an event
        </button>
      </header>

      <div className="toolbar">
        <Segmented
          label="View"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'calendar', label: 'Calendar' },
            { value: 'table', label: 'Events' },
          ]}
        />
        {mode === 'calendar' && (
          <Segmented
            label="Range"
            value={range}
            onChange={setRange}
            options={(Object.keys(RANGES) as RangeKey[]).map((key) => ({ value: key, label: RANGES[key].label }))}
          />
        )}
        <label className="field field--inline">
          <span className="field__label">Environment</span>
          <select value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
            {ENVIRONMENTS.map((candidate) => (
              <option key={candidate.environmentId} value={candidate.environmentId}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {view?.unavailable !== undefined && (
        <p className="banner banner--warn">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>{view.unavailable}</span>
        </p>
      )}

      {error !== null && (
        <p className="banner banner--error">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>{error}</span>
        </p>
      )}

      {notReady.length > 0 && view?.unavailable === undefined && (
        <p className="banner banner--warn">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>
            {notReady.map((domain) => DOMAIN_LABELS[domain]).join(', ')} has no off state recorded - an event could go
            up but never come down. Record it in the booking form.
          </span>
        </p>
      )}

      {loading ? (
        <p className="field__note">
          <span className="spinner" aria-hidden="true" /> Reading the calendar...
        </p>
      ) : mode === 'calendar' ? (
        <>
          <LiveOpsGantt
            events={events}
            from={from}
            to={to}
            now={now}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <Legend />
        </>
      ) : (
        <EventTable events={events} now={now} busyId={busyId} onCancel={cancel} onNavigate={onNavigate} />
      )}

      {composing && (
        <LiveOpsDialog
          environmentId={environmentId}
          onClose={() => setComposing(false)}
          onScheduled={() => {
            setComposing(false);
            void load();
          }}
        />
      )}
    </section>
  );
}

function Legend() {
  return (
    <ul className="legend">
      {(Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).map((category) => (
        <li key={category}>
          <span className="legend__swatch" style={{ background: CATEGORY_COLOURS[category] }} aria-hidden="true" />
          {CATEGORY_LABELS[category]}
        </li>
      ))}
      <li>
        <span className="legend__swatch legend__swatch--preview" aria-hidden="true" />
        Config live, event not open yet
      </li>
    </ul>
  );
}

function EventTable({
  events,
  now,
  busyId,
  onCancel,
  onNavigate,
}: {
  events: LiveOpsEntry[];
  now: number;
  busyId: string | null;
  onCancel: (entry: LiveOpsEntry) => void;
  onNavigate: (view: View) => void;
}) {
  if (events.length === 0) {
    return (
      <p className="empty">
        Nothing is scheduled. An event is a battle pass season, a rolling offer, a limited-time feature.
      </p>
    );
  }

  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Feature</th>
            <th scope="col">Category</th>
            <th scope="col">Opens</th>
            <th scope="col">Ends</th>
            <th scope="col">Runs for</th>
            <th scope="col">Phase</th>
            <th scope="col">Config</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {events.map((entry) => {
            const phase: EventPhase = phaseOf(entry, now);
            const open = phase === 'scheduled' || phase === 'preview' || phase === 'active' || phase === 'ending';
            return (
              <tr key={entry.id}>
                <td>
                  <span className="table__strong">{entry.label === '' ? DOMAIN_LABELS[entry.domain] : entry.label}</span>
                  {entry.note !== null && entry.note !== '' && <span className="table__sub">{entry.note}</span>}
                </td>
                <td>
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => onNavigate(FEATURE_SOURCE[entry.domain as keyof typeof FEATURE_SOURCE] as View)}
                  >
                    {DOMAIN_LABELS[entry.domain]}
                  </button>
                </td>
                <td>
                  <span
                    className="tag"
                    style={{ ['--tag-colour' as string]: CATEGORY_COLOURS[entry.liveops.category] }}
                  >
                    {CATEGORY_LABELS[entry.liveops.category]}
                  </span>
                </td>
                <td>
                  {localTime(entry.liveops.opensAt)}
                  {/* Only events booked while the preview box existed have one. */}
                  {previewHoursOf(entry.liveops) > 0 && (
                    <span className="table__sub">config published {previewHoursOf(entry.liveops)}h earlier</span>
                  )}
                </td>
                <td>
                  {localTime(entry.endsAt)}
                  {phase === 'active' || phase === 'ending' ? (
                    <span className="table__sub">
                      {entry.endsInMs === null ? '' : relativeTime(entry.endsInMs)}
                    </span>
                  ) : null}
                </td>
                <td>{durationLabel(entry.liveops.opensAt, entry.endsAt)}</td>
                <td>
                  <span className={`chip chip--${PHASE_TONES[phase]}`}>{PHASE_LABELS[phase]}</span>
                </td>
                <td className="mono">
                  {(entry.payloadBytes / 1024).toFixed(1)} kB
                  {/* Provenance, not a live link: the payload was snapshotted
                      when the event was booked. */}
                  {typeof entry.liveops.sourceUrl === 'string' && entry.liveops.sourceUrl !== '' && (
                    <span className="table__sub">
                      <a href={entry.liveops.sourceUrl} target="_blank" rel="noreferrer">
                        from the sheet
                      </a>
                    </span>
                  )}
                </td>
                <td>
                  {open && (
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      onClick={() => onCancel(entry)}
                      disabled={busyId === entry.id}
                    >
                      {phase === 'scheduled' ? 'Cancel' : 'End it now'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
