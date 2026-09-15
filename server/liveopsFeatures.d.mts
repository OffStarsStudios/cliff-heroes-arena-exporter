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
  withSubjectId(value: unknown, fromId: string, toId: string): Record<string, unknown> | null;
  subjectOf(value: unknown): string | null;
  /** Present on a feature whose events carry text and art set in the back office. */
  presentationOf?(value: unknown, subjectId: string | null): Presentation | null;
  withPresentation?(value: unknown, subjectId: string, presentation: Presentation): Record<string, unknown> | null;
  /** Present on a feature whose ended events stay listed until they are retired. */
  retiredBy?(value: unknown, context?: { now?: number; afterDays?: number }): { payload: Record<string, unknown> | null; retired: string[] };
}

export type PresentationField =
  | 'DisplayName'
  | 'Subtitle'
  | 'CompletionText'
  | 'BackgroundArt'
  | 'TopBarArt'
  | 'RewardArt'
  | 'ButtonArt';

export type Presentation = Record<PresentationField, string>;

export declare const LIVEOPS_FEATURES: Record<LiveOpsDomain, LiveOpsFeature>;
export declare const LIVEOPS_DOMAINS: LiveOpsDomain[];
export declare const EVENT_CATEGORIES: EventCategory[];
export declare const ENDING_SOON_HOURS: number;
export declare const REASON_TEXT: Record<string, string>;

export declare const OFFER_KEY_ORDER: string[];
export declare const RETIRE_AFTER_DAYS: number;
export declare const PRESENTATION_FIELDS: PresentationField[];

export declare function baseOf(id: string): string;
export declare function hasRunKey(id: unknown): boolean;
export declare function mintRunId(baseId: string, opensAt: string | number | null | undefined, taken?: Iterable<string>): string | null;
export declare function runIdFor(
  feature: LiveOpsFeature,
  context: { baseId: string; live: unknown; opensAt?: string | number | null; now?: number; taken?: string[] },
): { id: string | null; fresh: boolean };
export declare function emptyPresentation(): Presentation;
export declare function checkPresentation(presentation: Partial<Presentation> | null | undefined): string[];

export declare function featureFor(domain: string): LiveOpsFeature | null;
export declare function offerInKeyOrder<T>(offer: T): T;
export declare function readPayload(value: unknown): Record<string, unknown> | null;
export declare function toClientUtc(isoOrMs: string | number): string;
export declare function fromClientUtc(text: unknown): number;
export declare function phaseOfWindow(
  startsAt: string | null,
  endsAt: string | null,
  now: number,
): 'scheduled' | 'active' | 'ending' | 'ended';
