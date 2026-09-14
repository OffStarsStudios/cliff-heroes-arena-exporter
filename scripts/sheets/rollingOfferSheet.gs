/**
 * Builds a rolling offer workbook, and makes new ones from it.
 *
 * Paste into the Rolling Offer Template's bound script (Extensions > Apps
 * Script) and run `setUpRollingOfferSheet` once. After that the template
 * carries a **Rolling offers** menu, and "New offer from this template" copies
 * it into the Rolling Offers folder ready to fill in.
 *
 * **One workbook per offer, on purpose.** The client takes the offer list whole
 * - an offer that stops appearing is retired and every player's progress under
 * its ID is dropped on the next launch - but that is the *published* shape, not
 * the shape anyone should have to author in. A single sheet holding every offer
 * would mean two people laying out next month's run are editing the same rows.
 * Each offer is written on its own, and the console merges it into the live
 * list by OfferID when it publishes.
 *
 * **What is deliberately not here.** An offer's dates are not in the sheet.
 * Whether it is timed, when it opens and how long it runs are the live ops
 * event's to say - they are booked on the calendar, the same way the battle
 * pass season window is - so there is one answer to "when is this live" rather
 * than two that have to be kept agreeing. The sheet is the content.
 */

/* ----------------------------------------------------------- vocabulary -- */

/**
 * How a step is paid for. `RealMoney`, `Free` and `Ad` are the client's own
 * words; the rest are the currencies the player holds, by the name they are
 * shown under. A value that is neither drops the step.
 */
var SOLD_IN = ['Free', 'Ad', 'RealMoney', 'Coins', 'Gems', 'Upgrade Cards', 'Trophies', 'Pass Tokens'];

/** The currencies among them - the ones a Price is a figure in. */
var CURRENCIES = ['Coins', 'Gems', 'Upgrade Cards', 'Trophies', 'Pass Tokens'];

/**
 * The dollar prices the stores stock. A real-money step's tier is its price and
 * its SKU both, so a figure off this ladder has nothing to charge against and
 * the step is dropped.
 */
var PRICE_TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];

/**
 * Every reward the build registers, as name -> ID.
 *
 * Rewards are derived in the client rather than authored: one per hero, per
 * non-default skin, per arena, per currency and per lootbox. Naming them here
 * is what lets the sheet offer a dropdown instead of asking anyone to type
 * `reward.skin.cinder.rainbow` correctly.
 */
var REWARDS = [
  ['Coins', 'reward.currency.coins'],
  ['Upgrade Cards', 'reward.currency.cards'],
  ['Gems', 'reward.currency.gems'],
  ['Trophies', 'reward.currency.trophies'],
  ['Pass Tokens', 'reward.currency.passTokens'],
  ['Lootbox - Common', 'reward.lootbox.common'],
  ['Lootbox - Rare', 'reward.lootbox.rare'],
  ['Lootbox - Legendary', 'reward.lootbox.legendary'],
  ['Hero - Cliff', 'reward.hero.cliff'],
  ['Hero - Flick', 'reward.hero.flick'],
  ['Hero - Guy', 'reward.hero.guy'],
  ['Hero - Pedro', 'reward.hero.pedro'],
  ['Hero - Tank', 'reward.hero.tank'],
  ['Hero - Glint', 'reward.hero.glint'],
  ['Hero - Cinder', 'reward.hero.cinder'],
  ['Arena - Lost Oasis', 'reward.arena.lostoasis'],
  ['Arena - Mystic Forest', 'reward.arena.mysticforest'],
  ['Arena - Sakura Cliffs', 'reward.arena.sakuracliffs'],
  ['Skin - Cliff Halloween', 'reward.skin.cliff.halloween'],
  ['Skin - Cliff Space', 'reward.skin.cliff.space'],
  ['Skin - Cliff Nature', 'reward.skin.cliff.nature'],
  ['Skin - Cliff Pirate', 'reward.skin.cliff.pirate'],
  ['Skin - Cliff Rainbow', 'reward.skin.cliff.rainbow'],
  ['Skin - Flick Ghost', 'reward.skin.flick.ghost'],
  ['Skin - Flick Space', 'reward.skin.flick.space'],
  ['Skin - Flick Nature', 'reward.skin.flick.nature'],
  ['Skin - Flick Pirate', 'reward.skin.flick.pirate'],
  ['Skin - Flick Rainbow', 'reward.skin.flick.rainbow'],
  ['Skin - Guy Pirate', 'reward.skin.guy.pirate'],
  ['Skin - Guy Space', 'reward.skin.guy.space'],
  ['Skin - Guy Super Space', 'reward.skin.guy.superspace'],
  ['Skin - Tank Flower', 'reward.skin.tank.flower'],
  ['Skin - Tank Space', 'reward.skin.tank.space'],
  ['Skin - Tank Nature', 'reward.skin.tank.nature'],
  ['Skin - Tank Pirate', 'reward.skin.tank.pirate'],
  ['Skin - Glint Space', 'reward.skin.glint.space'],
  ['Skin - Glint Nature', 'reward.skin.glint.nature'],
  ['Skin - Glint Rainbow', 'reward.skin.glint.rainbow'],
  ['Skin - Pedro Space', 'reward.skin.pedro.space'],
  ['Skin - Pedro Nature', 'reward.skin.pedro.nature'],
  ['Skin - Pedro Pirate', 'reward.skin.pedro.pirate'],
  ['Skin - Pedro Rainbow', 'reward.skin.pedro.rainbow'],
  ['Skin - Cinder Space', 'reward.skin.cinder.space'],
  ['Skin - Cinder Nature', 'reward.skin.cinder.nature'],
  ['Skin - Cinder Pirate', 'reward.skin.cinder.pirate'],
  ['Skin - Cinder Rainbow', 'reward.skin.cinder.rainbow'],
];

