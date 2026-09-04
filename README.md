# Cliff Heroes JSON Exporter

Convert Cliff Heroes design sheets into game-ready JSON.

A browser tool with one exporter per ConfigCat setting:

- **Trophy road** - reads an arena progression sheet, joins arena and reward names
  against the workbook's own lookup tabs, and exports `arena-progress.json`
  (`trophyRoadSettings`).
- **Hero stats** - reads base stats, level factors and power settings, rolls the level
  curves out, and exports `heroes.json` (`heroesSettings`).
- **Arenas** - reads the Arenas Settings workbook and exports `arenas.json`
  (`arenasSettings`): track count and bot line-up per arena.
- **Match trophies** - reads the Match Trophy Settings workbook and exports
  `match-trophy.json` (`matchTrophySettings`): the trophy delta per finishing place.
- **Bots** - reads the Bots Settings workbook and exports `bots.json`
  (`botsSettings`): the tuning of every bot difficulty level.

Each exporter is its own section in the left sidebar and **keeps its own workbook**,
because every config lives in its own Google Sheet (one folder per config under the
`Economy` Drive folder). A page remembers the last Google Sheet link it loaded and
offers to reload it with one click. Sections are deep-linkable (`#/arena` is the
trophy road, `#/heroes`, `#/arenas`, `#/matchTrophy`, `#/bots`, `#/live`, `#/reference`).

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

Pick a section in the sidebar - **Trophy road**, **Hero stats**, **Arenas**,
**Match trophies** or **Bots** - then work down the numbered steps. Each step shows its own status, and the step you still
have to finish opens on its own.

1. **Load the workbook.** Drop an `.xlsx` file, or paste a Google Sheets link. Each
   exporter has its own workbook; a page that has loaded a sheet before offers to
   reload it.
2. **Pick the tabs.** Sensible defaults are picked automatically; every field says what
   the tab has to contain.
   - Trophy road: **Progression**, **Arenas lookup**, **Rewards lookup**
   - Hero stats: **Heroes lookup**, **Base stats**, **Stats level factors**, **Power settings**
   - Arenas: **Arenas lookup**, **Arena settings**
   - Match trophies: **Trophies by place**
   - Bots: **Bots**
3. **Map the columns** (trophy road only). Detected columns are pre-filled; anything
   detection was unsure about is called out.
4. **Review and export.** Live counts, then the errors and warnings, then a tab switch
   between the parsed rows and the JSON. Press **Generate JSON** in the bar pinned to
   the bottom of the page, then copy or download. Generating also runs the
   **Check against live config** (below), and the publish panel only ever sends
   exactly what was generated and checked.

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

## ConfigCat

The console reads the live config straight from ConfigCat, and the exporters
publish to it through the plan/apply routes described under *Publishing*.

### Credentials

The Management API credentials are organization-wide and can modify any product,
so they are server-side only and must never be `VITE_`-prefixed - Vite copies
every `VITE_` variable into the public browser bundle.

| Variable | Where to get it |
| --- | --- |
| `CONFIGCAT_API_USER` | ConfigCat dashboard, account menu, Public API credentials |
| `CONFIGCAT_API_PASS` | the same credential pair; shown once at creation |

Set them in Vercel under Project Settings > Environment Variables. For local
work copy `.env.example` to `.env.local` (already gitignored) - `vite.config.ts`
loads those keys into `process.env` for the dev API handlers.

### Routes

| Route | Purpose |
| --- | --- |
| `GET /api/configcat/tree` | Products, configs, environments and settings |
| `GET /api/configcat/values?configId=&environmentId=` | Live values, with byte sizes and parsed JSON |
| `GET /api/configcat/probe?productId=` | What this account and plan actually allow |
| `GET /api/drift?configId=&from=&to=` | Which settings differ between two environments |

Each is a Vercel serverless function in `api/` over a shared handler in
`server/configcatHandler.mjs`, so the dev server and production behave the same.

### Publishing

| Route | Purpose |
| --- | --- |
| `POST /api/publish/plan` | What would change. Writes nothing, and issues the baseline hash. |
| `POST /api/publish/apply` | Performs the write. Requires that hash. |

Every exporter ends in a **Publish to ConfigCat** panel. Pick the environment,
press *Show what would change* for a structural diff against the live value,
then publish. Publishing to the environment the game reads needs one more
explicit confirmation.

Three things stand between the button and the live game:

- The exporter’s own validation. Errors block publishing exactly as they block
  the download.
- The baseline hash. `apply` refuses if the live value changed after the plan
  was made, so a second publisher gets a conflict rather than overwriting the
  first.
- A read-back. After writing, the value is fetched again and compared. A write
  that cannot be confirmed is reported as unverified rather than as success.

Only the default value is written, as a JSON Patch, so targeting rules and
percentage options on a setting are left alone.

