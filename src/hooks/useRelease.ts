/**
 * Everything the console can say about a config before it goes live, computed
 * the moment there is something to say it about.
 *
 * The old flow made this a button: parse the sheet, press Generate JSON, press
 * Show what would change, read the diff, press Publish. Four deliberate acts
 * for one intention. The JSON was never the point - it was a artefact of the
 * console having started life as a converter - and the diff is the thing
 * anybody actually wants to look at.
 *
 * So this hook runs both checks automatically whenever the parsed config
 * changes: the diff against the live value (which also issues the baseline
 * hash publishing needs) and the cross-config graph check with this payload
 * substituted in. Publishing is then one press, against a diff that is already
 * on screen.
 *
 * Two things keep that safe rather than merely fast. Nothing here writes -
 * `plan` is explicitly a read. And a result never outlives the payload it was
 * computed for: a superseded request is discarded rather than allowed to land
 * on a newer config.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACCOUNT } from '../domains/account';
import { SETTING_KEYS, type DomainId } from '../domains/types';
import type { Issue } from '../lib/types';
import {
  compareGraphReports,
  fetchValues,
  planPublish,
  toConfigSet,
  withCandidate,
  type Plan,
  type PlanEntry,
} from '../lib/liveConfig';
import { emptyRegistry, mergeRegistries, registryFromConfigs, type IdRegistry } from '../workspace/registry';
import { validateGraph } from '../workspace/graph';

export interface GraphCheck {
  introduced: Issue[];
  preexisting: Issue[];
  resolved: Issue[];
  /** Domains the live config could not supply, so rules needing them were skipped. */
  missing: DomainId[];
  settingCount: number;
}

export type ReleaseStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Release {
  status: ReleaseStatus;
  /** The diff against the live value, and the baseline hash publishing needs. */
  entry: PlanEntry | null;
  plan: Plan | null;
  graph: GraphCheck | null;
  error: string | null;
  /** Errors this change would introduce across configs. Publishing is refused while above zero. */
  introducedErrors: number;
  /** True when the live value already equals this payload. */
  unchanged: boolean;
  reload: () => void;
}

const IDLE: Release = {
  status: 'idle',
  entry: null,
  plan: null,
  graph: null,
  error: null,
  introducedErrors: 0,
  unchanged: false,
  reload: () => {},
};

interface UseReleaseInput {
  domain: DomainId;
  /** The parsed config, or null while the sheet is incomplete or in error. */
  payload: unknown | null;
  environmentId: string;
  /** IDs the workbook defines that no published config does, e.g. rewards. */
  extraRegistry?: IdRegistry;
}

export function useRelease({ domain, payload, environmentId, extraRegistry }: UseReleaseInput): Release {
  const [state, setState] = useState<Omit<Release, 'reload'>>(IDLE);
  const [runId, setRunId] = useState(0);
  const reload = useCallback(() => setRunId((id) => id + 1), []);

  // The payload is an object rebuilt by the analysis memo, so identity is
  // already stable per parse. Serialising it as the dependency would mean
  // hashing a whole hero table on every render for nothing.
  const registry = extraRegistry ?? null;

  // Keeps the very latest request identifiable, so a slow first response
  // cannot overwrite a fast second one.
  const latest = useRef(0);

  useEffect(() => {
    if (payload === null || payload === undefined) {
      setState(IDLE);
      return;
    }

    const ticket = ++latest.current;
    setState({ ...IDLE, status: 'loading' });

    let cancelled = false;
    (async () => {
      try {
        // Both reads at once: they are independent, and together they are the
        // whole answer to "what happens if I publish this".
        const [plan, values] = await Promise.all([
          planPublish({
            configId: ACCOUNT.configId,
            environmentId,
            productId: ACCOUNT.productId,
            entries: [{ settingKey: SETTING_KEYS[domain], payload }],
          }),
          fetchValues(ACCOUNT.configId, environmentId),
        ]);

        const live = toConfigSet(values);
        const baseline = validateGraph(live, registryFromConfigs(live));
        const candidateSet = withCandidate(live, domain, payload);
        const candidate = validateGraph(
          candidateSet,
          mergeRegistries(registryFromConfigs(candidateSet), registry ?? emptyRegistry()),
        );
        const comparison = compareGraphReports(baseline, candidate);

        if (cancelled || ticket !== latest.current) return;

        const entry = plan.entries[0] ?? null;
        setState({
          status: 'ready',
          plan,
          entry,
          graph: {
            ...comparison,
            missing: candidate.missing as DomainId[],
            settingCount: values.settings.length,
          },
          error: null,
          introducedErrors: comparison.introduced.filter((issue) => issue.severity === 'error').length,
          unchanged: entry?.unchanged === true,
        });
      } catch (error) {
        if (cancelled || ticket !== latest.current) return;
        setState({ ...IDLE, status: 'error', error: (error as Error).message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [payload, environmentId, domain, registry, runId]);

  return useMemo(() => ({ ...state, reload }), [state, reload]);
}
