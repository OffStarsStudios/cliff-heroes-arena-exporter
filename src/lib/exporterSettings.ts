import type { ExporterDomain } from '../domains/types';

/**
 * Remembers the fields a page sets itself, per config.
 *
 * These are the values that do not come from the spreadsheet - the battle
 * pass's start and duration, say - and losing them on a refresh would mean
 * retyping a season window every time somebody reloads the page. They are
 * small, plain JSON and belong to one browser, exactly like the remembered
 * sheet links in `recentSources`, so they are stored the same way and with the
 * same rule: remembering is a convenience, and a blocked or full store must
 * never break the page.
 *
 * Nothing here is authoritative. The page seeds from the live config when
 * there is nothing stored, and every stored value is re-validated on the way
 * back in, so a stale shape degrades to "start from live" rather than to a
 * broken form.
 */

const PREFIX = 'cliffheroes.settings.';

function key(domain: ExporterDomain): string {
  return `${PREFIX}${domain}`;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // Some browsers throw on access when site data is blocked.
    return null;
  }
}

/** The stored JSON for a domain, or null when there is none or it is unreadable. */
export function recallSettings(domain: ExporterDomain): unknown | null {
  try {
    const raw = storage()?.getItem(key(domain)) ?? null;
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function rememberSettings(domain: ExporterDomain, value: unknown): void {
  try {
    storage()?.setItem(key(domain), JSON.stringify(value));
  } catch {
    // See the note above: this is a convenience, never a requirement.
  }
}