/** The offer header, as label / key / hint. */
var OFFER_FIELDS = [
  ['Offer ID', 'OfferID', 'offer.<name>. What progress is filed under - changing it starts a fresh chain.'],
  ['Display Name', 'DisplayName', 'The title across the top of the page.'],
  ['Subtitle', 'Subtitle', 'The line under it.'],
  ['Completion Reward', 'CompletionReward', 'What finishing the whole chain hands over. Leave empty for a chain that finishes on nothing.'],
  ['Completion Amount', 'CompletionAmount', 'How many. Leave empty to pay what the reward is authored to pay.'],
  ['Completion Text', 'CompletionText', 'The line along the bottom. {0} is replaced by the completion reward’s name.'],
  ['Background Art', 'BackgroundArt', 'Under OfferImages/, without the prefix. Empty falls back to the schedule default.'],
  ['Top Bar Art', 'TopBarArt', 'Under OfferImages/. Empty falls back to the schedule default.'],
  ['Reward Art', 'RewardArt', 'The prize picture. Empty shows the completion reward’s own art.'],
  ['Button Art', 'ButtonArt', 'The picture on the offer’s button on the main screen.'],
];

var STEP_HEADER = [
  'Step', 'Sold In', 'Price', 'Price Tier', 'Ad Placement',
  'Reward 1', 'Amount 1', 'Reward 2', 'Amount 2', 'Reward 3', 'Amount 3', 'Check',
];

var HEAD_DARK = '#37474f';
var HEAD_BLUE = '#1565c0';
var HEAD_ORANGE = '#ef6c00';
var HEAD_GREEN = '#2e7d32';
var HEAD_PURPLE = '#5e35b1';

var STEP_ROWS = 12;

/* ------------------------------------------------------------ the menu -- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Rolling offers')
    .addItem('New offer from this template', 'newOfferFromTemplate')
    .addSeparator()
    .addItem('Rebuild this sheet', 'setUpRollingOfferSheet')
    .addToUi();
}

/**
 * Copies this workbook into the folder it lives in, so a new offer starts from
 * a sheet that is already formatted and already validated rather than from a
 * blank one somebody has to remember the shape of.
 */
function newOfferFromTemplate() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt(
    'New rolling offer',
    'Name it after the offer, e.g. "Rolling Offer - Autumn Roll".',
    ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;

  var title = answer.getResponseText().trim();
  if (title === '') {
    ui.alert('That needs a name.');
    return;
  }

  var file = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
  var parents = file.getParents();
  var copy = parents.hasNext() ? file.makeCopy(title, parents.next()) : file.makeCopy(title);

  // Anyone with the link can read it, which is what lets the console load it.
  copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  ui.alert('Made "' + title + '".\n\n' + copy.getUrl());
}

