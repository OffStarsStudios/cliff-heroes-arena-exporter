import type { MatchTrophyPreviewRow } from '../lib/types';

/** The parsed places, in output order. */
export function MatchTrophyPreviewTable({ rows }: { rows: MatchTrophyPreviewRow[] }) {
  if (rows.length === 0) return <p className="empty">No places were parsed.</p>;

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col" className="num">
              Place
            </th>
            <th scope="col" className="num">
              Trophies
            </th>
            <th scope="col">Effect</th>
            <th scope="col" className="num">
              Sheet row
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.place}>
              <td className="num">{row.place}</td>
              <td className="num mono">{row.trophies > 0 ? `+${row.trophies}` : row.trophies}</td>
              <td>
                <span
                  className={`tag ${row.trophies > 0 ? 'tag--bot-easy' : row.trophies < 0 ? 'tag--bot-veryhard' : 'tag--reward'}`}
                >
                  {row.trophies > 0 ? 'gain' : row.trophies < 0 ? 'loss' : 'no change'}
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
