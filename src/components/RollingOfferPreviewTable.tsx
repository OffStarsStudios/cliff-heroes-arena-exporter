import type { RollingOfferPreviewRow } from '../lib/types';

/**
 * The chain, in the order the player climbs it.
 *
 * Step numbers are shown but not editable anywhere: a step has no identity
 * beyond where it sits, so the number is a consequence of the row order rather
 * than a field that could disagree with it.
 */
export function RollingOfferPreviewTable({ rows }: { rows: RollingOfferPreviewRow[] }) {
  if (rows.length === 0) return <p className="empty">No steps were parsed.</p>;

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col" className="num">
              Step
            </th>
            <th scope="col">Sold in</th>
            <th scope="col">Costs</th>
            <th scope="col">Pays</th>
            <th scope="col" className="num">
              Sheet row
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.step}>
              <td className="num">{row.step}</td>
              <td>{row.soldIn}</td>
              <td className="mono">{row.price}</td>
              <td>
                <span className="param-list">
                  {row.rewards.map((reward) => (
                    <span key={reward} className="tag tag--reward">
                      {reward}
                    </span>
                  ))}
                </span>
              </td>
              <td className="num">{row.sheetRow}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
