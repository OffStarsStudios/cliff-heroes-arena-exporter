/**
 * Client side of the read-only ConfigCat routes.
 *
 * The Management API credentials never reach the browser - every call here
 * goes to this app's own `/api/*` routes, which hold the credentials
 * server-side. See `server/configcat.mjs`.
 */

import type { ConfigSet, DomainId } from '../domains/types';
import { SETTING_KEYS } from '../domains/types';
import type { Issue } from './types';
import type { GraphReport } from '../workspace/graph';

export interface TreeSetting {
  settingId: number;
  key: string;
  name: string;
  settingType: string;
}

export interface TreeConfig {
  configId: string;
  name: string;
  settings: TreeSetting[];
}

export interface TreeEnvironment {
  environmentId: string;
  name: string;
}

export interface TreeProduct {
  productId: string;
  name: string;
  configs: TreeConfig[];
  environments: TreeEnvironment[];
}

export interface Tree {
  products: TreeProduct[];
}

export interface SettingValue {
  settingId: number | null;
  key: string | null;
  name: string | null;
  settingType: string | null;
  value: unknown;
  /** Byte length of the stored string, or null for non-string settings. */
  bytes: number | null;
  /** Parsed payload for string settings holding JSON, else null. */
  json: unknown;
  /** Set when a string setting was expected to hold JSON but does not parse. */
  parseError: string | null;
}

/**
 * Set when the response parsed but yielded nothing usable, which nearly always
 * means the API's response shape moved rather than that the config is empty.
 */
export interface Unreadable {
  reason: string;
  apiVersion: string;
  listKey: string | null;
  responseKeys: string[];
  sampleEntryKeys: string[];
}

export interface Values {
  configId: string;
  environmentId: string;
  /** Which Management API version served this config: 'v1' or 'v2'. */
  apiVersion: string;
  settings: SettingValue[];
  totalBytes: number;
  unreadable: Unreadable | null;
}

export type ChangeKind = 'added' | 'removed' | 'changed' | 'reordered';

export interface Change {
  kind: ChangeKind;
  path: string;
  before?: unknown;
  after?: unknown;
  description: string;
}

export interface DriftSetting {
  key: string;
  name: string | null;
  status: 'same' | 'different' | 'only-in-from' | 'only-in-to';
  comparedAs?: 'json' | 'raw';
  bytes?: { from: number | null; to: number | null };
  summary?: { added: number; removed: number; changed: number; reordered: number; total: number };
  changes?: Change[];
  truncated?: number;
}

export interface Drift {
  configId: string;
  from: string;
  to: string;
  settings: DriftSetting[];
  differing: number;
  unreadable: Unreadable | null;
}

export interface Probe {
  productId: string;
  changeRequests: {
    available: boolean;
    status: number;
    message: string;
    sample: unknown;
  };
}

/** An API error carrying the status, so callers can tell 401 from 502. */
export class LiveConfigError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LiveConfigError';
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new LiveConfigError(
      `Could not reach the server: ${(error as Error).message}. If this is a local build, the API routes only exist on the dev server or on Vercel.`,
      0,
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
    const message =
      record !== null && 'error' in record
        ? String(record.error)
        : `The server returned HTTP ${response.status}.`;
    // ConfigCat puts the actual reason in the response body. Without it an
    // error like a rejected API version reads as an unexplained 400.
    const detail =
      record !== null && record.detail !== undefined && record.detail !== null
        ? typeof record.detail === 'string'
          ? record.detail
          : JSON.stringify(record.detail)
        : null;
    throw new LiveConfigError(
      detail === null ? message : `${message} ConfigCat said: ${detail}`,
      response.status,
    );
  }

  return body as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new LiveConfigError(`Could not reach the server: ${(error as Error).message}`, 0);
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const record = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    const message =
      record !== null && 'error' in record
        ? String(record.error)
        : `The server returned HTTP ${response.status}.`;
    throw new LiveConfigError(message, response.status);
  }

  return parsed as T;
}

/* ------------------------------------------------------------- publishing -- */

export interface PlanEntry {
  settingKey: string;
  settingId: number | null;
  name?: string | null;
  error?: string;
  baselineHash?: string;
  unchanged?: boolean;
  bytesBefore?: number | null;
  bytesAfter?: number;
  summary?: { added: number; removed: number; changed: number; reordered: number; total: number };
  changes?: Change[];
  truncated?: number;
}

export interface PendingCheck {
  checked: boolean;
  count: number;
  blocking: boolean;
  message: string;
}

