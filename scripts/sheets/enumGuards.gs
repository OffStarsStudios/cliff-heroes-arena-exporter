/**
 * Dropdowns for the three sheets whose cells name something the game parses
 * into an enum.
 *
 * Paste into the bound script of the sheet you are guarding (Extensions > Apps
 * Script) and run the one function for it. Each is idempotent and touches no
 * values - it only constrains what can be typed next.
 *
 * **Why these three are worth guarding above the others.** The game reads these
 * cells with Newtonsoft's defaults, which accept the exact enum name and throw
 * on anything else. The throw is caught and turned into a config that failed to
 * load, and `heroesSettings`, `heroUpgradeSettings` and `botsSettings` are all
 * configs the game will not start without - so a rarity typed "Legendry" is not
 * a mistuned curve, it is a launch that never leaves the loading screen. The
 * exporter refuses these names too, but a dropdown stops them being typed at
 * all.
 */

/** `Rarity` in the game, in its declared order - which is also the progression. */
var RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];

/**
 * `BotLevel` in the game, in its declared order. The order is what gives each
 * one its number: VeryEasy is 0 through VeryHard at 4. The arenas sheet names
 * them; the bots sheet numbers them; both land in this one enum.
 */
var BOT_LEVELS = ['VeryEasy', 'Easy', 'Medium', 'Hard', 'VeryHard'];

/* ------------------------------------------------------ Arenas Settings -- */

/**
 * Every `Bot N Level` column takes a difficulty name, `VeryEasy` included - it
 * is a difficulty the game has always had and the old dropdown simply left out,
 * so no arena could be authored to race at it.
 */
function guardArenaDifficulties() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Arena Settings');
  if (!sheet) throw new Error('No "Arena Settings" tab in this workbook.');

  var rule = listRule_(BOT_LEVELS, 'A difficulty the game has: ' + BOT_LEVELS.join(', ') + '.');
  var headers = headerRow_(sheet);
  var rows = lastDataRow_(sheet) - 1;
  if (rows < 1) return;

  var guarded = 0;
  for (var column = 1; column <= headers.length; column += 1) {
    if (!/^Bot \d+ Level$/.test(headers[column - 1])) continue;
    sheet.getRange(2, column, rows, 1).setDataValidation(rule);
    guarded += 1;
  }
  SpreadsheetApp.getActive().toast('Guarded ' + guarded + ' bot difficulty columns.');
}

/* -------------------------------------------------------- Bots Settings -- */

/**
 * The Level column is the `BotLevel` enum as a number, so only 0..4 mean
 * anything: the game looks each difficulty up by value and keeps the tuning
 * compiled into the build for anything it cannot find, so a level of 5 tunes no
 * bot at all and says nothing about it.
 *
 * It also labels each row with the difficulty its number names, which is the
 * thing the sheet has never said out loud.
 */
function guardBotLevels() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Bots');
  if (!sheet) throw new Error('No "Bots" tab in this workbook.');

  var last = lastDataRow_(sheet);
  if (last < 2) return;

  var rule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, BOT_LEVELS.length - 1)
    .setAllowInvalid(false)
    .setHelpText(BOT_LEVELS.map(function (name, level) { return level + ' ' + name; }).join(', ') + '.')
    .build();
  sheet.getRange(2, 1, last - 1, 1).setDataValidation(rule);

  // A note rather than a column: the difficulty is the level, not a second
  // field that could disagree with it.
  var levels = sheet.getRange(2, 1, last - 1, 1).getValues();
  var notes = levels.map(function (row) {
    var name = BOT_LEVELS[row[0]];
    return [name ? name : 'No difficulty has this number'];
  });
  sheet.getRange(2, 1, notes.length, 1).setNotes(notes);

  if (last - 1 !== BOT_LEVELS.length) {
    SpreadsheetApp.getActive().toast(
      'This tab tunes ' + (last - 1) + ' of the ' + BOT_LEVELS.length + ' difficulties. ' +
      'The game keeps the build\'s own values for any it does not find here.',
      'Check the rows', 10);
  }
}

/* ------------------------------------------------ Hero Upgrade Settings -- */

/** The Costs tab's Rarity column, and the Reference Rarity on the Growth tab. */
function guardUpgradeRarities() {
  var book = SpreadsheetApp.getActive();
  var rule = listRule_(RARITIES, 'A rarity the game has: ' + RARITIES.join(', ') + '.');

  var costs = book.getSheetByName('Costs');
  if (costs) {
    var rows = lastDataRow_(costs) - 1;
    if (rows > 0) costs.getRange(2, 1, rows, 1).setDataValidation(rule);
  }

  // The Growth tab is a key/value list, so the cell to guard is the one beside
  // the "Reference Rarity" row rather than a whole column.
  var growth = book.getSheetByName('Growth');
  if (growth) {
    var keys = growth.getRange(1, 1, growth.getMaxRows(), 1).getValues();
    for (var row = 1; row <= keys.length; row += 1) {
      if (String(keys[row - 1][0] || '').trim() === 'Reference Rarity') {
        growth.getRange(row, 2).setDataValidation(rule);
        break;
      }
    }
  }
  book.toast('Rarity dropdowns applied.');
}

/* ----------------------------------------------- Heroes Configuration -- */

/** The hero sheet's own Rarity column, wherever it sits. */
function guardHeroRarities() {
  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  var headers = headerRow_(sheet);
  var column = headers.indexOf('Rarity') + 1;
  if (column < 1) throw new Error('No "Rarity" column on the "' + sheet.getName() + '" tab.');

  var rows = lastDataRow_(sheet) - 1;
  if (rows < 1) return;
  sheet
    .getRange(2, column, rows, 1)
    .setDataValidation(listRule_(RARITIES, 'A rarity the game has: ' + RARITIES.join(', ') + '.'));
  SpreadsheetApp.getActive().toast('Rarity dropdown applied to "' + sheet.getName() + '".');
}

/* ------------------------------------------------------------- helpers -- */

function listRule_(values, help) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .setHelpText(help)
    .build();
}

function headerRow_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0].map(function (value) {
    return String(value || '').trim();
  });
}

/**
 * The last row holding data, read off column A only. `getLastRow()` counts
 * anything on the spare rows - a formula, a stray validation - and using it is
 * what makes a re-run creep down the sheet.
 */
function lastDataRow_(sheet) {
  var first = sheet.getRange(1, 1, sheet.getMaxRows(), 1).getValues();
  for (var row = first.length; row >= 2; row -= 1) {
    if (String(first[row - 1][0] || '').trim() !== '') return row;
  }
  return 1;
}
