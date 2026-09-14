import type { ShopPreviewRow, ShopSoldIn } from '../lib/types';

/**
 * Only the three ways of paying need rewording. A currency is already shown to
 * the player under the name it is exported as, so it stands as it is.
 */
const KIND_LABEL: Record<string, string> = {
  RealMoney: 'Real money',
  Free: 'Free',
  Ad: 'Rewarded ad',
};

function soldInLabel(soldIn: ShopSoldIn): string {
  return KIND_LABEL[soldIn] ?? soldIn;
}

/**
 * What the product costs, in the one currency it is charged in. A dollar tier
 * is shown as the dollars it is - that is exactly what the tier means - and a
 * product carrying both is priced both ways, which is how one is moved between
 * real money and gems without being re-sent.
 */
function priceLabel(row: ShopPreviewRow): string {
  const parts: string[] = [];
  if (row.priceTier !== null) parts.push(`$${row.priceTier}`);
  if (row.price !== null) parts.push(row.price.toLocaleString());
  return parts.length === 0 ? '-' : parts.join(' / ');
}

/** The parsed products, in sheet order. */
export function ShopPreviewTable({ rows }: { rows: ShopPreviewRow[] }) {
  if (rows.length === 0) return <p className="empty">No products were parsed.</p>;

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Sold in</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Price
            </th>
            <th scope="col">Badge</th>
            <th scope="col">Grants</th>
            <th scope="col" className="num">
              Sheet row
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="mono">{row.id}</td>
              <td>{soldInLabel(row.soldIn)}</td>
              <td>
                <span className="param-list">
                  <span className={`tag ${row.enabled ? 'tag--bot-easy' : 'tag--bot-veryhard'}`}>
                    {row.enabled ? 'enabled' : 'disabled'}
                  </span>
                  {!row.listed && <span className="tag tag--reward">unlisted</span>}
                </span>
              </td>
              <td className="num mono">{priceLabel(row)}</td>
              <td>{row.badge ?? '-'}</td>
              <td>
                {row.contents.length === 0 ? (
                  <span className="tag tag--reward">nothing</span>
                ) : (
                  <span className="param-list">
                    {row.contents.map((content) => (
                      <span key={content} className="tag tag--unlock">
                        {content}
                      </span>
                    ))}
                  </span>
                )}
              </td>
              <td className="num">{row.sheetRow}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
