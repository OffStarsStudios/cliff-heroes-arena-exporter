/**
 * Regenerates `src/lib/rewards.ts` from the game.
 *
 * Run with `npm run sync:rewards` and a checkout of the game repo:
 *
 * ```bash
 * CLIFF_HEROES_REPO=D:/CliffHeroes npm run sync:rewards
 * ```
 *
 * **Rewards are not authored anywhere.** `RewardSettings.Init` builds them at
 * runtime from the things that can be handed over - one per hero, one per
 * non-default skin, one per arena, one per currency, one per lootbox - and
 * names each by a rule rather than by a field. So there is no list to copy:
 * the list is a consequence of the other settings, and the only honest way to
 * know it is to derive it the same way the client does.
 *
 * That is what this does, reading the game's own assets and remote configs. The
 * result is the one place the console, the sheets and the validation all take
 * their reward vocabulary from.
 *
 * Exits non-zero when the generated list differs from what is checked in, so a
 * build that has gained a skin fails the check rather than passing quietly with
 * a stale list. `--write` updates the file instead.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const WRITE = process.argv.includes('--write');
const TARGET = join(process.cwd(), 'src', 'lib', 'rewards.ts');
const GS_TARGET = join(process.cwd(), 'scripts', 'sheets', 'rewards.generated.gs');

const repo = process.env.CLIFF_HEROES_REPO;

interface Derived {
  id: string;
  name: string;
  family: Family;
  /** What it hands over, for the page to show beside the ID. */
  target: string;
}

type Family = 'currency' | 'hero' | 'skin' | 'arena' | 'lootbox';

/* ----------------------------------------------------------- the naming -- */

/**
 * How a reward is named in a sheet.
 *
 * `<Family> - <Thing>`, except currencies, which are the everyday case and read
 * better as themselves: `Coins`, not `Currency - Coins`. Title case with spaces
 * rather than `Hero_Cinder`, because these are read by people choosing from a
 * dropdown, and a dropdown of `Skin_Cinder_Rainbow` is a dropdown nobody scans.
 *
 * The ID is never derived from the name, in either direction. The name is a
 * label; the ID is what the game answers to.
 */
export function displayName(family: Family, target: string, label: string): string {
  if (family === 'currency') return label;
  const prefix = family[0].toUpperCase() + family.slice(1);
  return `${prefix} - ${label}`;
}

/**
 * A last resort for something with no DisplayName authored on it.
 *
 * Deliberately not the main path: an ID is lowercase and unspaced, so
 * `arena.lostoasis` can only ever come back as "Lostoasis". Everything the
 * client turns into a reward carries a DisplayName the player already sees, and
 * that is what `RewardData` names it by too.
 */
function words(identifier: string, take: number): string {
  return identifier
    .split('.')
    .slice(-take)
    .map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2'))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** The `DisplayName:` of a single-object asset. */
function assetDisplayName(path: string): string | null {
  if (!existsSync(path)) return null;
  const match = /^\s*DisplayName:\s*(.+)$/m.exec(readFileSync(path, 'utf8'));
  return match ? match[1].trim() : null;
}

/** Every `X.asset` under a folder, as ID -> DisplayName. */
function displayNamesIn(folder: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(folder)) return out;
  for (const file of readdirSync(folder)) {
    if (!file.endsWith('.asset')) continue;
    const text = readFileSync(join(folder, file), 'utf8');
    const id = /^\s*ID:\s*(\S+)/m.exec(text);
    const name = /^\s*DisplayName:\s*(.+)$/m.exec(text);
    if (id && name) out.set(id[1], name[1].trim());
  }
  return out;
}

/* ------------------------------------------------------------- the game -- */

/** Every `- ID:` block of a Unity asset, with the fields asked for. */
function assetEntries(path: string, fields: string[]): Record<string, string>[] {
  const text = readFileSync(path, 'utf8');
  const out: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    const start = /^\s+- ID:\s*(\S+)/.exec(line);
    if (start) {
      if (current) out.push(current);
      current = { ID: start[1] };
      continue;
    }
    if (!current) continue;
    for (const field of fields) {
      const match = new RegExp(`^\\s+${field}:\\s*(.*)$`).exec(line);
      if (match) current[field] = match[1].trim();
    }
  }
  if (current) out.push(current);
  return out;
}

