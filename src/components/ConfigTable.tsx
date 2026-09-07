import { useState } from 'react';
import { Icon } from './Icon';

/**
 * A published config, rendered as tables rather than JSON.
 *
 * One generic renderer rather than eight bespoke ones, because all eight
 * configs turn out to be the same two shapes in different proportions: a
 * handful of top-level scalars, and one array of uniform objects. Arenas,
 * heroes, shop and the trophy road are the array; the battle pass header and
 * the hero upgrade curve are the scalars; bots is both. A ninth config would
 * be too, and would need no code.
 *
 * The parts that are genuinely irregular - a hero's ten level rows, a shop
 * product's contents, a bot's nested power block - are summarised in the cell
 * and opened on demand, so a table of seven heroes stays a table of seven
 * heroes instead of unrolling into seventy rows nobody asked for.
 *
 * Keys are shown humanised with the exact config key as the tooltip. The
 * live-ops reader wants "Speed Increase Per Second"; whoever is comparing this
 * against the schema wants `SpeedIncreasePerSecond`, and both are one hover
 * apart.
 */

type Json = unknown;

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitive(value: Json): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** `SpeedIncreasePerSecond` -> `Speed Increase Per Second`, `IsEnabled` -> `Is Enabled`. */
export function humanise(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

/** Ordinals for arrays whose index is the meaning, e.g. trophies by finishing place. */
function ordinal(index: number): string {
  const n = index + 1;
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  // Floats are tuning knobs - 0.35 must not become 0.4, and 0.3500000001 must
  // not take up half a column.
  return String(Number(value.toFixed(6)));
}

function Scalar({ value }: { value: Json }) {
  if (value === null || value === undefined) return <span className="cell cell--empty">not set</span>;
  if (typeof value === 'boolean') {
    // Never colour alone: the word carries the meaning for anyone who cannot
    // separate the two hues.
    return <span className={`chip chip--${value ? 'ok' : 'neutral'}`}>{value ? 'yes' : 'no'}</span>;
  }
  if (typeof value === 'number') return <span className="cell cell--num">{formatNumber(value)}</span>;

  const text = String(value);
  // Ids and enum-ish values read better in the monospace face; prose does not.
  const looksLikeId = /^[a-z0-9]+([._-][a-z0-9]+)+$/i.test(text);
  return <span className={looksLikeId ? 'cell mono' : 'cell'}>{text === '' ? '-' : text}</span>;
}

/** What a nested value looks like when it has to fit in one cell. */
function Summary({ value }: { value: Json }) {
  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) {
      return (
        <span className="cell cell--list">
          {value.map((entry, index) => (
            <span key={index} className="cell__pill">
              <Scalar value={entry} />
            </span>
          ))}
        </span>
      );
    }
    return <span className="cell cell--nested">{value.length} entries</span>;
  }
  if (isObject(value)) {
    return <span className="cell cell--nested">{Object.keys(value).length} fields</span>;
  }
  return <Scalar value={value} />;
}

function needsExpanding(value: Json): boolean {
  if (Array.isArray(value)) return !value.every(isPrimitive);
  return isObject(value);
}

