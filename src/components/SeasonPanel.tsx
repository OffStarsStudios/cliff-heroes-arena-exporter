import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { ControlsPanelProps } from '../exporters/types';
import {
  CONFIRMED_SKIP_CURRENCY,
  SKIP_CURRENCIES,
  nextSeasonId,
  seasonEndUtc,
  type BattlePassSeason,
} from '../lib/battlePass';
import { fetchLiveConfig } from '../lib/liveConfig';
import type { ShopConfig } from '../lib/types';

/**
 * The whole season header, set here rather than in the sheet.
 *
 * Every field on this panel was a row on the Season tab until it moved here,
 * and the reason is the same for all of them: they are decisions about one
 * live season, and several are IDs that have to match another config exactly.
 * A spreadsheet can hold any string; this panel can only offer the products
 * the shop actually sells and the currencies the game actually has, and can
 * work out the next season's ID from the one that is live. What is left in the
 * sheet is the ladder - thirty rows of rewards and amounts, which is what a
 * spreadsheet is for.
 *
 * The start is stated and stored in UTC, because that is what the client
 * reads. `datetime-local` carries no zone of its own, which is exactly what is
 * wanted here - the field is labelled UTC and the value is taken at face value
 * rather than converted out of whatever zone the browser happens to be in.
 *
 * Booked from the live ops calendar, the start and the duration are the
 * event's own window and are shown as such: the calendar already asked, and a
 * second answer here could only disagree with the first.
 */

/** `YYYY-MM-DD HH:mm` (what the client reads) -> what the input wants. */
function toInput(startUtc: string): string {
  return startUtc.trim() === '' ? '' : startUtc.trim().replace(' ', 'T').slice(0, 16);
}

/** The input's value back to the canonical form. Seconds, if any, are dropped. */
function fromInput(value: string): string {
  return value.trim() === '' ? '' : value.trim().replace('T', ' ').slice(0, 16);
}

/** "2026-10-01 00:00" as "1 Oct 2026, 00:00 UTC". */
export function readableUtc(stamp: string): string {
  const parsed = Date.parse(`${stamp.replace(' ', 'T')}:00Z`);
  if (Number.isNaN(parsed)) return stamp;
  const date = new Date(parsed);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    date.getUTCMonth()
  ];
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

interface ShopProductOption {
  id: string;
  enabled: boolean;
  /** True for `shop.pass.*`, the products that sell a premium track. */
  isPass: boolean;
}

/** What the live configs can tell the panel about the rest of the game. */
interface GameFacts {
  products: ShopProductOption[];
  /** The season ID the game is serving, so the next one can be worked out. */
  liveSeasonId: string | null;
  /** Where the two came from, or why they could not be read. */
  note: string | null;
  loading: boolean;
}

function productsFrom(payload: unknown): ShopProductOption[] {
  const config = payload as ShopConfig | null;
  const products = config?.Products ?? [];
  return products
    .filter((product): product is NonNullable<typeof product> => typeof product?.ID === 'string' && product.ID !== '')
    .map((product) => ({
      id: product.ID,
      enabled: product.IsEnabled !== false,
      isPass: product.ID.startsWith('shop.pass.'),
    }));
}

