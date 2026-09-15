import type { View } from './AppShell';
import { DOMAIN_LABELS } from '../domains/types';
import type { BoardAction } from '../hooks/useLiveOpsBoard';
import {
  CATEGORY_COLOURS,
  CATEGORY_LABELS,
  FEATURE_SOURCE,
  LIVEOPS_FEATURES,
  PHASE_LABELS,
  PHASE_TONES,
  UNBOOKED_COLOUR,
  durationLabel,
  isEvergreen,
  isInGame,
  isLingering,
  type BoardEvent,
} from '../lib/liveops';
import { localTime, relativeTime } from '../lib/schedule';

/** The chip for an event, which says more than its phase when it is unusual. */
export function phaseChip(event: BoardEvent): { label: string; tone: string } {
  if (event.missingLive) return { label: 'Not in ConfigCat', tone: 'danger' };
  if (isEvergreen(event)) return { label: 'Evergreen', tone: 'ok' };
  if (isLingering(event)) return { label: 'Ended, still listed', tone: 'neutral' };
  return { label: PHASE_LABELS[event.phase], tone: PHASE_TONES[event.phase] };
}

export function eventColour(event: BoardEvent): string {
  return event.category === null ? UNBOOKED_COLOUR : CATEGORY_COLOURS[event.category];
}

/** What can be done to an event from a list, strongest first. Deleting a card is only offered on the calendar's menu. */
export function actionsFor(event: BoardEvent): { action: Exclude<BoardAction, 'delete'>; label: string; danger: boolean }[] {
  if (event.missingLive) return [{ action: 'cancel', label: 'Call off', danger: false }];
  if (event.live === null) {
    return event.entry?.state === 'scheduled' ? [{ action: 'cancel', label: 'Cancel', danger: true }] : [];
  }
  if (isInGame(event)) return [{ action: 'end', label: 'End now', danger: true }];
  if (isLingering(event)) return [{ action: 'remove', label: 'Remove', danger: false }];
  return [];
}

interface EventBoardProps {
  events: BoardEvent[];
  now: number;
  busyKey: string | null;
  selectedKey: string | null;
  onOpen: (event: BoardEvent) => void;
  onAct: (event: BoardEvent, action: BoardAction) => void;
  /** Absent on a feature's own page, where the feature column says nothing. */
  onNavigate?: (view: View) => void;
  empty: string;
}

/**
 * Every event as a row: booked or published directly, coming, running or
 * over - and the button that takes a running one down.
 *
 * The same table on the calendar and on each feature's page, so an event looks
 * and behaves the same wherever somebody finds it.
 */
export function EventBoard({ events, now, busyKey, selectedKey, onOpen, onAct, onNavigate, empty }: EventBoardProps) {
  if (events.length === 0) return <p className="empty">{empty}</p>;

  return (
    <div className="tablewrap tablewrap--board">
      <table className="table table--board">
        <thead>
          <tr>
            <th scope="col">Event</th>
            {onNavigate !== undefined && <th scope="col">Feature</th>}
            <th scope="col">Booking</th>
            <th scope="col">Opens</th>
            <th scope="col">Ends</th>
            <th scope="col">Runs for</th>
            <th scope="col">Phase</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const chip = phaseChip(event);
            const running = event.phase === 'active' || event.phase === 'ending';
            return (
              // The whole row opens the event, the way a board card does. The
              // name inside it is a real button, so this works from a keyboard
              // as well as from a pointer.
              <tr
                key={event.key}
                className={`table__row--open${event.key === selectedKey ? ' table__row--selected' : ''}`}
                style={{ ['--event-colour' as string]: eventColour(event) }}
                onClick={() => onOpen(event)}
              >
                <td>
                  <button type="button" className="table__open" onClick={() => onOpen(event)}>
                    {event.name}
                  </button>
                  {event.subjectId !== null && <span className="table__sub mono">{event.subjectId}</span>}
                  {event.entry?.note !== null && event.entry?.note !== undefined && event.entry.note !== '' && (
                    <span className="table__sub">{event.entry.note}</span>
                  )}
                </td>
                {onNavigate !== undefined && (
                  <td>
                    <button
                      type="button"
                      className="linklike"
                      onClick={(mouse) => {
                        mouse.stopPropagation();
                        onNavigate(FEATURE_SOURCE[event.domain] as View);
                      }}
                    >
                      {DOMAIN_LABELS[event.domain]}
                    </button>
                  </td>
                )}
                <td>
                  {event.category === null ? (
                    <span
                      className="tag"
                      style={{ ['--tag-colour' as string]: UNBOOKED_COLOUR }}
                      title="Live in ConfigCat without a booking: published from its page, or edited in ConfigCat by hand."
                    >
                      Published directly
                    </span>
                  ) : (
                    <span className="tag" style={{ ['--tag-colour' as string]: CATEGORY_COLOURS[event.category] }}>
                      {CATEGORY_LABELS[event.category]}
                    </span>
                  )}
                  {typeof event.entry?.liveops.sourceUrl === 'string' && event.entry.liveops.sourceUrl !== '' && (
                    <span className="table__sub">
                      <a
                        href={event.entry.liveops.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(mouse) => mouse.stopPropagation()}
                      >
                        from the sheet
                      </a>
                    </span>
                  )}
                </td>
                <td>
                  {event.startsAt === null ? 'Always on' : localTime(event.startsAt)}
                  {event.phase === 'scheduled' || event.phase === 'preview' ? (
                    event.startsAt !== null && (
                      <span className="table__sub">{relativeTime(Date.parse(event.startsAt) - now)}</span>
                    )
                  ) : null}
                </td>
                <td>
                  {event.endsAt === null ? 'Never' : localTime(event.endsAt)}
                  {running && event.endsAt !== null && (
                    <span className="table__sub">{relativeTime(Date.parse(event.endsAt) - now)}</span>
                  )}
                </td>
                <td>
                  {event.startsAt === null || event.endsAt === null
                    ? '-'
                    : durationLabel(event.startsAt, event.endsAt)}
                </td>
                <td>
                  <span className={`chip chip--${chip.tone}`}>{chip.label}</span>
                  {event.live !== null && event.phase === 'preview' && event.domain === 'battlePass' && (
                    <span className="table__sub" title="The client shows a pass as soon as it is published, whatever its start.">
                      already visible in game
                    </span>
                  )}
                </td>
                <td className="table__actions">
                  {actionsFor(event).map(({ action, label, danger }) => (
                    <button
                      key={action}
                      type="button"
                      className={danger ? 'btn btn--sm btn--danger' : 'btn btn--sm'}
                      title={
                        action === 'remove' && LIVEOPS_FEATURES[event.domain].unit === 'list'
                          ? 'Takes it out of the list for good. Players lose their progress on it.'
                          : undefined
                      }
                      onClick={(mouse) => {
                        mouse.stopPropagation();
                        onAct(event, action);
                      }}
                      disabled={busyKey === event.key}
                    >
                      {label}
                    </button>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
