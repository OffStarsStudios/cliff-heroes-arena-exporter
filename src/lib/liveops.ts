import type { DomainId } from '../domains/types';
import type { ScheduleEntry } from './schedule';
import {
  ENDING_SOON_HOURS,
  LIVEOPS_DOMAINS,
  LIVEOPS_FEATURES,
  phaseOfWindow,
  type EventCategory,
  type LiveOpsDomain,
  type PayloadEvent,
  type Presentation,
} from '../../server/liveopsFeatures.mjs';

/**
 * The live ops calendar's vocabulary.
 *
 * The feature list and what each feature can say about its payload are not
 * written here: they are imported from `server/liveopsFeatures.mjs`, the same
 * file the scheduler runs, so the calendar and the heartbeat cannot disagree
 * about what an event is.
 *
 * The distinction this whole file turns on: a core config is always live and
 * ends by going back to its previous version; a live ops feature is only
 * sometimes live and ends by going away. Everything here - the phases, the
 * lanes, the fact that an end time is required - follows from that.
 */

/**
 * The features, and everything each can answer about its payload, come from
 * the one module the server runs as well - see `server/liveopsFeatures.mjs`.
 */
export {
  ENDING_SOON_HOURS,
  EVENT_CATEGORIES,
  LIVEOPS_DOMAINS,
  LIVEOPS_FEATURES,
  PRESENTATION_FIELDS,
  REASON_TEXT,
  RETIRE_AFTER_DAYS,
  baseOf,
  checkPresentation,
  emptyPresentation,
  featureFor,
  hasRunKey,
  mintRunId,
  phaseOfWindow,
  runIdFor,
} from '../../server/liveopsFeatures.mjs';
export type {
  EventCategory,
  LiveOpsDomain,
  LiveOpsFeature,
  PayloadEvent,
  Presentation,
  PresentationField,
} from '../../server/liveopsFeatures.mjs';

export function isLiveOpsDomain(domain: DomainId): domain is LiveOpsDomain {
  return (LIVEOPS_DOMAINS as readonly string[]).includes(domain);
}

/** Where each feature's payload is authored, so an event links back to its sheet. */
export const FEATURE_SOURCE: Record<LiveOpsDomain, string> = {
  battlePass: 'battlePass',
  rollingOffer: 'rollingOffer',
};

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  monetization: 'Monetisation',
  engagement: 'Engagement',
  seasonal: 'Seasonal',
  test: 'Test',
};

/**
 * One hue per category, used by both views.
 *
 * The calendar is read at a glance for one question - what kind of thing is
 * running this week - so the colour has to carry the category rather than the
 * state. State is carried by the fill: solid while it is live, hatched while
 * it is only scheduled.
 */
export const CATEGORY_COLOURS: Record<EventCategory, string> = {
  monetization: '#b45309',
  engagement: '#0f766e',
  seasonal: '#7c3aed',
  test: '#475569',
};

export interface LiveOpsBlock {
  category: EventCategory;
  /** When players see the event, and - with no preview - when its config goes up. */
  opensAt: string;
  /**
   * How long before it opens the config is published.
   *
   * No longer collected: an event's config now goes up when the event opens,
   * which is the one date a designer already has in their head. The field
   * stays optional so events booked while the box existed still draw their
   * preview slice on the calendar rather than silently changing shape.
   */
  previewHours?: number;
  /**
   * The Google Sheet the config was exported from, kept so the calendar can
   * link back to it. The payload itself is a snapshot taken when the event was
   * booked - the link is provenance, not a promise to re-read the sheet.
   */
  sourceUrl?: string | null;
  /**
   * The one entry inside the payload this event owns, where the payload is a
   * list the client takes whole - a rolling offer's `OfferID`.
   *
   * Recorded because ending such an event cannot restore an "off" payload: a
   * list has no off state, only a version of itself without one member. The
   * scheduler removes this entry from what is live instead. Absent for a
   * feature whose payload is wholly its own, like the battle pass.
   */
  subjectId?: string | null;
  /** The ID the sheet names, without the run key the booking added. Sent back by the server; never sent to it. */
  baseId?: string | null;
  /** What a booked offer shows players - its text and art - read back off the payload it will publish. */
  presentation?: Presentation | null;
}

/** Preview hours, for the entries old enough to have them. */
export function previewHoursOf(block: LiveOpsBlock): number {
  return block.previewHours ?? 0;
}

/** A schedule entry that was booked from the calendar. */
export type LiveOpsEntry = ScheduleEntry & { liveops: LiveOpsBlock };

