import type { ShopPreviewRow, ShopSoldIn } from '../lib/types';

const SOLD_IN_LABEL: Record<ShopSoldIn, string> = {
  RealMoney: 'Real money',
  Gems: 'Gems',
  Free: 'Free',
  Ad: 'Rewarded ad',
};

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
              <td>{SOLD_IN_LABEL[row.soldIn]}</td>
              <td>
                <span className="param-list">
                  <span className={`tag ${row.enabled ? 'tag--bot-easy' : 'tag--bot-veryhard'}`}>
                    {row.enabled ? 'enabled' : 'disabled'}
                  </span>
                  {!row.listed && <span className="tag tag--reward">unlisted</span>}
                </span>
              </td>
              <td className="num mono">{row.price === null ? '-' : row.price.toLocaleString()}</td>
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
