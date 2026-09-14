/**
 * Would publishing each Google Sheet change the live game?
 *
 * Run with `npm run audit:live`. For every config, this downloads the sheet the
 * exporter reads, runs the real exporter over it, and diffs the result against
 * the value ConfigCat is actually serving. Nothing is written anywhere.
 *
 * This is the only check that answers that question. `npm test` proves the
 * exporters reproduce the payloads in `config/`, and `npm run check:graph`
 * proves those payloads agree with each other - but both work from files in the
 * repo, so a sheet edited last week and a value changed by hand in ConfigCat
 * are equally invisible to them. Both have happened.
 *
 * Two inputs, neither of them secret:
 *
 * - `CONFIGCAT_SDK_KEY` - the **client** SDK key for the environment the game
 *   reads (Test, not Production). It is compiled into the shipped game and can
 *   be read out of any build, which is why the config CDN answers without
 *   authentication; it grants read access to the config and nothing else. It is
 *   taken from the environment rather than committed so that this repo does not
 *   become another place it has to be rotated. In the game repo it is the
 *   `SdkKey` constant in `Assets/SDK/Runtime/Config/ConfigProvider.cs`.
 * - `scripts/sheets.json` - which spreadsheet backs which config. Every one of
 *   them is shared "anyone with the link, viewer", which is what lets the
 *   exporter read them at all.
 *
 * Exit code is non-zero when a sheet **cannot** be published - an exporter
 * error means the config it would produce is refused. Differences on their own
 * exit zero: a sheet ahead of live is the normal state of someone mid-edit, not
 * a failure. Pass `--strict` to fail on those too, which is what a scheduled
 * run wants.
 */

import { existsSync, readFileSync } from 'fs';
import { get } from 'https';
import { join } from 'path';

import { runAnalysis } from '../src/exporters/analysis';
import { ARENAS_EXPORTER } from '../src/exporters/arenas';
import { BATTLE_PASS_EXPORTER } from '../src/exporters/battlePass';
import { BOTS_EXPORTER } from '../src/exporters/bots';
import { HERO_UPGRADE_EXPORTER } from '../src/exporters/heroUpgrade';
import { HEROES_EXPORTER } from '../src/exporters/heroes';
import { MATCH_TROPHY_EXPORTER } from '../src/exporters/matchTrophy';
import { SHOP_EXPORTER } from '../src/exporters/shop';
import { detectColumns } from '../src/lib/columnDetect';
import { buildLookup } from '../src/lib/lookups';
import { autoSelectSheets } from '../src/lib/sheetSelect';
import { transform } from '../src/lib/transform';
import { readWorkbookBytes } from '../src/lib/workbook';
import type { Issue, RawWorkbook } from '../src/lib/types';
import { DOMAIN_LABELS, SETTING_KEYS, type DomainId } from '../src/domains/types';

const STRICT = process.argv.includes('--strict');
const SHEETS_FILE = join(process.cwd(), 'scripts', 'sheets.json');

/* ------------------------------------------------------------- fetching -- */

