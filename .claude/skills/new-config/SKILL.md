---
name: new-config
description: Add a new game config to the back office, or build/standardise the Google Sheet that authors one. Use whenever a ConfigCat setting needs an exporter, a page, a sheet, or reward aliases - and before designing any sheet that names rewards. Triggers on "add a config", "new exporter", "build a sheet for", "standardise the sheet", "rewards convention", "reward aliases".
---

# Adding a config to the back office

Everything here was learned by getting it wrong first. Read it before designing
a sheet or writing an exporter, not after.

## The one rule: read the client, never the payload

The console's schemas were originally transcribed from the ConfigCat values.
That is how `PriceTier` went missing for months - the payload simply did not
happen to show it mattered - and how `Rarity` shipped as a free string against
an enum the client throws on.

**Start in the game repo.** `Assets/Scripts/Config/<Name>RemoteConfig.cs` is the
class that parses the key, and `Assets/Scripts/Settings/<Name>RemoteSettings.cs`
is the shape. Read `ApplyRemoteSettings` too: it says what the client *drops*,
what it *refuses*, and what it merges rather than replaces. Those three
behaviours decide what the exporter must treat as an error.

See `[[game-repo-read-only]]` in memory for the checkout. It is read-only.

Four questions the client answers and the payload cannot:

- **Is the key required?** `IsRequired` defaults to true, and a required config
  that fails to parse holds the game on its loading screen. For those, a bad
  value is a launch that never finishes, not a mistuned number.
- **Is a list merged or taken whole?** `rollingOfferSettings.Offers` and
  `shopSettings.Products` are taken whole - an entry that stops appearing is
  retired, and for rolling offers the player's progress goes with it.
- **What is silently dropped?** A step that pays nothing, a product with no SKU,
  a difficulty the table does not tune. The console should refuse what the
  client would quietly discard.
- **Which enums are parsed strictly?** Newtonsoft throws on an unknown name.
  `Rarity` and `BotLevel` both do. `SoldIn` does not - it resolves by hand.

## Rewards: the convention, and where it comes from

**Never invent a reward name or ID.** Rewards are not authored anywhere in the
game: `RewardSettings.Init` derives them at runtime from the heroes, skins,
arenas, currencies and lootboxes that exist. So the list is a consequence, and
the only trustworthy copy is one derived the same way.

```bash
CLIFF_HEROES_REPO=D:/CliffHeroes npm run sync:rewards -- --write
```

That writes both consumers from one pass:

| File | Who reads it |
| --- | --- |
| `src/lib/rewards.ts` | the console: the reward library page, and every exporter's validation |
| `scripts/sheets/rewards.generated.gs` | the sheets: paste into a workbook's bound script |

Without `--write` it exits non-zero when the checked-in list has drifted, so it
works as a gate after a build gains a skin.

### How a reward is named

`<Family> - <Thing>`, with the family capitalised, except currencies which are
the everyday case and read better as themselves:

```
Coins                     reward.currency.coins
Upgrade Cards             reward.currency.cards
Hero - Cinder             reward.hero.cinder
Skin - Cliff Halloween    reward.skin.cliff.halloween
Arena - Lost Oasis        reward.arena.lostoasis
Lootbox - Common          reward.lootbox.common
```

The label comes from the **DisplayName the game authors**, never from the ID -
`arena.lostoasis` can only ever be squashed back into "Lostoasis". A skin leads
with its hero, because "Halloween" alone says nothing about whose it is and
several heroes share a skin name.

The old convention was `Hero_Cinder`, and each sheet listed only the rewards it
happened to use. Both are wrong: underscores read badly in a dropdown, and a
partial list means an author cannot discover what they could give away.

### The Rewards tab

Every sheet that names a reward carries the **same** tab: `Reward Name |
Reward ID`, all 46, green header, IDs in mono. Nothing is ever constructed from
a name - the exporter resolves the name to an ID through this tab, and an
unknown name is an error rather than a guess.

## The sheet

Copy the rolling offer template's shape; it is the reference:
`scripts/sheets/rollingOfferSheet.gs`, and the workbook it builds.

- **Key/value tab for a header**, one row per field with its hint in a third
  column. Prose reads down a page, not across it.
- **Row-per-thing tab for a list**, with colour-coded header groups: identity
  dark, how it is sold blue, money orange, rewards green, the Check column
  purple.
- **A Check column** whose formula restates what the client will do with that
  row. A step that would be dropped says so beside itself rather than after a
  failed export.
- **Dropdowns everywhere a value is from a fixed set** - rewards, currencies,
  price tiers, enums. Number rules where it is a number.
- **Warning-only validation on IDs.** They have to stay pasteable.
- `lastDataRow()` off column A, never `getLastRow()` - see
  `[[shop-sheet-apps-script]]` for why a Check formula on spare rows makes the
  sheet creep down the page on every run.

**What does not go in the sheet:** anything the live ops calendar owns. If a
config is booked as an event, its window - when it opens, how long it runs,
whether it is timed at all - comes from the event through `eventSettings`, so
there is one answer rather than two that have to be kept agreeing. Put a note on
the sheet saying so, or its absence reads as an oversight.

### Building it

Apps Script, not a file handed over. The Drive connector can create a native
Sheet but cannot write cells, so: create the sheet, open **Extensions > Apps
Script**, set the source through Monaco
(`monaco.editor.getModels()[0].setValue(...)`), save, and run it from the
sheet's own menu. The user has to click the authorisation prompt - that is a
permission grant, so ask first.

Do not build an `.xlsx` and upload it. It loses the dropdowns, it needs
converting, and openpyxl without `lxml` writes every part with no XML
declaration, which Sheets and Excel both refuse to open.

## The exporter

`src/exporters/types.ts` is the contract; adding a config is a definition, not a
page. Follow an existing one - `shop.tsx` for a list, `battlePass.tsx` for a
config whose header the console owns.

Everything else is mechanical: `DomainId`, `SETTING_KEYS`, `GIT_PATHS` and
`DOMAIN_LABELS` in `src/domains/types.ts`; the transformer and its schema gate in
`src/lib/`; the preview table; a `config/<domain>.json` baseline; and the sheet
in `scripts/sheets.json` so `npm run audit:live` covers it.

Two habits worth keeping:

- **The transformer is pure and the gate is independent.** The gate re-checks
  the generated object against the schema without trusting the transformer, so a
  regression in one cannot ship through the other.
- **Emit keys in the live payload's order** and omit optional ones rather than
  writing null, so a published diff shows what changed rather than the shape.

## Before you say it works

```bash
npm test && npm run check:graph
CONFIGCAT_SDK_KEY=... npm run audit:live
```

`audit:live` is the one that matters: it runs the real exporter over the real
sheet and diffs against what the game's own SDK would fetch. The other two only
read files in this repo, so a sheet edited last week and a value changed by hand
in ConfigCat are invisible to them. Both have happened.
