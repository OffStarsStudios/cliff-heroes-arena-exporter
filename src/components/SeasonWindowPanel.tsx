import { useId } from 'react';
import { Icon } from './Icon';
import { seasonEndUtc, type BattlePassSchedule } from '../lib/battlePass';

/**
 * The three battle pass fields the console owns rather than the sheet.
 *
 * A season window is a decision about a live game, not a description of a
 * ladder, and it is the thing somebody wants to nudge in the minute before
 * publishing - push the start back an hour, run it a week longer, drop in the
 * final reward art now that it exists. Doing that through Drive means editing
 * a cell, re-exporting and reloading, so it happens here instead.
 *
 * The start is stated and stored in UTC, because that is what the client
 * reads. `datetime-local` carries no zone of its own, which is exactly what is
 * wanted here - the field is labelled UTC and the value is taken at face value
 * rather than being converted out of whatever zone the browser happens to be
 * in. The computed end is shown underneath so the window is legible without
 * anybody having to add days in their head.
 */

interface SeasonWindowPanelProps {
  value: BattlePassSchedule;
  onChange: (next: BattlePassSchedule) => void;
}

/** `YYYY-MM-DD HH:mm` (what the client reads) -> what the input wants. */
function toInput(startUtc: string): string {
  return startUtc.trim() === '' ? '' : startUtc.trim().replace(' ', 'T').slice(0, 16);
}

/** The input's value back to the canonical form. Seconds, if any, are dropped. */
function fromInput(value: string): string {
  return value.trim() === '' ? '' : value.trim().replace('T', ' ').slice(0, 16);
}

/** "2026-10-01 00:00" as "1 Oct 2026, 00:00 UTC". */
export function readableUtc(stamp: string): string {
  const parsed = Date.parse(`${stamp.replace(' ', 'T')}:00Z`);
  if (Number.isNaN(parsed)) return stamp;
  const date = new Date(parsed);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    date.getUTCMonth()
  ];
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

export function SeasonWindowPanel({ value, onChange }: SeasonWindowPanelProps) {
  const ids = useId();
  const end = seasonEndUtc(value);

  return (
    <div className="stack-sm">
      <div className="grid-fields">
        <div className="field">
          <label className="field__label" htmlFor={`${ids}-start`}>
            Season start, in UTC
          </label>
          <input
            id={`${ids}-start`}
            type="datetime-local"
            value={toInput(value.startUtc)}
            onChange={(event) => onChange({ ...value, startUtc: fromInput(event.target.value) })}
          />
          <span className="field__note">
            Taken as UTC exactly as typed, not as your local time.
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${ids}-duration`}>
            Duration, in days
          </label>
          <input
            id={`${ids}-duration`}
            type="number"
            min={1}
            step={1}
            value={Number.isFinite(value.durationDays) && value.durationDays !== 0 ? value.durationDays : ''}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({ ...value, durationDays: Number.isNaN(parsed) ? 0 : parsed });
            }}
          />
          <span className="field__note">Whole days. The season ends this long after it starts.</span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${ids}-art`}>
            Final reward art
          </label>
          <input
            id={`${ids}-art`}
            type="text"
            value={value.finalRewardArt}
            placeholder="Leave empty for no art"
            onChange={(event) => onChange({ ...value, finalRewardArt: event.target.value })}
          />
          <span className="field__note">
            The one field the game accepts empty. Published as written.
          </span>
        </div>
      </div>

      {end !== null && (
        <p className="banner banner--info">
          <Icon name="info" size={14} className="banner__icon" />
          <span>
            The season runs from <strong>{readableUtc(value.startUtc)}</strong> to{' '}
            <strong>{readableUtc(end)}</strong>.
          </span>
        </p>
      )}
    </div>
  );
}