/** GET a URL, following the redirects Google's export endpoint hands out. */
function download(url: string, hops = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (hops > 5) {
      reject(new Error(`too many redirects for ${url}`));
      return;
    }
    get(url, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        resolve(download(new URL(location, url).toString(), hops + 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/**
 * Every setting the CDN is serving, decoded.
 *
 * Each one is a string holding minified JSON, at `.f.<key>.v.s`. This is the
 * same file the game's own SDK reads, so what comes back is what players get.
 */
async function readLive(sdkKey: string): Promise<Record<string, unknown>> {
  const url = `https://cdn-global.configcat.com/configuration-files/${sdkKey}/config_v6.json`;
  const body = JSON.parse((await download(url)).toString('utf8')) as {
    f: Record<string, { v: { s: string } }>;
  };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body.f ?? {})) {
    try {
      out[key] = JSON.parse(body.f[key].v.s);
    } catch {
      // A setting that is not JSON is not one of ours; leave it out rather than
      // failing the whole run over it.
    }
  }
  return out;
}

async function readSheet(id: string): Promise<RawWorkbook> {
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  const bytes = await download(url);
  if (bytes.slice(0, 2).toString() !== 'PK') {
    throw new Error(
      'the export did not come back as a workbook. The sheet is probably not shared ' +
        '"anyone with the link, viewer".',
    );
  }
  return readWorkbookBytes(bytes, `${id}.xlsx`);
}

/* ---------------------------------------------------------------- diffing -- */

/**
 * The identity of a list entry, where it has one. Products, arenas, heroes and
 * cost rows are all keyed, so they are matched by key rather than by position -
 * otherwise one product missing from the middle reports every row after it as
 * changed, which buries the real finding.
 */
function idOf(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['ID', 'ArenaID', 'RewardID', 'Rarity', 'Level']) {
    const found = record[key];
    if (typeof found === 'string' || typeof found === 'number') return `${key}=${found}`;
  }
  return null;
}

function diff(live: unknown, sheet: unknown, path = ''): string[] {
  if (JSON.stringify(live) === JSON.stringify(sheet)) return [];

  const bothObjects = [live, sheet].every((value) => value !== null && typeof value === 'object');
  if (!bothObjects) {
    return [`${path || '(root)'}: live ${JSON.stringify(live)}, sheet ${JSON.stringify(sheet)}`];
  }

  if (Array.isArray(live) && Array.isArray(sheet)) {
    const out: string[] = [];
    const keyed = [...live, ...sheet].every((entry) => idOf(entry) !== null);
    if (keyed) {
      const a = new Map(live.map((entry) => [idOf(entry) as string, entry]));
      const b = new Map(sheet.map((entry) => [idOf(entry) as string, entry]));
      a.forEach((_, key) => {
        if (!b.has(key)) out.push(`${path}: ${key} is live, and the sheet would remove it`);
      });
      b.forEach((_, key) => {
        if (!a.has(key)) out.push(`${path}: ${key} is in the sheet, and would be added`);
      });
      a.forEach((entry, key) => {
        if (b.has(key)) out.push(...diff(entry, b.get(key), `${path}{${key}}`));
      });
      return out;
    }
    if (live.length !== sheet.length) out.push(`${path}: live has ${live.length}, the sheet has ${sheet.length}`);
    for (let i = 0; i < Math.min(live.length, sheet.length); i += 1) {
      out.push(...diff(live[i], sheet[i], `${path}[${i}]`));
    }
    return out;
  }

  const a = live as Record<string, unknown>;
  const b = sheet as Record<string, unknown>;
  const keys: string[] = [];
  for (const key of Object.keys(a).concat(Object.keys(b))) {
    if (keys.indexOf(key) === -1) keys.push(key);
  }
  const out: string[] = [];
  for (const key of keys) out.push(...diff(a[key], b[key], path ? `${path}.${key}` : key));
  return out;
}

/* ----------------------------------------------------------------- audit -- */

interface Outcome {
  domain: DomainId;
  errors: Issue[];
  differences: string[];
  note?: string;
}

/**
 * The trophy road has no `ExporterDefinition` - its page wires detection,
 * lookups and `transform` together by hand - so the audit does the same rather
 * than leaving the one config with no automated path unchecked.
 */
function runTrophyRoad(workbook: RawWorkbook): { config: unknown; issues: Issue[] } {
  // The same tab scoring the page uses. Picking by hand here would quietly
  // audit a different tab from the one anyone actually publishes - this
  // workbook keeps several progression drafts side by side.
  const selection = autoSelectSheets(workbook);
  const named = (name: string | null) =>
    name === null ? undefined : workbook.sheets.find((sheet) => sheet.name === name);
  const progression = named(selection.progression);
  const arenas = named(selection.arenas);
  const rewards = named(selection.rewards);
  if (!progression || !arenas || !rewards) {
    const missing = [
      progression ? null : 'progression',
      arenas ? null : 'Arenas',
      rewards ? null : 'Rewards',
    ].filter(Boolean);
    return {
      config: null,
      issues: [{ severity: 'error', code: 'missing-tab', message: `No ${missing.join(' or ')} tab.` }],
    };
  }
  const detection = detectColumns(progression);
  const result = transform({
    progression,
    headerRowIndex: detection.headerRowIndex,
    mapping: detection.mapping,
    arenas: buildLookup(arenas, 'arena').table,
    rewards: buildLookup(rewards, 'reward').table,
  });
  return { config: result.config, issues: result.issues };
}

const EXPORTERS: Partial<Record<DomainId, unknown>> = {
  arenas: ARENAS_EXPORTER,
  bots: BOTS_EXPORTER,
  heroUpgrade: HERO_UPGRADE_EXPORTER,
  heroes: HEROES_EXPORTER,
  matchTrophy: MATCH_TROPHY_EXPORTER,
  shop: SHOP_EXPORTER,
  battlePass: BATTLE_PASS_EXPORTER,
};

/**
 * The battle pass season header is entered in the console, not read from the
 * sheet, so the audit hands the exporter the live header. That leaves the
 * ladder - the only part the sheet owns - as the thing being compared.
 */
function seasonFromLive(live: Record<string, unknown>): unknown {
  const pass = (live.battlePassSettings ?? {}) as Record<string, unknown>;
  return {
    seasonId: pass.SeasonID ?? '',
    seasonName: pass.SeasonName ?? '',
    startUtc: pass.StartUtc ?? '',
    durationDays: pass.DurationDays ?? 0,
    tokensPerTier: pass.TokensPerTier ?? 0,
    premiumProductId: pass.PremiumProductID ?? '',
    skipTierCost: pass.SkipTierCost ?? 0,
    skipCurrencyId: pass.SkipCurrencyID ?? '',
    finalRewardArt: pass.FinalRewardArt ?? '',
  };
}

async function audit(domain: DomainId, id: string, live: Record<string, unknown>): Promise<Outcome> {
  const key = SETTING_KEYS[domain];
  const liveValue = live[key];
  const workbook = await readSheet(id);

  let config: unknown;
  let issues: Issue[];

  if (domain === 'trophyRoad') {
    const result = runTrophyRoad(workbook);
    config = result.config;
    issues = result.issues;
  } else {
    const exporter = EXPORTERS[domain] as {
      autoSelect: (workbook: RawWorkbook) => unknown;
    };
    const selection = exporter.autoSelect(workbook);
    const settings = domain === 'battlePass' ? seasonFromLive(live) : undefined;
    const analysis = runAnalysis(exporter as never, workbook, selection as never, settings as never);
    config = analysis.result ? analysis.result.config : null;
    issues = analysis.issues ?? [];
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  if (liveValue === undefined) {
    return { domain, errors, differences: [], note: `${key} is not on the dashboard, so there is nothing to compare` };
  }
  if (config === null) {
    return { domain, errors, differences: [], note: 'the sheet produced no config, so nothing was compared' };
  }
  return { domain, errors, differences: diff(liveValue, config) };
}

/* ------------------------------------------------------------------ main -- */

async function main(): Promise<number> {
  const sdkKey = process.env.CONFIGCAT_SDK_KEY;
  if (!sdkKey) {
    console.error('CONFIGCAT_SDK_KEY is not set.');
    console.error('It is the client SDK key for the environment the game reads, and it is not a secret -');
    console.error('the game ships with it. In the game repo it is the SdkKey constant in');
    console.error('Assets/SDK/Runtime/Config/ConfigProvider.cs, and the ConfigCat dashboard shows it too.');
    return 2;
  }
  if (!existsSync(SHEETS_FILE)) {
    console.error(`No ${SHEETS_FILE}. It maps each config to the spreadsheet that backs it.`);
    return 2;
  }

  const sheets = JSON.parse(readFileSync(SHEETS_FILE, 'utf8')) as Record<string, string>;
  const live = await readLive(sdkKey);
  console.log(`ConfigCat is serving ${Object.keys(live).length} settings.\n`);

  const outcomes: Outcome[] = [];
  for (const domain of Object.keys(sheets) as DomainId[]) {
    const id = sheets[domain];
    if (!id) continue;
    try {
      outcomes.push(await audit(domain, id, live));
    } catch (error) {
      outcomes.push({
        domain,
        errors: [{ severity: 'error', code: 'audit-failed', message: (error as Error).message }],
        differences: [],
      });
    }
  }

  let blocked = 0;
  let drifted = 0;
  for (const outcome of outcomes) {
    const label = DOMAIN_LABELS[outcome.domain];
    if (outcome.errors.length > 0) {
      blocked += 1;
      console.log(`${label}: CANNOT PUBLISH - ${outcome.errors.length} error(s)`);
      for (const issue of outcome.errors.slice(0, 5)) console.log(`   ${issue.message}`);
      if (outcome.errors.length > 5) console.log(`   ... and ${outcome.errors.length - 5} more`);
    } else if (outcome.note) {
      console.log(`${label}: ${outcome.note}`);
    } else if (outcome.differences.length === 0) {
      console.log(`${label}: matches live`);
    } else {
      drifted += 1;
      console.log(`${label}: ${outcome.differences.length} change(s) waiting in the sheet`);
      for (const line of outcome.differences.slice(0, 10)) console.log(`   ${line}`);
      if (outcome.differences.length > 10) console.log(`   ... and ${outcome.differences.length - 10} more`);
    }
    console.log('');
  }

  console.log(`${outcomes.length} checked, ${blocked} cannot publish, ${drifted} ahead of live.`);
  if (blocked > 0) return 1;
  return STRICT && drifted > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
