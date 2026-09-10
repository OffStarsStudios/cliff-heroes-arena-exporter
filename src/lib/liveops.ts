import type { DomainId } from '../domains/types';
import type { ScheduleEntry } from './schedule';

/**
 * The live ops calendar's vocabulary.
 *
 * Mirrors `server/liveops.mjs`, the same way `domains/types.ts` mirrors the
 * setting keys the server holds: the server has no build step and cannot
 * import TypeScript, so the two lists are kept side by side and small enough
 * to check by eye. A test asserts they agree.
 *
 * The distinction this whole file turns on: a core config is always live and
 * ends by going back to its previous version; a live ops feature is only
 * sometimes live and ends by going away. Everything here - the phases, the
 * lanes, the fact that an end time is required - follows from that.
 */

/** Features scheduled as events rather than configured permanently. */
export const LIVEOPS_DOMAINS = ['battlePass'] as const;

export type LiveOpsDomain = (typeof LIVEOPS_DOMAINS)[number];

export function isLiveOpsDomain(domain: DomainId): domain is LiveOpsDomain {
  return (LIVEOPS_DOMAINS as readonly string[]).includes(domain);
}

/** Where each feature's payload is authored, so an event links back to its sheet. */
export const FEATURE_SOURCE: Record<LiveOpsDomain, string> = {
  battlePass: 'battlePass',
};

export const EVENT_CATEGORIES = ['monetization', 'engagement', 'seasonal', 'test'] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

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

export const ENDING_SOON_HOURS = 24;

const HOUR_MS = 3600 * 1000;

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

/** The window the config is actually published for, and the slice players see. */
export function spanOf(entry: LiveOpsEntry): { publishedFrom: number; opens: number; ends: number } {
  return {
    publishedFrom: Date.parse(entry.startsAt),
    opens: Date.parse(entry.liveops.opensAt),
    ends: entry.endsAt === null ? Date.parse(entry.startsAt) : Date.parse(entry.endsAt),
  };
}

/* ------------------------------------------------------------- the gantt -- */

export interface GanttBar {
  entry: LiveOpsEntry;
  phase: EventPhase;
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

export interface GanttLane {
  domain: DomainId;
  label: string;
  bars: GanttBar[];
}

export interface GanttTick {
  at: number;
  left: number;
  label: string;
  major: boolean;
}

/**
 * Lays events out against a time range.
 *
 * Kept out of the component and free of DOM so the arithmetic that decides
 * where a bar sits can be tested directly - an off-by-one here is a promotion
 * drawn in the wrong week, which is exactly the mistake a calendar exists to
 * prevent.
 */
export function layOutBars(entries: LiveOpsEntry[], from: number, to: number, now: number): GanttBar[] {
  const span = Math.max(to - from, 1);
  // Rows are needed even though the scheduler refuses two *live* windows on
  // one feature: a finished event and its replacement are allowed to overlap,
  // and drawing them on top of each other would hide one of them entirely.
  const rowEnds: number[] = [];

  return entries
    .slice()
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .map((entry) => {
      const { publishedFrom, opens, ends } = spanOf(entry);
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
        entry,
        phase: phaseOf(entry, now),
        left: (visibleStart - from) / span,
        width,
        previewFraction: width === 0 ? 0 : (previewEnd - visibleStart) / (visibleEnd - visibleStart),
        clippedStart: publishedFrom < from,
        clippedEnd: ends > to,
        row,
      };
    })
    .filter((bar): bar is GanttBar => bar !== null);
}

/** Day ticks across the range, with the first of each month called out. */
export function ticksFor(from: number, to: number): GanttTick[] {
  const span = Math.max(to - from, 1);
  const ticks: GanttTick[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  if (cursor.getTime() < from) cursor.setDate(cursor.getDate() + 1);

  // A day tick every day reads as noise past about six weeks, so the step
  // widens with the range rather than the labels overlapping.
  const days = span / 86400000;
  const step = days <= 21 ? 1 : days <= 70 ? 7 : 14;

  while (cursor.getTime() <= to) {
    const at = cursor.getTime();
    const firstOfMonth = cursor.getDate() === 1;
    ticks.push({
      at,
      left: (at - from) / span,
      label: firstOfMonth
        ? cursor.toLocaleDateString(undefined, { month: 'short' })
        : cursor.toLocaleDateString(
            undefined,
            // Day numbers alone read fine when every day is ticked, and become
            // a guessing game once the ticks are a fortnight apart.
            step === 1 ? { day: 'numeric' } : { day: 'numeric', month: 'short' },
          ),
      major: firstOfMonth,
    });
    cursor.setDate(cursor.getDate() + step);
  }
  return ticks;
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