export interface Plan {
  configId: string;
  environmentId: string;
  apiVersion: string;
  entries: PlanEntry[];
  pending: PendingCheck;
  blockers: string[];
  writable: boolean;
}

export interface ApplyResult {
  settingKey: string;
  settingId?: number | null;
  status: 'written' | 'unchanged' | 'conflict' | 'error' | 'unverified';
  message?: string;
  apiVersion?: string;
  bytes?: number;
  verified?: boolean;
}

export interface GitCommit {
  path: string;
  committed: boolean;
  reason?: string;
  sha?: string | null;
  url?: string | null;
}

export interface ApplyResponse {
  configId: string;
  environmentId: string;
  results: ApplyResult[];
  pending: PendingCheck;
  git: { available: boolean; commits: GitCommit[] };
  written: number;
  failed: number;
  conflicts: number;
}

export interface PublishEntryInput {
  settingKey: string;
  payload: unknown;
  gitPath?: string;
  baselineHash?: string;
  note?: string;
}

export function planPublish(input: {
  configId: string;
  environmentId: string;
  productId?: string;
  entries: PublishEntryInput[];
}): Promise<Plan> {
  return post<Plan>('/api/publish/plan', input);
}

export function applyPublish(input: {
  configId: string;
  environmentId: string;
  productId?: string;
  entries: PublishEntryInput[];
}): Promise<ApplyResponse> {
  return post<ApplyResponse>('/api/publish/apply', input);
}

export function fetchTree(): Promise<Tree> {
  return get<Tree>('/api/configcat/tree');
}

export function fetchValues(configId: string, environmentId: string): Promise<Values> {
  return get<Values>(
    `/api/configcat/values?configId=${encodeURIComponent(configId)}&environmentId=${encodeURIComponent(environmentId)}`,
  );
}

export function fetchDrift(configId: string, from: string, to: string): Promise<Drift> {
  return get<Drift>(
    `/api/drift?configId=${encodeURIComponent(configId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export function fetchProbe(productId: string): Promise<Probe> {
  return get<Probe>(`/api/configcat/probe?productId=${encodeURIComponent(productId)}`);
}

/** Setting key -> domain id, the reverse of `SETTING_KEYS`. */
const DOMAIN_BY_KEY = new Map<string, DomainId>(
  (Object.keys(SETTING_KEYS) as DomainId[]).map((domain) => [SETTING_KEYS[domain], domain]),
);

export function domainForKey(key: string | null): DomainId | null {
  return key === null ? null : DOMAIN_BY_KEY.get(key) ?? null;
}

/**
 * Turns live values into the config set the graph checker consumes.
 *
 * A setting that failed to parse is left out rather than passed through as
 * something malformed - the parse error is reported separately, and the graph
 * report says which domains it could not check.
 */
export function toConfigSet(values: Values): ConfigSet {
  const set: Record<string, unknown> = {};
  for (const setting of values.settings) {
    const domain = domainForKey(setting.key);
    if (domain === null) continue;
    if (setting.parseError !== null || setting.json === null) continue;
    set[domain] = setting.json;
  }
  return set as ConfigSet;
}

/** Settings ConfigCat holds that this console has no domain for. */
export function unknownSettingKeys(values: Values): string[] {
  return values.settings
    .map((setting) => setting.key)
    .filter((key): key is string => key !== null && domainForKey(key) === null);
}

/* ---------------------------------------------------- candidate checking -- */

/** The live set with one domain replaced by a payload that is about to be published. */
export function withCandidate(set: ConfigSet, domain: DomainId, payload: unknown): ConfigSet {
  return { ...set, [domain]: payload } as ConfigSet;
}

export interface GraphComparison {
  /** Issues the candidate causes that the live config does not have. */
  introduced: Issue[];
  /** Issues present with and without the candidate - not this change's doing. */
  preexisting: Issue[];
  /** Live issues the candidate makes go away. */
  resolved: Issue[];
}

function issueKey(issue: Issue): string {
  return `${issue.code}\n${issue.message}`;
}

/**
 * Splits a candidate's graph report against the live baseline, so a warning
 * that fires on every run (the undeclared difficulty mapping, say) is never
 * read as something the current change caused.
 */
export function compareGraphReports(baseline: GraphReport, candidate: GraphReport): GraphComparison {
  const before = new Set(baseline.issues.map(issueKey));
  const after = new Set(candidate.issues.map(issueKey));
  return {
    introduced: candidate.issues.filter((issue) => !before.has(issueKey(issue))),
    preexisting: candidate.issues.filter((issue) => before.has(issueKey(issue))),
    resolved: baseline.issues.filter((issue) => !after.has(issueKey(issue))),
  };
}
