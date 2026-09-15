import { useCallback, useEffect, useMemo, useState } from 'react';
import { ACCOUNT, environmentName, isLiveEnvironment } from '../domains/account';
import { fetchValues } from '../lib/liveConfig';
import {
  LIVEOPS_DOMAINS,
  LIVEOPS_FEATURES,
  boardEvents,
  RETIRE_AFTER_DAYS,
  isInGame,
  type BoardEvent,
  type LiveOpsDomain,
} from '../lib/liveops';
import {
  ScheduleRejected,
  cancelWindow,
  deleteWindow,
  endEvent,
  fetchSchedule,
  type ScheduleView,
} from '../lib/schedule';

/**
 * `delete` takes the whole card off the calendar: whatever of the event is
 * still listed comes out of ConfigCat, and its booking is erased. Never for an
 * event in the game - that is End now.
 */
export type BoardAction = 'end' | 'remove' | 'cancel' | 'delete';

export interface LiveOpsBoard {
  view: ScheduleView | null;
  events: BoardEvent[];
  now: number;
  loading: boolean;
  /** Reading the schedule failed, or an action was refused. */
  error: string | null;
  /** ConfigCat could not be read, so only bookings are shown. */
  liveError: string | null;
  notice: string | null;
  busyKey: string | null;
  reload: () => Promise<void>;
  /** Asks, then acts. Resolves to true when something was changed. */
  act: (event: BoardEvent, action: BoardAction) => Promise<boolean>;
}

/**
 * The live ops board for one environment: every booking, joined to what
 * ConfigCat is serving, plus the things that can be done to an event from a
 * list or its menu.
 *
 * One hook for both surfaces - the calendar and each feature's own page -
 * because "what is running" and "take it down" must mean exactly the same
 * thing in both places.
 */
export function useLiveOpsBoard(environmentId: string, domain?: LiveOpsDomain): LiveOpsBoard {
  const [view, setView] = useState<ScheduleView | null>(null);
  const [live, setLive] = useState<Partial<Record<LiveOpsDomain, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [readAt, setReadAt] = useState(() => Date.now());

  const reload = useCallback(async () => {
    setLoading(true);
    const [schedule, values] = await Promise.allSettled([
      fetchSchedule(),
      fetchValues(ACCOUNT.configId, environmentId),
    ]);

    if (schedule.status === 'fulfilled') {
      setView(schedule.value);
      setError(null);
    } else {
      setError((schedule.reason as Error).message);
    }

    if (values.status === 'fulfilled' && values.value.unreadable === null) {
      const next: Partial<Record<LiveOpsDomain, unknown>> = {};
      for (const feature of LIVEOPS_DOMAINS) {
        const setting = values.value.settings.find((candidate) => candidate.key === LIVEOPS_FEATURES[feature].settingKey);
        // A setting that does not exist in this environment is a feature with
        // nothing running, which is an answer - not a failed read.
        next[feature] = setting === undefined ? null : (setting.json ?? setting.value);
      }
      setLive(next);
      setLiveError(null);
    } else {
      setLive({});
      setLiveError(
        values.status === 'rejected'
          ? (values.reason as Error).message
          : (values.value.unreadable?.reason ?? 'The live values could not be read.'),
      );
    }
    setReadAt(Date.now());
    setLoading(false);
  }, [environmentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The server's clock when there is one, so a phase never depends on how far
  // this laptop's clock has drifted.
  const now = view === null ? readAt : Date.parse(view.now);

  const events = useMemo(() => {
    const all = boardEvents({ entries: view?.entries ?? [], live, environmentId, now });
    return domain === undefined ? all : all.filter((event) => event.domain === domain);
  }, [view, live, environmentId, now, domain]);

  const act = useCallback(
    async (event: BoardEvent, action: BoardAction) => {
      const feature = LIVEOPS_FEATURES[event.domain];
      const where = environmentName(environmentId);
      const players = isLiveEnvironment(environmentId) ? ` ${where} is what players are on.` : '';
      if (action === 'delete' && isInGame(event)) return false;
      const erased = 'Its booking and history are erased from the calendar; its run ID is never reused.';
      const question =
        action === 'delete'
          ? event.live !== null
            ? feature.unit === 'list'
              ? `Delete "${event.name}"? It is taken out of ${feature.settingKey} in ${where} for good, and players' progress on it is dropped on their next launch.${event.entry !== null ? ` ${erased}` : ''}${players}`
              : `Delete "${event.name}"? The off state is published in ${where} in its place.${event.entry !== null ? ` ${erased}` : ''}${players}`
            : `Delete "${event.name}"? ${event.phase === 'scheduled' ? 'It has not started, so nothing' : 'Nothing'} is published. ${erased}`
          : action === 'cancel'
          ? event.entry?.state === 'active'
            ? `Call off the booking for "${event.name}"? It is not in ConfigCat any more, so nothing is published.`
            : `Cancel "${event.name}"? It has not started, so nothing is published.`
          : action === 'remove'
            ? feature.unit === 'list'
              ? `Remove "${event.name}" from ${feature.settingKey} in ${where}? It is taken out of the list for good, and players' progress on it is dropped on their next launch.${players}`
              : `Remove "${event.name}" from ${where}? The off state is published in its place.${players}`
            : feature.unit === 'list'
              ? `End "${event.name}" now in ${where}? Its window is closed, so it leaves the menu on players' next launch. It stays listed for ${RETIRE_AFTER_DAYS} days, then is retired - a re-run is a new run, starting everyone fresh.${players}`
              : `End "${event.name}" now in ${where}? The off state is published, so the ${feature.noun} leaves the game on players' next launch.${players}`;
      if (!window.confirm(question)) return false;

      setBusyKey(event.key);
      setNotice(null);
      setError(null);
      try {
        if (action === 'delete') {
          // What is still listed comes out first, or the card would come
          // straight back as an event nobody booked.
          if (event.live !== null && event.subjectId !== null) {
            await endEvent({
              domain: event.domain,
              environmentId,
              subjectId: event.subjectId,
              mode: 'remove',
              expected: event.live.part,
              reason: 'Deleted from the back office.',
            });
          }
          if (event.entry !== null) {
            // Booked as running but gone from ConfigCat: called off before it
            // can be erased. Removing a listed one above already cancelled it.
            if (event.live === null && event.entry.state === 'active') {
              await cancelWindow(event.entry.id, 'Called off to be deleted from the back office.');
            }
            await deleteWindow(event.entry.id);
          }
          setNotice(`"${event.name}" was deleted.`);
        } else if (action === 'cancel' || (event.live === null && event.entry !== null)) {
          if (event.entry === null) return false;
          await cancelWindow(event.entry.id, 'Cancelled from the back office.');
          setNotice(`"${event.name}" was called off.`);
        } else if (event.subjectId !== null) {
          await endEvent({
            domain: event.domain,
            environmentId,
            subjectId: event.subjectId,
            mode: action === 'remove' ? 'remove' : 'end',
            expected: event.live?.part,
            reason: `${action === 'remove' ? 'Removed' : 'Ended'} from the back office.`,
          });
          setNotice(
            action === 'remove'
              ? `"${event.name}" is out of ${feature.settingKey}.`
              : isInGame(event)
                ? `"${event.name}" has ended. Players see it gone on their next launch.`
                : `"${event.name}" is ended.`,
          );
        }
        await reload();
        return true;
      } catch (reason) {
        setError(
          reason instanceof ScheduleRejected ? reason.problems.join(' ') : (reason as Error).message,
        );
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [environmentId, reload],
  );

  return { view, events, now, loading, error, liveError, notice, busyKey, reload, act };
}
