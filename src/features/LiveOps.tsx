import { useCallback, useState } from 'react';
import { EventBoard } from '../components/EventBoard';
import { Icon } from '../components/Icon';
import { LiveOpsDialog } from '../components/LiveOpsDialog';
import { LiveOpsGantt } from '../components/LiveOpsGantt';
import { Segmented } from '../components/Segmented';
import type { View } from '../components/AppShell';
import { ENVIRONMENTS, liveEnvironment } from '../domains/account';
import { DOMAIN_LABELS } from '../domains/types';
import { useLiveOpsBoard, type LiveOpsBoard } from '../hooks/useLiveOpsBoard';
import {
  CALENDAR_RANGES,
  CATEGORY_COLOURS,
  CATEGORY_LABELS,
  LIVEOPS_DOMAINS,
  UNBOOKED_COLOUR,
  calendarWindow,
  isInGame,
  type BoardEvent,
  type CalendarRange,
} from '../lib/liveops';
import { relativeTime } from '../lib/schedule';

type Mode = 'table' | 'calendar';

/** What the arrows step by, in words, for their accessible names. */
const RANGE_UNITS: Record<CalendarRange, string> = {
  day: 'day',
  week: 'week',
  '6w': 'six weeks',
  '3m': 'three months',
  '6m': 'six months',
};

