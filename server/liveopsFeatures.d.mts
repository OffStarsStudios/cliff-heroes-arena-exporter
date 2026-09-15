/**
 * Types for `liveopsFeatures.mjs`, so the React app imports the same functions
 * the server runs rather than a TypeScript copy of them.
 */

export type LiveOpsDomain = 'battlePass' | 'rollingOffer';

export type EventCategory = 'monetization' | 'engagement' | 'seasonal' | 'test';

/** One event as a payload describes it. A null start is open already; a null end never closes. */
export interface PayloadEvent {
  subjectId: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
}

export type PartReason = 'removed' | 'ended' | 'unreadable' | 'not-listed' | 'no-off-state' | 'would-empty' | 'already-ended';

export interface PartResult {
  payload: Record<string, unknown> | null;
  reason: PartReason;
}

export interface LiveOpsFeature {
  domain: LiveOpsDomain;
  settingKey: string;
  label: string;
  unit: 'whole' | 'list';
  evergreen: boolean;
  noun: string;
  eventsIn(value: unknown): PayloadEvent[];
  partOf(value: unknown, subjectId: string | null): Record<string, unknown> | null;
  withPart(live: unknown, booked: unknown, subjectId: string): Record<string, unknown> | null;
  withWindow(
    value: unknown,
    subjectId: string,
    window: { startsAt: string | null; endsAt: string | null },
  ): Record<string, unknown> | null;
  endedNow(value: unknown, subjectId: string, context: { now: number; off?: unknown }): PartResult;
  withoutPart(value: unknown, subjectId: string, context?: { off?: unknown }): PartResult;
  subjectOf(value: unknown): string | null;
}

export declare const LIVEOPS_FEATURES: Record<LiveOpsDomain, LiveOpsFeature>;
export declare const LIVEOPS_DOMAINS: LiveOpsDomain[];
export declare const EVENT_CATEGORIES: EventCategory[];
export declare const ENDING_SOON_HOURS: number;
export declare const REASON_TEXT: Record<string, string>;

export declare function featureFor(domain: string): LiveOpsFeature | null;
export declare function readPayload(value: unknown): Record<string, unknown> | null;
export declare function toClientUtc(isoOrMs: string | number): string;
export declare function fromClientUtc(text: unknown): number;
export declare function phaseOfWindow(
  startsAt: string | null,
  endsAt: string | null,
  now: number,
): 'scheduled' | 'active' | 'ending' | 'ended';
