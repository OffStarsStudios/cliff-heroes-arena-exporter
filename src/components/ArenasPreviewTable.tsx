import type { ArenaPreviewRow } from '../lib/types';

/** The parsed arenas, one row each, with the bot line-up as tags. */
export function ArenasPreviewTable({ rows }: { rows: ArenaPreviewRow[] }) {
  if (rows.length === 0) return <p className="empty">No arenas were parsed.</p>;

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Arena</th>
            <th scope="col">ID</th>
            <th scope="col" className="num">
              Tracks
            </th>
            <th scope="col">Bots</th>
            <th scope="col" className="num">
              Sheet row
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td className="mono">{row.id}</td>
              <td className="num">{row.trackCount}</td>
              <td>
                <span className="param-list">
                  {row.botLevels.map((level, index) => (
                    <span key={`${index}-${level}`} className={`tag tag--bot-${level.toLowerCase()}`}>
                      {index + 1}. {level}
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
