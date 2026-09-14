/**
 * Brings a config sheet onto the shared reward vocabulary and the shared look.
 *
 * Paste beside `rewards.generated.gs` into the bound script of the Shop or
 * Battle Pass workbook, then run `standardiseThisSheet`. It works out which
 * workbook it is in from the tabs it finds.
 *
 * **Renaming rewards is the dangerous part**, and it is why this exists rather
 * than anyone doing it by hand. The data tabs reference rewards *by name* -
 * `Hero_Cinder` in a Products row, `Lootbox_Common` in a Tiers row - and the
 * exporter resolves those names through the Rewards tab. Overwrite that tab
 * with new names and every reference becomes an unknown reward: the export
 * stops dead, or worse, resolves to something else.
 *
 * So the old tab is read first and kept as name -> ID. Every reference cell is
 * then rewritten through the **ID**, which is the only thing that does not
 * change, and only then is the tab replaced. A name the old tab never defined
 * is left exactly as it is and reported, rather than being guessed at.
 *
 * Idempotent: run it again after adding rows and it extends the formatting and
 * validation without touching a value.
 */

/* --------------------------------------------------------------- shared -- */

var HEAD_DARK = '#37474f';
var HEAD_BLUE = '#1565c0';
var HEAD_ORANGE = '#ef6c00';
var HEAD_GREEN = '#2e7d32';
var HEAD_PURPLE = '#5e35b1';

/** Which reward-name columns each tab has, by header. */
var REWARD_COLUMNS = {
  Products: ['Reward 1', 'Reward 2', 'Reward 3'],
  Tiers: ['Free Reward', 'Premium Reward'],
  Steps: ['Reward 1', 'Reward 2', 'Reward 3'],
  Offer: [],
};

function standardiseThisSheet() {
  var book = SpreadsheetApp.getActive();
  var before = readRewardTab_(book);

  // Order matters, and getting it wrong is not subtle. The reward columns carry
  // a dropdown that refuses anything outside the Rewards tab, so writing a new
  // name into a cell while the tab still holds the old list throws
  // "Pick a reward name from the Rewards tab" and nothing moves. The validation
  // comes off first, the tab is replaced, the references are rewritten against
  // it, and only then is the dropdown put back.
  clearRewardValidation_(book);
  writeRewardTab_(book);

  var renamed = 0;
  var unknown = [];
  Object.keys(REWARD_COLUMNS).forEach(function (tab) {
    var sheet = book.getSheetByName(tab);
    if (!sheet) return;
    var result = rewriteReferences_(sheet, REWARD_COLUMNS[tab], before);
    renamed += result.renamed;
    unknown = unknown.concat(result.unknown);
  });

  repointValidation_(book);
  restyle_(book);

  var message = 'Rewards standardised. ' + renamed + ' reference(s) renamed.';
  if (unknown.length > 0) {
    message += '\n\nLeft alone because the old Rewards tab did not define them:\n' +
      unknown.slice(0, 8).join('\n');
  }
  SpreadsheetApp.getUi().alert(message);
}

/* ------------------------------------------------------------- renaming -- */

/**
 * The Rewards tab as it stands, as old name -> ID. Read before anything is
 * written, because it is the only record of what the data tabs currently mean.
 */
function readRewardTab_(book) {
  var sheet = book.getSheetByName('Rewards');
  var map = {};
  if (!sheet) return map;
  var last = lastDataRow_(sheet);
  if (last < 2) return map;
  var values = sheet.getRange(2, 1, last - 1, 2).getValues();
  values.forEach(function (row) {
    var name = String(row[0] || '').trim();
    var id = String(row[1] || '').trim();
    if (name !== '' && id !== '') map[name] = id;
  });
  return map;
}

/** ID -> the name it is called now. */
function canonicalByID_() {
  var map = {};
  REWARDS.forEach(function (row) { map[row[1]] = row[0]; });
  return map;
}

/**
 * Rewrites a tab's reward references from whatever they were called to what
 * they are called now, joined by ID.
 */
function rewriteReferences_(sheet, headers, before) {
  var result = { renamed: 0, unknown: [] };
  if (headers.length === 0) return result;

  var last = lastDataRow_(sheet);
  if (last < 2) return result;

  var canonical = canonicalByID_();
  var head = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0]
    .map(function (value) { return String(value || '').trim(); });

  headers.forEach(function (header) {
    var column = head.indexOf(header) + 1;
    if (column < 1) return;

    var range = sheet.getRange(2, column, last - 1, 1);
    var values = range.getValues();
    var touched = false;

    for (var i = 0; i < values.length; i += 1) {
      var name = String(values[i][0] || '').trim();
      if (name === '') continue;

      // Already current: nothing to do, which is what makes a re-run harmless.
      if (canonical[before[name]] === name) continue;

      var id = before[name];
      if (!id || !canonical[id]) {
        result.unknown.push('"' + name + '" in ' + sheet.getName() + '!' + header);
        continue;
      }
      values[i][0] = canonical[id];
      result.renamed += 1;
      touched = true;
    }
    if (touched) range.setValues(values);
  });
  return result;
}

