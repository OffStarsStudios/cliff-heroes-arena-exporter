import { useId } from 'react';
import type { RollingOfferSchedule } from '../lib/rollingOffer';
import type { ControlsPanelProps } from '../exporters/types';

/**
 * The offer's window, and what it is being merged into.
 *
 * The window is here rather than on the sheet for the same reason the battle
 * pass season is: it is a decision about a live run that somebody wants to
 * change in the minute before publishing, not a description of content. When
 * the offer is booked as a live ops event the event owns it outright and these
 * fields show what the booking decided rather than inviting a second answer.
 *
 * The rest of the schedule is shown but not editable. It is the part of the
 * payload this sheet does not describe, and seeing it is the difference between
 * "publish this offer" and "publish these five offers, one of which I edited" -
 * which is what actually happens, because the client takes the list whole.
 */
export function OfferWindowPanel({ value, onChange, fromEvent }: ControlsPanelProps<RollingOfferSchedule>) {
  const timedId = useId();
  const startId = useId();
  const hoursId = useId();

  const set = (patch: Partial<RollingOfferSchedule>) => onChange({ ...value, ...patch });

  const days = value.durationHours > 0 ? value.durationHours / 24 : 0;
  const readableLength =
    days >= 1 && Number.isInteger(days) ? `${days} day${days === 1 ? '' : 's'}` : `${value.durationHours} hours`;

  return (
    <div className="stack-md">
      <div className="field">
        <label className="field__label" htmlFor={timedId}>
          <input
            id={timedId}
            type="checkbox"
            checked={value.isTimed}
            disabled={fromEvent}
            onChange={(event) => set({ isTimed: event.target.checked })}
          />{' '}
          Runs between dates
        </label>
        <p className="field__hint">
          Off makes it evergreen: always on the menu, no clock, and the two fields below are ignored.
        </p>
      </div>

      {value.isTimed && (
        <>
          <div className="field">
            <label className="field__label" htmlFor={startId}>
              Opens (UTC)
            </label>
            <input
              id={startId}
              type="text"
              placeholder="2026-10-01 09:00"
              value={value.startUtc}
              disabled={fromEvent}
              onChange={(event) => set({ startUtc: event.target.value })}
            />
            <p className="field__hint">
              {fromEvent
                ? 'Taken from the event window, so there is one answer rather than two.'
                : 'YYYY-MM-DD HH:mm. The client reads no other spelling.'}
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor={hoursId}>
              Runs for (hours)
            </label>
            <input
              id={hoursId}
              type="number"
              min={1}
              value={value.durationHours}
              disabled={fromEvent}
              onChange={(event) => set({ durationHours: Number(event.target.value) })}
            />
            <p className="field__hint">{readableLength}.</p>
          </div>
        </>
      )}

      <div className="field">
        <span className="field__label">Also live</span>
        {value.others.length === 0 ? (
          <p className="field__hint">
            Nothing else is running. This will be the only offer in the published schedule.
          </p>
        ) : (
          <>
            <span className="param-list">
              {value.others.map((other) => (
                <span key={other.OfferID} className="tag tag--unlock">
                  {other.OfferID}
                </span>
              ))}
            </span>
            <p className="field__hint">
              Carried through untouched. The client takes the offer list whole, so publishing sends
              all of these as well as this one &mdash; an offer left out would be retired, and its
              players&rsquo; progress dropped.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