function derive(root: string): Derived[] {
  const remote = (name: string) => JSON.parse(readFileSync(join(root, 'RemoteConfigs', name), 'utf8'));
  const rewards: Derived[] = [];

  // Currencies first: they are what most rewards are, and the reward key differs
  // from the currency ID where one was named before the rule was.
  for (const currency of assetEntries(
    join(root, 'Assets/Settings/Resources/Currencies/CurrencySettings.asset'),
    ['DisplayName', '_rewardKey'],
  )) {
    const key = currency._rewardKey && currency._rewardKey !== '' ? currency._rewardKey : currency.ID;
    rewards.push({
      id: `reward.currency.${key}`,
      name: displayName('currency', currency.ID, currency.DisplayName),
      family: 'currency',
      target: currency.ID,
    });
  }

  const heroNames = displayNamesIn(join(root, 'Assets/Settings/Resources/Heroes'));
  for (const hero of remote('heroesSettings.json').Heroes as { ID: string }[]) {
    rewards.push({
      id: `reward.hero.${hero.ID.split('.').pop()}`,
      name: displayName('hero', hero.ID, heroNames.get(hero.ID) ?? words(hero.ID, 1)),
      family: 'hero',
      target: hero.ID,
    });
  }

  for (const skin of assetEntries(
    join(root, 'Assets/Settings/Resources/Skins/SkinSettings.asset'),
    ['DisplayName', 'IsDefault', 'HeroID'],
  )) {
    // A hero's default skin is what they are already wearing, so the client
    // registers no reward for it.
    if (skin.IsDefault === '1') continue;
    // "Halloween" on its own says nothing about whose skin it is, and several
    // heroes share a skin name, so the hero leads and the skin follows.
    const hero = heroNames.get(skin.HeroID) ?? words(skin.HeroID ?? skin.ID, 1);
    const label = skin.DisplayName && skin.DisplayName !== '' ? skin.DisplayName : words(skin.ID, 1);
    rewards.push({
      id: `reward.skin.${skin.ID.split('.').slice(-2).join('.')}`,
      name: displayName('skin', skin.ID, `${hero} ${label}`),
      family: 'skin',
      target: skin.ID,
    });
  }

  const arenaNames = displayNamesIn(join(root, 'Assets/Settings/Resources/Arena'));
  for (const arena of remote('arenasSettings.json').Arenas as { ID: string }[]) {
    rewards.push({
      id: `reward.arena.${arena.ID.split('.').pop()}`,
      name: displayName('arena', arena.ID, arenaNames.get(arena.ID) ?? words(arena.ID, 1)),
      family: 'arena',
      target: arena.ID,
    });
  }

  for (const file of ['CommonLootbox', 'RareLootbox', 'LegendaryLootbox']) {
    const path = join(root, 'Assets/Settings/Resources/Lootbox', `${file}.asset`);
    if (!existsSync(path)) continue;
    const match = /^\s*ID:\s*(\S+)/m.exec(readFileSync(path, 'utf8'));
    if (!match) continue;
    // "Common Box" already says box, so the family prefix would say it twice.
    const label = (assetDisplayName(path) ?? words(match[1], 1)).replace(/\s*Box$/i, '');
    rewards.push({
      id: `reward.lootbox.${match[1].split('.').pop()}`,
      name: displayName('lootbox', match[1], label),
      family: 'lootbox',
      target: match[1],
    });
  }

  return rewards;
}

/* ------------------------------------------------------------ the file -- */

