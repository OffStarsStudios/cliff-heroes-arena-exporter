import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { environmentName, isLiveEnvironment } from '../domains/account';
import { DOMAIN_LABELS, type DomainId } from '../domains/types';
import { fetchLiveConfig } from '../lib/liveConfig';
import {
  CATEGORY_LABELS,
  EVENT_CATEGORIES,
  LIVEOPS_DOMAINS,
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

/** Where the event's config comes from. */
type Source = 'baseline' | 'live';

/** Next whole hour: events open on the hour, not at 18:07. */
function defaultOpen(): Date {
  const date = new Date(Date.now() + 3600000);
  date.setMinutes(0, 0, 0);
  return date;
}

function bytesOf(payload: unknown): number {
  return payload === null || payload === undefined ? 0 : new TextEncoder().encode(JSON.stringify(payload)).length;
}

/**
 * Books a live ops event.
 *
 * Two things make this different from scheduling a core config, and both are
 * about the same fact - the feature is not always there.
 *
 * The end time is required. A window with no end never comes down, and a
 * battle pass that never comes down is not an event.
 *
 * What it comes down *to* is the off state, not a default. The dialog will not
 * let an event be booked until that payload has been looked at and recorded,
 * because "what the game receives when nothing is running" is a contract with
 * the client that the console must not invent on somebody's behalf.
 */
export function LiveOpsDialog({ environmentId, onClose, onScheduled }: LiveOpsDialogProps) {
  const [domain, setDomain] = useState<LiveOpsDomain>(LIVEOPS_DOMAINS[0]);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<EventCategory>('monetization');
  const [note, setNote] = useState('');
  const [opensAt, setOpensAt] = useState(() => toLocalInput(defaultOpen()));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(defaultOpen().getTime() + 30 * 86400000)));
  const [previewHours, setPreviewHours] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  const [source, setSource] = useState<Source>('baseline');
  const [baseline, setBaseline] = useState<unknown>(null);
  const [live, setLive] = useState<unknown>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [off, setOff] = useState<OffState | null>(null);
  const [offError, setOffError] = useState<string | null>(null);
  const [showOff, setShowOff] = useState(false);
  const [savingOff, setSavingOff] = useState(false);

  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const targetsLive = isLiveEnvironment(environmentId);
  const payload = source === 'baseline' ? baseline : live;

  useEffect(() => {
    let cancelled = false;
    setLoadingConfig(true);
    setError(null);
    fetchLiveConfig(domain, environmentId)
      .then((view) => {
        if (cancelled) return;
        setBaseline(view.baseline.present ? view.baseline.json : null);
        setLive(view.live.present ? view.live.json : null);
        // Prefer whatever is actually there, so the first thing shown is never
        // an empty attachment.
        setSource(view.baseline.present ? 'baseline' : 'live');
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, [domain, environmentId]);

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
    const opensIso = fromLocalInput(opensAt);
    const endsIso = fromLocalInput(endsAt);
    try {
      if (opensIso === null || endsIso === null) throw new Error('Both dates are required.');
      await createWindow({
        domain,
        environmentId,
        environmentName: environmentName(environmentId),
        label,
        note: note === '' ? undefined : note,
        payload,
        // Worked out on the server from the event's own times; sent so the
        // request is a valid window even when read on its own.
        startsAt: opensIso,
        endsAt: endsIso,
        liveops: { category, opensAt: opensIso, previewHours },
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
  const ready =
    offReady && label.trim() !== '' && payload !== null && (!targetsLive || confirmed) && !loadingConfig;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Schedule a live ops event">
      <div className="modal__scrim" role="presentation" onClick={onClose} />
      <div className="modal__panel">
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
              <span className="field__note">
                Only features that come and go are here. Core configs are edited on their own pages.
              </span>
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
            <span className="field__note">What this shows as on the calendar.</span>
          </label>

          <div className="grid-2">
            <label className="field">
              <span className="field__label">Opens</span>
              <input type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
              <span className="field__note">When players see it. Your local time.</span>
            </label>

            <label className="field">
              <span className="field__label">Ends</span>
              <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
              <span className="field__note">When it leaves the game for good.</span>
            </label>

            <label className="field">
              <span className="field__label">Preview hours</span>
              <input
                type="number"
                min={0}
                max={336}
                value={previewHours}
                onChange={(event) => setPreviewHours(Number(event.target.value))}
              />
              <span className="field__note">
                Publish the config this early so the client can advertise it. 0 for none.
              </span>
            </label>
          </div>

          <div className="field">
            <span className="field__label">The config it carries</span>
            {loadingConfig ? (
              <p className="field__note">
                <span className="spinner" aria-hidden="true" /> Reading {DOMAIN_LABELS[domain as DomainId]}...
              </p>
            ) : (
              <>
                <div className="grid-2">
                  <label className="checkline">
                    <input
                      type="radio"
                      checked={source === 'baseline'}
                      disabled={baseline === null}
                      onChange={() => setSource('baseline')}
                    />
                    <span>
                      Last published
                      <span className="field__note">
                        {baseline === null ? 'nothing recorded yet' : `${(bytesOf(baseline) / 1024).toFixed(1)} kB from git`}
                      </span>
                    </span>
                  </label>
                  <label className="checkline">
                    <input
                      type="radio"
                      checked={source === 'live'}
                      disabled={live === null}
                      onChange={() => setSource('live')}
                    />
                    <span>
                      Live value
                      <span className="field__note">
                        {live === null
                          ? 'nothing live'
                          : `${(bytesOf(live) / 1024).toFixed(1)} kB from ${environmentName(environmentId)}`}
                      </span>
                    </span>
                  </label>
                </div>
                <span className="field__note">
                  To schedule something new, build it on the {DOMAIN_LABELS[domain as DomainId]} page first and publish
                  it - this attaches what is recorded, not what is in a spreadsheet.
                </span>
              </>
            )}
          </div>

          {/* The whole point of a live ops event: what happens when it is over. */}
          <div className={offReady ? 'banner banner--ok' : 'banner banner--warn'}>
            <Icon name={offReady ? 'check' : 'alert'} size={14} className="banner__icon" />
            <div className="stack-sm">
              <p className="banner__title">When this event ends</p>
              {offError !== null ? (
                <p className="field__note">
                  The off state could not be read, so no event can be booked yet: {offError}
                </p>
              ) : off === null ? (
                <p className="field__note">
                  <span className="spinner" aria-hidden="true" /> Checking the off state...
                </p>
              ) : offReady ? (
                <p className="field__note">
                  {DOMAIN_LABELS[domain as DomainId]} is removed from the game: the off state is published in its place.
                  {off.means !== null && ` ${off.means}`}{' '}
                  <button type="button" className="linkbtn" onClick={() => setShowOff(!showOff)}>
                    {showOff ? 'Hide it' : 'Show it'}
                  </button>
                </p>
              ) : (
                <>
                  <p className="field__note">
                    Nothing is recorded for {DOMAIN_LABELS[domain as DomainId]} yet, so an event could go up but never
                    come down. This is what would be recorded - it is a contract with the client, so read it before
                    agreeing to it.
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