ConfigCat stores the minified form and git stores the pretty-printed one. They
are the same config - the diff is structural - but the wire payload every client
downloads should be small and a git history is only useful if its diffs are
readable.

Recording to git needs `GITHUB_TOKEN` (a fine-grained PAT with Contents:
read/write on this repo). Without it the publish still happens and the result
says the history was not written; publishing is not failed over bookkeeping.

Writes are not atomic across settings. ConfigCat’s Change Requests API exposes
reading and updating but not creating, so a genuine multi-setting transaction is
not available yet.

### Check against live config

Every exporter runs the cross-config rules *before* publishing. When the JSON is
generated, the page fetches every setting of the target environment, substitutes
the generated payload for its own setting, and runs the same graph checks the Live
config page runs. The report is split against the live baseline:

- **Introduced** issues are ones this change causes. Introduced *errors* block
  publishing; introduced warnings do not.
- **Already present** issues exist with or without the change (the undeclared
  difficulty mapping, for instance) and are folded away so they are not blamed on it.
- **Fixed** issues are live problems the change makes go away.

If the live config cannot be read (no credentials, no network) the check says so
and does not block - the publish step needs the same connection and fails on its
own. Download and copy are never gated by the graph.

### The Live config page

`#/live` in the sidebar shows what is deployed right now: every setting with its
byte size, whether its payload parses, the cross-config check results, and a
structural comparison of the two environments. It is read-only.

Graph validation runs in the browser over the fetched payloads, so nothing has
to be sent anywhere to be checked. Reward IDs are the exception - they need the
workbook, so load one on an exporter page to include them.

### Which environment is live

The game currently reads the **Test** environment, not Production. Test is
therefore the environment where a mistake reaches players, and Production is the
safe place to rehearse a change. This is the reverse of the usual arrangement
and is worth stating out loud before touching either.

## Cross-config validation

The eight settings reference each other - the trophy road names arenas and
rewards, rewards name heroes, arena bot counts have to match the number of
scoring places - and nothing checked those edges before. `npm run check:graph`
validates them against the payloads in `config/`.

```bash
npm run check:graph
```

It exits non-zero on errors, so it works as a CI gate as well as a report.
Rules whose inputs are absent are skipped rather than passed, and the output
says which ones those were. `src/workspace/graph.ts` holds the rules and
`src/workspace/registry.ts` builds the shared ID registry from the workbook
lookup tabs.

`config/` holds the current live payload for each setting, formatted exactly as
the exporters emit it, as the git-tracked baseline for future diffs.

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

## Output schema: arenas

```json
{
  "Arenas": [
    { "ID": "arena.lostoasis", "TrackCount": 15, "BotLevels": ["Easy", "Medium", "Medium"] }
  ]
}
```

Key order is always `ID, TrackCount, BotLevels`. `TrackCount` is a whole number of 1
or more; `BotLevels` holds one difficulty name per bot, spelled exactly `Easy`,
`Medium`, `Hard` or `VeryHard` (the list lives in `src/lib/arenaDifficulties.ts`,
the same way power parameters live in `powerParams.ts`).

### The Arenas Settings sheet

The workbook follows the Heroes Configuration convention: a lookup tab that owns
the IDs, and a settings tab that references entities by name through a dropdown.

- **Arenas** tab: `Arena Name | Arena ID`. The ID column is one `ARRAYFORMULA`
  (`arena.` plus the lowercase name without spaces), so a new arena only needs its
  name typed in. The exporter still reads the ID from the cell, never rebuilds it.
- **Arena Settings** tab: `Arena Name | Track Count | Bot 1 Level | Bot 2 Level | Bot 3 Level`.
  Arena Name is a dropdown validated against the Arenas tab; Track Count rejects
  anything but a whole number of 1 or more; the bot columns are dropdowns
  (colour-coded Easy to VeryHard). Add a bot by adding a `Bot 4 Level` column - the
  live-config check will then report the mismatch against the four trophy places.
- Columns are found by header, so `Tracks`, `Bot Level 1` or `Bot 1 Difficulty` also
  work, and the bot columns may sit in any order - they are read in numeric order.

### Arenas validation

Errors (block export and publish): missing Arena Name / Track Count / bot columns,
an arena the lookup tab does not define, a name mapped to two IDs, an arena
configured twice (by name or by resolved ID), a blank, non-numeric, fractional or
zero track count, an arena with no bots, a blank bot column followed by a filled
one, a difficulty the game does not know (with a "did you mean" suggestion), a row
with values but no name, an empty settings tab, and the independent schema gate on
the generated object.

Warnings (exported as-is): an ID not matching `arena.<name>`, a difficulty spelled
with different case or spacing (exported under the canonical spelling), arenas
running different numbers of bots, bot columns numbered with gaps, and lookup
arenas that have no settings row.

