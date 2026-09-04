import type { HeroUpgradePreviewRow } from '../lib/types';

/** The priced rarities, in sheet order. */
export function HeroUpgradePreviewTable({ rows }: { rows: HeroUpgradePreviewRow[] }) {
  if (rows.length === 0) return <p className="empty">No rarities were parsed.</p>;

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Rarity</th>
            <th scope="col" className="num">
              Coins base
            </th>
            <th scope="col" className="num">
              Cards base
            </th>
            <th scope="col" className="num">
              Cost modifier
            </th>
            <th scope="col" className="num">
              Growth modifier
            </th>
            <th scope="col" className="num">
              Sheet row
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rarity}>
              <td>
                <span className="tag tag--reward">{row.rarity}</span>
              </td>
              <td className="num mono">{row.coinsBase.toLocaleString()}</td>
              <td className="num mono">{row.cardsBase.toLocaleString()}</td>
              <td className="num mono">{row.costModifier}</td>
              <td className="num mono">{row.growthModifier}</td>
              <td className="num">{row.sheetRow}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
