import type { HeroLevel, HeroPreviewRow } from '../lib/types';

function levelText(level: HeroLevel | null): string {
  if (level === null) return '-';
  return `${level.Health} / ${level.Speed} / ${level.Grip}`;
}

export function HeroPreviewTable({ rows }: { rows: HeroPreviewRow[] }) {
  if (rows.length === 0) {
    return <p className="empty">Nothing parsed yet. Check the tab choices above.</p>;
  }

  const maxLevels = rows.reduce((max, row) => Math.max(max, row.levelCount), 0);

  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">Heroes parsed from the selected tabs</caption>
        <thead>
          <tr>
            <th>Hero</th>
            <th>ID</th>
            <th>Rarity</th>
            <th className="num">Max speed</th>
            <th className="num">Levels</th>
            <th>Level 1 (H / S / G)</th>
            <th>Level {maxLevels || '-'} (H / S / G)</th>
            <th>Power parameters</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td className="mono">{row.id}</td>
              <td>
                <span className="tag tag--arena">{row.rarity}</span>
              </td>
              <td className="num">{row.maxSpeed}</td>
              <td className="num">{row.levelCount}</td>
              <td className="mono">{levelText(row.first)}</td>
              <td className="mono">{levelText(row.last)}</td>
              <td className={row.powerParams.length === 0 ? 'cell-faint' : undefined}>
                {row.powerParams.length === 0 ? 'none' : row.powerParams.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
