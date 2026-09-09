import { ShopPreviewTable } from '../components/ShopPreviewTable';
import { buildLookup } from '../lib/lookups';
import { autoSelectShopSheets, type ShopSheetSelection } from '../lib/sheetSelect';
import { transformShop } from '../lib/shop';
import { serializeShopConfig, validateShopConfig } from '../lib/validateShop';
import type { ShopConfig, ShopPreviewRow } from '../lib/types';
import { rewardRegistryFromLookup } from '../workspace/registry';
import type { ExporterDefinition } from './types';

/** The Shop exporter: `shopSettings` from the Shop Settings workbook. */
export const SHOP_EXPORTER: ExporterDefinition<ShopSheetSelection, ShopConfig, ShopPreviewRow> = {
  domain: 'shop',
  dataset: 'shop',
  view: 'shop',
  title: 'Shop',
  lead: (
    <>
      Every product, how it is sold, its price or limits, and the rewards it grants, joined against
      the Rewards lookup tab and published to <span className="mono">shopSettings</span>.
    </>
  ),
  icon: 'cart',
  badge: 'shop',
  downloadFilename: 'shop.json',
  tabsHint: 'Shop products are joined from two tabs.',
  tabs: [
    {
      key: 'products',
      label: 'Products',
      note: 'One row per product: ID, how it is sold, flags, price or limits, then Reward N / Amount N pairs.',
    },
    {
      key: 'rewards',
      label: 'Rewards lookup',
      note: 'Maps each reward name to its reward ID.',
    },
  ],
  autoSelect: autoSelectShopSheets,
  analyze({ products, rewards }) {
    const lookup = buildLookup(rewards, 'reward');
    const result = transformShop({ products, rewards: lookup.table });
    const registry = rewardRegistryFromLookup(lookup.table, 'shop');
    return {
      config: result.config,
      preview: result.preview,
      issues: [...lookup.issues, ...result.issues],
      stats: [
        { label: 'Products', value: result.stats.products },
        { label: 'Enabled', value: result.stats.enabled },
        { label: 'Rewards granted', value: result.stats.contents },
      ],
      count: result.stats.products,
      registry,
    };
  },
  validate: validateShopConfig,
  serialize: serializeShopConfig,
  PreviewTable: ShopPreviewTable,
  noun: { singular: 'product', plural: 'products' },
  errorContext: 'a product row or a reward lookup is failing',
};
