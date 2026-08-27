# Arena Progress JSON Exporter

Convert Cliff Heroes progression sheets into game-ready JSON.

A browser tool that reads an arena progression spreadsheet, joins arena and reward
names against the workbook's own lookup tabs, and exports `arena-progress.json`.

## Requirements

**Node 18 or newer.** The Node currently on this machine's `PATH` is 14.17.5, which
Vite and Vitest cannot run on. Install a current Node (e.g. from
[nodejs.org](https://nodejs.org) or via `nvm-windows`) before using the scripts below.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

For a production build served by the bundled zero-dependency server:

```bash
npm run build && npm start
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server, including the Google Sheets proxy |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm start` | Serve `dist/` plus the Google Sheets proxy on port 4173 |
| `npm test` | Run the transformation test suite |
| `npm run typecheck` | TypeScript only |

## Using it

1. Upload an `.xlsx` workbook, or paste a Google Sheets link.
2. Confirm the three tabs: **Progression**, **Arenas lookup**, **Rewards lookup**.
   Sensible defaults are picked automatically.
3. Confirm the detected columns, adjusting them in the mapping panel if needed.
4. Check the data summary and the parsed milestone table.
5. Press **Generate JSON**, then copy or download `arena-progress.json`.

Export is blocked while any validation error is outstanding, so a failed name join
can never produce partial JSON.

### Google Sheets

The sheet must be shared with **Anyone with the link** (Viewer is enough). No OAuth
and no Google Cloud project are required. Requests are routed through the app's own
`/api/gsheet` endpoint, because Google's export URLs send no CORS headers; that
endpoint only ever forwards to `docs.google.com`.

## Deploying to Vercel

The repo is Vercel-ready: `vercel.json` pins the Vite preset, and `api/gsheet.js`
is a serverless function that replaces the local `server/index.mjs` proxy in
production. Both share the same handler in `server/gsheetHandler.mjs`, so there is
one implementation to maintain.

The **GitHub route needs no local Node at all** - Vercel installs and builds in the
cloud, so Node 14 on your machine is not a blocker:

1. Push this repo to GitHub.
2. In Vercel, **Add New... > Project**, then import the repo.
3. Leave every build setting on its detected default (Framework `Vite`, Build
   `npm run build`, Output `dist`) and press **Deploy**.

No environment variables are needed - the app has no secrets and no Google
credentials.

If the build complains about the Node version, set **Project Settings > General >
Node.js Version** to 22.x.

### Sharing it with teammates

The production URL is public to anyone who has it. To restrict it, use
**Project Settings > Deployment Protection** (Vercel Authentication limits access to
your Vercel team; password protection is the alternative). Check what your plan
includes before relying on it.

## Output schema

```json
{
  "Milestones": [
    { "Trophies": 0, "ArenaID": "arena.lostoasis" },
    { "Trophies": 10, "RewardID": "reward.currency.coins", "Amount": 50 },
    {
      "Trophies": 250,
      "ArenaID": "arena.mysticforest",
      "Unlocks": [
        { "RewardID": "reward.arena.mysticforest" },
        { "RewardID": "reward.hero.glint" }
      ]
    }
  ]
}
```

Property order is exactly as shown, numbers are never quoted, and nothing else is
ever added to a milestone.

## How the spreadsheet is interpreted

Nothing about the current content is hardcoded - no arena names, hero names, reward
names, or trophy values. The rules are structural:

- **Header row** is found by scanning the first rows for recognisable column labels,
  so a title row above the table is fine.
- **Trophy column** matches `Trophies` / `Trophy` / `Trophy Count` /
  `Trophy Requirement` / `Required Trophies`, and deliberately rejects range bounds
  like `min trophies` and `max trophies`.
- **Arena column** matches `Arena` / `Arena Name`. Blank arena cells are
  forward-filled from the row above, for sheets that name the arena only once per
  block.
- **Reward slots** are reward-name columns each paired with the amount column that
  follows them, so `Reward | Reward Amount | Reward | Reward Amount | ...` works for
  any number of slots.
- **Arena milestones** are the first row that introduces each arena. On such a row,
  reward slots carrying no amount become `Unlocks` entries - any number of them. An
  arena row with no rewards emits just `Trophies` and `ArenaID`.
- **Everything else** becomes a `Trophies` / `RewardID` / `Amount` milestone, in
  sheet order.

If automatic detection is unsure, the column mapping panel lets you assign every
field by hand.

### Name matching

Names are matched after trimming whitespace and lowercasing, but the **exact ID
stored in the lookup tab is always what gets emitted** - IDs are never constructed
from names. Duplicate lookup names with conflicting IDs are reported as an error
rather than guessed at.

## Validation

Errors block export; warnings are shown separately and do not.

Errors: unmatched reward name, unmatched arena name, unmatched arena unlock reward,
ambiguous duplicate lookup names, missing trophy value, non-numeric trophy value,
missing reward amount, non-numeric amount, missing lookup tab, empty progression
table, no valid milestones, and a final independent check of the generated object
against the output schema.

## Layout

```
src/lib/workbook.ts       xlsx bytes  -> plain grid model
src/lib/columnDetect.ts   grid        -> column mapping
src/lib/sheetSelect.ts    workbook    -> default tab choices
src/lib/lookups.ts        lookup tab  -> name -> id resolver
src/lib/transform.ts      rows        -> milestones + issues + preview
src/lib/validate.ts       milestones  -> schema check + serializer
src/lib/googleSheets.ts   sheet URL   -> workbook
src/components/           UI
server/                   Google Sheets proxy (dev plugin + prod server)
tests/                    transformation tests, including the real workbook
```

The parsing logic is entirely independent of React, so it is directly testable;
`tests/workbook.test.ts` runs the real `fixtures/arena-progression.xlsx` through the
whole pipeline and asserts the exact output.
