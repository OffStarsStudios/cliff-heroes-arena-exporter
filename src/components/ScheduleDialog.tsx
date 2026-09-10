import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Portal } from './Portal';
import { ACCOUNT, environmentName, isLiveEnvironment } from '../domains/account';
import { DOMAIN_LABELS, SETTING_KEYS, type DomainId } from '../domains/types';
import { fetchValues } from '../lib/liveConfig';
import {
  ScheduleRejected,
  createWindow,
  fetchDefault,
  fromLocalInput,
  saveDefault,
  toLocalInput,
} from '../lib/schedule';

interface ScheduleDialogProps {
  domain: DomainId;
  payload: unknown;
  environmentId: string;
  onClose: () => void;
  onScheduled: () => void;
}

/** Rounded to the next quarter hour, because nobody schedules a promotion for 18:07. */
function defaultStart(): Date {
  const date = new Date(Date.now() + 3600000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return date;
}

/**
 * Books a window for one config.
 *
 * The dialog is opinionated about one thing: a window that ends cannot be
 * created until the config has a default recorded, because otherwise the end
 * of the window would mean taking a config away from a running game with
 * nothing to put in its place. Rather than only refusing, it offers the fix -
 * the value that is live right now is almost always the right default, and one
 * press records it.
 */
export function ScheduleDialog({ domain, payload, environmentId, onClose, onScheduled }: ScheduleDialogProps) {
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [startsAt, setStartsAt] = useState(() => toLocalInput(defaultStart()));
  const [hasEnd, setHasEnd] = useState(true);
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(defaultStart().getTime() + 3 * 86400000)));
  const [confirmed, setConfirmed] = useState(false);

  const [hasDefault, setHasDefault] = useState<boolean | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const targetsLive = isLiveEnvironment(environmentId);

  useEffect(() => {
    let cancelled = false;
    fetchDefault(domain)
      .then((result) => {
        if (!cancelled) setHasDefault(result.present);
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setHasDefault(false);
          setError(reason.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [domain]);

  // Escape closes, because a dialog that traps you is worse than no dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const captureDefault = async () => {
    setSavingDefault(true);
    setError(null);
    try {
      const values = await fetchValues(ACCOUNT.configId, environmentId);
      const live = values.settings.find((setting) => setting.key === SETTING_KEYS[domain]);
      if (live === undefined || live.json === null) {
        throw new Error(
          `${SETTING_KEYS[domain]} could not be read from ${environmentName(environmentId)}, so there is nothing to record as the default.`,
        );
      }
      await saveDefault(domain, live.json, `Captured from ${environmentName(environmentId)} as the fallback for ${DOMAIN_LABELS[domain]}.`);
      setHasDefault(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSavingDefault(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setProblems([]);
    setError(null);
    const start = fromLocalInput(startsAt);
    const end = hasEnd ? fromLocalInput(endsAt) : null;

    if (start === null) {
      setProblems(['A start time is required.']);
      setBusy(false);
      return;
    }

    try {
      await createWindow({
        domain,
        environmentId,
        environmentName: environmentName(environmentId),
        label: label.trim(),
        note: note.trim() === '' ? undefined : note.trim(),
        payload,
        startsAt: start,
        endsAt: end,
      });
      onScheduled();
      onClose();
    } catch (reason) {
      if (reason instanceof ScheduleRejected) setProblems(reason.problems);
      else setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const blockedOnDefault = hasEnd && hasDefault === false;
  const canSubmit = !busy && !blockedOnDefault && (!targetsLive || confirmed);

  return (
    <Portal>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-title">
      <div className="modal__scrim" onClick={onClose} aria-hidden="true" />
      <div className="modal__panel">
        <header className="modal__head">
          <h2 className="modal__title" id="schedule-title">
            <Icon name="calendar" size={17} />
            Schedule {DOMAIN_LABELS[domain]}
          </h2>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="modal__body stack-md">
          <p className="field__note">
            The back office publishes this config to {environmentName(environmentId)} when the window
            opens, and puts it back afterwards. Nobody has to be awake for either.
          </p>

          <div className="field">
            <label className="field__label" htmlFor="schedule-label">
              What is this window
            </label>
            <input
              id="schedule-label"
              type="text"
              placeholder="Weekend shop takeover"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <span className="field__note">Shown on the dashboard and written into the audit log.</span>
          </div>

          <div className="grid-2">
            <div className="field">
              <label className="field__label" htmlFor="schedule-start">
                Goes live
              </label>
              <input
                id="schedule-start"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
              <span className="field__note">Your local time.</span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="schedule-end">
                Comes down
              </label>
              <input
                id="schedule-end"
                type="datetime-local"
                value={endsAt}
                disabled={!hasEnd}
                onChange={(event) => setEndsAt(event.target.value)}
              />
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={!hasEnd}
                  onChange={(event) => setHasEnd(!event.target.checked)}
                />
                Leave it up until something replaces it
              </label>
            </div>
          </div>

          {blockedOnDefault && (
            <div className="banner banner--warn">
              <Icon name="shield" size={15} className="banner__icon" />
              <span>
                <strong>{DOMAIN_LABELS[domain]} has no default recorded.</strong> A window that comes
                down needs somewhere to go back to, so this one cannot be scheduled yet. The value
                that is live in {environmentName(environmentId)} right now is almost always the right
                default.
                <span style={{ display: 'block', marginTop: 8 }}>
                  <button type="button" className="btn btn--sm" onClick={() => void captureDefault()} disabled={savingDefault}>
                    {savingDefault ? <span className="spinner" aria-hidden="true" /> : <Icon name="shield" size={13} />}
                    Record the current live value as the default
                  </button>
                </span>
              </span>
            </div>
          )}

          {hasEnd && hasDefault === true && (
            <p className="banner banner--ok">
              <Icon name="check" size={14} className="banner__icon" />
              <span>
                When this window ends the config falls back to the recorded default for{' '}
                {DOMAIN_LABELS[domain]}, unless another window is due to start at the same moment.
              </span>
            </p>
          )}

          <div className="field">
            <label className="field__label" htmlFor="schedule-note">
              Note for the audit log (optional)
            </label>
            <input
              id="schedule-note"
              type="text"
              placeholder="Prices agreed with the publisher on Tuesday"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {targetsLive && (
            <label className="checkline checkline--warn">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              This publishes to {environmentName(environmentId)}, which the shipped game reads.
            </label>
          )}

          {problems.length > 0 && (
            <div className="banner banner--error" role="alert">
              <Icon name="alert" size={15} className="banner__icon" />
              <span>
                <strong>This window was not scheduled.</strong>
                <ul className="banner__list">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </span>
            </div>
          )}

          {error !== null && (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" size={15} className="banner__icon" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? <span className="spinner spinner--on-accent" aria-hidden="true" /> : <Icon name="calendar" size={14} />}
            Schedule it
          </button>
        </footer>
      </div>
    </div>
    </Portal>
  );
}