/** Top-level scalars: the config's own settings, as a definition list. */
function Fields({ entries }: { entries: [string, Json][] }) {
  return (
    <dl className="fields">
      {entries.map(([key, value]) => (
        <div key={key} className="fields__row">
          <dt className="fields__key" title={key}>
            {humanise(key)}
          </dt>
          <dd className="fields__value">
            <Scalar value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** An array of primitives, where the position is the meaning. */
function PositionTable({ name, values }: { name: string; values: Json[] }) {
  return (
    <div className="tablewrap">
      <table className="ctable">
        <thead>
          <tr>
            {values.map((_, index) => (
              <th key={index} scope="col">
                {ordinal(index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {values.map((value, index) => (
              <td key={index}>
                <Scalar value={value} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="field__note">
        {values.length} {humanise(name).toLowerCase()}, in order.
      </p>
    </div>
  );
}

function Row({ row, columns, index }: { row: Record<string, Json>; columns: string[]; index: number }) {
  const [open, setOpen] = useState(false);
  const nested = columns.filter((column) => needsExpanding(row[column]));
  const expandable = nested.length > 0;

  return (
    <>
      <tr className={open ? 'ctable__row ctable__row--open' : 'ctable__row'}>
        <td className="ctable__gutter">
          {expandable ? (
            <button
              type="button"
              className="ctable__expand"
              aria-expanded={open}
              aria-label={open ? `Collapse row ${index + 1}` : `Expand row ${index + 1}`}
              onClick={() => setOpen((current) => !current)}
            >
              <Icon
                name="chevron"
                size={13}
                className={open ? 'mapping__chevron mapping__chevron--open' : 'mapping__chevron'}
              />
            </button>
          ) : (
            <span className="ctable__index">{index + 1}</span>
          )}
        </td>
        {columns.map((column) => (
          <td key={column}>
            <Summary value={row[column]} />
          </td>
        ))}
      </tr>
      {open && (
        <tr className="ctable__detail">
          <td colSpan={columns.length + 1}>
            <div className="stack-sm">
              {nested.map((column) => (
                <div key={column}>
                  <p className="step__section-title" title={column}>
                    {humanise(column)}
                  </p>
                  <ConfigTable value={row[column]} nameHint={column} nested />
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** An array of objects: the shape every list-like config has. */
function ObjectTable({ name, rows }: { name: string; rows: Record<string, Json>[] }) {
  // Columns in order of first appearance, so the table reads the way the
  // config is written rather than alphabetically.
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  }

  return (
    <div>
      <div className="tablewrap">
        <table className="ctable">
          <thead>
            <tr>
              <th scope="col" className="ctable__gutter" aria-label="Row" />
              {columns.map((column) => (
                <th key={column} scope="col" title={column}>
                  {humanise(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <Row key={index} row={row} columns={columns} index={index} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="field__note">
        {rows.length} {humanise(name).toLowerCase()}
        {rows.some((row) => columns.some((column) => needsExpanding(row[column]))) &&
          ' - rows with a chevron have more inside'}
        .
      </p>
    </div>
  );
}

interface ConfigTableProps {
  value: Json;
  /** The key this value came from, used to name a bare array. */
  nameHint?: string;
  /** Nested tables drop the section headings, which would double up. */
  nested?: boolean;
}

export function ConfigTable({ value, nameHint = 'entries', nested = false }: ConfigTableProps) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="empty">Empty.</p>;
    if (value.every(isPrimitive)) return <PositionTable name={nameHint} values={value} />;
    if (value.every(isObject)) return <ObjectTable name={nameHint} rows={value as Record<string, Json>[]} />;
    // Mixed arrays are not a shape any config uses, but rendering something
    // truthful beats rendering nothing.
    return (
      <ul className="param-list">
        {value.map((entry, index) => (
          <li key={index} className="param mono">
            {JSON.stringify(entry)}
          </li>
        ))}
      </ul>
    );
  }

  if (!isObject(value)) return <Scalar value={value} />;

  const entries = Object.entries(value);
  const scalars = entries.filter(([, entry]) => isPrimitive(entry));
  const collections = entries.filter(([, entry]) => !isPrimitive(entry));

  return (
    <div className="stack-md">
      {scalars.length > 0 && <Fields entries={scalars} />}
      {collections.map(([key, entry]) => (
        <div key={key}>
          {!nested && (
            <p className="step__section-title" title={key}>
              {humanise(key)}
            </p>
          )}
          <ConfigTable value={entry} nameHint={key} nested />
        </div>
      ))}
      {entries.length === 0 && <p className="empty">This config is empty.</p>}
    </div>
  );
}
