import { useEffect, useMemo, useState } from 'react';
import { actionsFor, phaseChip } from './EventBoard';
import { EventConfigSource, type EventConfig } from './EventConfigSource';
import { Icon } from './Icon';
import { Portal } from './Portal';
import { Segmented } from './Segmented';
import { environmentName, isLiveEnvironment } from '../domains/account';
import { DOMAIN_LABELS } from '../domains/types';
import {
  CATEGORY_LABELS,
  EVENT_CATEGORIES,
  LIVEOPS_DOMAINS,
  LIVEOPS_FEATURES,
  durationLabel,
  eventDuration,
  isLingering,
  type BoardEvent,
  type EventCategory,
  type LiveOpsDomain,
} from '../lib/liveops';
import {
  ScheduleRejected,
  cancelWindow,
  createWindow,
  endEvent,
  fetchOff,
  fromLocalInput,
  localTime,
  republishEvent,
  saveOff,
  toLocalInput,
  updateWindow,
  type OffState,
} from '../lib/schedule';

/** A config already built on a feature's own page, handed to the booking form. */
export interface EventPreset {
  payload: unknown;
  /** The season ID or offer ID it carries, when the page knows it. */
  subjectId: string | null;
  sourceUrl: string | null;
}

interface LiveOpsDialogProps {
  environmentId: string;
  /** The event being opened, or null to create one. */
  event?: BoardEvent | null;
  /** Fixes the feature: set when the dialog is opened from that feature's page. */
  domain?: LiveOpsDomain;
  /** The config the feature's page has already built and checked. */
  preset?: EventPreset | null;
  onClose: () => void;
  /** Something changed; the caller reloads. */
  onDone: () => void;
}

/** Next whole hour: events open on the hour, not at 18:07. */
function defaultOpen(): Date {
  const date = new Date(Date.now() + 3600000);
  date.setMinutes(0, 0, 0);
  return date;
}

function inputOf(iso: string | null, fallback: Date): string {
  return toLocalInput(iso === null ? fallback : new Date(iso));
}

/**
 * One form for every live ops event, whatever state it is in.
 *
 * New: pick the feature, name it, take its config from a sheet (or from the
 * page it was opened on), and either book it for a date or put it live now.
 *
 * Booked and not started: everything can change, and nothing is published
 * until it opens.
 *
 * In the game - booked here, published from its page, evergreen, or pasted into
 * ConfigCat by hand: its dates and its config are inside the payload players
 * are reading, so saving *publishes*, straight away. And it can be ended from
 * here the moment somebody sees a problem.
 *
 * The event's dates are the one answer for its window. Whatever the sheet or
 * the page said, the season's start and length and the offer's hours are
 * written from them when the event is saved - so moving an event never needs
 * the sheet reloaded, and never publishes a config on the old dates.
 */