/* ------------------------------------------------------------- building -- */

function setUpRollingOfferSheet() {
  var book = SpreadsheetApp.getActive();
  buildRewards_(book);
  buildOffer_(book);
  buildSteps_(book);

  // Leave the author on the tab they actually fill in first.
  book.setActiveSheet(book.getSheetByName('Offer'));
  var blank = book.getSheetByName('Sheet1');
  if (blank) book.deleteSheet(blank);

  book.toast('Rolling offer sheet built. Fill in Offer, then Steps.');
}

function sheetNamed_(book, name) {
  var sheet = book.getSheetByName(name);
  return sheet ? sheet : book.insertSheet(name);
}

function headerRow_(sheet, values, colour) {
  var range = sheet.getRange(1, 1, 1, values.length);
  range.setValues([values]);
  range.setBackground(colour).setFontColor('#ffffff').setFontWeight('bold');
  range.setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);
}

/** The lookup every reward is named through. IDs are never typed by hand. */
function buildRewards_(book) {
  var sheet = sheetNamed_(book, 'Rewards');
  sheet.clear();
  headerRow_(sheet, ['Reward Name', 'Reward ID'], HEAD_GREEN);
  sheet.getRange(2, 1, REWARDS.length, 2).setValues(REWARDS);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 260);
  sheet.getRange(2, 2, REWARDS.length, 1).setFontFamily('Roboto Mono').setFontColor('#5f6368');
}

/**
 * The offer header, as a key/value tab rather than a wide row: there are ten
 * fields and most are prose, which reads far better down the page than across
 * it, and it leaves room for each one to carry its own hint.
 */
function buildOffer_(book) {
  var sheet = sheetNamed_(book, 'Offer');
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  headerRow_(sheet, ['Setting', 'Value', 'What it is'], HEAD_DARK);

  var rows = OFFER_FIELDS.map(function (field) { return [field[0], '', field[2]]; });
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  sheet.getRange(2, 1, rows.length, 1).setFontWeight('bold');
  sheet.getRange(2, 3, rows.length, 1).setFontColor('#5f6368').setWrap(true);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 330);
  sheet.setColumnWidth(3, 460);

  var rowOf = {};
  OFFER_FIELDS.forEach(function (field, index) { rowOf[field[1]] = index + 2; });

  // The completion reward is named from the lookup, like every other reward.
  sheet.getRange(rowOf.CompletionReward, 2).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(book.getSheetByName('Rewards').getRange('A2:A' + (REWARDS.length + 1)), true)
      .setAllowInvalid(false)
      .setHelpText('A reward from the Rewards tab. Leave empty for a chain that finishes on nothing.')
      .build());

  sheet.getRange(rowOf.CompletionAmount, 2).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireNumberGreaterThan(0)
      .setAllowInvalid(false)
      .setHelpText('Leave empty to pay what the reward is authored to pay.')
      .build());

  sheet.getRange(2, 2, rows.length, 1).setBackground('#fffde7');

  // A note at the bottom rather than empty rows that look like fields.
  var footer = rows.length + 3;
  sheet.getRange(footer, 1, 1, 3).merge();
  sheet.getRange(footer, 1)
    .setValue(
      'The dates are not here on purpose. Whether this offer is timed, when it opens and how long it ' +
      'runs are set when it is booked on the live ops calendar, so there is one answer rather than two.')
    .setFontColor('#b06000').setBackground('#fef7e0').setWrap(true);
  sheet.setRowHeight(footer, 40);
}