/** "Tue, 15 Sep 2026" for a day, "14 – 20 Sep 2026" for anything longer. */
function windowLabel(range: CalendarRange, from: number, to: number): string {
  const format = new Intl.DateTimeFormat(undefined, {
    weekday: range === 'day' ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  // The window ends on the midnight after its last day, which is not a day it shows.
  return range === 'day' ? format.format(from) : format.formatRange(from, to - 1);
}

/**
 * The live ops calendar.
 *
 * Everything that is only sometimes in the game, in one place: every event
 * ConfigCat is serving right now - booked here, published from its own page,
 * evergreen, or pasted into the dashboard by hand - and every event booked to
 * come. Two views of that one list, because the same events answer two
 * questions: the table is "what exactly is this and is it right", the calendar
 * is "what runs when, and does anything collide".
 *
 * Whatever is running can be taken down from here the moment somebody sees a
 * problem, without waiting for its end and without opening ConfigCat.
 */
export function LiveOps({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [mode, setMode] = useState<Mode>('calendar');
  const [range, setRange] = useState<CalendarRange>('week');
  // Whole ranges away from the one holding today: -1 is last week on a week.
  const [page, setPage] = useState(0);
  const [environmentId, setEnvironmentId] = useState((liveEnvironment() ?? ENVIRONMENTS[0]).environmentId);
  const board = useLiveOpsBoard(environmentId);
  const { view, events, now, loading } = board;

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // One dialog, two jobs: `composing` books a new event, `editing` holds the
  // one a row or a bar opened.
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<BoardEvent | null>(null);

  const open = (event: BoardEvent) => {
    setSelectedKey(event.key);
    setEditing(event);
  };

  const live = events.filter(isInGame).length;
  const upcoming = events.filter((event) => event.phase === 'scheduled').length;

  const { from, to } = calendarWindow(range, now, page);
  // Functional, because a thumb wheel can turn two pages before React renders once.
  const turnPage = useCallback((step: -1 | 1) => setPage((current) => current + step), []);

  /** Features that need an off state and have none cannot book an ending event. */
  const notReady = LIVEOPS_DOMAINS.filter(
    (domain) => view !== null && view.unavailable === undefined && view.off?.[domain]?.present !== true,
  );
  const booked = events.some((event) => event.entry !== null && event.phase !== 'ended' && event.phase !== 'off');

  return (
    <section className="stack-md">
      <header className="page__head">
        <div>
          <h1 className="page__title">
            Live ops calendar
            <span className="page__badge page__badge--schedule" aria-hidden="true">
              <Icon name="calendar" size={16} />
            </span>
          </h1>
          <p className="page__lead">
            Every event that is running or booked: battle pass seasons and rolling offers, whether they were booked
            here, published from their own page, or are evergreen. Book, change or end any of them from here or from the
            feature&rsquo;s page.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setComposing(true)}>
          <Icon name="plus" size={14} /> New event
        </button>
      </header>

      <div className="toolbar toolbar--board">
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
          <>
            <Segmented
              label="Range"
              value={range}
              onChange={(next) => {
                setRange(next);
                setPage(0);
              }}
              options={(Object.keys(CALENDAR_RANGES) as CalendarRange[]).map((key) => ({
                value: key,
                label: CALENDAR_RANGES[key].label,
              }))}
            />
            <div className="pager" role="group" aria-label="Move the calendar">
              <button
                type="button"
                className="btn btn--sm pager__step"
                onClick={() => setPage(page - 1)}
                aria-label={`Previous ${RANGE_UNITS[range]}`}
                title={`Previous ${RANGE_UNITS[range]} - or scroll sideways on the calendar`}
              >
                <Icon name="chevron" size={14} className="pager__icon pager__icon--back" />
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setPage(0)} disabled={page === 0}>
                Today
              </button>
              <button
                type="button"
                className="btn btn--sm pager__step"
                onClick={() => setPage(page + 1)}
                aria-label={`Next ${RANGE_UNITS[range]}`}
                title={`Next ${RANGE_UNITS[range]} - or scroll sideways on the calendar`}
              >
                <Icon name="chevron" size={14} className="pager__icon pager__icon--forward" />
              </button>
              <span className="pager__label" aria-live="polite">
                {windowLabel(range, from, to)}
              </span>
            </div>
          </>
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
        <button type="button" className="btn btn--sm" onClick={() => void board.reload()} disabled={loading}>
          {loading ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={13} />}
          Refresh
        </button>

        {/* The two numbers a live ops board is opened to check. */}
        <div className="tally" aria-live="polite">
          <span className="tally__item">
            <span className="tally__dot tally__dot--live" aria-hidden="true" />
            {live} in game
          </span>
          <span className="tally__item">
            <span className="tally__dot tally__dot--soon" aria-hidden="true" />
            {upcoming} upcoming
          </span>
        </div>
      </div>

      <BoardBanners board={board} booked={booked} />

      {notReady.length > 0 && (
        <p className="banner banner--warn">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>
            {notReady.map((domain) => DOMAIN_LABELS[domain]).join(', ')} has no off state recorded, so an event could go
            up but never come down. Record it in the booking form.
          </span>
        </p>
      )}

      {loading && view === null ? (
        <p className="field__note">
          <span className="spinner" aria-hidden="true" /> Reading the calendar and what is live...
        </p>
      ) : mode === 'calendar' ? (
        <>
          <LiveOpsGantt
            events={events}
            from={from}
            to={to}
            now={now}
            selectedKey={selectedKey}
            busyKey={board.busyKey}
            onOpen={open}
            onAct={(event, action) => void board.act(event, action)}
            onPage={turnPage}
          />
          <Legend />
        </>
      ) : (
        <EventBoard
          events={events}
          now={now}
          busyKey={board.busyKey}
          selectedKey={selectedKey}
          onOpen={open}
          onAct={(event, action) => void board.act(event, action)}
          onNavigate={onNavigate}
          empty="Nothing is running or booked. An event is a battle pass season or a rolling offer."
        />
      )}

      {(composing || editing !== null) && (
        <LiveOpsDialog
          environmentId={environmentId}
          event={editing}
          takenIds={events.flatMap((candidate) => (candidate.subjectId === null ? [] : [candidate.subjectId]))}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
          onDone={() => {
            setComposing(false);
            setEditing(null);
            void board.reload();
          }}
        />
      )}
    </section>
  );
}

/**
 * What a board cannot show on its own: why part of it may be missing, what just
 * happened, and whether the heartbeat that runs bookings is arriving.
 */
export function BoardBanners({ board, booked }: { board: LiveOpsBoard; booked: boolean }) {
  const { view, error, liveError, notice } = board;
  return (
    <>
      {notice !== null && (
        <p className="banner banner--ok">
          <Icon name="check" size={14} className="banner__icon" />
          <span>{notice}</span>
        </p>
      )}

      {error !== null && (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>{error}</span>
        </p>
      )}

      {liveError !== null && (
        <p className="banner banner--warn">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>
            ConfigCat could not be read, so only booked events are shown - anything published directly is missing from
            this view. {liveError}
          </span>
        </p>
      )}

      {view?.unavailable !== undefined && (
        <p className="banner banner--warn">
          <Icon name="alert" size={14} className="banner__icon" />
          <span>
            Bookings are unavailable: {view.unavailable} What is live is still shown, and can still be ended.
          </span>
        </p>
      )}

      {view !== null && view.unavailable === undefined && view.heartbeatStale && (
        <div className={booked ? 'banner banner--error' : 'banner banner--warn'} role="alert">
          <Icon name="alert" size={15} className="banner__icon" />
          <span>
            <strong>The heartbeat is not arriving.</strong>{' '}
            {view.lastTickAt === null
              ? 'The scheduler has never run.'
              : `Last beat ${relativeTime(Date.parse(view.lastTickAt) - Date.now())}.`}{' '}
            {booked
              ? 'Booked events will not open or close until it does. Publishing now and ending now still work.'
              : 'Nothing is booked, so nothing is being missed yet.'}{' '}
            It is an external pinger calling <span className="mono">POST /api/schedule/tick</span> every five minutes
            with the <span className="mono">CRON_SECRET</span> as a bearer token. Check the job is still{' '}
            <strong>enabled</strong> - pingers switch a job off after a run of failures - then open the endpoint, which
            says exactly why a tick was refused.
          </span>
        </div>
      )}
    </>
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
        <span
          className="legend__swatch legend__swatch--unbooked"
          style={{ backgroundColor: UNBOOKED_COLOUR }}
          aria-hidden="true"
        />
        Published directly, not booked
      </li>
      <li>
        <span className="legend__swatch legend__swatch--preview" aria-hidden="true" />
        Config live, event not open yet
      </li>
    </ul>
  );
}
