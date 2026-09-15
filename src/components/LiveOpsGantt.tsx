import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { actionsFor, eventColour, phaseChip } from './EventBoard';
import { DOMAIN_LABELS } from '../domains/types';
import type { BoardAction } from '../hooks/useLiveOpsBoard';
import { useSideScrollPaging } from '../hooks/useSideScrollPaging';
import {
  CATEGORY_LABELS,
  LIVEOPS_DOMAINS,
  barTimes,
  isHourScale,
  isInGame,
  layOutBars,
  ticksFor,
  type BoardEvent,
} from '../lib/liveops';
import { localTime } from '../lib/schedule';

interface LiveOpsGanttProps {
  events: BoardEvent[];
  /** Start of the visible range, in ms. */
  from: number;
  /** End of the visible range, in ms. */
  to: number;
  now: number;
  selectedKey: string | null;
  /** The event an action is running on, whose menu items wait for it. */
  busyKey: string | null;
  /** A bar is the event: clicking one opens it, the way a board card does. */
  onOpen: (event: BoardEvent) => void;
  /** What a bar's right-click menu does besides opening it. */
  onAct: (event: BoardEvent, action: BoardAction) => void;
  /** Sideways scrolling over the calendar turns it a page: -1 back, 1 forward. */
  onPage: (step: -1 | 1) => void;
}

/** What a bar's menu offers, strongest last: open it, the list's own actions, then delete. */
export function eventMenuItems(
  event: BoardEvent,
  { busy, onOpen, onAct }: { busy: boolean; onOpen: () => void; onAct: (action: BoardAction) => void },
): ContextMenuItem[] {
  const waiting = busy ? 'Working on it...' : null;
  const items: ContextMenuItem[] = [{ id: 'edit', label: 'Edit', icon: 'pencil', onSelect: onOpen }];

  for (const { action, label } of actionsFor(event)) {
    // Removing a finished offer from its list is part of deleting its card, so
    // the menu does not offer it twice.
    if (action === 'remove') continue;
    items.push({
      id: action,
      label,
      icon: action === 'end' ? 'stop' : 'x',
      danger: action === 'end',
      disabledReason: waiting,
      onSelect: () => onAct(action),
    });
  }

  items.push({
    id: 'delete',
    label: 'Delete event',
    icon: 'trash',
    danger: true,
    separated: true,
    disabledReason: isInGame(event) ? 'In the game - end it first' : waiting,
    onSelect: () => onAct('delete'),
  });
  return items;
}

interface OpenMenu {
  event: BoardEvent;
  x: number;
  y: number;
  /** The bar it was opened on, which gets focus back when the menu closes. */
  trigger: HTMLElement;
  fromKeyboard: boolean;
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
 * Over a day or a week the bars are drawn taller, as cards carrying the hours
 * each event opens and closes on.
 *
 * Scrolling sideways over it turns the page, and right-clicking a bar opens
 * its menu, so moving through the calendar and acting on an event never needs
 * a trip to the toolbar or the table.
 */
export function LiveOpsGantt({ events, from, to, now, selectedKey, busyKey, onOpen, onAct, onPage }: LiveOpsGanttProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  useSideScrollPaging(rootRef, onPage);
  useSlideOnPage(rootRef, from, to);

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
  const labels = ticks.filter((tick) => tick.label !== '');
  const lines = ticks.filter((tick) => tick.line);
  const cards = isHourScale(from, to);
  const nowLeft = now >= from && now <= to ? ((now - from) / Math.max(to - from, 1)) * 100 : null;

  const openMenu = (mouse: MouseEvent<HTMLButtonElement>, event: BoardEvent) => {
    mouse.preventDefault();
    const trigger = mouse.currentTarget;
    // The menu key and shift + F10 report no pointer, so the menu hangs off the bar instead.
    const fromKeyboard = mouse.clientX === 0 && mouse.clientY === 0;
    const box = trigger.getBoundingClientRect();
    setMenu({
      event,
      x: fromKeyboard ? box.left : mouse.clientX,
      y: fromKeyboard ? box.bottom : mouse.clientY,
      trigger,
      fromKeyboard,
    });
  };

  const closeMenu = useCallback(
    (restoreFocus: boolean) => {
      if (restoreFocus && menu !== null && menu.trigger.isConnected) menu.trigger.focus({ preventScroll: true });
      setMenu(null);
    },
    [menu],
  );

  return (
    <div className={cards ? 'gantt gantt--cards' : 'gantt'} ref={rootRef}>
      <div className="gantt__ruler">
        <div className="gantt__lane-head" aria-hidden="true" />
        <div className="gantt__track">
          {labels.map((tick) => (
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
              {lines.map((tick) => (
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
                      event.key === selectedKey || event.key === menu?.event.key ? 'gantt__bar--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      left: `${bar.left * 100}%`,
                      width: `${bar.width * 100}%`,
                      ['--row' as string]: String(bar.row),
                      // The preview slice is drawn as a hatch over the head of
                      // the bar: the config is live but the event is not, and
                      // those two facts have to be visible at once.
                      ['--preview' as string]: `${bar.previewFraction * 100}%`,
                      ['--event-colour' as string]: eventColour(event),
                    }}
                    onClick={() => onOpen(event)}
                    onContextMenu={(mouse) => openMenu(mouse, event)}
                    title={[
                      event.name,
                      `${event.category === null ? 'Published directly' : CATEGORY_LABELS[event.category]} - ${chip.label}`,
                      `Opens ${event.startsAt === null ? 'always on' : localTime(event.startsAt)}`,
                      `Ends ${event.endsAt === null ? 'never' : localTime(event.endsAt)}`,
                      'Right-click for more',
                    ].join('\n')}
                  >
                    <span className="gantt__bar-label">{event.name}</span>
                    <span className="gantt__bar-phase">{chip.label}</span>
                    {cards && <span className="gantt__bar-times">{barTimes(event, from, to)}</span>}
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

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.event.name}
          subtitle={`${DOMAIN_LABELS[menu.event.domain]} - ${phaseChip(menu.event).label}`}
          focusFirst={menu.fromKeyboard}
          items={eventMenuItems(menu.event, {
            busy: busyKey === menu.event.key,
            onOpen: () => onOpen(menu.event),
            onAct: (action) => onAct(menu.event, action),
          })}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

/**
 * Slides the tracks in from the side the calendar moved towards, so turning a
 * page reads as travelling along time rather than as the bars being swapped.
 * A change of range only fades, since nothing moved sideways.
 */
function useSlideOnPage(ref: RefObject<HTMLElement>, from: number, to: number) {
  const shown = useRef({ from, to });

  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { from, to };
    const root = ref.current;
    if (root === null || before.from === from || typeof root.animate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) return;

    const sameSpan = Math.abs(before.to - before.from - (to - from)) < 3 * 3600 * 1000;
    const offset = sameSpan ? (from > before.from ? 28 : -28) : 0;
    for (const track of root.querySelectorAll<HTMLElement>('.gantt__track')) {
      track.animate(
        [
          { transform: `translateX(${offset}px)`, opacity: 0.3 },
          { transform: 'translateX(0)', opacity: 1 },
        ],
        // --dur-2 and --ease-out, the app's pair for things arriving.
        { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    }
  }, [ref, from, to]);
}
