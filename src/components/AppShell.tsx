import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import type { RawWorkbook } from '../lib/types';

export type View = 'arena' | 'heroes' | 'reference';

interface NavItem {
  id: View;
  label: string;
  blurb: string;
  icon: IconName;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'arena',
    label: 'Arena progress',
    blurb: 'Trophy milestones, arenas, rewards',
    icon: 'trophy',
  },
  {
    id: 'heroes',
    label: 'Hero stats',
    blurb: 'Base stats, level curves, power',
    icon: 'spark',
  },
];

export const REFERENCE_ITEM: NavItem = {
  id: 'reference',
  label: 'Power parameters',
  blurb: 'Accepted parameter names',
  icon: 'book',
};

const CRUMB_LABEL: Record<View, string> = {
  arena: 'Arena progress',
  heroes: 'Hero stats',
  reference: 'Power parameters',
};

const CRUMB_SECTION: Record<View, string> = {
  arena: 'Exporters',
  heroes: 'Exporters',
  reference: 'Reference',
};

interface AppShellProps {
  view: View;
  onNavigate: (view: View) => void;
  workbook: RawWorkbook | null;
  onReset: () => void;
  children: ReactNode;
}

export function AppShell({ view, onNavigate, workbook, onReset, children }: AppShellProps) {
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
            <p className="rail__group-title">Exporters</p>
            {NAV_ITEMS.map(renderLink)}
          </div>
        </div>

        <div className="rail__group">
          <p className="rail__group-title">Reference</p>
          {renderLink(REFERENCE_ITEM)}
        </div>

        {workbook !== null && (
          <div className="rail__source">
            <span className="rail__source-label">Loaded workbook</span>
            <span className="rail__source-name">{workbook.sourceName}</span>
            <span className="rail__source-meta">
              {workbook.sheets.length} tab{workbook.sheets.length === 1 ? '' : 's'}
            </span>
            <button type="button" className="btn btn--sm" onClick={onReset}>
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
