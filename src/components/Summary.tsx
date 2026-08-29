import { Icon } from './Icon';
import type { HeroTransformResult, Issue, TransformResult } from '../lib/types';

interface StatProps {
  value: number;
  label: string;
  tone?: 'danger' | 'warn' | 'ok';
}

function Stat({ value, label, tone }: StatProps) {
  return (
    <div className={tone ? `stat stat--${tone}` : 'stat'}>
      <div className="stat__value">{value.toLocaleString()}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

/** Live counts for the arena exporter - recalculated on every mapping change. */
export function ArenaStats({ result }: { result: TransformResult }) {
  const { stats } = result;
  return (
    <div className="stats">
      <Stat value={stats.milestones} label="Milestones" />
      <Stat value={stats.arenas} label="Arenas" />
      <Stat value={stats.arenaUnlockMilestones} label="Arena unlocks" />
      <Stat value={stats.rewardMilestones} label="Rewards" />
      <Stat value={stats.errors} label="Errors" tone={stats.errors > 0 ? 'danger' : 'ok'} />
      <Stat value={stats.warnings} label="Warnings" tone={stats.warnings > 0 ? 'warn' : undefined} />
    </div>
  );
}

/** Live counts for the hero exporter. */
export function HeroStats({ result }: { result: HeroTransformResult }) {
  const { stats } = result;
  return (
    <div className="stats">
      <Stat value={stats.heroes} label="Heroes" />
      <Stat value={stats.levels} label="Levels" />
      <Stat value={stats.powerParams} label="Power params" />
      <Stat value={stats.errors} label="Errors" tone={stats.errors > 0 ? 'danger' : 'ok'} />
      <Stat value={stats.warnings} label="Warnings" tone={stats.warnings > 0 ? 'warn' : undefined} />
    </div>
  );
}

interface IssueListProps {
  issues: Issue[];
  severity: 'error' | 'warning';
}

/**
 * Errors are announced: they are the reason the export button stays disabled,
 * so a keyboard or screen-reader user has to hear about them without hunting.
 */
export function IssueList({ issues, severity }: IssueListProps) {
  const filtered = issues.filter((issue) => issue.severity === severity);
  if (filtered.length === 0) return null;

  return (
    <ul className="issues" role={severity === 'error' ? 'alert' : undefined}>
      {filtered.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className={`issue issue--${severity}`}>
          <Icon name={severity === 'error' ? 'alert' : 'info'} size={14} className="issue__icon" />
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