/** The chain. One row per step, in the order the player takes them. */
function buildSteps_(book) {
  var sheet = sheetNamed_(book, 'Steps');
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  sheet.clearConditionalFormatRules();

  var colours = [
    HEAD_DARK, HEAD_BLUE, HEAD_ORANGE, HEAD_ORANGE, HEAD_ORANGE,
    HEAD_GREEN, HEAD_GREEN, HEAD_GREEN, HEAD_GREEN, HEAD_GREEN, HEAD_GREEN, HEAD_PURPLE,
  ];
  headerRow_(sheet, STEP_HEADER, HEAD_DARK);
  colours.forEach(function (colour, index) {
    sheet.getRange(1, index + 1).setBackground(colour);
  });

  var widths = [60, 130, 90, 100, 150, 190, 100, 190, 100, 190, 100, 300];
  widths.forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });

  var last = STEP_ROWS + 1;

  // The step number is the row's position in the chain, so it is written rather
  // than typed - a step has no identity of its own beyond where it sits.
  var numbers = [];
  for (var i = 1; i <= STEP_ROWS; i += 1) numbers.push([i]);
  sheet.getRange(2, 1, STEP_ROWS, 1).setValues(numbers)
    .setFontColor('#9aa0a6').setHorizontalAlignment('center');

  var rewardsRange = book.getSheetByName('Rewards').getRange('A2:A' + (REWARDS.length + 1));
  var rewardRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(rewardsRange, true).setAllowInvalid(false)
    .setHelpText('A reward from the Rewards tab.').build();
  [6, 8, 10].forEach(function (column) {
    sheet.getRange(2, column, STEP_ROWS, 1).setDataValidation(rewardRule);
  });

  var amountRule = SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThan(0).setAllowInvalid(false)
    .setHelpText('Whole number. Leave empty to pay what the reward is authored to pay.').build();
  [7, 9, 11].forEach(function (column) {
    sheet.getRange(2, column, STEP_ROWS, 1).setDataValidation(amountRule);
  });

  sheet.getRange(2, 2, STEP_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SOLD_IN, true).setAllowInvalid(false)
      .setHelpText('How the step is paid for: Free, Ad, RealMoney, or one of the player’s currencies.')
      .build());

  sheet.getRange(2, 3, STEP_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireNumberGreaterThan(0).setAllowInvalid(false)
      .setHelpText('What it costs in the currency it is sold in.').build());

  var tiers = PRICE_TIERS.map(function (tier) { return String(tier); });
  sheet.getRange(2, 4, STEP_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(tiers, true).setAllowInvalid(false)
      .setHelpText('Dollars, and the store SKU charged. Only the prices the stores stock.').build())
    .setNumberFormat('$0');

  buildStepChecks_(sheet, last);
  buildStepColours_(sheet, last);
}

/**
 * One formula per row restating what the client will do with it, so a step that
 * would be dropped says so beside itself rather than after a failed export.
 */
function buildStepChecks_(sheet, last) {
  var currencyList = '{"' + CURRENCIES.join('";"') + '"}';
  var formulas = [];
  for (var row = 2; row <= last; row += 1) {
    formulas.push([
      '=IF(COUNTA($B' + row + ':$K' + row + ')=0,"",' +
      'IF($B' + row + '="","Sold In is empty - the step would be dropped",' +
      'IF(AND($B' + row + '="RealMoney",$D' + row + '=""),"Needs a Price Tier - it is the price and the SKU",' +
      'IF(AND(NOT(ISNA(MATCH($B' + row + ',' + currencyList + ',0))),$C' + row + '=""),"Needs a Price in "&$B' + row + ',' +
      'IF(AND(ISNA(MATCH($B' + row + ',' + currencyList + ',0)),$C' + row + '<>""),"Price is set but it is not sold in a currency",' +
      'IF($F' + row + '="","Pays nothing - the step would be dropped",' +
      'IF(AND($G' + row + '="",$I' + row + '="",$K' + row + '=""),"OK",' +
      '"OK"))))))) ',
    ]);
  }
  sheet.getRange(2, 12, formulas.length, 1).setFormulas(formulas);
}

function buildStepColours_(sheet, last) {
  var checks = sheet.getRange(2, 12, last - 1, 1);
  var all = sheet.getRange(2, 1, last - 1, 12);
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$L2="OK"')
      .setBackground('#e6f4ea').setFontColor('#137333').setRanges([checks]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($L2<>"",$L2<>"OK")')
      .setBackground('#fce8e6').setFontColor('#c5221f').setRanges([checks]).build(),
    // A real-money step reads differently from a free one at a glance.
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B2="RealMoney"')
      .setBackground('#fff8e1').setRanges([all]).build(),
  ];
  sheet.setConditionalFormatRules(rules);
}
