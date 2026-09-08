/**
 * Client side of the scheduling routes.
 *
 * Same shape as `liveConfig.ts`: the browser never talks to GitHub or
 * ConfigCat, only to this app's own `/api/*` routes, which hold the
 * credentials server-side.
 */

import type { DomainId } from '../domains/types';
import type { Change } from './liveConfig';
import type { EventPhase, LiveOpsBlock } from './liveops';

export type ScheduleState =
  | 'scheduled'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'missed'
  | 'failed'
  | 'superseded';

export interface ScheduleHistoryLine {
  at: string;
  action: string;
  ok: boolean;
  message: string | null;
}

/**
 * One window, as the list route returns it - without its payload, so opening
 * the schedule page does not download eight hero tables.
 */
export interface ScheduleEntry {
  id: string;
  domain: DomainId;
  settingKey: string;
  environmentId: string;
  environmentName: string | null;
  label: string;
  note: string | null;
  payloadHash: string;
  payloadBytes: number;
  startsAt: string;
  endsAt: string | null;
  state: ScheduleState;
  createdAt: string;
  createdBy: string;
  activatedAt: string | null;
  /** Failed tick attempts so far. Non-zero means it is being retried, not stuck. */
  attempts: number;
  history: ScheduleHistoryLine[];
  /**
   * Present only on windows booked from the live ops calendar. Its absence is
   * what tells every reader this is an ordinary config window, so the two
   * kinds never have to be told apart by their domain.
   */
  liveops: LiveOpsBlock | null;
  phase: EventPhase | null;
  startsInMs: number;
  endsInMs: number | null;
}

export interface DefaultStatus {
  present: boolean;
  hash: string | null;
  error?: string;
}

export interface ScheduleView {
  entries: ScheduleEntry[];
  defaults: Record<DomainId, DefaultStatus>;
  /** Off states, per live ops feature. Empty for a non-live-ops domain. */
  off: Partial<Record<DomainId, DefaultStatus>>;
  lastTickAt: string | null;
  /** True when the heartbeat has not been heard from in over an hour. */
  heartbeatStale: boolean;
  repo: string;
  /** Which branch the schedule is stored on. Not the deployed one - see the README. */
  branch?: string;
  now: string;
  /**
   * Set when the scheduler cannot work at all - no GitHub token, or a repo it
   * cannot read. The list is empty because there is nothing to list, not
   * because nothing is booked, and those are very different sentences.
   */
  unavailable?: string;
}

export interface GitStatus {
  repo: string;
  branch: string;
  tokenPresent: boolean;
  ok: boolean;
  canRead: boolean;
  canWrite: boolean;
  identity: { login: string | null; type: string | null } | null;
  private?: boolean | null;
  permissions?: Record<string, boolean>;
  status?: number;
  problem: string | null;
}

export interface SchedulePreview {
  id: string;
  settingKey: string;
  summary: { added: number; removed: number; changed: number; reordered: number; total: number };
  changes: Change[];
  truncated: number;
}

/** Thrown with the guardrail list when a window is refused. */
export class ScheduleRejected extends Error {
  readonly problems: string[];

  constructor(message: string, problems: string[]) {
    super(message);
    this.name = 'ScheduleRejected';
    this.problems = problems;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    });
  } catch (error) {
    throw new Error(
      `Could not reach the server: ${(error as Error).message}. The API routes only exist on the dev server or on Vercel.`,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }

  if (!response.ok) {
    const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const problems = Array.isArray(record?.problems) ? (record.problems as string[]) : null;
    const message = typeof record?.error === 'string' ? record.error : `The server returned HTTP ${response.status}.`;
    if (problems !== null) throw new ScheduleRejected(message, problems);
    throw new Error(message);
  }

  return body as T;
}

export function fetchSchedule(): Promise<ScheduleView> {
  return call<ScheduleView>('/api/schedule');
}

export function fetchGitStatus(): Promise<GitStatus> {
  return call<GitStatus>('/api/git/status');
}

