# Cliff Heroes Back Office

The live-ops console for Cliff Heroes: what the game is serving, what is about to
change, and the two ways to change it - now, or on a schedule.

It used to be a JSON exporter with a publish button bolted on, and it still parses
the same design sheets. But nobody working on a live game wants a file. They want to
know what a spreadsheet edit does to the running game and then to make it happen, so
that is what the console is built around now:

**Load the sheet, look at the diff, publish it.** The JSON is produced and
schema-checked silently, the diff against the live config computes itself the moment
the sheet parses, and there is no Generate step in between.

## What is in it

**Overview** (`#/dashboard`, the front door) - every config with its live size, how
far the two environments have drifted apart, what is scheduled, and whether the three
things this all depends on are actually working: ConfigCat, the GitHub token, and the
scheduler's heartbeat.

**Scheduling** (`#/schedule`) - windows the back office opens and closes on its own,
the fallback each config returns to, and proof the heartbeat is arriving. See
[Scheduling](#scheduling).

**Live config** (`#/live`) - every setting as deployed, byte for byte. Read-only.

**One page per config**, each with its own workbook, because every config lives in its
own Google Sheet (one folder per config under the `Economy` Drive folder):

| Page | Route | Setting | What it controls |
| --- | --- | --- | --- |
| Trophy road | `#/arena` | `trophyRoadSettings` | Trophy milestones, arena unlocks, rewards |
| Hero stats | `#/heroes` | `heroesSettings` | Base stats, level curves, power |
| Arenas | `#/arenas` | `arenasSettings` | Track count and bot line-up per arena |
| Match trophies | `#/matchTrophy` | `matchTrophySettings` | Trophy delta per finishing place |
| Bots | `#/bots` | `botsSettings` | Tuning per bot difficulty level |
| Hero upgrades | `#/heroUpgrade` | `heroUpgradeSettings` | Upgrade cost curve, per-rarity bases |
| Shop | `#/shop` | `shopSettings` | Products, prices, what they grant |
| Battle pass | `#/battlePass` | `battlePassSettings` | Season header and the reward ladder |

A page remembers the last Google Sheet link it loaded and offers to reload it with one
click. **Power parameters** (`#/reference`) lists every accepted special parameter
name, and a failing hero export links straight to it.

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

Pick a config in the sidebar. There are two steps.

1. **Load the sheet.** Drop an `.xlsx` file, or paste a Google Sheets link.
   Tab selection happens automatically and is folded away as a one-line summary;
   the fold opens itself only when a tab could not be matched. The trophy road also
   maps columns, folded the same way, and it opens itself when detection was unsure.
2. **Review and ship.** Parse counts, then the errors and warnings, then the diff
   against the live config - added, removed, changed and reordered, line by line -
   and the cross-config check with this payload substituted in. Underneath, two
   buttons: **Publish to Test** and **Schedule it**.

Nothing has to be pressed to get there. The JSON is generated and schema-checked as
part of parsing, and the diff is fetched as soon as the config is valid. If you want
the file anyway it is still there, under *The JSON itself*, with copy and download.

Publishing is refused, with the reason stated, while any of these is true:

- the sheet has validation errors, or parsed to nothing
- the generated config fails its schema check
- the change would introduce a cross-config error (a trophy road naming an arena that
  the arenas config does not define, say)
- somebody has unpublished work staged in the ConfigCat dashboard
- the live value moved after the diff was computed - you get a conflict, not a
  silent overwrite

Publishing to the environment the shipped game reads needs one extra confirmation on
top, keyed off which environment that actually is rather than off its name. See
[Which environment is live](#which-environment-is-live).

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

If the build complains about the Node version, set **Project Settings > General >
Node.js Version** to 22.x.

### Why most commits do not deploy

`vercel.json` sets an `ignoreCommand` that skips the build when a commit touches
nothing outside `schedules/`.

This is not an optimisation. The heartbeat writes `lastTickAt` to
`schedules/schedules.json` on every tick, quiet ones included, because "the
scheduler has not run since Tuesday" is the failure the whole feature exists to
make visible - see [The heartbeat](#the-heartbeat). At a tick every five minutes
that is close to three hundred commits a day, and without this every one of them
would queue a production build. Vercel's free plan allows a hundred a day, so the
budget was gone by mid-afternoon and real deploys were refused for the rest of it.

The command builds whenever it cannot tell - an unresolvable parent commit means
a shallow clone, not a heartbeat - so the failure mode is a redundant build
rather than a missed one. A commit that changes any real file still deploys. To
force a deploy from a schedules-only commit, use **Redeploy** in the Vercel
dashboard.

### Environment variables

Set these under **Project Settings > Environment Variables**, then **redeploy** -
changing a variable does not affect the deployment already running, which is the
single most common reason a fix appears not to have worked.

| Variable | Needed for | If it is missing |
| --- | --- | --- |
| `CONFIGCAT_API_USER` | reading and publishing | the console can read nothing |
| `CONFIGCAT_API_PASS` | reading and publishing | the console can read nothing |
| `GITHUB_TOKEN` | git history, and all scheduling | publishes still work but are not recorded; scheduling is unavailable |
| `CRON_SECRET` | guarding the heartbeat | the heartbeat endpoint is open (harmless, see [Scheduling](#scheduling)) |
| `GITHUB_REPO` | optional | defaults to `OffStarsStudios/cliff-heroes-arena-exporter` |
| `GITHUB_BRANCH` | optional | defaults to `main` |
| `CONFIGCAT_CONFIG_ID` | optional | defaults to the `CliffHeroes` config |
| `CONFIGCAT_PRODUCT_ID` | optional | defaults to the `Cliff Heroes` product |

None of them may be `VITE_`-prefixed. Vite copies every `VITE_` variable into the
public browser bundle, which for these would publish write access to the live game
config to anyone who opens the page.

The **Overview** page shows the state of all three dependencies, so a variable that
was set but never redeployed is visible rather than discovered during a publish.

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

#### The publish note

Every write carries a note describing the change, built from the same diff the
plan showed:

```
Published arenasSettings from the arenas exporter. 2 changes (2 changed):
~ Arenas[ID=arena.lostoasis].TrackCount: 25 -> 15;
~ Arenas[ID=arena.mysticforest].TrackCount: 25 -> 20
```

It goes to two places, so the two records of one publish never have to be
reconciled by hand:

- **ConfigCat's audit log**, as the `reason` on the value update. It shows in
  the product's changelog next to the change itself, which is where someone
  looks when they find an unexpected value. Because it is always sent, the
  product preference *Config changes require a reason* can be turned on without
  breaking this console.
- **The git commit body** for `config/<domain>.json`.

The note is capped at 900 characters. A publish that rewrites more of a config
than that lists as many changes as fit and ends with "and N more"; the count at
the front is always of the whole diff.

ConfigCat stores the minified form and git stores the pretty-printed one. They
are the same config - the diff is structural - but the wire payload every client
downloads should be small and a git history is only useful if its diffs are
readable.

#### Recording the publish in git

Committing `config/<domain>.json` needs `GITHUB_TOKEN`. Without it the publish
still happens, ConfigCat still gets the note, and the result says the history
was not written - publishing is never failed over bookkeeping.

To set it up:

1. GitHub, **Settings > Developer settings > Personal access tokens >
   Fine-grained tokens > Generate new token**.
2. Resource owner `OffStarsStudios`, **Only select repositories >
   cliff-heroes-arena-exporter**, and under Repository permissions set
   **Contents: Read and write**. Nothing else is needed.
3. Add it as `GITHUB_TOKEN` in Vercel under **Project Settings > Environment
   Variables** (Production, and Preview if you publish from previews), then
   redeploy so the functions pick it up. For local work put it in `.env.local`.
4. Optional: `GITHUB_REPO` and `GITHUB_BRANCH` override the defaults
   `OffStarsStudios/cliff-heroes-arena-exporter` and `main`.

#### When GitHub answers 403

`GET /api/git/status` reports exactly what the token can do, and the **Overview**
page renders it. A refusal is never reported as a bare status code: the four causes
of a 403 on this endpoint are indistinguishable from the number alone, so the console
lists them.

- **The token's resource owner is not the organisation.** A fine-grained token
  created under a personal account cannot reach an organisation repository however
  its permissions are set. It has to be created with `OffStarsStudios` selected as
  the resource owner.
- **The organisation has not approved it.** A fine-grained token against an
  organisation repository starts as a request; an owner approves it under the
  organisation's **Settings > Personal access tokens > Pending requests**. Until
  then every call is refused.
- **Contents is not set to Read and write**, or the repository is not in the token's
  repository selection.
- **The organisation has fine-grained tokens disabled** under **Settings > Personal
  access tokens > Settings**.

Two more things that look like a 403 and are not:

- **404 on a private repository.** GitHub answers 404 rather than 403 when a token
  cannot see a repository at all, so a 404 here can still be a permissions problem.
  The message says so.
- **A stale deployment.** Setting `GITHUB_TOKEN` in Vercel does nothing until the
  next deploy. Redeploy after changing it.

One historical cause has been fixed rather than documented: the Contents API path was
being encoded with `encodeURIComponent`, which turns the `/` in `config/heroes.json`
into `%2F`. GitHub then looks for one oddly named file at the repository root, so
every read 404s and every write would have created junk. Paths are now encoded
segment by segment (`server/git.mjs`, covered by `tests/git.test.ts`).

Writes are not atomic across settings. ConfigCat’s Change Requests API exposes
reading and updating but not creating, so a genuine multi-setting transaction is
not available yet.

### Check against live config

Every config page runs the cross-config rules *before* publishing, automatically,
as soon as the sheet parses. The page fetches every setting of the target
environment, substitutes the parsed payload for its own setting, and runs the same
graph checks the Live config page runs. The report is split against the live baseline:

- **Introduced** issues are ones this change causes. Introduced *errors* block
  publishing; introduced warnings do not.
- **Already present** issues exist with or without the change (the undeclared
  difficulty mapping, for instance) and are folded away so they are not blamed on it.
- **Fixed** issues are live problems the change makes go away.

If the live config cannot be read (no credentials, no network) the check says so
rather than pretending to pass. Download and copy are never gated by the graph.

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

## Scheduling

Book a config to go live at a time, and to come down at another. The back office does
both without anybody being awake for either.

A window is created from a config page, not from the scheduling page: load the sheet,
read the diff, then press **Schedule it** instead of **Publish**. There is deliberately
no create form on `#/schedule`, because a window booked without looking at what it
publishes is the exact mistake this console exists to prevent.

### The guardrails, and why each one is there

**A window that ends needs somewhere to go back to.** Each config has a *default* -
the payload it returns to when a window closes and nothing else is due. Scheduling a
window with an end time is refused until one is recorded. The dialog offers the fix
inline: the value that is live right now is almost always the right default, and one
press records it. Open-ended windows need no default, because nothing has to be
restored.

**Windows for one config and environment may not overlap.** Two schedules fighting
over one setting is not something anyone means to configure, so it is refused at
creation with the clashing window named.

**A start time in the past is refused**, with about fifteen minutes of grace for a
slow form submit. A window longer than 180 days is refused too - that is nearly
always a mistyped year.

**Nothing is reverted that does not still look like what the schedule put there.**
When a window ends, the live value is compared against what that window published. If
somebody has published over it by hand, the revert is skipped and recorded. A
deliberate fix is never undone by a promotion expiring.

**A missed window is closed, not applied late.** Activation is written as "what should
be live right now", never as "what changed since the last run", so a heartbeat that is
late, early or skipped entirely still produces the right answer. A window whose whole
span went by unnoticed is marked *missed* rather than dropping a finished promotion
onto players.

**Failures retry before they give up.** A ConfigCat blip or a colleague's open change
request delays a window by one tick rather than cancelling it; after six failed
attempts it is marked failed and shown on the Overview.

**Every scheduled write is a real publish**: read back and verified, noted in
ConfigCat's audit log with the window's name, committed to `config/`, and refused
while there is unpublished work staged in the ConfigCat dashboard. The one difference
from a person pressing the button is that there is no baseline hash - the window was
planned days ago and the live value is expected to have moved since.

### Where the schedule lives

In this repository, through the Contents API: `schedules/schedules.json` for the
windows and `config/defaults/<domain>.json` for the fallbacks. There is no database,
and adding one for eight configs and a handful of windows a week would be the wrong
trade - the repo already gives durability, an audit trail, and a diff for every change
to the schedule itself. It is one file on purpose: one file is one sha, so two people
editing the schedule at once conflict loudly instead of interleaving.

This is why **scheduling needs `GITHUB_TOKEN`** and reports itself unavailable
without one, where publishing merely notes that the history was not written.

### The heartbeat

Nothing happens without something calling `POST /api/schedule/tick`.

**The primary heartbeat is an external pinger**, every five minutes:

| Field | Value |
| --- | --- |
| URL | `https://<deployment>/api/schedule/tick` |
| Method | `POST` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Interval | 5 minutes |

[cron-job.org](https://cron-job.org) is free, allows custom headers, and is punctual;
UptimeRobot or Better Stack work the same way. Whichever you use, turn on its failure
notifications - a heartbeat nobody is watching is the failure this whole section
exists to prevent.

Two things about setting one of these up have already gone wrong here and are worth
stating:

- **A test run is not proof.** cron-job.org's Test run sends the form you are looking
  at; scheduled executions send the last *saved* version of the job. Editing the
  header, testing it green, and not pressing Save produces a job that has never worked
  and a test that says it does. Verify from the execution history after a real run,
  not from the test.
- **A wrong token is permanent, not temporary.** Pingers disable a job after a run of
  failures - cron-job.org does it after about 25 - so the heartbeat does not resume
  when the token is fixed. Re-enable the job as well.

A refused tick says which way the token was wrong: no header at all, a scheme that is
not `Bearer`, or a value of the wrong length. It never echoes the token.

Two backstops run alongside it and neither is good enough to be the primary:

- **`.github/workflows/schedule-tick.yml`**, every fifteen minutes. GitHub runs
  `schedule` events on a best-effort basis and deprioritises frequent ones, so a
  `*/5` here arrives ten to thirty minutes late as a matter of course and sometimes
  not at all. That was tried first and did not work. It stays at fifteen minutes to
  catch up whatever the pinger missed while it was down, and because it costs nothing
  on a public repository. It needs two Actions secrets: `BACK_OFFICE_URL` (the
  deployment origin, no trailing slash) and `CRON_SECRET`. A non-2xx fails the run,
  so GitHub's notifications flag a broken endpoint.
- **`vercel.json`'s cron**, once a day. Vercel's Hobby plan allows no more than that.

Because the tick is idempotent, running all three costs nothing but a few API calls,
and the schedule is correct whichever of them happens to arrive.

The tick is idempotent - it publishes only what should be live at that instant - so an
extra run costs one API call and changes nothing.

`CRON_SECRET` guards the endpoint when set and leaves it open when not. Open is
defensible *here and only here*: a tick can apply a window only once its start time
has passed, so calling it early does nothing and calling it repeatedly does nothing
twice. It cannot publish anything that was not already going to be published. Set it
anyway; the Overview says when it is missing.

Whatever calls it, **timing is only as good as the caller**. Even a punctual pinger
leaves up to five minutes of slop, so a promotion that must be up at 18:00 sharp
should be booked for 17:50. The scheduler is not a real-time system and does not
pretend to be one.

The Overview and the scheduling page both show when the last beat arrived, and say so
loudly past an hour. A scheduler nobody is running is worse than no scheduler, and its
failure mode is silence - nothing happens, and nothing is exactly what an empty
schedule looks like.

### Routes

| Route | Purpose |
| --- | --- |
| `GET /api/schedule` | Every window, the fallbacks, and the heartbeat's health |
| `POST /api/schedule` | Book a window. Refused with the full list of failed guardrails. |
| `POST /api/schedule/cancel` | Stop a window; if it is live, put the config back first |
| `GET|POST /api/schedule/default` | Read or record a config's fallback |
| `GET /api/schedule/preview?id=` | What one window would change if it ran now |
| `GET|POST /api/schedule/tick` | The heartbeat. GET as well, because Vercel Cron issues one. |
| `GET /api/git/status` | Whether the token can read and write the repo, and why not |

`server/schedule.mjs` holds the model and the guardrails; `tests/schedule.test.ts` is
their specification.

All four `/api/schedule/<action>` routes are served by one function,
`api/schedule/[action].js`, because Vercel's Hobby plan allows twelve serverless
functions per deployment and this app has ten. A deployment that exceeds the limit
*builds* successfully and then fails at the deploy step, so the count is worth
keeping an eye on when adding a route.

## Cross-config validation

The eight settings reference each other - the trophy road names arenas and
rewards, rewards name heroes, arena bot counts have to match the number of
scoring places, the battle pass is bought as a shop product - and nothing
checked those edges before. `npm run check:graph`
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

## Output schema: hero upgrades

```json
{
  "CoinsGrowth": 1.42,
  "CardsGrowth": 1.3,
  "CoinsRounding": 10,
  "CardsRounding": 1,
  "ReferenceRarity": "Common",
  "CardsPayoutModifier": 2,
  "Costs": [
    { "Rarity": "Common", "CoinsBase": 250, "CardsBase": 20, "CostModifier": 1, "GrowthModifier": 1 }
  ]
}
```

Key order is fixed as shown. `ReferenceRarity` is emitted with the exact
spelling of the matching `Costs` row.

### The Hero Upgrade Settings sheet

Two tabs. `Growth` is a key/value tab - `Setting | Value` with one row per
scalar (Coins Growth, Cards Growth, Coins Rounding, Cards Rounding, Reference
Rarity, Cards Payout Modifier); the names are matched like power parameters,
so spacing and case do not matter, and a misspelled name gets a suggestion.
Reference Rarity is a dropdown fed by the Costs tab. `Costs` is one row per
rarity: `Rarity | Coins Base | Cards Base | Cost Modifier | Growth Modifier`,
with Rarity a dropdown of the known rarities and the numbers validated.

### Hero upgrades validation

Errors: a setting missing, unknown, duplicated or blank; a non-numeric scalar;
a growth factor that is not positive; a rounding that is not a whole number of
1 or more; a negative payout modifier; a Reference Rarity no Costs row prices;
a missing Costs column; a rarity blank or priced twice; a base that is not a
whole number of 0 or more; a modifier that is not positive; an empty Costs tab;
and the schema gate.

Warnings: a growth factor below 1 (each level would cost less than the last).

## Output schema: shop

```json
{
  "Products": [
    { "ID": "shop.featured.cinder", "SoldIn": "RealMoney", "IsEnabled": true, "BadgeLabel": "SALE",
      "OfferDurationHours": 6, "Contents": [{ "RewardID": "reward.hero.cinder", "Amount": 1 }] },
    { "ID": "shop.coins.tier1", "SoldIn": "Gems", "IsEnabled": true, "PriceInCurrency": 80,
      "Contents": [{ "RewardID": "reward.currency.coins", "Amount": 500 }] }
  ]
}
```

Keys follow the order `ID, SoldIn, IsEnabled, IsListed, PriceInCurrency, BadgeLabel,
OfferDurationHours, CooldownHours, DailyLimit, Contents`, with unused optional keys
omitted rather than written as null. `IsListed` is written only when false.

### The Shop Settings sheet

Two tabs. `Products` has one row per product: `Product ID | Sold In | Enabled |
Listed | Price | Badge Label | Offer Duration Hours | Cooldown Hours | Daily Limit |
Reward 1 | Amount 1 | Reward 2 | Amount 2 ...` - any number of reward/amount pairs.
Sold In is a dropdown (RealMoney, Gems, Free, Ad); Enabled and Listed are
checkboxes; Reward N is a dropdown fed by the `Rewards` tab, which maps reward
names to reward IDs exactly as the trophy road workbook does.

Which optional columns a row uses follows from Sold In: **Gems** products need a
Price and real-money, free and ad products must not have one; **Free** products
need Cooldown Hours; **Ad** products need a Daily Limit; Badge Label and Offer
Duration Hours are optional for any product.

### Shop validation

Errors: missing Product ID / Sold In / Enabled / reward columns, a reward column
with no amount column, a row with values but no ID, a duplicated ID, an unknown
Sold In (with a suggestion), a non-boolean Enabled or Listed, a price / cooldown /
daily limit that is missing where required or present where not, a non-numeric or
out-of-range number, a reward name the Rewards tab does not define, a reward
granted twice by one product, an amount missing or not a whole number of 1 or
more, an amount with no reward beside it, an empty tab, and the schema gate.

Warnings: an ID not matching `shop.<kind>.<name>`, a Sold In spelled with different
case or spacing, and a product that grants nothing.

The Rewards tab also feeds the live-config check, so reward IDs named by the
trophy road and the battle pass are checked against it when this workbook is
loaded.

## Output schema: battle pass

```json
{
  "SeasonID": "pass.season1",
  "SeasonName": "SEASON 1",
  "StartUtc": "2026-09-01 00:00",
  "DurationDays": 30,
  "TokensPerTier": 100,
  "PremiumProductID": "shop.pass.season1.premium",
  "SkipTierCost": 75,
  "SkipCurrencyID": "hardCurrency",
  "FinalRewardArt": "",
  "Tiers": [
    { "Free": { "RewardID": "reward.currency.coins", "Amount": 200 },
      "Premium": { "RewardID": "reward.currency.gems", "Amount": 25 } },
    { "Premium": { "RewardID": "reward.currency.coins", "Amount": 300 } }
  ]
}
```

The season keys are written in that order, then `Tiers`. `Tiers` is positional:
tier 1 is `Tiers[0]`, so the array is the ladder itself. A tier that grants
nothing on a track omits that key rather than writing null, and a tier that
grants nothing at all is `{}`.

### The Battle Pass Settings sheet

Three tabs. `Season` is a key/value tab - `Setting | Value` - with one row per
season setting: Season ID, Season Name, Start (UTC), Duration Days, Tokens Per
Tier, Premium Product ID, Skip Tier Cost, Skip Currency ID, Final Reward Art.
Every row must be present; Final Reward Art is the only one that may be left
empty.

`Tiers` has one row per tier: `Tier | Free Reward | Free Amount | Premium Reward
| Premium Amount`. Either track may be left blank on a tier, and the reward
columns are dropdowns fed by the `Rewards` tab, the same lookup the shop and the
trophy road use. Rows may be in any order - the tier numbers decide the output
order - but they have to run 1 upwards with no gaps, because a gap would shift
every tier above it.

Start (UTC) is read as `YYYY-MM-DD HH:mm`. A cell formatted as a real date works
too: it arrives as an ISO timestamp and is written back in the canonical form.

### Battle pass validation

Errors: a missing or duplicated season setting, a row with a value but no
setting name, an unknown setting name (with a suggestion), an empty value on
anything but Final Reward Art, a Duration Days / Tokens Per Tier that is not a
whole number of 1 or more, a negative Skip Tier Cost, a Start (UTC) that is not
a UTC timestamp, a missing tier or reward column, a row with values but no tier
number, a tier that is not a whole number of 1 or more, a duplicated tier, a gap
in the ladder, a reward name the Rewards tab does not define or defines twice,
an amount missing or not a whole number of 1 or more, an amount with no reward
beside it, an empty tab, and the schema gate.

Warnings: a Season ID not matching `pass.<name>`, a Premium Product ID not
matching `shop.<kind>.<name>`, and a tier that grants nothing on either track.

The live-config check adds the edge to the shop: the premium product has to be a
product `shopSettings` defines, and an existing but disabled one is a warning.

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
src/lib/heroUpgrade.ts    growth + costs tabs -> upgrade config + issues + preview
src/lib/shop.ts           products tab -> shop products + issues + preview
src/lib/validateShop.ts   schema check + serializer
src/lib/validateHeroUpgrade.ts  schema check + serializer
src/lib/validateBots.ts   schema check + serializer
src/lib/validateMatchTrophy.ts  schema check + serializer
src/lib/columns.ts        header-driven column resolution shared by the tabular parsers
src/lib/nameResolve.ts    fuzzy name resolution against a constant list
src/lib/recentSources.ts  remembered Google Sheet link per exporter
src/lib/googleSheets.ts   sheet URL   -> workbook
src/lib/schedule.ts        client side of the scheduling routes + time formatting
src/exporters/            one ExporterDefinition per config + the pure analysis runner
src/hooks/useWorkbookSources.ts  per-page workbook sources
src/hooks/useRelease.ts   parsed config -> diff against live + cross-config check, automatically
src/features/Dashboard.tsx       the overview: what is live, what is booked, what is broken
src/features/Schedule.tsx        windows, fallbacks, heartbeat health
src/features/             the hand-written config pages (trophy road, live config, reference)
src/components/ChangeReview.tsx  the diff, the cross-config check and the two ship buttons
src/components/ScheduleDialog.tsx  booking a window, with the fallback guardrail inline
src/components/           app shell, stepper, ExporterPage, and the shared UI primitives
src/styles.css            design tokens + component styling
src/liveops.css           the live-ops surfaces (overview, schedule, diff, modal)
server/git.mjs            GitHub Contents API: publish history, schedule store, diagnostics
server/schedule.mjs       the scheduling model, its guardrails, and the tick
server/                   Google Sheets proxy, ConfigCat client, publish + schedule routes
.github/workflows/schedule-tick.yml   the scheduler's five-minute heartbeat
tests/                    transformation tests, the scheduler guardrails, the GitHub client
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
publishing. All eight ConfigCat settings now have one; a ninth would be a
definition in `src/exporters`, a parser and a schema gate in `src/lib`, a tab
scorer in `src/lib/sheetSelect.ts`, and entries in `src/domains/types.ts`,
`AppShell` and `App`.