/* ------------------------------------------------------------ the tab -- */

/** The canonical list, whole. Every sheet carries all of it, not just what it uses. */
function writeRewardTab_(book) {
  var sheet = book.getSheetByName('Rewards') || book.insertSheet('Rewards');
  sheet.clear();

  var header = sheet.getRange(1, 1, 1, 2);
  header.setValues([['Reward Name', 'Reward ID']]);
  header.setBackground(HEAD_GREEN).setFontColor('#ffffff').setFontWeight('bold');
  header.setVerticalAlignment('middle');
  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);

  sheet.getRange(2, 1, REWARDS.length, 2).setValues(REWARDS);
  sheet.getRange(2, 2, REWARDS.length, 1).setFontFamily('Roboto Mono').setFontColor('#5f6368');
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 260);
}

/** Takes the dropdown off, so the rename is not refused by the old list. */
function clearRewardValidation_(book) {
  Object.keys(REWARD_COLUMNS).forEach(function (tab) {
    var sheet = book.getSheetByName(tab);
    if (!sheet || REWARD_COLUMNS[tab].length === 0) return;
    var last = Math.max(lastDataRow_(sheet), 2);
    var head = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0]
      .map(function (value) { return String(value || '').trim(); });
    REWARD_COLUMNS[tab].forEach(function (header) {
      var column = head.indexOf(header) + 1;
      if (column < 1) return;
      sheet.getRange(2, column, last - 1, 1).clearDataValidations();
    });
  });
}

/** Every reward column picks from the whole list. */
function repointValidation_(book) {
  var names = book.getSheetByName('Rewards').getRange('A2:A' + (REWARDS.length + 1));
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(names, true)
    .setAllowInvalid(false)
    .setHelpText('A reward from the Rewards tab.')
    .build();

  Object.keys(REWARD_COLUMNS).forEach(function (tab) {
    var sheet = book.getSheetByName(tab);
    if (!sheet || REWARD_COLUMNS[tab].length === 0) return;
    var last = Math.max(lastDataRow_(sheet), 2);
    var head = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0]
      .map(function (value) { return String(value || '').trim(); });

    REWARD_COLUMNS[tab].forEach(function (header) {
      var column = head.indexOf(header) + 1;
      if (column < 1) return;
      sheet.getRange(2, column, last - 1, 1).setDataValidation(rule);
    });
  });
}

/* ------------------------------------------------------------ the look -- */

/**
 * The header groups the rolling offer template uses: identity dark, how it is
 * sold blue, money orange, rewards green, the Check column purple. Colour is
 * doing real work here - a Products row is eighteen columns wide, and the
 * groups are what make it scannable.
 */
function groupColour_(header) {
  if (/^(Check)$/.test(header)) return HEAD_PURPLE;
  if (/Reward|Amount/.test(header)) return HEAD_GREEN;
  if (/Price|Cost|Tier|Hours|Limit|Sort|Tokens|Badge/.test(header)) return HEAD_ORANGE;
  if (/Sold In|Enabled|Listed|Timed/.test(header)) return HEAD_BLUE;
  return HEAD_DARK;
}

function restyle_(book) {
  ['Products', 'Tiers', 'Steps', 'Season', 'Offer'].forEach(function (tab) {
    var sheet = book.getSheetByName(tab);
    if (!sheet) return;

    var width = sheet.getLastColumn();
    if (width < 1) return;
    var head = sheet.getRange(1, 1, 1, width);
    var values = head.getValues()[0];

    head.setFontColor('#ffffff').setFontWeight('bold').setVerticalAlignment('middle').setWrap(true);
    for (var column = 1; column <= width; column += 1) {
      sheet.getRange(1, column).setBackground(groupColour_(String(values[column - 1] || '').trim()));
    }
    sheet.setRowHeight(1, 34);
    sheet.setFrozenRows(1);
  });
}

/* ------------------------------------------------------------- helpers -- */

/**
 * The last row holding data, read off column A only. `getLastRow()` counts the
 * Check formulas that sit on spare rows, and using it is what makes a re-run
 * creep further down the sheet every time.
 */
function lastDataRow_(sheet) {
  var first = sheet.getRange(1, 1, sheet.getMaxRows(), 1).getValues();
  for (var row = first.length; row >= 2; row -= 1) {
    if (String(first[row - 1][0] || '').trim() !== '') return row;
  }
  return 1;
}