Cross-config (from the live-config check): an arena the trophy road introduces
but this config does not define, an arena no milestone introduces, a bot count
that does not match the number of scoring places, more difficulty names than bot
levels, and arena rewards that grant an arena this config does not define.

## Output schema: match trophies

```json
{ "TrophiesByPlace": [60, 35, 0, -15] }
```

One whole number per finishing place, first place first; negative for a loss.
The array length is the racer count, so it has to be one more than the bots
every arena runs - the live-config check reports a mismatch against
`arenasSettings`.

### The Match Trophy Settings sheet

One tab, `Trophies By Place`: `Place | Trophies`, one row per finishing place.
Place rejects anything but a whole number of 1 or more; Trophies rejects
anything but a whole number. Rows may be in any order - the places decide the
output order.

### Match trophies validation

Errors: missing Place / Trophies column, a blank or non-numeric place, a place
below 1 or fractional, a place listed twice, a gap in the place sequence (the
output is indexed by place, so a gap would shift every place below it), a blank,
non-numeric or fractional trophy value, an empty tab, and the schema gate.

Warnings: a first place that awards no trophies, and a place that awards more
than the place above it.

## Output schema: bots

```json
{
  "BotLevel": 4,
  "Bots": [
    { "Level": 0, "MinJumpInterval": 4, "MaxJumpInterval": 6, "MinDodgeChance": 0.1, "MaxDodgeChance": 0.2,
      "RaycastDistance": 8, "RaycastInterval": 0.3, "MinFireInterval": 2, "MaxFireInterval": 4 }
  ]
}
```

Key order is fixed as shown. `BotLevel` is never authored: it is the highest
level in the table. Levels must run 0..N with no gaps or duplicates, the same
rule hero levels follow, because the client indexes into the table.

### The Bots Settings sheet

One tab, `Bots`: `Level | Min Jump Interval | Max Jump Interval | Min Dodge Chance |
Max Dodge Chance | Raycast Distance | Raycast Interval | Min Fire Interval | Max Fire Interval`,
one row per level. Level rejects anything but a whole number of 0 or more; the
dodge chances reject anything outside 0..1; the other columns reject anything
that is not a positive number. Rows may be in any order.

### Bots validation

Errors: a missing column (reported by name), a blank or non-numeric value, a
fractional or negative level, a level listed twice, a gap in the level sequence,
an interval or distance that is not positive, a dodge chance outside 0..1, a
minimum above its maximum, an empty tab, and the schema gate (key order,
`BotLevel` equal to the highest level).

Warnings: a level that dodges less or fires slower than the level below it.

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
src/lib/arenas.ts         arena tabs  -> arenas + issues + preview
src/lib/validateArenas.ts arenas      -> schema check + serializer
src/lib/arenaDifficulties.ts  bot difficulty schema + name resolution
src/lib/matchTrophy.ts    places tab  -> trophies by place + issues + preview
src/lib/bots.ts           bots tab    -> bot levels + issues + preview
src/lib/validateBots.ts   schema check + serializer
src/lib/validateMatchTrophy.ts  schema check + serializer
src/lib/columns.ts        header-driven column resolution shared by the tabular parsers
src/lib/nameResolve.ts    fuzzy name resolution against a constant list
src/lib/recentSources.ts  remembered Google Sheet link per exporter
src/lib/googleSheets.ts   sheet URL   -> workbook
src/exporters/            one ExporterDefinition per config (heroes, arenas, matchTrophy, bots) + the pure analysis runner
src/hooks/                per-page workbook sources
src/features/             the hand-written pages (trophy road, heroes, live config, reference)
src/components/           app shell, stepper, ExporterPage, LiveGraphCheck, and the shared UI primitives
src/styles.css            design tokens + all component styling
server/                   Google Sheets proxy (dev plugin + prod server)
tests/                    transformation tests, including both real workbooks
```

The parsing logic is entirely independent of React, so it is directly testable.
`tests/workbook.test.ts` runs the real `fixtures/arena-progression.xlsx`,
`tests/heroes.test.ts` the real `fixtures/hero-stats.xlsx`, and `tests/arenas.test.ts`
the real `fixtures/arenas-settings.xlsx` (downloaded from the Arenas Settings Google
Sheet) through the whole pipeline, each asserting the exact live payload.

### Adding the next config

Each exporter page is an `ExporterDefinition` (see `src/exporters/arenas.tsx`): the
tabs it needs, how to auto-select them, a pure `analyze` over the chosen sheets, an
independent `validate` gate, a serializer and a preview table. `ExporterPage`
supplies the rest - loading, tab picking, review, the live-config check and
publishing. The remaining settings (hero upgrades, shop, battle pass) are each one
definition plus a parser in `src/lib`.
