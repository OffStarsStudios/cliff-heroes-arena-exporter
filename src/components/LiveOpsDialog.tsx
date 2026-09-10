import { useEffect, useMemo, useState } from 'react';
import { EventConfigSource, type EventConfig } from './EventConfigSource';
import { Icon } from './Icon';
import { environmentName, isLiveEnvironment } from '../domains/account';
import { DOMAIN_LABELS, type DomainId } from '../domains/types';
import {
  CATEGORY_LABELS,
  EVENT_CATEGORIES,
  LIVEOPS_DOMAINS,
  durationLabel,
  eventDuration,
  type EventCategory,
  type LiveOpsDomain,
} from '../lib/liveops';
import {
  ScheduleRejected,
  createWindow,
  fetchOff,
  fromLocalInput,
  saveOff,
  toLocalInput,
  type OffState,
} from '../lib/schedule';

interface LiveOpsDialogProps {
  environmentId: string;
  onClose: () => void;
  onScheduled: () => void;
}

/** Next whole hour: events open on the hour, not at 18:07. */
function defaultOpen(): Date {
  const date = new Date(Date.now() + 3600000);
  date.setMinutes(0, 0, 0);
  return date;
}

/**
 * Books a live ops event.
 *
 * Three things make this different from scheduling a core config, and all
 * three are about the same fact - the feature is not always there.
 *
 * The end time is required. A window with no end never comes down, and a
 * battle pass that never comes down is not an event. Because it is required,
 * the form can say how long the event runs, which is the number designers
 * actually argue about; the two dates are only how it is written down.
 *
 * What it comes down *to* is the off state, not a default. The dialog will not
 * let an event be booked until that payload has been looked at and recorded,
 * because "what the game receives when nothing is running" is a contract with
 * the client that the console must not invent on somebody's behalf.
 *
 * And what it goes up *with* is a spreadsheet - the next season exists as a
 * sheet, not as something already published - so the config is loaded from its
 * link here and checked exactly as its own page would check it.
 */