export function isLiveOpsEntry(entry: ScheduleEntry): entry is LiveOpsEntry {
  return entry.liveops !== null && entry.liveops !== undefined;
}

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Where an event is in its life, which is not the same question as whether the
 * scheduler has done its job.
 *
 * `scheduled` - booked, nothing published yet.
 * `preview`   - the config is live but the event has not opened; the client
 *               can advertise it.
 * `active`    - running.
 * `ending`    - running, and inside its last day.
 * `ended`     - over, and the feature is out of the game again.
 * `off`       - cancelled or missed; it never happened.
 */
export type EventPhase = 'scheduled' | 'preview' | 'active' | 'ending' | 'ended' | 'off';

export const PHASE_LABELS: Record<EventPhase, string> = {
  scheduled: 'Scheduled',
  preview: 'In preview',
  active: 'Live',
  ending: 'Ending soon',
  ended: 'Ended',
  off: 'Never ran',
};

export const PHASE_TONES: Record<EventPhase, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  scheduled: 'info',
  preview: 'info',
  active: 'ok',
  ending: 'warn',
  ended: 'neutral',
  off: 'neutral',
};

export function phaseOf(entry: LiveOpsEntry, now: number): EventPhase {
  if (entry.state === 'cancelled' || entry.state === 'missed' || entry.state === 'superseded') return 'off';
  const opens = Date.parse(entry.liveops.opensAt);
  const ends = entry.endsAt === null ? Infinity : Date.parse(entry.endsAt);

  if (now >= ends) return 'ended';
  if (now < Date.parse(entry.startsAt)) return 'scheduled';
  if (now < opens) return 'preview';
  if (ends !== Infinity && ends - now <= ENDING_SOON_HOURS * HOUR_MS) return 'ending';
  return 'active';
}

/* ------------------------------------------------------------- the board -- */

/**
 * The colour of an event nobody booked - published from its page, or pasted
 * into ConfigCat by hand. It has no category because it never went through the
 * form that asks for one, and it should look different for exactly that reason.
 */
export const UNBOOKED_COLOUR = '#64748b';

/**
 * One row of the calendar: an event as the game sees it, joined to the booking
 * behind it when there is one.
 *
 * Two sources, because either alone lies. The schedule knows what was booked
 * but not what somebody published from a page or edited in ConfigCat. The live
 * payload knows what players get but not what is coming next week. So every
 * event live in ConfigCat is a row, matched to the booking that put it there;
 * and every booking not accounted for that way - still to come, finished, or
 * gone from ConfigCat under it - is a row of its own.
 */
export interface BoardEvent {
  /** Stable across reloads: the booking's id, or the feature and subject for an unbooked event. */
  key: string;
  domain: LiveOpsDomain;
  /** The season ID or offer ID this event is inside its payload. */
  subjectId: string | null;
  name: string;
  /** Null for an event that was never booked. */
  category: EventCategory | null;
  /** When it opens. Null for an evergreen event, which is open already. */
  startsAt: string | null;
  /** When it closes. Null for one that never does. */
  endsAt: string | null;
  phase: EventPhase;
  /** The booking behind it, when there is one. */
  entry: LiveOpsEntry | null;
  /** What ConfigCat is serving for it right now, when it is serving anything. */
  live: { event: PayloadEvent; part: Record<string, unknown> } | null;
  /**
   * A booking that should be live but is not in ConfigCat: somebody took it
   * out by hand. Only ever set when the live payload could actually be read.
   */
  missingLive: boolean;
}

/** An event with no window: always on, never ends. */
export function isEvergreen(event: BoardEvent): boolean {
  return event.live !== null && event.startsAt === null && event.endsAt === null;
}

/** In the game right now, or published and waiting for its own start. */
export function isInGame(event: BoardEvent): boolean {
  return event.live !== null && (event.phase === 'active' || event.phase === 'ending' || event.phase === 'preview');
}

/** Over, but still carried in the payload. Harmless to players; worth tidying. */
export function isLingering(event: BoardEvent): boolean {
  return event.live !== null && event.phase === 'ended';
}

/** A booking on its own, before anything is known about what is live. */
export function boardEventFromEntry(entry: LiveOpsEntry, now: number, missingLive = false): BoardEvent {
  const domain = entry.domain as LiveOpsDomain;
  return {
    key: entry.id,
    domain,
    subjectId: entry.liveops.subjectId ?? null,
    name: entry.label === '' ? (LIVEOPS_FEATURES[domain]?.label ?? entry.domain) : entry.label,
    category: entry.liveops.category,
    startsAt: entry.liveops.opensAt,
    endsAt: entry.endsAt,
    phase: phaseOf(entry, now),
    entry,
    live: null,
    missingLive,
  };
}

