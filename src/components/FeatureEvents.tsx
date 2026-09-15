import { useState } from 'react';
import type { View } from './AppShell';
import { EventBoard } from './EventBoard';
import { Icon } from './Icon';
import { LiveOpsDialog } from './LiveOpsDialog';
import { Segmented } from './Segmented';
import { BoardBanners } from '../features/LiveOps';
import { ENVIRONMENTS } from '../domains/account';
import { useLiveOpsBoard } from '../hooks/useLiveOpsBoard';
import { LIVEOPS_FEATURES, type BoardEvent, type LiveOpsDomain } from '../lib/liveops';

interface FeatureEventsProps {
  domain: LiveOpsDomain;
  environmentId: string;
  onEnvironmentChange: (environmentId: string) => void;
  onNavigate: (view: View) => void;
}

/**
 * One feature's events, on that feature's own page.
 *
 * The same board as the live ops calendar, filtered to this feature: whatever
 * is running - booked, published from this page, or evergreen - with the same
 * End now, and the same form to book the next one. A season or an offer can be
 * managed from here or from the calendar, and the two are one list.
 */
export function FeatureEvents({ domain, environmentId, onEnvironmentChange, onNavigate }: FeatureEventsProps) {
  const board = useLiveOpsBoard(environmentId, domain);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<BoardEvent | null>(null);
  const feature = LIVEOPS_FEATURES[domain];
  const booked = board.events.some((event) => event.entry !== null && event.phase !== 'ended' && event.phase !== 'off');

  return (
    <div className="stack-md">
      <div className="row-between review__bar">
        <Segmented
          label="Environment"
          value={environmentId}
          options={ENVIRONMENTS.map((environment) => ({
            value: environment.environmentId,
            label: (
              <>
                {environment.name.replace(' Environment', '')}
                {environment.readByLiveGame && <span className="segmented__flag">live</span>}
              </>
            ),
          }))}
          onChange={onEnvironmentChange}
        />
        <div className="review__buttons">
          <button type="button" className="btn btn--sm" onClick={() => void board.reload()} disabled={board.loading}>
            {board.loading ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={13} />}
            Refresh
          </button>
          <button type="button" className="btn btn--sm" onClick={() => onNavigate('liveops')}>
            <Icon name="calendar" size={13} /> Calendar
          </button>
          <button type="button" className="btn btn--sm btn--primary" onClick={() => setComposing(true)}>
            <Icon name="plus" size={13} /> New {feature.noun}
          </button>
        </div>
      </div>

      <BoardBanners board={board} booked={booked} />

      {board.loading && board.view === null ? (
        <p className="field__note">
          <span className="spinner" aria-hidden="true" /> Reading what is live and booked...
        </p>
      ) : (
        <EventBoard
          events={board.events}
          now={board.now}
          busyKey={board.busyKey}
          selectedKey={editing?.key ?? null}
          onOpen={setEditing}
          onAct={(event, action) => void board.act(event, action)}
          empty={`No ${feature.noun} is running or booked in this environment.`}
        />
      )}

      {(composing || editing !== null) && (
        <LiveOpsDialog
          environmentId={environmentId}
          domain={domain}
          event={editing}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
          onDone={() => {
            setComposing(false);
            setEditing(null);
            void board.reload();
          }}
        />
      )}
    </div>
  );
}