export function LiveOpsDialog({ environmentId, onClose, onScheduled }: LiveOpsDialogProps) {
  const [domain, setDomain] = useState<LiveOpsDomain>(LIVEOPS_DOMAINS[0]);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<EventCategory>('monetization');
  const [note, setNote] = useState('');
  const [opensAt, setOpensAt] = useState(() => toLocalInput(defaultOpen()));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(defaultOpen().getTime() + 30 * 86400000)));
  const [confirmed, setConfirmed] = useState(false);

  const [config, setConfig] = useState<EventConfig>({
    payload: null,
    sourceUrl: null,
    blocker: 'Load the sheet this event publishes.',
  });

  const [off, setOff] = useState<OffState | null>(null);
  const [offError, setOffError] = useState<string | null>(null);
  const [showOff, setShowOff] = useState(false);
  const [savingOff, setSavingOff] = useState(false);

  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const targetsLive = isLiveEnvironment(environmentId);

  // The event's window, in the ISO the scheduler and the exporters speak.
  const opensIso = useMemo(() => fromLocalInput(opensAt), [opensAt]);
  const endsIso = useMemo(() => fromLocalInput(endsAt), [endsAt]);
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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

  const submit = async () => {
    setBusy(true);
    setProblems([]);
    setError(null);
    try {
      if (opensIso === null || endsIso === null) throw new Error('Both dates are required.');
      await createWindow({
        domain,
        environmentId,
        environmentName: environmentName(environmentId),
        label,
        note: note === '' ? undefined : note,
        payload: config.payload,
        // The window and the event are now the same span: the config goes up
        // when the event opens. Sent anyway so the request is a valid window
        // when it is read on its own.
        startsAt: opensIso,
        endsAt: endsIso,
        liveops: { category, opensAt: opensIso, sourceUrl: config.sourceUrl },
      });
      onScheduled();
    } catch (reason) {
      if (reason instanceof ScheduleRejected) setProblems(reason.problems);
      else setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const offReady = off !== null && off.present;
  const datesReady = opensIso !== null && endsIso !== null && duration !== null;
  const ready =
    offReady &&
    datesReady &&
    label.trim() !== '' &&
    config.payload !== null &&
    (!targetsLive || confirmed);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Schedule a live ops event">
      <div className="modal__scrim" role="presentation" onClick={onClose} />
      <div className="modal__panel modal__panel--roomy">
        <div className="modal__head">
          <h2 className="modal__title">Schedule an event</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="modal__body stack-md">
          <div className="grid-2">
            <label className="field">
              <span className="field__label">Feature</span>
              <select
                value={domain}
                onChange={(event) => setDomain(event.target.value as LiveOpsDomain)}
                disabled={LIVEOPS_DOMAINS.length === 1}
              >
                {LIVEOPS_DOMAINS.map((id) => (
                  <option key={id} value={id}>
                    {DOMAIN_LABELS[id as DomainId]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as EventCategory)}>
                {EVENT_CATEGORIES.map((id) => (
                  <option key={id} value={id}>
                    {CATEGORY_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span className="field__label">Name</span>
            <input
              type="text"
              value={label}
              placeholder="Season 1 battle pass"
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>

          <div className="grid-3">
            <label className="field">
              <span
                className="field__label"
                title="When players see it, and when the config is published. Your local time."
              >
                Opens
              </span>
              <input type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
            </label>

            <label className="field">
              <span className="field__label" title="When the feature leaves the game for good.">
                Ends
              </span>
              <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
            </label>

            {/* Calculated, never typed: the two dates are the input, and this is
                the number anybody actually has an opinion about. */}
            <div className="field">
              <span className="field__label">Runs for</span>
              <output className="field__readout">
                {datesReady ? durationLabel(opensIso, endsIso) : '-'}
              </output>
            </div>
          </div>

          <EventConfigSource
            domain={domain}
            environmentId={environmentId}
            opensAt={opensIso}
            endsAt={endsIso}
            onResult={setConfig}
          />

          {/* The whole point of a live ops event: what happens when it is over.
              Answered, it is one line; unanswered, it is a decision somebody has
              to read before agreeing to, and keeps its explanation. */}
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
                <p className="field__note">
                  When it ends, {DOMAIN_LABELS[domain as DomainId]} is removed from the game.{' '}
                  <button type="button" className="linkbtn" onClick={() => setShowOff(!showOff)}>
                    {showOff ? 'Hide the off state' : 'Show the off state'}
                  </button>
                </p>
              ) : (
                <>
                  <p className="banner__title">Nothing happens when this event ends</p>
                  <p className="field__note">
                    No off state is recorded for {DOMAIN_LABELS[domain as DomainId]}, so an event could go up but never
                    come down. This is what would be recorded - a contract with the client, so read it before agreeing
                    to it.
                    {off.means !== null && ` Meaning: ${off.means}`}
                  </p>
                  <pre className="json-view json-view--sm" tabIndex={0}>{JSON.stringify(off.payload, null, 2)}</pre>
                  <button type="button" className="btn btn--sm" onClick={() => void recordOff()} disabled={savingOff}>
                    {savingOff ? 'Recording...' : 'Record this as the off state'}
                  </button>
                </>
              )}
              {offReady && showOff && (
                <pre className="json-view json-view--sm" tabIndex={0}>{JSON.stringify(off.payload, null, 2)}</pre>
              )}
            </div>
          </div>

          <label className="field">
            <span className="field__label">Note</span>
            <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>

          {targetsLive && (
            <label className="checkline">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>
                This targets {environmentName(environmentId)}, which is what players are on. Book it.
              </span>
            </label>
          )}

          {problems.length > 0 && (
            <div className="banner banner--error">
              <Icon name="alert" size={14} className="banner__icon" />
              <div>
                <p>This event was not scheduled.</p>
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
          {/* Says what is still missing rather than leaving a dead button to be
              stared at - the config step has several ways to be incomplete. */}
          {!ready && (
            <span className="modal__hint">
              {!datesReady
                ? 'Both dates are needed.'
                : label.trim() === ''
                  ? 'Give the event a name.'
                  : config.blocker !== null
                    ? config.blocker
                    : !offReady
                      ? 'Record the off state first.'
                      : 'Confirm the environment.'}
            </span>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={!ready || busy}>
            {busy ? 'Scheduling...' : 'Schedule it'}
          </button>
        </div>
      </div>
    </div>
  );
}