export function LiveOpsDialog({
  environmentId,
  event = null,
  domain: fixedDomain,
  preset = null,
  onClose,
  onDone,
}: LiveOpsDialogProps) {
  const entry = event?.entry ?? null;
  // The booking that still runs this event. A finished booking is history: the
  // event it left behind is edited as if nobody had booked it.
  const owning = entry !== null && (entry.state === 'scheduled' || entry.state === 'active') ? entry : null;
  const mode: 'new' | 'booked' | 'live' | 'history' =
    event === null ? 'new' : event.live !== null ? 'live' : entry?.state === 'scheduled' ? 'booked' : 'history';
  const editable = mode !== 'history';

  const [domain, setDomain] = useState<LiveOpsDomain>(event?.domain ?? fixedDomain ?? LIVEOPS_DOMAINS[0]);
  const feature = LIVEOPS_FEATURES[domain];

  /** What the preset carries, read the same way the calendar reads a live payload. */
  const presetEvent = useMemo(() => {
    if (preset === null) return null;
    const subjectId = preset.subjectId ?? feature.subjectOf(preset.payload);
    return feature.eventsIn(preset.payload).find((candidate) => candidate.subjectId === subjectId) ?? null;
  }, [preset, feature]);

  const [label, setLabel] = useState(event?.name ?? presetEvent?.name ?? '');
  const [category, setCategory] = useState<EventCategory>(event?.category ?? 'monetization');
  const [note, setNote] = useState(entry?.note ?? '');
  const [startNow, setStartNow] = useState(false);

  const initialStart = event?.startsAt ?? presetEvent?.startsAt ?? null;
  const initialEnd = event !== null ? event.endsAt : (presetEvent?.endsAt ?? null);
  // An evergreen event that is given a window starts from now, not the next
  // hour: it is on the menu already, and a later start would take it off.
  const [opensAt, setOpensAt] = useState(() =>
    inputOf(initialStart, event?.live != null ? new Date(Math.floor(Date.now() / 60000) * 60000) : defaultOpen()),
  );
  const [endsAt, setEndsAt] = useState(() =>
    inputOf(initialEnd, new Date((initialStart === null ? defaultOpen().getTime() : Date.parse(initialStart)) + 14 * 86400000)),
  );
  // An evergreen offer: no window at all. Only a feature that has an
  // evergreen form offers the box.
  const [noEnd, setNoEnd] = useState(
    feature.evergreen && (event !== null ? event.endsAt === null : presetEvent !== null && presetEvent.endsAt === null),
  );
  const [confirmed, setConfirmed] = useState(false);

  const [config, setConfig] = useState<EventConfig>({
    payload: preset?.payload ?? null,
    sourceUrl: preset?.sourceUrl ?? entry?.liveops.sourceUrl ?? null,
    blocker: mode === 'new' && preset === null ? 'Load the sheet this event publishes.' : null,
    subjectId: preset?.subjectId ?? event?.subjectId ?? null,
    touched: false,
  });

  const [off, setOff] = useState<OffState | null>(null);
  const [offError, setOffError] = useState<string | null>(null);
  const [savingOff, setSavingOff] = useState(false);

  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Booked, but the immediate publish did not land: the dialog stays open to say so. */
  const [startedLate, setStartedLate] = useState<string | null>(null);

  const targetsLive = isLiveEnvironment(environmentId);
  const where = environmentName(environmentId);

  const now = Date.now();
  // Evergreen is no window at all, for an event in the game. A new or booked
  // one still needs the moment it goes up.
  const opensIso = useMemo(() => {
    if (mode === 'new' && startNow) return new Date(Math.floor(now / 60000) * 60000).toISOString();
    if (mode === 'live' && noEnd) return null;
    return fromLocalInput(opensAt);
    // `now` only matters when starting now, and is read at the moment of saving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opensAt, startNow, noEnd, mode]);
  const endsIso = useMemo(() => (noEnd ? null : fromLocalInput(endsAt)), [endsAt, noEnd]);
  const duration = useMemo(
    () => (opensIso === null || endsIso === null ? null : eventDuration(opensIso, endsIso)),
    [opensIso, endsIso],
  );

  useEffect(() => {
    let cancelled = false;
    setOff(null);
    setOffError(null);
    fetchOff(domain)
      .then((state) => {
        if (!cancelled) setOff(state);
      })
      .catch((reason: Error) => {
        // Kept apart from the general error, because this one blocks booking
        // and a spinner that never resolves says nothing about why.
        if (!cancelled) setOffError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [domain]);

  useEffect(() => {
    const onKey = (key: KeyboardEvent) => {
      if (key.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const recordOff = async () => {
    if (off === null) return;
    setSavingOff(true);
    setError(null);
    try {
      await saveOff(domain, off.payload, `Recorded from the live ops calendar as the off state for ${domain}.`);
      setOff({ ...off, present: true, suggested: false });
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSavingOff(false);
    }
  };

  const fail = (reason: unknown) => {
    if (reason instanceof ScheduleRejected) setProblems(reason.problems);
    else setError((reason as Error).message);
  };

  /** A new config only goes with the save when somebody asked for one. */
  const sendConfig = mode === 'new' || config.touched;
  const windowMoved = event !== null && (opensIso !== event.startsAt || endsIso !== event.endsAt);
  const detailsChanged =
    owning !== null && (label !== owning.label || note !== (owning.note ?? '') || category !== owning.liveops.category);

  const submit = async () => {
    setBusy(true);
    setProblems([]);
    setError(null);
    try {
      if (mode === 'new') {
        if (opensIso === null) throw new Error('When it opens is required.');
        const { started } = await createWindow({
          domain,
          environmentId,
          environmentName: where,
          label: label.trim(),
          note: note === '' ? undefined : note,
          payload: config.payload,
          startsAt: opensIso,
          endsAt: endsIso,
          startNow,
          liveops: { category, opensAt: opensIso, sourceUrl: config.sourceUrl, subjectId: config.subjectId },
        });
        if (startNow && started !== null && !started.ok) {
          setStartedLate(started.detail ?? 'the publish was refused');
          return;
        }
      } else if (owning !== null) {
        // Booked, whether or not it has started: the scheduler owns it, and
        // publishes straight away when a running event's window or config moves.
        await updateWindow({
          id: owning.id,
          label: label.trim(),
          note: note === '' ? null : note,
          endsAt: endsIso,
          payload: sendConfig && config.payload !== null ? config.payload : undefined,
          liveops: {
            category,
            opensAt: opensIso ?? owning.liveops.opensAt,
            sourceUrl: config.sourceUrl ?? owning.liveops.sourceUrl ?? null,
            subjectId: config.subjectId ?? owning.liveops.subjectId ?? null,
          },
        });
      } else if (event !== null && event.subjectId !== null) {
        // In the game with nobody's booking behind it: republish it as it is,
        // with whatever moved.
        await republishEvent({
          domain,
          environmentId,
          subjectId: event.subjectId,
          payload: sendConfig && config.payload !== null ? config.payload : undefined,
          window: windowMoved ? { startsAt: opensIso, endsAt: endsIso } : undefined,
          expected: event.live?.part,
          reason: 'Changed from the live ops calendar.',
        });
      }
      onDone();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const takeDown = async (action: 'end' | 'remove' | 'cancel') => {
    if (event === null) return;
    const question =
      action === 'cancel'
        ? `Cancel "${event.name}"? It has not started, so nothing is published.`
        : action === 'remove'
          ? `Remove "${event.name}" from ${feature.settingKey} in ${where}? ${
              feature.unit === 'list' ? "It is taken out for good and players' progress on it is dropped." : 'The off state is published.'
            }`
          : `End "${event.name}" now in ${where}? ${
              feature.unit === 'list'
                ? "Its window is closed, so it leaves the menu on players' next launch. Their progress is kept."
                : `The off state is published, so the ${feature.noun} leaves the game on players' next launch.`
            }`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setProblems([]);
    setError(null);
    try {
      if (action === 'cancel' || event.live === null) {
        if (entry !== null) await cancelWindow(entry.id, 'Cancelled from the back office.');
      } else if (event.subjectId !== null) {
        await endEvent({
          domain,
          environmentId,
          subjectId: event.subjectId,
          mode: action === 'remove' ? 'remove' : 'end',
          expected: event.live.part,
          reason: `${action === 'remove' ? 'Removed' : 'Ended'} from the back office.`,
        });
      }
      onDone();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const offNeeded = off === null ? feature.unit === 'whole' : off.needed;
  const offReady = !offNeeded || (off !== null && off.present);
  const datesReady =
    (mode === 'live' && noEnd) || (opensIso !== null && (endsIso === null ? noEnd : duration !== null));

  const changed = mode === 'new' || windowMoved || detailsChanged || (config.touched && config.payload !== null);
  const ready =
    editable &&
    datesReady &&
    (mode !== 'new' || offReady) &&
    label.trim() !== '' &&
    (mode === 'new' ? config.payload !== null : !config.touched || config.blocker === null) &&
    changed &&
    (!targetsLive || confirmed);

  const hint = !datesReady
    ? noEnd
      ? 'When it opens is needed.'
      : 'Both dates are needed, with the end after the start.'
    : label.trim() === ''
      ? 'Give the event a name.'
      : config.blocker !== null && (mode === 'new' || config.touched)
        ? config.blocker
        : mode === 'new' && !offReady
          ? 'Record the off state first.'
          : !changed
            ? 'Nothing has changed yet.'
            : 'Confirm the environment.';

  const goesLiveNow = mode === 'live' || (mode === 'new' && startNow);
  const primaryLabel =
    mode === 'new' ? (startNow ? 'Publish now' : 'Schedule it') : mode === 'live' && (windowMoved || config.touched) ? 'Publish changes' : 'Save changes';
  const actions = event === null ? [] : actionsFor(event);
  const chip = event === null ? null : phaseChip(event);

  return (
    <Portal>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={event === null ? 'New live ops event' : `Live ops event ${event.name}`}
      >
        <div className="modal__scrim" role="presentation" onClick={onClose} />
        <div className="modal__panel modal__panel--roomy">
          <div className="modal__head">
            <h2 className="modal__title">
              {event === null ? 'New event' : event.name}
              {chip !== null && <span className={`chip chip--${chip.tone}`}>{chip.label}</span>}
            </h2>
            <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={14} />
            </button>
          </div>

          <div className="modal__body stack-md">
            {mode === 'live' && (
              <p className="banner banner--info">
                <Icon name="info" size={14} className="banner__icon" />
                <span>
                  {owning === null
                    ? `Live in ${where} without a booking - published from its page or edited in ConfigCat. `
                    : `Live in ${where}. `}
                  Saving a new window or config publishes it now.
                </span>
              </p>
            )}

            {event?.missingLive === true && (
              <p className="banner banner--warn">
                <Icon name="alert" size={14} className="banner__icon" />
                <span>
                  Booked as running, but {feature.settingKey} in {where} does not carry it any more - somebody took it
                  out by hand. Call the booking off, or book it again.
                </span>
              </p>
            )}

            <div className="grid-2">
              <label className="field">
                <span className="field__label">Feature</span>
                <select
                  value={domain}
                  onChange={(change) => {
                    const next = change.target.value as LiveOpsDomain;
                    setDomain(next);
                    // Only a feature with an evergreen form can have no end.
                    if (!LIVEOPS_FEATURES[next].evergreen) setNoEnd(false);
                  }}
                  // An event publishes one feature's setting; another feature
                  // would be another event, not this one changed.
                  disabled={event !== null || fixedDomain !== undefined || preset !== null}
                >
                  {LIVEOPS_DOMAINS.map((id) => (
                    <option key={id} value={id}>
                      {DOMAIN_LABELS[id]}
                    </option>
                  ))}
                </select>
              </label>

              {event !== null && owning === null ? (
                <div className="field">
                  <span className="field__label">Booking</span>
                  <output className="field__readout">Published directly, not booked</output>
                </div>
              ) : (
                <label className="field">
                  <span className="field__label">Category</span>
                  <select
                    value={category}
                    disabled={!editable}
                    onChange={(change) => setCategory(change.target.value as EventCategory)}
                  >
                    {EVENT_CATEGORIES.map((id) => (
                      <option key={id} value={id}>
                        {CATEGORY_LABELS[id]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <label className="field">
              <span className="field__label">Name</span>
              <input
                type="text"
                value={label}
                placeholder={feature.unit === 'list' ? 'Weekend roll offer' : 'Season 2 battle pass'}
                // An unbooked event's name is its display name in the payload,
                // which is the config's business, not the calendar's.
                disabled={!editable || (event !== null && owning === null)}
                onChange={(change) => setLabel(change.target.value)}
              />
              {event?.subjectId !== null && event?.subjectId !== undefined && (
                <span className="field__note mono">{event.subjectId}</span>
              )}
            </label>

            {mode === 'new' && (
              <Segmented
                label="Goes live"
                value={startNow ? 'now' : 'date'}
                onChange={(next) => setStartNow(next === 'now')}
                options={[
                  { value: 'date', label: 'At a date' },
                  { value: 'now', label: 'Now' },
                ]}
              />
            )}

            <div className="grid-3">
              <label className="field">
                <span className="field__label" title="When players see it, and when the config is published. Your local time.">
                  Opens
                </span>
                <input
                  type="datetime-local"
                  value={mode === 'new' && startNow ? toLocalInput(new Date()) : opensAt}
                  disabled={!editable || (mode === 'new' && startNow) || (mode === 'live' && noEnd)}
                  onChange={(change) => setOpensAt(change.target.value)}
                />
              </label>

              <label className="field">
                <span className="field__label" title="When it leaves the game. Your local time.">
                  Ends
                </span>
                <input
                  type="datetime-local"
                  value={endsAt}
                  disabled={!editable || noEnd}
                  onChange={(change) => setEndsAt(change.target.value)}
                />
                {feature.evergreen && (
                  <label className="checkline">
                    <input
                      type="checkbox"
                      checked={noEnd}
                      disabled={!editable}
                      onChange={(change) => setNoEnd(change.target.checked)}
                    />
                    <span>Evergreen - no end</span>
                  </label>
                )}
              </label>

              {/* Calculated, never typed: the two dates are the input, and this
                  is the number anybody actually has an opinion about. */}
              <div className="field">
                <span className="field__label">Runs for</span>
                <output className="field__readout">
                  {noEnd ? 'Until ended' : opensIso !== null && endsIso !== null ? durationLabel(opensIso, endsIso) : '-'}
                </output>
              </div>
            </div>

            {editable &&
              (preset !== null && !config.touched ? (
                <p className="field__note">
                  The config built on the {feature.label} page goes with it
                  {presetEvent === null ? '' : ` - ${presetEvent.subjectId}`}. Its dates are taken from the ones above.
                </p>
              ) : (
                <EventConfigSource
                  // One feature's settings are not another's: switching the
                  // feature starts the config step again rather than handing a
                  // season header to the offer panel.
                  key={domain}
                  domain={domain}
                  environmentId={environmentId}
                  opensAt={opensIso}
                  endsAt={endsIso}
                  booked={
                    event === null
                      ? null
                      : {
                          sourceUrl: entry?.liveops.sourceUrl ?? null,
                          bytes: entry?.payloadBytes ?? JSON.stringify(event.live?.part ?? {}).length,
                        }
                  }
                  onResult={setConfig}
                />
              ))}

            {mode !== 'new' && editable && !config.touched && (
              <p className="field__note">
                Its config stays as it is unless you load the sheet or change a field above.
              </p>
            )}

            {/* What happens when it is over - only a question for a feature
                that has an off state to publish. */}
            {mode === 'new' && offNeeded && (
              <div className={offReady ? 'banner banner--ok' : 'banner banner--warn'}>
                <Icon name={offReady ? 'check' : 'alert'} size={14} className="banner__icon" />
                <div className="stack-sm">
                  {offError !== null ? (
                    <p className="field__note">Off state unreadable: {offError}</p>
                  ) : off === null ? (
                    <p className="field__note">
                      <span className="spinner" aria-hidden="true" /> Checking the off state...
                    </p>
                  ) : offReady ? (
                    <p className="field__note">When it ends, {DOMAIN_LABELS[domain]} is removed from the game.</p>
                  ) : (
                    <>
                      <p className="banner__title">Nothing happens when this event ends</p>
                      <p className="field__note">
                        No off state is recorded for {DOMAIN_LABELS[domain]}, so an event could go up but never come
                        down. This is what would be recorded - read it before agreeing to it.
                        {off.means !== null && ` Meaning: ${off.means}`}
                      </p>
                      <pre className="json-view json-view--sm" tabIndex={0}>
                        {JSON.stringify(off.payload, null, 2)}
                      </pre>
                      <button type="button" className="btn btn--sm" onClick={() => void recordOff()} disabled={savingOff}>
                        {savingOff ? 'Recording...' : 'Record this as the off state'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {(mode === 'new' || owning !== null) && (
              <label className="field">
                <span className="field__label">Note</span>
                <textarea rows={2} value={note} disabled={!editable} onChange={(change) => setNote(change.target.value)} />
              </label>
            )}

            {entry !== null && entry.history.length > 0 && (
              <details className="disclosure">
                <summary>History ({entry.history.length})</summary>
                <ul className="param-list">
                  {entry.history.map((line, index) => (
                    <li key={`${line.at}-${index}`} className={line.ok ? 'param' : 'param param--danger'}>
                      <span className="mono">{localTime(line.at)}</span> {line.action}
                      {line.message !== null && ` - ${line.message}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {editable && targetsLive && (
              <label className="checkline checkline--warn">
                <input type="checkbox" checked={confirmed} onChange={(change) => setConfirmed(change.target.checked)} />
                <span>
                  {goesLiveNow
                    ? `This publishes to ${where} now, which is what players are on.`
                    : `This books it for ${where}, which is what players are on.`}
                </span>
              </label>
            )}

            {startedLate !== null && (
              <p className="banner banner--warn">
                <Icon name="alert" size={14} className="banner__icon" />
                <span>
                  Booked, but publishing it did not go through yet: {startedLate}. The heartbeat retries every few
                  minutes, and the calendar shows it as booked until it lands.
                </span>
              </p>
            )}

            {problems.length > 0 && (
              <div className="banner banner--error">
                <Icon name="alert" size={14} className="banner__icon" />
                <div>
                  <p>Nothing was changed.</p>
                  <ul className="banner__list">
                    {problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {error !== null && (
              <p className="banner banner--error">
                <Icon name="alert" size={14} className="banner__icon" />
                <span>{error}</span>
              </p>
            )}
          </div>

          <div className="modal__foot">
            {actions.map(({ action, label: actionLabel, danger }) => (
              <button
                key={action}
                type="button"
                className={danger ? 'btn btn--danger' : 'btn'}
                onClick={() => void takeDown(action)}
                disabled={busy}
                title={
                  event !== null && isLingering(event) && feature.unit === 'list'
                    ? "Takes it out of the list for good. Players lose their progress on it."
                    : undefined
                }
              >
                {actionLabel}
              </button>
            ))}
            {editable && !ready && startedLate === null && <span className="modal__hint">{hint}</span>}
            <button type="button" className="btn" onClick={startedLate === null ? onClose : onDone}>
              {startedLate === null ? 'Close' : 'Done'}
            </button>
            {editable && startedLate === null && (
              <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={!ready || busy}>
                {busy ? 'Saving...' : primaryLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
