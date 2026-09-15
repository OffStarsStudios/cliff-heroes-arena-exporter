import { useId } from 'react';
import { NumberInput } from './NumberInput';
import { OfferDetailsFields } from './OfferDetailsFields';
import { emptyPresentation } from '../lib/liveops';
import type { RollingOfferSchedule } from '../lib/rollingOffer';
import type { ControlsPanelProps } from '../exporters/types';

/**
 * What players see of the offer, its window, and what it is being merged into.
 *
 * The text, the art and the window are here rather than on the sheet for the
 * same reason the battle pass season is: they are decisions about a live run
 * that somebody wants to change in the minute before publishing, not a
 * description of content. When the offer is booked as a live ops event the
 * event owns them outright, so these fields step back - the event form asks for
 * the text and art, and the window is shown as what the booking decided.
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
      {fromEvent !== true && (
        <OfferDetailsFields
          value={value.presentation ?? emptyPresentation()}
          onChange={(presentation) => set({ presentation })}
          defaults={{
            BackgroundArt: value.defaultBackgroundArt,
            TopBarArt: value.defaultTopBarArt,
            RewardArt: value.defaultRewardArt,
            ButtonArt: value.defaultButtonArt,
          }}
        />
      )}

      <div className="field">
        <label className="checkline" htmlFor={timedId}>
          <input
            id={timedId}
            type="checkbox"
            checked={value.isTimed}
            disabled={fromEvent}
            onChange={(event) => set({ isTimed: event.target.checked })}
          />
          <span>Runs between dates</span>
        </label>
        <p className="field__note">
          {fromEvent
            ? 'Taken from the event: its dates are the window, and no end makes it evergreen.'
            : 'Off makes it evergreen: always on the menu, no clock, and the two fields below are ignored.'}
        </p>
      </div>

      {value.isTimed && (
        <div className="grid-2">
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
              aria-describedby={`${startId}-note`}
              onChange={(event) => set({ startUtc: event.target.value })}
            />
            <p id={`${startId}-note`} className="field__note">
              {fromEvent ? 'From the event window.' : 'YYYY-MM-DD HH:mm. The client reads no other spelling.'}
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor={hoursId}>
              Runs for (hours)
            </label>
            <NumberInput
              id={hoursId}
              min={1}
              blankWhen={0}
              value={value.durationHours}
              disabled={fromEvent}
              aria-describedby={`${hoursId}-note`}
              onChange={(durationHours) => set({ durationHours })}
            />
            <p id={`${hoursId}-note`} className="field__note">
              {readableLength}.
            </p>
          </div>
        </div>
      )}

      <div className="field">
        <span className="field__label">Live now</span>
        {value.others === null ? (
          <p className="field__note">
            Not read from ConfigCat yet, so nothing can be published: without the live list this offer would replace
            every other one.
          </p>
        ) : value.others.length === 0 ? (
          <p className="field__note">Nothing else is running. This will be the only offer in the published schedule.</p>
        ) : (
          <>
            <span className="param-list">
              {value.others.map((other) => (
                <span key={other.OfferID} className="tag tag--unlock">
                  {other.OfferID}
                </span>
              ))}
            </span>
            <p className="field__note">
              Read from ConfigCat just now. Publishing adds this sheet&rsquo;s offer as a new run - or changes the run
              of it that is live - and carries the rest through untouched: the client takes the list whole, so an offer
              left out would be retired and its players&rsquo; progress dropped.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
