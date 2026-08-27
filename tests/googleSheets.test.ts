import { describe, expect, it } from 'vitest';
import { buildExportUrl, extractSpreadsheetId, isPublishedLink } from '../src/lib/googleSheets';

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

describe('spreadsheet id extraction', () => {
  it('handles the shapes Google hands out', () => {
    expect(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID);
    expect(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toBe(ID);
    expect(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}`)).toBe(ID);
    expect(extractSpreadsheetId(`  https://docs.google.com/spreadsheets/d/${ID}/view  `)).toBe(ID);
    expect(extractSpreadsheetId(ID)).toBe(ID);
  });

  it('handles published-to-web links', () => {
    const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vABCdef/pubhtml';
    expect(extractSpreadsheetId(url)).toBe('2PACX-1vABCdef');
    expect(isPublishedLink(url)).toBe(true);
  });

  it('rejects anything that is not a sheets link', () => {
    expect(extractSpreadsheetId('')).toBeNull();
    expect(extractSpreadsheetId('not a url')).toBeNull();
    expect(extractSpreadsheetId('https://example.com/spreadsheet')).toBeNull();
  });
});

describe('export url', () => {
  it('uses the xlsx export endpoint for normal links', () => {
    const url = `https://docs.google.com/spreadsheets/d/${ID}/edit`;
    expect(buildExportUrl(url, ID)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`);
  });

  it('uses the pub endpoint for published links', () => {
    const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vABCdef/pubhtml';
    expect(buildExportUrl(url, '2PACX-1vABCdef')).toBe(
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vABCdef/pub?output=xlsx',
    );
  });
});
