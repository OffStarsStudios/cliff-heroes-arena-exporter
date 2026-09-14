/**
 * Brings the Shop Settings workbook level with what the game actually reads.
 *
 * Paste into the workbook's bound script (Extensions > Apps Script) beside
 * `setUpShopSheet`, then run `upgradeShopSheet` once. It is idempotent: run it
 * again after adding products and it extends the new columns, validation and
 * Check formulas over them without touching a value anyone has typed.
 *
 * What it adds, and why:
 *
 * **Price Tier** - the column the sheet has never had. A real-money product is
 * charged through its tier: the tier is the dollar figure, and it is also the
 * store SKU, because one consumable product per price point is registered on
 * Google Play and App Store Connect and everything costing five dollars charges
 * the same `tier5`. Nothing about a price lives on the store dashboard, so a
 * real-money product published without a tier is one the game refuses to sell.
 * The sheet said the opposite until now ("real-money products are priced by the
 * app store"), which is why every live tier had to be recovered from the game
 * repo rather than read off this sheet.
 *
 * **Sort Override** - where the card sits in its section, when the default
 * order is not wanted.
 *
 * It also widens the **Sold In** dropdown. The game resolves that cell to a way
 * of paying or to any currency the player holds, so Coins, Trophies, Upgrade
 * Cards and Pass Tokens are all sellable and the old four-value list was
 * narrower than the game.
 */

/** The dollar figures the stores stock, from `StorePriceTiers` in the game. */
var PRICE_TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];

/**
 * Ways of paying, then every currency the player holds, by the name the game
 * shows it under. From `SoldIn.cs` and the `CurrencySettings` asset.
 */
var SOLD_IN = ['RealMoney', 'Free', 'Ad', 'Coins', 'Gems', 'Upgrade Cards', 'Trophies', 'Pass Tokens'];

/** The currencies among them: these are the ones a Price is a figure in. */
var CURRENCIES = ['Coins', 'Gems', 'Upgrade Cards', 'Trophies', 'Pass Tokens'];

/**
 * The tier each real-money product is live on, recovered from the game's own
 * `RemoteConfigs/shopSettings.json`. Only used to fill a blank cell, so a tier
 * someone has since changed here is left alone.
 */
var LIVE_TIERS = {
  'shop.featured.cinder': 5,
  'shop.featured.starter': 10,
  'shop.gems.tier1': 1,
  'shop.gems.tier2': 2,
  'shop.gems.tier3': 5,
  'shop.gems.tier4': 10,
  'shop.gems.tier5': 20,
  'shop.gems.tier6': 50,
  'shop.cards.tier1': 1,
  'shop.cards.tier2': 2,
  'shop.cards.tier3': 5,
  'shop.cards.tier4': 10,
  'shop.cards.tier5': 20,
  'shop.cards.tier6': 50,
};

var PRODUCTS_TAB = 'Products';

function upgradeShopSheet() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(PRODUCTS_TAB);
  if (!sheet) throw new Error('No "' + PRODUCTS_TAB + '" tab in this workbook.');

  addColumnAfter_(sheet, 'Price Tier', 'Price');
  addColumnAfter_(sheet, 'Sort Override', 'Amount 3', 'Check');

  fillLiveTiers_(sheet);
  applyValidation_(sheet);
  applyCheckColumn_(sheet);

  SpreadsheetApp.getActive().toast('Shop sheet upgraded: Price Tier and Sort Override are in place.');
}

/* ------------------------------------------------------------- helpers -- */

/** The header row as plain strings. */
function headers_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0].map(function (value) {
    return String(value || '').trim();
  });
}

/** 1-based column of a header, or 0. */
function columnOf_(sheet, header) {
  var index = headers_(sheet).indexOf(header);
  return index === -1 ? 0 : index + 1;
}

/**
 * The last row holding a product.
 *
 * Column A only, deliberately: `getLastRow()` counts the Check formulas that
 * sit on the spare rows, so using it grows the sheet by twenty rows on every
 * run.
 */
function lastDataRow_(sheet) {
  var ids = sheet.getRange(1, 1, sheet.getMaxRows(), 1).getValues();
  for (var row = ids.length; row >= 2; row -= 1) {
    if (String(ids[row - 1][0] || '').trim() !== '') return row;
  }
  return 1;
}

/**
 * Inserts a column with this header after `afterHeader`, unless it is already
 * somewhere on the sheet. `beforeHeader`, when given, is preferred as the
 * anchor's right-hand neighbour so a trailing Check column stays last.
 */
function addColumnAfter_(sheet, header, afterHeader, beforeHeader) {
  if (columnOf_(sheet, header) > 0) return;

  var anchor = beforeHeader ? columnOf_(sheet, beforeHeader) - 1 : columnOf_(sheet, afterHeader);
  if (anchor < 1) anchor = columnOf_(sheet, afterHeader);
  if (anchor < 1) throw new Error('Cannot place "' + header + '": no "' + afterHeader + '" column.');

  sheet.insertColumnAfter(anchor);
  var cell = sheet.getRange(1, anchor + 1);
  cell.setValue(header);
  // Match whatever the header row already looks like, so a new column does not
  // stand out as unformatted.
  sheet.getRange(1, anchor).copyFormatToRange(sheet, anchor + 1, anchor + 1, 1, 1);
  sheet.setColumnWidth(anchor + 1, 110);
}