function seasonIdFrom(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const id = (payload as Record<string, unknown>).SeasonID;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/**
 * Reads the shop and the live pass so the panel can offer real choices.
 *
 * The live value is what the game is serving and therefore the honest answer;
 * the git baseline is the fallback, because a console that cannot reach
 * ConfigCat should still offer the product list rather than an empty dropdown.
 * Neither is required: with both unavailable the panel degrades to typed IDs
 * and says so, which is exactly what it was before this existed.
 */
function useGameFacts(environmentId: string): GameFacts {
  const [facts, setFacts] = useState<GameFacts>({
    products: [],
    liveSeasonId: null,
    note: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setFacts((current) => ({ ...current, loading: true }));

    Promise.all([
      fetchLiveConfig('shop', environmentId).catch(() => null),
      fetchLiveConfig('battlePass', environmentId).catch(() => null),
    ])
      .then(([shop, pass]) => {
        if (cancelled) return;
        const fromLive = shop === null ? [] : productsFrom(shop.live.json);
        const fromGit = shop === null ? [] : productsFrom(shop.baseline.json);
        const products = fromLive.length > 0 ? fromLive : fromGit;
        setFacts({
          products,
          liveSeasonId: pass === null ? null : seasonIdFrom(pass.live.json) ?? seasonIdFrom(pass.baseline.json),
          note:
            products.length === 0
              ? 'The shop could not be read, so the product has to be typed in full.'
              : fromLive.length === 0
                ? 'Products listed from the last published shop config, not from the live one.'
                : null,
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFacts({ products: [], liveSeasonId: null, note: 'The live configs could not be read.', loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  return facts;
}

const OTHER = '__other__';

export function SeasonPanel({ value, onChange, environmentId, fromEvent }: ControlsPanelProps<BattlePassSeason>) {
  const ids = useId();
  const facts = useGameFacts(environmentId);
  const end = seasonEndUtc(value);

  // The ID the live season implies. Offered, not imposed: a season that breaks
  // the numbering (a one-off event pass) is a legitimate thing to type.
  const suggestedId = useMemo(
    () => (facts.liveSeasonId === null ? null : nextSeasonId(facts.liveSeasonId)),
    [facts.liveSeasonId],
  );

  /**
   * Fill the ID in once, when there is nothing to overwrite.
   *
   * A one-shot rather than a derived value: after this the box belongs to
   * whoever is typing in it, and a slow live response must not reach back and
   * replace what they wrote.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || suggestedId === null) return;
    seeded.current = true;
    if (value.seasonId.trim() !== '') return;
    const number = /(\d+)$/.exec(suggestedId)?.[1];
    onChange({
      ...value,
      seasonId: suggestedId,
      seasonName: value.seasonName.trim() === '' && number !== undefined ? `SEASON ${number}` : value.seasonName,
    });
  }, [suggestedId, value, onChange]);

  const [typingProduct, setTypingProduct] = useState(false);
  const known = facts.products.some((product) => product.id === value.premiumProductId);
  // An unpublished product is a normal state - next season's product may not be
  // in the shop yet - so the typed value stays visible rather than being reset.
  const showProductBox = typingProduct || (value.premiumProductId !== '' && !known && !facts.loading);

  const passProducts = facts.products.filter((product) => product.isPass);
  const otherProducts = facts.products.filter((product) => !product.isPass);
  const chosenProduct = facts.products.find((product) => product.id === value.premiumProductId) ?? null;

  return (
    <div className="stack-sm">
      {/*
        Labels and controls, and nothing else.

        Every field here used to carry a sentence explaining it, and nine
        explanations stacked on top of each other stop being read - the panel
        looked like documentation with inputs in it. What a field means lives
        where it is needed instead: in the control itself (the product list,
        the currency marked as confirmed), in the tooltip on its label, and in
        the issue list when a value is actually wrong.
      */}
      <div className="fieldgrid">
        <div className="field">
          <div className="field__labelrow">
            <label
              className="field__label"
              htmlFor={`${ids}-id`}
              title="Player progress is stored against this ID, so a new season needs a new one."
            >
              Season ID
            </label>
            {suggestedId !== null && value.seasonId !== suggestedId && (
              <button
                type="button"
                className="linkbtn"
                onClick={() => onChange({ ...value, seasonId: suggestedId })}
              >
                Use {suggestedId}
              </button>
            )}
          </div>
          <input
            id={`${ids}-id`}
            type="text"
            value={value.seasonId}
            placeholder="pass.season2"
            onChange={(event) => onChange({ ...value, seasonId: event.target.value })}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${ids}-name`}>
            Season name
          </label>
          <input
            id={`${ids}-name`}
            type="text"
            value={value.seasonName}
            placeholder="SEASON 2"
            onChange={(event) => onChange({ ...value, seasonName: event.target.value })}
          />
        </div>

        {fromEvent === true ? (
          <>
            <div className="field">
              <span className="field__label">Start (UTC)</span>
              <output className="field__readout" title="Set by the event above.">
                {value.startUtc === '' ? '-' : readableUtc(value.startUtc)}
              </output>
            </div>

            <div className="field">
              <span className="field__label">Duration</span>
              <output
                className="field__readout"
                title="The event's own length, rounded to the whole days the client counts in."
              >
                {value.durationDays} days
              </output>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label
                className="field__label"
                htmlFor={`${ids}-start`}
                title="Taken as UTC exactly as typed, not as your local time."
              >
                Start (UTC)
              </label>
              <input
                id={`${ids}-start`}
                type="datetime-local"
                value={toInput(value.startUtc)}
                onChange={(event) => onChange({ ...value, startUtc: fromInput(event.target.value) })}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor={`${ids}-duration`} title="Whole days.">
                Duration, days
              </label>
              <input
                id={`${ids}-duration`}
                type="number"
                min={1}
                step={1}
                value={Number.isFinite(value.durationDays) && value.durationDays !== 0 ? value.durationDays : ''}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  onChange({ ...value, durationDays: Number.isNaN(parsed) ? 0 : parsed });
                }}
              />
            </div>
          </>
        )}

        <div className="field">
          <label className="field__label" htmlFor={`${ids}-tokens`} title="How much progress one tier costs.">
            Tokens per tier
          </label>
          <input
            id={`${ids}-tokens`}
            type="number"
            min={1}
            step={1}
            value={Number.isFinite(value.tokensPerTier) && value.tokensPerTier !== 0 ? value.tokensPerTier : ''}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({ ...value, tokensPerTier: Number.isNaN(parsed) ? 0 : parsed });
            }}
          />
        </div>

        <div className="field field--wide">
          <div className="field__labelrow">
            <label
              className="field__label"
              htmlFor={`${ids}-product`}
              title="The shop product that sells the premium track, by exact ID."
            >
              Premium product
            </label>
            {facts.loading ? (
              <span className="spinner" aria-label="Reading the shop" />
            ) : showProductBox && facts.products.length > 0 ? (
              <button
                type="button"
                className="linkbtn"
                onClick={() => {
                  setTypingProduct(false);
                  onChange({ ...value, premiumProductId: '' });
                }}
              >
                Pick from the shop
              </button>
            ) : null}
          </div>
          {showProductBox ? (
            <input
              id={`${ids}-product`}
              type="text"
              value={value.premiumProductId}
              placeholder="shop.pass.season2.premium"
              onChange={(event) => onChange({ ...value, premiumProductId: event.target.value })}
            />
          ) : (
            <select
              id={`${ids}-product`}
              value={value.premiumProductId}
              onChange={(event) => {
                if (event.target.value === OTHER) {
                  setTypingProduct(true);
                  onChange({ ...value, premiumProductId: '' });
                  return;
                }
                onChange({ ...value, premiumProductId: event.target.value });
              }}
            >
              <option value="">
                {facts.products.length === 0 ? 'The shop could not be read' : 'Pick a product...'}
              </option>
              {passProducts.length > 0 && (
                <optgroup label="Pass products">
                  {passProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.id}
                      {product.enabled ? '' : ' (disabled)'}
                    </option>
                  ))}
                </optgroup>
              )}
              {otherProducts.length > 0 && (
                <optgroup label="Everything else in the shop">
                  {otherProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.id}
                      {product.enabled ? '' : ' (disabled)'}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={OTHER}>Not in the shop yet - type the ID</option>
            </select>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${ids}-skip-cost`} title="Zero for a free skip.">
            Skip cost
          </label>
          <input
            id={`${ids}-skip-cost`}
            type="number"
            min={0}
            step={1}
            value={Number.isFinite(value.skipTierCost) ? value.skipTierCost : ''}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({ ...value, skipTierCost: Number.isNaN(parsed) ? 0 : parsed });
            }}
          />
        </div>

        <div className="field">
          <label
            className="field__label"
            htmlFor={`${ids}-skip-currency`}
            title={`Only ${CONFIRMED_SKIP_CURRENCY} is confirmed to work in the client.`}
          >
            Skip currency
          </label>
          <select
            id={`${ids}-skip-currency`}
            value={value.skipCurrencyId}
            onChange={(event) => onChange({ ...value, skipCurrencyId: event.target.value })}
          >
            {!SKIP_CURRENCIES.includes(value.skipCurrencyId) && value.skipCurrencyId !== '' && (
              <option value={value.skipCurrencyId}>{value.skipCurrencyId}</option>
            )}
            {SKIP_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
                {currency === CONFIRMED_SKIP_CURRENCY ? ' (confirmed)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field field--wide">
          <label
            className="field__label"
            htmlFor={`${ids}-art`}
            title="May be left empty. An art library will replace this box."
          >
            Final reward art
          </label>
          <input
            id={`${ids}-art`}
            type="text"
            value={value.finalRewardArt}
            placeholder="Optional"
            onChange={(event) => onChange({ ...value, finalRewardArt: event.target.value })}
          />
        </div>
      </div>

      {/* State, not prose: the window these fields add up to, and the one thing
          about the chosen product that the dropdown cannot show. */}
      {(end !== null || (chosenProduct !== null && !chosenProduct.enabled)) && (
        <div className="factline">
          {end !== null && (
            <span>
              {readableUtc(value.startUtc)} &rarr; {readableUtc(end)}
            </span>
          )}
          {chosenProduct !== null && !chosenProduct.enabled && (
            <span className="factline__warn">
              <Icon name="alert" size={13} /> {chosenProduct.id} is disabled in the shop
            </span>
          )}
        </div>
      )}
    </div>
  );
}
