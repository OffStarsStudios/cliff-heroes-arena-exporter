/**
 * Regenerates `src/lib/offerArt.generated.ts` - the offer art the game has.
 *
 * Run with `npm run sync:offer-art` and a signed-in GitHub CLI (`gh auth login`):
 *
 * ```bash
 * npm run sync:offer-art -- --write
 * ```
 *
 * **What counts as uploaded.** The client loads an offer's pictures as
 * addressables, `OfferImages/<name>`, and a name that is not an address in the
 * build draws nothing at all. So the library is the game's `Offers` addressable
 * group on its default branch - every entry whose address starts
 * `OfferImages/` - not whatever image files happen to sit in the repo.
 *
 * The group names each entry by GUID, so the source file behind it is found
 * through the `.meta` files beside the offer art, and is used only to say which
 * slot a picture is meant for: a background, a top bar, a button.
 *
 * Read through the GitHub API rather than a local checkout, because the art and
 * the addressables data are exactly what a sparse clone of the game leaves out.
 *
 * Exits non-zero when the generated file differs from what is checked in, so a
 * build that has gained a picture fails the check rather than passing with a
 * stale dropdown. `--write` updates the file instead.
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const WRITE = process.argv.includes('--write');
const TARGET = join(process.cwd(), 'src', 'lib', 'offerArt.generated.ts');
const REPO = process.env.CLIFF_HEROES_GITHUB_REPO ?? 'OffStarsStudios/CliffHeroes';
const REF = process.env.CLIFF_HEROES_REF ?? 'master';
const GROUP = 'Assets/AddressableAssetsData/AssetGroups/Offers.asset';
const PREFIX = 'OfferImages/';

type ArtSlot = 'background' | 'topBar' | 'reward' | 'button';

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function raw(path: string): string {
  return gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/${encodeURI(path)}?ref=${REF}`]);
}

/** `{ guid, address }` for every entry in an addressable group asset. */
function groupEntries(yaml: string): { guid: string; address: string }[] {
  const entries: { guid: string; address: string }[] = [];
  const pattern = /- m_GUID: ([0-9a-f]+)\s+m_Address: (.+)/g;
  for (let match = pattern.exec(yaml); match !== null; match = pattern.exec(yaml)) {
    entries.push({ guid: match[1], address: match[2].trim() });
  }
  return entries;
}

/**
 * Which slot a picture is drawn for, from its name and its file.
 *
 * A guess, and only used to put the likely pictures first in each dropdown -
 * any picture can be picked for any slot, which is also what the client allows.
 */
function slotOf(name: string, file: string | null): ArtSlot | null {
  const stem = file === null ? '' : (file.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
  const says = (pattern: RegExp) => pattern.test(name) || pattern.test(stem);
  if (says(/(background|bg)$|\b(background|bg)\b/i)) return 'background';
  if (says(/(topbar|top|header)$|\b(top|header)\b/i)) return 'topBar';
  if (says(/button$|\bbutton\b/i)) return 'button';
  if (says(/(reward|prize)$|\b(reward|prize)\b/i)) return 'reward';
  return null;
}

function main(): void {
  const entries = groupEntries(raw(GROUP)).filter((entry) => entry.address.startsWith(PREFIX));
  if (entries.length === 0) throw new Error(`${GROUP} on ${REPO}@${REF} lists no ${PREFIX} addresses.`);

  // The .meta files of images in any folder about offers: few, and enough to name every entry.
  const tree = JSON.parse(gh(['api', `repos/${REPO}/git/trees/${REF}?recursive=1`])) as {
    tree: { path: string; type: string }[];
    truncated: boolean;
  };
  if (tree.truncated) console.warn('The GitHub tree came back truncated; some source files may be unnamed.');
  const metas = tree.tree
    .map((node) => node.path)
    .filter((path) => /\.(png|jpe?g|psd|tga)\.meta$/i.test(path) && /offer/i.test(path));

  const fileOf = new Map<string, string>();
  const wanted = new Set(entries.map((entry) => entry.guid));
  for (const meta of metas) {
    const guid = /^guid: ([0-9a-f]+)/m.exec(raw(meta))?.[1];
    if (guid !== undefined && wanted.has(guid)) fileOf.set(guid, meta.replace(/\.meta$/, ''));
  }

  const art = entries
    .map((entry) => {
      const name = entry.address.slice(PREFIX.length);
      const file = fileOf.get(entry.guid) ?? null;
      return { name, address: entry.address, file, slot: slotOf(name, file) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const body = art
    .map(
      (item) =>
        `  { name: ${JSON.stringify(item.name)}, address: ${JSON.stringify(item.address)}, file: ${JSON.stringify(item.file)}, slot: ${JSON.stringify(item.slot)} },`,
    )
    .join('\n');

  const source = `/**
 * Every picture an offer can be drawn with: the entries of the game's \`Offers\`
 * addressable group, by the name a payload gives them.
 *
 * GENERATED by \`npm run sync:offer-art\` from ${REPO}@${REF}. Do not edit by hand.
 * An offer naming a picture that is not here draws nothing in its place.
 */

import type { OfferArt } from './offerArt';

export const OFFER_ART_SOURCE = { repo: ${JSON.stringify(REPO)}, ref: ${JSON.stringify(REF)}, group: ${JSON.stringify(GROUP)} };

export const OFFER_ART: readonly OfferArt[] = [
${body}
];
`;

  let current = '';
  try {
    current = readFileSync(TARGET, 'utf8');
  } catch {
    // Not generated yet.
  }
  if (current === source) {
    console.log(`Offer art is up to date: ${art.length} pictures.`);
    return;
  }
  if (!WRITE) {
    console.error(`Offer art has changed (${art.length} pictures in the game). Run with --write to update ${TARGET}.`);
    process.exit(1);
  }
  writeFileSync(TARGET, source);
  console.log(`Wrote ${art.length} pictures to ${TARGET}.`);
}

main();