/** Writes the live tier into any real-money row whose Price Tier is still blank. */
function fillLiveTiers_(sheet) {
  var last = lastDataRow_(sheet);
  if (last < 2) return;

  var idColumn = columnOf_(sheet, 'Product ID');
  var tierColumn = columnOf_(sheet, 'Price Tier');
  var ids = sheet.getRange(2, idColumn, last - 1, 1).getValues();
  var tiers = sheet.getRange(2, tierColumn, last - 1, 1).getValues();

  var filled = 0;
  for (var i = 0; i < ids.length; i += 1) {
    var id = String(ids[i][0] || '').trim();
    var blank = tiers[i][0] === '' || tiers[i][0] === null;
    if (blank && Object.prototype.hasOwnProperty.call(LIVE_TIERS, id)) {
      tiers[i][0] = LIVE_TIERS[id];
      filled += 1;
    }
  }
  if (filled > 0) sheet.getRange(2, tierColumn, last - 1, 1).setValues(tiers);
}

function applyValidation_(sheet) {
  var last = lastDataRow_(sheet);
  if (last < 2) return;
  var rows = last - 1;

  var soldIn = SpreadsheetApp.newDataValidation()
    .requireValueInList(SOLD_IN, true)
    .setAllowInvalid(false)
    .setHelpText('How this is paid for: RealMoney, Free, Ad, or one of the currencies the player holds.')
    .build();
  sheet.getRange(2, columnOf_(sheet, 'Sold In'), rows, 1).setDataValidation(soldIn);

  var tier = SpreadsheetApp.newDataValidation()
    .requireValueInList(PRICE_TIERS.map(String), true)
    .setAllowInvalid(false)
    .setHelpText('Dollars, and the store SKU charged. Only the prices the stores stock can be charged.')
    .build();
  var tierRange = sheet.getRange(2, columnOf_(sheet, 'Price Tier'), rows, 1);
  tierRange.setDataValidation(tier);
  tierRange.setNumberFormat('$0');

  var sort = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(-999, 999)
    .setAllowInvalid(false)
    .setHelpText('Where the card sits in its section. Leave empty for the default order.')
    .build();
  sheet.getRange(2, columnOf_(sheet, 'Sort Override'), rows, 1).setDataValidation(sort);
}

/**
 * Rewrites the Check column so it restates the rules the exporter now applies.
 *
 * One formula per row, reading its own row only, so a sheet author sees the
 * refusal beside the row that causes it rather than after a failed export.
 */
function applyCheckColumn_(sheet) {
  var checkColumn = columnOf_(sheet, 'Check');
  if (checkColumn < 1) return;
  var last = lastDataRow_(sheet);
  if (last < 2) return;

  var id = letter_(columnOf_(sheet, 'Product ID'));
  var soldIn = letter_(columnOf_(sheet, 'Sold In'));
  var price = letter_(columnOf_(sheet, 'Price'));
  var tier = letter_(columnOf_(sheet, 'Price Tier'));
  var reward1 = letter_(columnOf_(sheet, 'Reward 1'));

  var currencyList = '{"' + CURRENCIES.join('";"') + '"}';
  var tierList = '{' + PRICE_TIERS.join(';') + '}';

  var formulas = [];
  for (var row = 2; row <= last; row += 1) {
    var f =
      '=IF($' + id + row + '="","",' +
      'IF($' + soldIn + row + '="","Sold In is empty",' +
      // Real money is charged through the tier, so it is the one thing a paid
      // product cannot go out without.
      'IF(AND($' + soldIn + row + '="RealMoney",$' + tier + row + '=""),"Needs a Price Tier - it is the price and the SKU",' +
      'IF(AND($' + tier + row + '<>"",ISNA(MATCH($' + tier + row + ',' + tierList + ',0))),"Price Tier is not a price the stores stock",' +
      'IF(AND(NOT(ISNA(MATCH($' + soldIn + row + ',' + currencyList + ',0))),$' + price + row + '=""),"Needs a Price in " & $' + soldIn + row + ',' +
      'IF(AND(ISNA(MATCH($' + soldIn + row + ',' + currencyList + ',0)),$' + price + row + '<>""),"Price is set but it is not sold in a currency",' +
      'IF($' + reward1 + row + '="","Grants nothing",' +
      '"OK")))))))';
    formulas.push([f]);
  }
  sheet.getRange(2, checkColumn, formulas.length, 1).setFormulas(formulas);

  // Spare rows keep no formula at all: a Check formula below the data is what
  // makes getLastRow() overcount and the sheet grow on every run.
  var spare = sheet.getMaxRows() - last;
  if (spare > 0) sheet.getRange(last + 1, checkColumn, spare, 1).clearContent();
}

/** Column number to its letter. */
function letter_(column) {
  var name = '';
  while (column > 0) {
    var remainder = (column - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    column = (column - 1 - remainder) / 26;
  }
  return name;
}
