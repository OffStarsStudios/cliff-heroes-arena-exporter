import type { HeroTransformResult, Issue, TransformResult } from '../lib/types';

interface SummaryCardProps {
  result: TransformResult;
}

interface StatProps {
  value: number;
  label: string;
  tone?: 'danger' | 'warn' | 'ok';
}

function Stat({ value, label, tone }: StatProps) {
  const className = tone ? `stat stat--${tone}` : 'stat';
  return (
    <div className={className}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

export function SummaryCard({ result }: SummaryCardProps) {
  const { stats } = result;
  return (
    <section className="card">
      <header className="card__header">
        <h2 className="card__title">Data summary</h2>
        <span className="card__hint">Recalculated as you change the mapping</span>
      </header>
      <div className="card__body">
        <div className="summary">
          <Stat value={stats.milestones} label="Milestones" />
          <Stat value={stats.arenas} label="Arenas" />
          <Stat value={stats.arenaUnlockMilestones} label="Arena unlocks" />
          <Stat value={stats.rewardMilestones} label="Rewards" />
          <Stat value={stats.errors} label="Errors" tone={stats.errors > 0 ? 'danger' : 'ok'} />
          <Stat value={stats.warnings} label="Warnings" tone={stats.warnings > 0 ? 'warn' : undefined} />
        </div>
      </div>
    </section>
  );
}

interface HeroSummaryCardProps {
  result: HeroTransformResult;
}

export function HeroSummaryCard({ result }: HeroSummaryCardProps) {
  const { stats } = result;
  return (
    <section className="card">
      <header className="card__header">
        <h2 className="card__title">Data summary</h2>
        <span className="card__hint">Recalculated as you change the selection</span>
      </header>
      <div className="card__body">
        <div className="summary">
          <Stat value={stats.heroes} label="Heroes" />
          <Stat value={stats.levels} label="Levels" />
          <Stat value={stats.powerParams} label="Power params" />
          <Stat value={stats.errors} label="Errors" tone={stats.errors > 0 ? 'danger' : 'ok'} />
          <Stat value={stats.warnings} label="Warnings" tone={stats.warnings > 0 ? 'warn' : undefined} />
        </div>
      </div>
    </section>
  );
}

interface IssueListProps {
  issues: Issue[];
  severity: 'error' | 'warning';
  title: string;
}

export function IssueList({ issues, severity, title }: IssueListProps) {
  const filtered = issues.filter((issue) => issue.severity === severity);
  if (filtered.length === 0) return null;

  return (
    <section className="card">
      <header className="card__header">
        <h2 className="card__title">{title}</h2>
        <span className="card__hint">{filtered.length}</span>
      </header>
      <div className="card__body">
        <ul className="issues">
          {filtered.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={`issue issue--${severity}`}>
              <span className="issue__badge">{severity === 'error' ? 'Error' : 'Warn'}</span>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
