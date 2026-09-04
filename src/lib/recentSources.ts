import type { ExporterDomain } from '../domains/types';

/**
 * Remembers the last Google Sheet each exporter loaded, so reopening a page
 * is one click rather than a hunt through Drive for the link.
 *
 * Only sheet links are remembered - a dropped file cannot be reopened without
 * a user gesture - and only after a successful load. Workbook contents are
 * never stored. Keys use the domain id rather than the page route, so a route
 * rename cannot orphan a remembered link.
 */

const PREFIX = 'cliffheroes.source.';

function key(domain: ExporterDomain): string {
  return `${PREFIX}${domain}.url`;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // Some browsers throw on access when site data is blocked.
    return null;
  }
}

export function recallSheetUrl(domain: ExporterDomain): string | null {
  try {
    const value = storage()?.getItem(key(domain)) ?? null;
    return value !== null && value.trim() !== '' ? value : null;
  } catch {
    return null;
  }
}

export function rememberSheetUrl(domain: ExporterDomain, url: string): void {
  try {
    storage()?.setItem(key(domain), url);
  } catch {
    // Remembering is a convenience; a full or blocked store must not break loading.
  }
}

export function forgetSheetUrl(domain: ExporterDomain): void {
  try {
    storage()?.removeItem(key(domain));
  } catch {
    // See above.
  }
}
