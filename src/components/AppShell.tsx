import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { PixelHeart } from './PixelHeart';
import type { RawWorkbook } from '../lib/types';

/**
 * Page ids. Note `'arena'` is the trophy road page (its historical route,
 * `#/arena`, is documented and kept) while `'arenas'` is the arenas config.
 */
export type View =
  | 'dashboard'
  | 'liveops'
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
  icon: IconName;
}

interface NavSection {
  /** Stable key for the collapsed-state memory; never derived from the title. */
  id: string;
  title: string;
  items: NavItem[];
}

/**
 * The rail, in reading order. Sections are the only grouping in the app, so
 * the breadcrumb section is read off them rather than kept in a second table
 * that could drift.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'operations',
    title: 'Operations',
    items: [
      { id: 'dashboard', label: 'Overview', icon: 'grid' },
      { id: 'liveops', label: 'Live ops', icon: 'calendar' },
      { id: 'schedule', label: 'Scheduling', icon: 'clock' },
      { id: 'live', label: 'Live config', icon: 'link' },
    ],
  },
  {
    id: 'core',
    title: 'Core',
    items: [
      { id: 'arena', label: 'Trophy road', icon: 'trophy' },
      { id: 'heroes', label: 'Hero stats', icon: 'spark' },
      { id: 'arenas', label: 'Arenas', icon: 'table' },
      { id: 'matchTrophy', label: 'Match trophies', icon: 'medal' },
      { id: 'bots', label: 'Bots', icon: 'bot' },
      { id: 'heroUpgrade', label: 'Hero upgrades', icon: 'coins' },
    ],
  },
  {
    id: 'monetization',
    title: 'Monetization',
    items: [{ id: 'shop', label: 'Shop', icon: 'cart' }],
  },
  {
    id: 'liveops',
    title: 'Live ops',
    items: [{ id: 'battlePass', label: 'Battle pass', icon: 'ticket' }],
  },
  {
    id: 'reference',
    title: 'Reference',
    items: [{ id: 'reference', label: 'Power parameters', icon: 'book' }],
  },
];

function sectionOf(view: View): NavSection {
  return NAV_SECTIONS.find((section) => section.items.some((item) => item.id === view)) ?? NAV_SECTIONS[0];
}

function labelOf(view: View): string {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((candidate) => candidate.id === view);
    if (item !== undefined) return item.label;
  }
  return view;
}

/* ---------- collapsed-section memory ---------- */

const COLLAPSED_KEY = 'cliffheroes.rail.collapsed';
const RAIL_OPEN_KEY = 'cliffheroes.rail.open';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // Some browsers throw on access when site data is blocked.
    return null;
  }
}

