import { useMemo } from 'react';
import { DOMAIN_LABELS, type DomainId } from '../domains/types';
import {
  CATEGORY_COLOURS,
  CATEGORY_LABELS,
  LIVEOPS_DOMAINS,
  PHASE_LABELS,
  layOutBars,
  ticksFor,
  type LiveOpsEntry,
} from '../lib/liveops';
import { localTime } from '../lib/schedule';

interface LiveOpsGanttProps {
  events: LiveOpsEntry[];
  /** Start of the visible range, in ms. */
  from: number;
  /** End of the visible range, in ms. */
  to: number;
  now: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * The calendar view: one lane per feature, time along the x axis.
 *
 * A gantt rather than a month grid because the question being asked is about
 * overlap and gaps - "is anything running that week", "do these two collide" -
 * and a month grid answers that badly the moment an event crosses a Sunday.
 * Lanes are per feature, not per event, because two events on one feature are
 * exactly the thing the scheduler refuses and the eye should catch first.
 *
 * Everything is laid out in fractions by `layOutBars`, so this component only
 * turns numbers into percentages and never does date arithmetic of its own.
 */
export function LiveOpsGantt({ events, from, to, now, selectedId, onSelect }: LiveOpsGanttProps) {
  const lanes = useMemo(
    () =>
      (LIVEOPS_DOMAINS as readonly DomainId[]).map((domain) => ({
        domain,
        label: DOMAIN_LABELS[domain],
        bars: layOutBars(
          events.filter((event) => event.domain === domain),
          from,
          to,
          now,
        ),
      })),
    [events, from, to, now],
  );

  const ticks = useMemo(() => ticksFor(from, to), [from, to]);
  const nowLeft = now >= from && now <= to ? ((now - from) / Math.max(to - from, 1)) * 100 : null;

  return (
    <div className="gantt">
      <div className="gantt__ruler">
        <div className="gantt__lane-head" aria-hidden="true" />
        <div className="gantt__track">
          {ticks.map((tick) => (
            <span
              key={tick.at}
              className={tick.major ? 'gantt__tick gantt__tick--major' : 'gantt__tick'}
              style={{ left: `${tick.left * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      <div className="gantt__body">
        {lanes.map((lane) => (
          <div className="gantt__lane" key={lane.domain}>
            <div className="gantt__lane-head">{lane.label}</div>
            <div
              className="gantt__track"
              style={{
                ['--rows' as string]: String(
                  lane.bars.reduce((most, bar) => Math.max(most, bar.row + 1), 1),
                ),
              }}
            >
              {ticks.map((tick) => (
                <span
                  key={tick.at}
                  className={tick.major ? 'gantt__gridline gantt__gridline--major' : 'gantt__gridline'}
                  style={{ left: `${tick.left * 100}%` }}
                  aria-hidden="true"
                />
              ))}

              {lane.bars.length === 0 && <span className="gantt__empty">Nothing scheduled in this range</span>}

              {lane.bars.map((bar) => {
                const colour = CATEGORY_COLOURS[bar.entry.liveops.category];
                const label = bar.entry.label === '' ? DOMAIN_LABELS[bar.entry.domain] : bar.entry.label;
                return (
                  <button
                    type="button"
                    key={bar.entry.id}
                    className={[
                      'gantt__bar',
                      `gantt__bar--${bar.phase}`,
                      bar.clippedStart ? 'gantt__bar--open-start' : '',
                      bar.clippedEnd ? 'gantt__bar--open-end' : '',
                      bar.entry.id === selectedId ? 'gantt__bar--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      left: `${bar.left * 100}%`,
                      width: `${bar.width * 100}%`,
                      top: `${8 + bar.row * 40}px`,
                      // The preview slice is drawn as a hatch over the head of
                      // the bar: the config is live but the event is not, and
                      // those two facts have to be visible at once.
                      ['--preview' as string]: `${bar.previewFraction * 100}%`,
                      ['--event-colour' as string]: colour,
                    }}
                    aria-pressed={bar.entry.id === selectedId}
                    onClick={() => onSelect(bar.entry.id === selectedId ? null : bar.entry.id)}
                    title={`${label}\n${CATEGORY_LABELS[bar.entry.liveops.category]} - ${PHASE_LABELS[bar.phase]}\nOpens ${localTime(
                      bar.entry.liveops.opensAt,
                    )}\nEnds ${localTime(bar.entry.endsAt)}`}
                  >
                    <span className="gantt__bar-label">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {nowLeft !== null && (
        <div className="gantt__now" style={{ left: `calc(var(--gantt-head) + (100% - var(--gantt-head)) * ${nowLeft / 100})` }}>
          <span className="gantt__now-label">now</span>
        </div>
      )}
    </div>
  );
}