function render(rewards: Derived[]): string {
  const rows = rewards
    .map((reward) => `  { id: '${reward.id}', name: '${reward.name}', family: '${reward.family}' },`)
    .join('\n');

  return `/**
 * Every reward the game can hand over, as the ID it answers to and the name a
 * sheet calls it by.
 *
 * GENERATED by \`npm run sync:rewards\` from the game's own assets. Do not edit
 * by hand: rewards are not authored anywhere in the game either, they are
 * derived at runtime from the heroes, skins, arenas, currencies and lootboxes
 * that exist, so the only list that can be trusted is one derived the same way.
 *
 * This is the vocabulary every config shares. A sheet's Rewards tab is a copy of
 * it, the reward library page renders it, and every exporter checks the IDs it
 * resolves against it - which is what turns "that reward does not exist" from
 * something the client logs at runtime into something the console refuses.
 */

/** What a reward hands over. Only currencies are named without their family. */
export type RewardFamily = 'currency' | 'hero' | 'skin' | 'arena' | 'lootbox';

export interface Reward {
  /** What the game answers to. Never built from the name. */
  id: string;
  /** What a sheet calls it: \`<Family> - <Thing>\`, or just the currency. */
  name: string;
  family: RewardFamily;
}

export const REWARDS: readonly Reward[] = [
${rows}
];

/** Reward ID -> its entry. */
export const REWARDS_BY_ID = new Map(REWARDS.map((reward) => [reward.id, reward]));

/** Sheet name -> its entry, matched the way the lookup tabs match. */
export const REWARDS_BY_NAME = new Map(REWARDS.map((reward) => [reward.name.toLowerCase(), reward]));

/** Whether the game registers a reward under this ID. */
export function isRewardId(id: string): boolean {
  return REWARDS_BY_ID.has(id);
}
`;
}

/**
 * The same list as an Apps Script fragment.
 *
 * Each sheet's bound script needs the vocabulary too, and Apps Script projects
 * cannot import from one another without a published library. Generating the
 * constant here instead means the sheets and the console are copies of one
 * source rather than two lists somebody has to keep agreeing.
 */
function renderGs(rewards: Derived[]): string {
  const rows = rewards.map((reward) => `  ['${reward.name}', '${reward.id}'],`).join('\n');
  return `/**
 * Every reward the build registers, as name -> ID.
 *
 * GENERATED by \`npm run sync:rewards\` in the back office. Paste into a config
 * sheet's bound script; do not edit here. Rewards are derived at runtime in the
 * client from the heroes, skins, arenas, currencies and lootboxes that exist,
 * so this is the only list that can be trusted to be complete.
 */
var REWARDS = [
${rows}
];
`;
}

function main(): number {
  if (!repo) {
    console.error('CLIFF_HEROES_REPO is not set - point it at a checkout of the game.');
    console.error('  CLIFF_HEROES_REPO=D:/CliffHeroes npm run sync:rewards');
    return 2;
  }
  if (!existsSync(join(repo, 'Assets/Settings/Resources/Skins/SkinSettings.asset'))) {
    console.error(`${repo} does not look like the game repo.`);
    return 2;
  }

  const rewards = derive(repo);
  const rendered = render(rewards);
  const current = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : '';

  const byFamily = rewards.reduce<Record<string, number>>((counts, reward) => {
    counts[reward.family] = (counts[reward.family] ?? 0) + 1;
    return counts;
  }, {});
  console.log(
    `${rewards.length} rewards: ` +
      Object.keys(byFamily).map((family) => `${byFamily[family]} ${family}`).join(', '),
  );

  // The Apps Script fragment is written whenever asked, even when the
  // TypeScript has not moved: a sheet can be out of step with a list that is
  // itself perfectly current.
  if (WRITE) {
    writeFileSync(GS_TARGET, renderGs(rewards));
    console.log(`Wrote ${GS_TARGET}.`);
  }

  if (rendered === current.replace(/\r\n/g, '\n')) {
    console.log('src/lib/rewards.ts is already level with the game.');
    return 0;
  }
  if (!WRITE) {
    console.error('src/lib/rewards.ts is out of date. Re-run with --write.');
    return 1;
  }
  writeFileSync(TARGET, rendered);
  console.log(`Wrote ${TARGET}.`);
  return 0;
}

process.exit(main());
