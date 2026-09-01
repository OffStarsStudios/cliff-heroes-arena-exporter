/**
 * Cross-config check over the payloads in `config/`.
 *
 * Run with `npm run check:graph`. Bundled through esbuild rather than run by a
 * test runner, so it works on the Node 14 currently on this machine's PATH.
 *
 * Exits non-zero when the config graph has errors, which makes it usable as a
 * CI gate as well as a report.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { validateGraph } from '../src/workspace/graph';
import { registryFromConfigs } from '../src/workspace/registry';
import type { ConfigSet, DomainId } from '../src/domains/types';
import { DOMAIN_LABELS, SETTING_KEYS } from '../src/domains/types';

const CONFIG_DIR = join(process.cwd(), 'config');

function readConfig(domain: DomainId): unknown | undefined {
  const path = join(CONFIG_DIR, `${domain}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`  ${path} is not valid JSON: ${(error as Error).message}`);
    process.exit(2);
  }
}

const DOMAINS = Object.keys(SETTING_KEYS) as DomainId[];

if (!existsSync(CONFIG_DIR)) {
  console.error(`No config directory at ${CONFIG_DIR}.`);
  process.exit(2);
}

const set: ConfigSet = {};
const loaded: DomainId[] = [];
for (const domain of DOMAINS) {
  const value = readConfig(domain);
  if (value === undefined) continue;
  (set as Record<string, unknown>)[domain] = value;
  loaded.push(domain);
}

const unexpected = readdirSync(CONFIG_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .filter((name) => !(DOMAINS as string[]).includes(name));

const report = validateGraph(set, registryFromConfigs(set));

console.log(`Checked ${loaded.length} of ${DOMAINS.length} configs in ${CONFIG_DIR}`);
console.log(`  loaded:      ${loaded.map((d) => SETTING_KEYS[d]).join(', ') || 'none'}`);
if (report.missing.length > 0) {
  console.log(`  not present: ${report.missing.map((d) => SETTING_KEYS[d as DomainId]).join(', ')}`);
  console.log('               rules needing these were skipped, not passed.');
}
if (unexpected.length > 0) {
  console.log(`  unrecognised files: ${unexpected.join(', ')}`);
}
console.log('');

if (report.issues.length === 0) {
  console.log('No cross-config issues found.');
} else {
  for (const issue of report.issues) {
    console.log(`${issue.severity === 'error' ? 'ERROR  ' : 'WARNING'}  ${issue.code}`);
    console.log(`         ${issue.message}`);
    console.log('');
  }
  console.log(`${report.errors} error(s), ${report.warnings} warning(s).`);
}

// Reward IDs can only be checked against the workbook's Rewards lookup tab,
// which this script has no access to. Say so rather than implying coverage.
console.log('');
console.log(`Reward IDs were not checked: that needs the workbook's Rewards lookup tab, which the console loads at runtime.`);
console.log(`Domains: ${DOMAINS.map((d) => DOMAIN_LABELS[d]).join(', ')}.`);

process.exit(report.errors > 0 ? 1 : 0);