export interface NewWindow {
  domain: DomainId;
  environmentId: string;
  environmentName?: string;
  label: string;
  note?: string;
  payload: unknown;
  /**
   * Ignored for a live ops event: the window's start is worked out from when
   * the event opens and how long it previews for, so there is one place a
   * date can be wrong instead of two that must agree.
   */
  startsAt: string;
  endsAt: string | null;
  liveops?: LiveOpsBlock;
}

export function createWindow(input: NewWindow): Promise<{ entry: ScheduleEntry }> {
  return call<{ entry: ScheduleEntry }>('/api/schedule', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelWindow(id: string, reason?: string): Promise<{ entry: ScheduleEntry }> {
  return call<{ entry: ScheduleEntry }>('/api/schedule/cancel', {
    method: 'POST',
    body: JSON.stringify({ id, reason }),
  });
}

export function fetchDefault(domain: DomainId): Promise<{ domain: DomainId; present: boolean; payload: unknown }> {
  return call(`/api/schedule/default?domain=${encodeURIComponent(domain)}`);
}

export function saveDefault(domain: DomainId, payload: unknown, note?: string): Promise<{ committed: boolean }> {
  return call('/api/schedule/default', {
    method: 'POST',
    body: JSON.stringify({ domain, payload, note }),
  });
}

export interface OffState {
  domain: DomainId;
  present: boolean;
  payload: unknown;
  /** True when nothing is recorded yet and `payload` is only a suggestion. */
  suggested: boolean;
  means: string | null;
}

export function fetchOff(domain: DomainId): Promise<OffState> {
  return call<OffState>(`/api/schedule/off?domain=${encodeURIComponent(domain)}`);
}

export function saveOff(domain: DomainId, payload: unknown, note?: string): Promise<{ committed: boolean }> {
  return call('/api/schedule/off', {
    method: 'POST',
    body: JSON.stringify({ domain, payload, note }),
  });
}

export function previewWindow(id: string): Promise<SchedulePreview> {
  return call<SchedulePreview>(`/api/schedule/preview?id=${encodeURIComponent(id)}`);
}

/* ------------------------------------------------------------ formatting -- */

/**
 * "in 3 hours", "2 days ago". Relative time is what a schedule is actually
 * read for - nobody scans absolute timestamps to work out what is next.
 */
export function relativeTime(ms: number): string {
  const abs = Math.abs(ms);
  const minute = 60000;
  const hour = 3600000;
  const day = 86400000;

  const pick = (): [number, Intl.RelativeTimeFormatUnit] => {
    if (abs < minute) return [Math.round(ms / 1000), 'second'];
    if (abs < hour) return [Math.round(ms / minute), 'minute'];
    if (abs < day) return [Math.round(ms / hour), 'hour'];
    if (abs < 30 * day) return [Math.round(ms / day), 'day'];
    return [Math.round(ms / (30 * day)), 'month'];
  };

  const [value, unit] = pick();
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit);
}

/** A timestamp in the reader's own timezone, which is the only one they can act on. */
export function localTime(iso: string | null): string {
  if (iso === null) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * `<input type="datetime-local">` speaks local wall-clock time with no zone,
 * and everything server-side speaks ISO with one. These two functions are the
 * only place that conversion happens, so a window can never be an hour out
 * because two components disagreed about it.
 */
export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const STATE_LABELS: Record<ScheduleState, string> = {
  scheduled: 'Scheduled',
  active: 'Live now',
  completed: 'Finished',
  cancelled: 'Cancelled',
  missed: 'Missed',
  failed: 'Failed',
  superseded: 'Superseded',
};

/** Tone for the state chip. Only `failed` and `missed` are alarming. */
export const STATE_TONES: Record<ScheduleState, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  scheduled: 'info',
  active: 'ok',
  completed: 'neutral',
  cancelled: 'neutral',
  missed: 'danger',
  failed: 'danger',
  superseded: 'warn',
};
