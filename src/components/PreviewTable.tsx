import type { PreviewRow } from '../lib/types';

const TAG_CLASS: Record<PreviewRow['type'], string> = {
  Arena: 'tag tag--arena',
  'Arena Unlock': 'tag tag--unlock',
  Reward: 'tag tag--reward',
};

export function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  if (rows.length === 0) {
    return <p className="empty">Nothing parsed yet. Check the tab and column choices above.</p>;
  }

  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">Milestones parsed from the progression tab</caption>
        <thead>
          <tr>
            <th className="num">Trophies</th>
            <th>Type</th>
            <th>Arena / reward</th>
            <th className="num">Amount</th>
            <th className="num">Sheet row</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.sheetRow}-${index}`}>
              <td className="num">{row.trophies === null ? '-' : row.trophies.toLocaleString()}</td>
              <td>
                <span className={TAG_CLASS[row.type]}>{row.type}</span>
              </td>
              <td>{row.label}</td>
              <td className="num">{row.amount === null ? '' : row.amount.toLocaleString()}</td>
              <td className="num cell-faint">{row.sheetRow}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
