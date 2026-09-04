import type { BotPreviewRow } from '../lib/types';

function range([min, max]: [number, number], unit = ''): string {
  return min === max ? `${min}${unit}` : `${min}${unit} - ${max}${unit}`;
}

/** The parsed bot levels, in output order. */
export function BotsPreviewTable({ rows }: { rows: BotPreviewRow[] }) {
  if (rows.length === 0) return <p className="empty">No bot levels were parsed.</p>;

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col" className="num">
              Level
            </th>
            <th scope="col">Jump interval</th>
            <th scope="col">Dodge chance</th>
            <th scope="col">Raycast</th>
            <th scope="col">Fire interval</th>
            <th scope="col" className="num">
              Sheet row
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.level}>
              <td className="num">{row.level}</td>
              <td className="mono">{range(row.jump, 's')}</td>
              <td className="mono">{range(row.dodge)}</td>
              <td className="mono">
                {row.raycast[0]} every {row.raycast[1]}s
              </td>
              <td className="mono">{range(row.fire, 's')}</td>
              <td className="num">{row.sheetRow}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