/** How far apart two ends may be and still be the same run - a season is rounded to whole days. */
const SAME_RUN_MS = 24 * HOUR_MS;

/**
 * Joins the schedule to what ConfigCat is serving, for one environment.
 *
 * `live` maps each feature to its payload. A feature missing from it is one
 * whose live value could not be read: its bookings are still shown, and none
 * of them is called missing on the strength of a read that failed.
 */
export function boardEvents({
  entries,
  live,
  environmentId,
  now,
}: {
  entries: ScheduleEntry[];
  live: Partial<Record<LiveOpsDomain, unknown>>;
  environmentId: string;
  now: number;
}): BoardEvent[] {
  const rows: BoardEvent[] = [];

  for (const domain of LIVEOPS_DOMAINS) {
    const feature = LIVEOPS_FEATURES[domain];
    const bookings = entries
      .filter(isLiveOpsEntry)
      .filter((entry) => entry.domain === domain && entry.environmentId === environmentId);
    const known = Object.prototype.hasOwnProperty.call(live, domain);
    const payload = known ? live[domain] : null;
    const claimed = new Set<string>();

    for (const event of known ? feature.eventsIn(payload) : []) {
      const bySubject = bookings.filter((entry) => entry.liveops.subjectId === event.subjectId);
      // The booking running it, or else the one that ran it - an offer that is
      // the last one listed stays listed after its booking finishes.
      const entry =
        bySubject.find((candidate) => candidate.state === 'active') ??
        bySubject
          .filter((candidate) => candidate.state === 'completed' && candidate.endsAt !== null && event.endsAt !== null)
          .filter(
            (candidate) =>
              Math.abs(Date.parse(candidate.endsAt as string) - Date.parse(event.endsAt as string)) <= SAME_RUN_MS,
          )
          .sort((x, y) => Date.parse(y.startsAt) - Date.parse(x.startsAt))[0] ??
        null;
      if (entry !== null) claimed.add(entry.id);

      const windowPhase = phaseOfWindow(event.startsAt, event.endsAt, now);
      rows.push({
        key: entry?.id ?? `live:${domain}:${event.subjectId}`,
        domain,
        subjectId: event.subjectId,
        name: entry !== null && entry.label !== '' ? entry.label : event.name,
        category: entry?.liveops.category ?? null,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        // Published but not open yet is the preview phase: the config is live,
        // the event is not.
        phase: windowPhase === 'scheduled' ? 'preview' : windowPhase,
        entry,
        live: { event, part: feature.partOf(payload, event.subjectId) ?? {} },
        missingLive: false,
      });
    }

    for (const entry of bookings) {
      if (claimed.has(entry.id)) continue;
      rows.push(boardEventFromEntry(entry, now, known && entry.state === 'active'));
    }
  }

  return rows.sort((a, b) => startOf(a) - startOf(b));
}

function startOf(event: BoardEvent): number {
  return event.startsAt === null ? -Infinity : Date.parse(event.startsAt);
}

/* ------------------------------------------------------------- the gantt -- */

export interface GanttBar {
  event: BoardEvent;
  /** Fractions of the chart width, 0..1, already clamped to the visible range. */
  left: number;
  width: number;
  /** Where the preview slice ends, as a fraction of the bar's own width. */
  previewFraction: number;
  /** True when the event runs past an edge, so the bar can be drawn open-ended. */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** Which row inside the lane, so two overlapping events never sit on top of each other. */
  row: number;
}

export interface GanttTick {
  at: number;
  left: number;
  /** Empty for a gridline with nothing written on the ruler. */
  label: string;
  major: boolean;
  /** False for a label with no gridline under it - a day's name, written across the middle of its day. */
  line: boolean;
}

/**
 * How much of the calendar is on screen, in whole local days before and after
 * today (today counts as the first day forward).
 *
 * A week is the default: it is what the calendar is opened to check - what is
 * on now and what is about to start. A day is for reading the hours an event
 * opens and closes on, which a range of weeks draws a pixel apart.
 */
