import { useMemo } from 'react';
import { eventColour, phaseChip } from './EventBoard';
import { DOMAIN_LABELS } from '../domains/types';
import { CATEGORY_LABELS, LIVEOPS_DOMAINS, layOutBars, ticksFor, type BoardEvent } from '../lib/liveops';
import { localTime } from '../lib/schedule';

interface LiveOpsGanttProps {
  events: BoardEvent[];
  /** Start of the visible range, in ms. */
  from: number;
  /** End of the visible range, in ms. */
  to: number;
  now: number;
  selectedKey: string | null;
  /** A bar is the event: clicking one opens it, the way a board card does. */
  onOpen: (event: BoardEvent) => void;
}

/**
 * The calendar view: one lane per feature, time along the x axis.
 *
 * A gantt rather than a month grid because the question being asked is about
 * overlap and gaps - "is anything running that week", "do these two collide" -
 * and a month grid answers that badly the moment an event crosses a Sunday.
 *
 * Everything is laid out in fractions by `layOutBars`, so this component only
 * turns numbers into percentages and never does date arithmetic of its own.
 */
export function LiveOpsGantt({ events, from, to, now, selectedKey, onOpen }: LiveOpsGanttProps) {
  const lanes = useMemo(
    () =>
      LIVEOPS_DOMAINS.map((domain) => ({
        domain,
        label: DOMAIN_LABELS[domain],
        bars: layOutBars(
          events.filter((event) => event.domain === domain),
          from,
          to,
        ),
      })),
    [events, from, to],
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

              {lane.bars.length === 0 && <span className="gantt__empty">Nothing running or booked in this range</span>}

              {lane.bars.map((bar) => {
                const { event } = bar;
                const chip = phaseChip(event);
                return (
                  <button
                    type="button"
                    key={event.key}
                    className={[
                      'gantt__bar',
                      `gantt__bar--${event.phase}`,
                      event.category === null ? 'gantt__bar--unbooked' : '',
                      event.missingLive ? 'gantt__bar--missing' : '',
                      bar.clippedStart ? 'gantt__bar--open-start' : '',
                      bar.clippedEnd ? 'gantt__bar--open-end' : '',
                      event.key === selectedKey ? 'gantt__bar--selected' : '',
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
                      ['--event-colour' as string]: eventColour(event),
                    }}
                    onClick={() => onOpen(event)}
                    title={[
                      event.name,
                      `${event.category === null ? 'Published directly' : CATEGORY_LABELS[event.category]} - ${chip.label}`,
                      `Opens ${event.startsAt === null ? 'always on' : localTime(event.startsAt)}`,
                      `Ends ${event.endsAt === null ? 'never' : localTime(event.endsAt)}`,
                    ].join('\n')}
                  >
                    <span className="gantt__bar-label">{event.name}</span>
                    <span className="gantt__bar-phase">{chip.label}</span>
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
