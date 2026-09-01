/**
 * Semantic JSON diff.
 *
 * Values in ConfigCat are stored minified; the exporters emit
 * `JSON.stringify(config, null, 2)`. A textual diff would call every publish a
 * total rewrite and be useless as a safety gate, so comparison happens on the
 * parsed structure instead.
 *
 * Two details matter for these payloads specifically:
 *
 * - Several schemas mandate exact key order (`validate.ts` enforces it), so a
 *   reordering is reported as a change rather than treated as equality.
 * - Arrays are matched by identity where the elements have one. Inserting a
 *   milestone in the middle of the trophy road shifts every later index, and an
 *   index-wise diff would report the whole tail as changed. Matching on
 *   `Trophies` or `ID` instead reports the one real insertion.
 */

/** Keys that identify an array element, most specific first. */
const IDENTITY_KEYS = ['ID', 'RewardID', 'key', 'Level', 'Rarity', 'Trophies'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The identity key shared by every element of an array, or null. */
function identityKeyFor(items) {
  if (items.length === 0) return null;
  if (!items.every(isPlainObject)) return null;
  for (const key of IDENTITY_KEYS) {
    const values = items.map((item) => item[key]);
    const usable = values.every((value) => typeof value === 'string' || typeof value === 'number');
    if (!usable) continue;
    if (new Set(values).size !== values.length) continue;
    return key;
  }
  return null;
}

function joinPath(path, segment) {
  return path === '' ? segment : `${path}${segment.startsWith('[') ? '' : '.'}${segment}`;
}

function change(changes, kind, path, before, after) {
  changes.push({ kind, path, before, after });
}

function walk(before, after, path, changes) {
  if (before === after) return;

  const bothObjects = isPlainObject(before) && isPlainObject(after);
  const bothArrays = Array.isArray(before) && Array.isArray(after);

  if (!bothObjects && !bothArrays) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      change(changes, 'changed', path, before, after);
    }
    return;
  }

  if (bothObjects) {
    const beforeKeys = Object.keys(before);
    const afterKeys = Object.keys(after);

    for (const key of beforeKeys) {
      if (!(key in after)) change(changes, 'removed', joinPath(path, key), before[key], undefined);
    }
    for (const key of afterKeys) {
      if (!(key in before)) change(changes, 'added', joinPath(path, key), undefined, after[key]);
    }
    for (const key of beforeKeys) {
      if (key in after) walk(before[key], after[key], joinPath(path, key), changes);
    }

    // Key order is part of these schemas, so report a pure reordering.
    const shared = beforeKeys.filter((key) => key in after);
    const sharedAfter = afterKeys.filter((key) => beforeKeys.includes(key));
    if (shared.length === sharedAfter.length && shared.some((key, i) => key !== sharedAfter[i])) {
      change(changes, 'reordered', path === '' ? '(root)' : path, shared, sharedAfter);
    }
    return;
  }

  const identity = identityKeyFor(before) ?? identityKeyFor(after);

  if (identity === null) {
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i += 1) {
      const segment = `[${i}]`;
      if (i >= before.length) change(changes, 'added', joinPath(path, segment), undefined, after[i]);
      else if (i >= after.length) change(changes, 'removed', joinPath(path, segment), before[i], undefined);
      else walk(before[i], after[i], joinPath(path, segment), changes);
    }
    return;
  }

  const beforeById = new Map(before.map((item) => [item[identity], item]));
  const afterById = new Map(after.map((item) => [item[identity], item]));

  for (const [id, item] of beforeById) {
    if (!afterById.has(id)) {
      change(changes, 'removed', joinPath(path, `[${identity}=${id}]`), item, undefined);
    }
  }
  for (const [id, item] of afterById) {
    if (!beforeById.has(id)) {
      change(changes, 'added', joinPath(path, `[${identity}=${id}]`), undefined, item);
    }
  }
  for (const [id, item] of beforeById) {
    if (afterById.has(id)) {
      walk(item, afterById.get(id), joinPath(path, `[${identity}=${id}]`), changes);
    }
  }

  // Order within the array can be meaningful too - the trophy road is read in
  // sequence - so report a pure reordering of the same elements.
  const beforeOrder = before.map((item) => item[identity]).filter((id) => afterById.has(id));
  const afterOrder = after.map((item) => item[identity]).filter((id) => beforeById.has(id));
  if (
    beforeOrder.length === afterOrder.length &&
    beforeOrder.some((id, i) => id !== afterOrder[i])
  ) {
    change(changes, 'reordered', path === '' ? '(root)' : path, beforeOrder, afterOrder);
  }
}

/** Structural changes turning `before` into `after`. Empty means equivalent. */
export function diffJson(before, after) {
  const changes = [];
  walk(before, after, '', changes);
  return changes;
}

/** True when two payloads are the same config, whatever their formatting. */
export function isEquivalent(before, after) {
  return diffJson(before, after).length === 0;
}

/** Counts by kind, for a headline above a change list. */
export function summarizeDiff(changes) {
  const summary = { added: 0, removed: 0, changed: 0, reordered: 0, total: changes.length };
  for (const item of changes) summary[item.kind] += 1;
  return summary;
}

/** A short, readable rendering of one change. */
export function describeChange(change) {
  const short = (value) => {
    if (value === undefined) return 'nothing';
    const text = JSON.stringify(value);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  };
  switch (change.kind) {
    case 'added':
      return `+ ${change.path} = ${short(change.after)}`;
    case 'removed':
      return `- ${change.path} was ${short(change.before)}`;
    case 'reordered':
      return `~ ${change.path} reordered`;
    default:
      return `~ ${change.path}: ${short(change.before)} -> ${short(change.after)}`;
  }
}
