import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import type { RawWorkbook } from '../lib/types';

/**
 * Page ids. Note `'arena'` is the trophy road page (its historical route,
 * `#/arena`, is documented and kept) while `'arenas'` is the arenas config.
 */
export type View =
  | 'dashboard'
  | 'schedule'
  | 'live'
  | 'arena'
  | 'heroes'
  | 'arenas'
  | 'matchTrophy'
  | 'bots'
  | 'heroUpgrade'
  | 'shop'
  | 'battlePass'
  | 'reference';

interface NavItem {
  id: View;
  label: string;
  blurb: string;
  icon: IconName;
}

/** The live-ops group: the state of the game, not the sheets that feed it. */
export const OPS_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Overview',
    blurb: 'What is live and what is booked',
    icon: 'grid',
  },
  {
    id: 'schedule',
    label: 'Scheduling',
    blurb: 'Windows that open and close themselves',
    icon: 'calendar',
  },
  {
    id: 'live',
    label: 'Live config',
    blurb: 'Every setting, byte for byte',
    icon: 'link',
  },
];

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'arena',
    label: 'Trophy road',
    blurb: 'Trophy milestones, arena unlocks, rewards',
    icon: 'trophy',
  },
  {
    id: 'heroes',
    label: 'Hero stats',
    blurb: 'Base stats, level curves, power',
    icon: 'spark',
  },
  {
    id: 'arenas',
    label: 'Arenas',
    blurb: 'Track counts and bot line-ups',
    icon: 'table',
  },
  {
    id: 'matchTrophy',
    label: 'Match trophies',
    blurb: 'Trophies won or lost per finishing place',
    icon: 'medal',
  },
  {
    id: 'bots',
    label: 'Bots',
    blurb: 'Tuning per bot difficulty level',
    icon: 'bot',
  },
  {
    id: 'heroUpgrade',
    label: 'Hero upgrades',
    blurb: 'Upgrade cost curve per rarity',
    icon: 'coins',
  },
  {
    id: 'shop',
    label: 'Shop',
    blurb: 'Products, prices and what they grant',
    icon: 'cart',
  },
  {
    id: 'battlePass',
    label: 'Battle pass',
    blurb: 'Season header and the reward ladder',
    icon: 'ticket',
  },
];

export const REFERENCE_ITEM: NavItem = {
  id: 'reference',
  label: 'Power parameters',
  blurb: 'Accepted parameter names',
  icon: 'book',
};

const CRUMB_LABEL: Record<View, string> = {
  dashboard: 'Overview',
  schedule: 'Scheduling',
  live: 'Live config',
  arena: 'Trophy road',
  heroes: 'Hero stats',
  arenas: 'Arenas',
  matchTrophy: 'Match trophies',
  bots: 'Bots',
  heroUpgrade: 'Hero upgrades',
  shop: 'Shop',
  battlePass: 'Battle pass',
  reference: 'Power parameters',
};

const CRUMB_SECTION: Record<View, string> = {
  dashboard: 'Live ops',
  schedule: 'Live ops',
  live: 'Live ops',
  arena: 'Configs',
  heroes: 'Configs',
  arenas: 'Configs',
  matchTrophy: 'Configs',
  bots: 'Configs',
  heroUpgrade: 'Configs',
  shop: 'Configs',
  battlePass: 'Configs',
  reference: 'Reference',
};

/** The current page's workbook, for the rail and the top bar. Null on pages without one. */
export interface ShellSource {
  label: string;
  workbook: RawWorkbook | null;
  onReset: () => void;
}

interface AppShellProps {
  view: View;
  onNavigate: (view: View) => void;
  source: ShellSource | null;
  children: ReactNode;
}

export function AppShell({ view, onNavigate, source, children }: AppShellProps) {
  const workbook = source?.workbook ?? null;

  const renderLink = (item: NavItem) => (
    <button
      key={item.id}
      type="button"
      className={`navlink${view === item.id ? ' navlink--active' : ''}`}
      aria-current={view === item.id ? 'page' : undefined}
      onClick={() => onNavigate(item.id)}
    >
      <Icon name={item.icon} size={17} className="navlink__icon" />
      <span>
        <span className="navlink__text">{item.label}</span>
        <span className="navlink__sub">{item.blurb}</span>
      </span>
    </button>
  );

  return (
    <div className="shell">
      <nav className="rail" aria-label="Sections">
        <div>
          <div className="rail__brand">
            <span className="rail__mark" aria-hidden="true">
              <Icon name="braces" size={18} />
            </span>
            <span>
              <span className="rail__name">Cliff Heroes</span>
              <span className="rail__sub">Back office</span>
            </span>
          </div>

          <div className="rail__group">
            <p className="rail__group-title">Live ops</p>
            {OPS_ITEMS.map(renderLink)}
          </div>

          <div className="rail__group">
            <p className="rail__group-title">Configs</p>
            {NAV_ITEMS.map(renderLink)}
          </div>
        </div>

        <div className="rail__group">
          <p className="rail__group-title">Reference</p>
          {renderLink(REFERENCE_ITEM)}
        </div>

        {source !== null && workbook !== null && (
          <div className="rail__source">
            <span className="rail__source-label">Loaded workbook</span>
            <span className="rail__source-name">{workbook.sourceName}</span>
            <span className="rail__source-meta">
              for {source.label} - {workbook.sheets.length} tab{workbook.sheets.length === 1 ? '' : 's'}
            </span>
            <button type="button" className="btn btn--sm" onClick={source.onReset}>
              <Icon name="swap" size={13} />
              Change source
            </button>
          </div>
        )}

        <p className="rail__foot">Everything is parsed in your browser.</p>
      </nav>

      <div className="main">
        <header className="topbar">
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>Cliff Heroes</span>
            <span className="crumbs__sep" aria-hidden="true">
              /
            </span>
            <span>{CRUMB_SECTION[view]}</span>
            <span className="crumbs__sep" aria-hidden="true">
              /
            </span>
            <span className="crumbs__current">{CRUMB_LABEL[view]}</span>
          </nav>

          {workbook !== null && (
            <div className="topbar__actions">
              <span className="chip chip--neutral">
                <Icon name="sheet" size={12} />
                {workbook.sourceName}
              </span>
            </div>
          )}
        </header>

        <main className="page">{children}</main>
      </div>
    </div>
  );
}