/** Sections start open; only the ones a user closed are remembered. */
function recallCollapsed(): string[] {
  try {
    const raw = storage()?.getItem(COLLAPSED_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function rememberCollapsed(ids: string[]): void {
  try {
    storage()?.setItem(COLLAPSED_KEY, JSON.stringify(ids));
  } catch {
    // A rail that forgets is fine; a rail that throws is not.
  }
}

/** The rail folds to icons; a board is worth the width. Remembered per browser. */
function recallRailOpen(): boolean {
  try {
    return storage()?.getItem(RAIL_OPEN_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function rememberRailOpen(open: boolean): void {
  try {
    storage()?.setItem(RAIL_OPEN_KEY, open ? 'open' : 'closed');
  } catch {
    // A rail that forgets is fine; a rail that throws is not.
  }
}

interface RailGroupProps {
  section: NavSection;
  open: boolean;
  /** True when the current page lives in this section. */
  holdsActive: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * One collapsible category. The panel animates between 0 and its measured
 * height - browsers still refuse to interpolate to `auto`, and the measurement
 * is re-taken whenever the list reflows, which it does when the rail turns
 * horizontal on a narrow screen.
 */
function RailGroup({ section, open, holdsActive, onToggle, children }: RailGroupProps) {
  const panelId = `rail-section-${section.id}`;
  const itemsRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const items = itemsRef.current;
    if (items === null) return;

    const measure = () => setHeight(items.scrollHeight);
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(items);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`rail__group${open ? '' : ' rail__group--closed'}`}>
      <button
        type="button"
        className="rail__group-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <Icon name="chevron" size={12} className="rail__group-chevron" />
        <span className="rail__group-title">{section.title}</span>
        {!open && holdsActive && <span className="rail__group-dot" aria-hidden="true" />}
        {!open && <span className="rail__group-count">{section.items.length}</span>}
      </button>

      {/* `visibility` keeps a closed group off the tab order and out of the
          accessibility tree, and waits for the fold to finish. */}
      <div
        id={panelId}
        className="rail__group-panel"
        style={{ height: open ? (height ?? undefined) : 0 }}
      >
        <div className="rail__group-items" ref={itemsRef}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The current page's workbook, for the rail and the top bar. Null on pages without one. */
export interface ShellSource {
  label: string;
  workbook: RawWorkbook | null;
  onReset: () => void;
}

/**
 * Pages that are worked in rather than read.
 *
 * The 1180px column is right for a config page - a form and a diff, read top to
 * bottom. It is wrong for a calendar and a table of events, where the width is
 * the information: more weeks on screen, more columns without a scroll.
 */
const WIDE_VIEWS = new Set<View>(['liveops', 'schedule']);

interface AppShellProps {
  view: View;
  onNavigate: (view: View) => void;
  source: ShellSource | null;
  children: ReactNode;
}

export function AppShell({ view, onNavigate, source, children }: AppShellProps) {
  const workbook = source?.workbook ?? null;
  const [collapsed, setCollapsed] = useState<string[]>(recallCollapsed);
  const [railOpen, setRailOpen] = useState<boolean>(recallRailOpen);

  const toggleRail = useCallback(() => {
    setRailOpen((open) => {
      rememberRailOpen(!open);
      return !open;
    });
  }, []);

  const activeSectionId = sectionOf(view).id;

  // Landing on a page inside a closed section opens it, so the rail always
  // shows where you are.
  useEffect(() => {
    setCollapsed((current) => {
      if (!current.includes(activeSectionId)) return current;
      const next = current.filter((id) => id !== activeSectionId);
      rememberCollapsed(next);
      return next;
    });
  }, [activeSectionId]);

  const toggleSection = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = current.includes(id) ? current.filter((other) => other !== id) : [...current, id];
      rememberCollapsed(next);
      return next;
    });
  }, []);

  const renderLink = (item: NavItem) => (
    <button
      key={item.id}
      type="button"
      className={`navlink${view === item.id ? ' navlink--active' : ''}`}
      aria-current={view === item.id ? 'page' : undefined}
      // Collapsed, the icon is the only thing naming the page, so it carries
      // the name for a pointer (title) and for a screen reader (aria-label).
      title={railOpen ? undefined : item.label}
      aria-label={railOpen ? undefined : item.label}
      onClick={() => onNavigate(item.id)}
    >
      <Icon name={item.icon} size={17} className="navlink__icon" />
      <span className="navlink__text">{item.label}</span>
    </button>
  );

  const renderSection = (section: NavSection) => (
    <RailGroup
      key={section.id}
      section={section}
      open={!collapsed.includes(section.id)}
      holdsActive={section.id === activeSectionId}
      onToggle={() => toggleSection(section.id)}
    >
      {section.items.map(renderLink)}
    </RailGroup>
  );

  return (
    <div className={`shell${railOpen ? '' : ' shell--rail-closed'}`}>
      <nav className="rail" aria-label="Sections">
        <div className="rail__nav">
          <div className="rail__brand">
            <button
              type="button"
              className="rail__mark"
              aria-expanded={railOpen}
              aria-label={railOpen ? 'Collapse the sidebar' : 'Expand the sidebar'}
              title={railOpen ? 'Collapse the sidebar' : 'Expand the sidebar'}
              onClick={toggleRail}
            >
              <PixelHeart size={19} className="rail__heart" />
              <Icon name="chevron" size={14} className="rail__mark-chevron" />
            </button>
            <span className="rail__brand-text">
              <span className="rail__name">Cliff Heroes</span>
              <span className="rail__sub">Back office</span>
            </span>
          </div>

          {NAV_SECTIONS.map(renderSection)}
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
            <span>{sectionOf(view).title}</span>
            <span className="crumbs__sep" aria-hidden="true">
              /
            </span>
            <span className="crumbs__current">{labelOf(view)}</span>
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

        {/* Keyed on the view so each page fades in rather than snapping. */}
        <main className={`page${WIDE_VIEWS.has(view) ? ' page--wide' : ''}`} key={view}>
          {children}
        </main>
      </div>
    </div>
  );
}
