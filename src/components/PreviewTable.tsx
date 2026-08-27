import type { PreviewRow } from '../lib/types';

interface PreviewTableProps {
  rows: PreviewRow[];
}

const TAG_CLASS: Record<PreviewRow['type'], string> = {
  Arena: 'tag tag--arena',
  'Arena Unlock': 'tag tag--unlock',
  Reward: 'tag tag--reward',
};

export function PreviewTable({ rows }: PreviewTableProps) {
  return (
    <section className="card">
      <header className="card__header">
        <h2 className="card__title">Parsed milestones</h2>
        <span className="card__hint">{rows.length} rows</span>
      </header>
      {rows.length === 0 ? (
        <div className="card__body">
          <p className="empty">Nothing parsed yet. Check the sheet and column selections above.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="num">Trophies</th>
                <th>Type</th>
                <th>Arena / Reward</th>
                <th className="num">Amount</th>
                <th className="num">Row</th>
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
                  <td className="num" style={{ color: 'var(--text-faint)' }}>
                    {row.sheetRow}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