export const CALENDAR_RANGES = {
  day: { label: 'Day', back: 0, forward: 1 },
  week: { label: 'Week', back: 1, forward: 6 },
  '6w': { label: '6 weeks', back: 7, forward: 35 },
  '3m': { label: '3 months', back: 14, forward: 76 },
  '6m': { label: '6 months', back: 30, forward: 150 },
} as const;

export type CalendarRange = keyof typeof CALENDAR_RANGES;

/**
 * The stretch of time a range shows, `page` whole ranges away from the one
 * holding today.
 *
 * Both edges sit on local midnight, and days are counted on the calendar rather
 * than as 24-hour blocks, so a clock change never leaves the day view an hour
 * short or every gridline after it an hour out.
 */
export function calendarWindow(range: CalendarRange, now: number, page = 0): { from: number; to: number } {
  const { back, forward } = CALENDAR_RANGES[range];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - back + page * (back + forward));
  const end = new Date(start);
  end.setDate(end.getDate() + back + forward);
  return { from: start.getTime(), to: end.getTime() };
}

/** Ranges this short are read in hours, and draw each event's times on its bar. */
export function isHourScale(from: number, to: number): boolean {
  return to - from <= 10 * DAY_MS;
}

/**
 * Lays events out against a time range.
 *
 * Kept out of the component and free of DOM so the arithmetic that decides
 * where a bar sits can be tested directly - an off-by-one here is a promotion
 * drawn in the wrong week, which is exactly the mistake a calendar exists to
 * prevent. An evergreen event runs off both edges, which is what it does.
 */
export function layOutBars(events: BoardEvent[], from: number, to: number): GanttBar[] {
  const span = Math.max(to - from, 1);
  // Rows are needed even though two bookings of one slot are refused: a
  // finished event and its replacement may overlap, offers run side by side,
  // and drawing them on top of each other would hide one entirely.
  const rowEnds: number[] = [];

  return events
    .slice()
    .sort((a, b) => startOf(a) - startOf(b))
    .map((event) => {
      const opens = startOf(event);
      // Entries booked with preview hours published their config early.
      const publishedFrom =
        event.entry !== null && event.live === null ? Math.min(Date.parse(event.entry.startsAt), opens) : opens;
      const ends = event.endsAt === null ? Infinity : Date.parse(event.endsAt);
      const visibleStart = Math.max(publishedFrom, from);
      const visibleEnd = Math.min(ends, to);
      if (visibleEnd <= visibleStart) return null;

      const width = (visibleEnd - visibleStart) / span;
      const previewEnd = Math.min(Math.max(opens, visibleStart), visibleEnd);

      // First row whose last bar has finished before this one starts.
      let row = rowEnds.findIndex((end) => end <= visibleStart);
      if (row === -1) row = rowEnds.length;
      rowEnds[row] = visibleEnd;

      return {
        event,
        left: (visibleStart - from) / span,
        width,
        previewFraction: (previewEnd - visibleStart) / (visibleEnd - visibleStart),
        clippedStart: publishedFrom < from,
        clippedEnd: ends > to,
        row,
      };
    })
    .filter((bar): bar is GanttBar => bar !== null);
}

/**
 * The ruler and gridlines for a range.
 *
 * Three scales, picked by how long the range is: hours for a day, days with
 * six-hour lines for a week, and dates for anything longer, with the first of
 * each month called out. A label sitting exactly on an edge is left off - half
 * of it would be cut away, and the range's own title already names that day.
 */
export function ticksFor(from: number, to: number): GanttTick[] {
  const span = Math.max(to - from, 1);
  const days = span / DAY_MS;
  const ticks = days <= 2 ? hourTicks(from, to) : isHourScale(from, to) ? weekTicks(from, to) : dateTicks(from, to);
  return ticks.map((tick) => ({ ...tick, left: (tick.at - from) / span, label: onEdge(tick, from, to) ? '' : tick.label }));
}

type Tick = Omit<GanttTick, 'left'>;

function onEdge(tick: Tick, from: number, to: number): boolean {
  return tick.at <= from || tick.at >= to;
}

/** The first local instant at or after `from` that `snap` lands on. */
function firstAtOrAfter(from: number, snap: (date: Date) => void, step: (date: Date) => void): Date {
  const cursor = new Date(from);
  snap(cursor);
  if (cursor.getTime() < from) step(cursor);
  return cursor;
}

