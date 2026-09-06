import type { BattlePassPreviewRow } from '../lib/types';

/** One track's cell: the reward and how much of it, or nothing on this tier. */
function Track({ name, amount, tone }: { name: string | null; amount: number | null; tone: string }) {
  if (name === null) return <span className="tag tag--reward">-</span>;
  return (
    <span className={`tag ${tone}`}>
      {name}
      {amount === null ? '' : ` x${amount.toLocaleString()}`}
    </span>
  );
}

/** The parsed tiers, in tier order. */
export function BattlePassPreviewTable({ rows }: { rows: BattlePassPreviewRow[] }) {
  if (rows.length === 0) return <p className="empty">No tiers were parsed.</p>;

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col" className="num">
              Tier
            </th>
            <th scope="col">Free track</th>
            <th scope="col">Premium track</th>
            <th scope="col" className="num">
              Sheet row
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tier}>
              <td className="num mono">{row.tier}</td>
              <td>
                <Track name={row.freeName} amount={row.freeAmount} tone="tag--unlock" />
              </td>
              <td>
                <Track name={row.premiumName} amount={row.premiumAmount} tone="tag--bot-hard" />
              </td>
              <td className="num">{row.sheetRow}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
