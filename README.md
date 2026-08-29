# Cliff Heroes JSON Exporter

Convert Cliff Heroes design sheets into game-ready JSON.

A browser tool with two exporters that share one workbook loader:

- **Arena progress** - reads an arena progression sheet, joins arena and reward names
  against the workbook's own lookup tabs, and exports `arena-progress.json`.
- **Hero stats** - reads base stats, level factors and power settings, rolls the level
  curves out, and exports `heroes.json`.

Each exporter is its own section in the left sidebar, and both read from the same
loaded workbook. Sections are deep-linkable (`#/arena`, `#/heroes`, `#/reference`).

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

Pick a section in the sidebar - **Arena progress** or **Hero stats** - then work down
the numbered steps. Each step shows its own status, and the step you still have to
finish opens on its own.

1. **Load the workbook.** Drop an `.xlsx` file, or paste a Google Sheets link. The
   workbook is shared by both exporters, so this is done once.
2. **Pick the tabs.** Sensible defaults are picked automatically; every field says what
   the tab has to contain.
   - Arena progress: **Progression**, **Arenas lookup**, **Rewards lookup**
   - Hero stats: **Heroes lookup**, **Base stats**, **Stats level factors**, **Power settings**
3. **Map the columns** (arena progress only). Detected columns are pre-filled; anything
   detection was unsure about is called out.
4. **Review and export.** Live counts, then the errors and warnings, then a tab switch
   between the parsed rows and the JSON. Press **Generate JSON** in the bar pinned to
   the bottom of the page, then copy or download.

The bottom bar always says why the export is or is not available, so the reason a
button is disabled never has to be hunted for.

The **Power parameters** section lists every accepted special parameter name, and a
failing hero export links straight to it.

Export is blocked while any validation error is outstanding, so a failed name join or a
mistyped power parameter can never produce partial JSON.

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

## Output schema: arena progress

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

## Output schema: hero stats

```json
{
  "Heroes": [
    {
      "ID": "heroes.cliff",
      "MaxSpeed": 24.8,
      "SpeedIncreasePerSecond": 0.05,
      "Rarity": "Rare",
      "PowerCooldown": 5,
      "Levels": [
        { "Health": 3, "Speed": 10, "Grip": 6.8 },
        { "Health": 3.3, "Speed": 11, "Grip": 7.5 }
      ],
      "Power": {
        "ActivationDelay": 0,
        "Duration": 3,
        "SpeedMultiplier": 1.5,
        "EndsOnObstacleHit": true
      }
    }
  ]
}
```

Hero key order is always `ID, MaxSpeed, SpeedIncreasePerSecond, Rarity, PowerCooldown,
Levels, Power`, and level key order is always `Health, Speed, Grip`. `Power` always
begins with `ActivationDelay` and `Duration`; the remaining parameters differ per hero
and follow the sheet's column order.

### How the hero sheets are interpreted

- **Hero order** follows the **Base stats** tab, so the sheet owns the ordering.
- **IDs** come from the **Heroes** tab and are never constructed from a hero name, the
  same rule the arena lookups follow.
- **Level stats** are `base stat x that level's multiplier`, rounded to one decimal
  place, nearest, with halves rounded up.
- **Levels must run 1..N** with no gaps or duplicates. A gap would silently shift every
  level above it, so it is an error rather than a warning.
- **Power settings** are two fixed columns (`Activation Delay`, `Duration`) followed by
  repeating `Special Param Name` / `Special Param Input` pairs, for any number of slots.
- Columns are found by header text, so adding or reordering columns is safe. A column
  the exporter needs but cannot find is reported by name.

### Power parameter validation

Special parameter names are checked against the schema in `src/lib/powerParams.ts`,
which lists every parameter the game reads along with its value type. This is the one
place that is deliberately a constant rather than read from the sheet - checking the
sheet against itself would validate nothing.

- **Exact name** - accepted silently.
- **Different case, spacing or punctuation** (`speed multiplier`, `SPEED_MULTIPLIER`) -
  accepted, exported under the canonical spelling, and reported as a warning.
- **Misspelling** (`SpeedMultiplyer`) - error, naming the likely intended parameter.
- **Unknown name** (`JumpHeight`) - error, with no suggestion when nothing is close.
- **Wrong value type** - error. `EndsOnObstacleHit` must be `TRUE`/`FALSE`; everything
  else must be numeric.
- **Duplicate parameter**, including one that collides with `Duration` - error.
- **A name with no value, or a value with no name** - error.

Rounding note: many level products land exactly on a `.x5` boundary, and in binary
floating point `9.7 * 1.5` is `14.549999999999999` rather than `14.55`. The
multiplication is therefore done in scaled-integer space, so those cases round on
intent rather than on representation, and match `ROUND(x, 1)` in the sheet.

When the game gains a new power parameter, add it to `POWER_PARAM_TYPES` in
`src/lib/powerParams.ts`. That is the only edit needed.

## How the arena spreadsheet is interpreted

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
src/lib/sheetSelect.ts    workbook    -> default tab choices + dataset detection
src/lib/lookups.ts        lookup tab  -> name -> id resolver (arenas, rewards, heroes)
src/lib/transform.ts      rows        -> milestones + issues + preview
src/lib/validate.ts       milestones  -> schema check + serializer
src/lib/powerParams.ts    power parameter schema + name resolution
src/lib/heroes.ts         hero tabs   -> heroes + issues + preview
src/lib/validateHeroes.ts heroes      -> schema check + serializer
src/lib/googleSheets.ts   sheet URL   -> workbook
src/features/             one page per section (arena, heroes, parameter reference)
src/components/           app shell, stepper, and the shared UI primitives
src/styles.css            design tokens + all component styling
server/                   Google Sheets proxy (dev plugin + prod server)
tests/                    transformation tests, including both real workbooks
```

The parsing logic is entirely independent of React, so it is directly testable.
`tests/workbook.test.ts` runs the real `fixtures/arena-progression.xlsx` and
`tests/heroes.test.ts` runs the real `fixtures/hero-stats.xlsx` through the whole
pipeline, each asserting the exact output.