const clockLabel = (date: Date) => date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** A line every hour, labelled every other hour so a narrow window never runs its labels together. */
function hourTicks(from: number, to: number): Tick[] {
  const ticks: Tick[] = [];
  const nextHour = (date: Date) => date.setHours(date.getHours() + 1);
  const cursor = firstAtOrAfter(from, (date) => date.setMinutes(0, 0, 0), nextHour);
  while (cursor.getTime() <= to) {
    const hour = cursor.getHours();
    const midnight = hour === 0;
    ticks.push({
      at: cursor.getTime(),
      label: midnight
        ? cursor.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
        : hour % 2 === 0
          ? clockLabel(cursor)
          : '',
      major: midnight,
      line: true,
    });
    nextHour(cursor);
  }
  return ticks;
}

/** A strong line at each midnight, fainter ones every six hours, and each day named across its middle. */
function weekTicks(from: number, to: number): Tick[] {
  const ticks: Tick[] = [];
  const quarter = (date: Date) => date.setHours(date.getHours() + 6);
  const cursor = firstAtOrAfter(from, (date) => date.setHours(Math.floor(date.getHours() / 6) * 6, 0, 0, 0), quarter);
  while (cursor.getTime() <= to) {
    const hour = cursor.getHours();
    ticks.push({ at: cursor.getTime(), label: '', major: hour === 0, line: true });
    if (hour === 12) {
      ticks.push({
        at: cursor.getTime(),
        label: cursor.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
        major: false,
        line: false,
      });
    }
    quarter(cursor);
  }
  return ticks;
}

function dateTicks(from: number, to: number): Tick[] {
  const ticks: Tick[] = [];
  const cursor = firstAtOrAfter(from, (date) => date.setHours(0, 0, 0, 0), (date) => date.setDate(date.getDate() + 1));

  // A day tick every day reads as noise past about six weeks, so the step
  // widens with the range rather than the labels overlapping.
  const days = (to - from) / DAY_MS;
  const step = days <= 21 ? 1 : days <= 70 ? 7 : 14;

  while (cursor.getTime() <= to) {
    const firstOfMonth = cursor.getDate() === 1;
    ticks.push({
      at: cursor.getTime(),
      label: firstOfMonth
        ? cursor.toLocaleDateString(undefined, { month: 'short' })
        : cursor.toLocaleDateString(
            undefined,
            // Day numbers alone read fine when every day is ticked, and become
            // a guessing game once the ticks are a fortnight apart.
            step === 1 ? { day: 'numeric' } : { day: 'numeric', month: 'short' },
          ),
      major: firstOfMonth,
      line: true,
    });
    cursor.setDate(cursor.getDate() + step);
  }
  return ticks;
}

/**
 * When an event opens and closes, written on its bar in the hour scales.
 *
 * As short as the range allows: the time alone for anything inside the day
 * being shown, the date as well for anything outside it or on a week.
 */
export function barTimes(event: BoardEvent, from: number, to: number): string {
  const oneDay = to - from <= 2 * DAY_MS;
  const when = (iso: string | null, none: string) => {
    if (iso === null) return none;
    const date = new Date(iso);
    const at = date.getTime();
    if (oneDay && at >= from && at < to) return clockLabel(date);
    return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${clockLabel(date)}`;
  };
  return `${when(event.startsAt, 'Always on')} – ${when(event.endsAt, 'no end')}`;
}

export interface EventDuration {
  /** Whole days, then the hours left over. Both rounded to the nearest hour. */
  days: number;
  hours: number;
  ms: number;
}

/**
 * How long an event runs, in the two units a designer books it in.
 *
 * Days and hours rather than one or the other, because both halves are
 * decisions: a season is "four weeks", a weekend offer is "60 hours", and a
 * season that came out as 29 days 23 hours is a mistake somebody wants to see
 * rather than a "30 days" that rounds the mistake away.
 */
export function eventDuration(fromIso: string, toIso: string | null): EventDuration | null {
  if (toIso === null) return null;
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.round(ms / 3600000);
  return { days: Math.floor(hours / 24), hours: hours % 24, ms };
}

/** "30 days", "1 day 12 hours", "6 hours" - how long an event runs, spelled out. */
export function durationLabel(fromIso: string, toIso: string | null): string {
  if (toIso === null) return 'no end';
  const duration = eventDuration(fromIso, toIso);
  if (duration === null) return '-';

  const { days, hours } = duration;
  const dayPart = days === 0 ? null : `${days} day${days === 1 ? '' : 's'}`;
  const hourPart = hours === 0 ? null : `${hours} hour${hours === 1 ? '' : 's'}`;
  if (dayPart === null && hourPart === null) return 'under an hour';
  return [dayPart, hourPart].filter((part) => part !== null).join(' ');
}
