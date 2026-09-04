import {
  requireNumber as requireSheetNumber,
  resolveColumns as resolveSheetColumns,
  type ColumnSpec,
  type Columns,
  type NumberCodes,
} from './columns';
import { cellText, isBlank, normalizeName, parseNumber } from './normalize';
import { resolveLookup } from './lookups';
import {
  FIXED_POWER_PARAMS,
  powerParamType,
  resolvePowerParamName,
  type PowerParamName,
} from './powerParams';
import type {
  HeroEntry,
  HeroLevel,
  HeroPower,
  HeroPreviewRow,
  HeroTransformResult,
  Issue,
  LookupTable,
  RawCell,
  RawSheet,
} from './types';

/**
 * Level stats round to one decimal place, nearest, halves away from zero.
 *
 * The multiplication happens in scaled-integer space rather than on the raw
 * floats. Many of these products land exactly on a .x5 boundary, and in binary
 * floating point `9.7 * 1.5` is 14.549999999999999, not 14.55 - so rounding the
 * float would decide those cases on representation rather than on intent.
 */
const SCALE = 1e6;

export function multiplyToOneDecimal(base: number, multiplier: number): number {
  const b = Math.round(base * SCALE);
  const m = Math.round(multiplier * SCALE);
  if (!Number.isSafeInteger(b * m)) {
    throw new Error(`Cannot round ${base} x ${multiplier} without losing precision.`);
  }
  const scaled = (b * m) / ((SCALE * SCALE) / 10);
  const rounded = (Math.sign(scaled) * Math.round(Math.abs(scaled))) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/* -------------------------------------------------------------- columns -- */

/** Accepted header spellings per logical field. Matching is token-based. */
const COLUMN_LABELS = {
  heroName: ['hero name', 'name', 'hero'],
  health: ['health', 'base health', 'hp'],
  speed: ['speed', 'base speed'],
  grip: ['grip', 'base grip'],
  maxSpeed: ['max speed', 'maximum speed'],
  speedIncrease: ['speed increase per second', 'speed increase'],
  powerCooldown: ['powerup cooldown', 'power cooldown', 'power up cooldown', 'cooldown'],
  rarity: ['rarity'],
  level: ['level', 'lvl'],
  healthMultiplier: ['health multiplier', 'health factor'],
  speedMultiplier: ['speed multiplier', 'speed factor'],
  gripMultiplier: ['grip multiplier', 'grip factor'],
  activationDelay: ['activation delay'],
  duration: ['duration'],
} as const;

type FieldName = keyof typeof COLUMN_LABELS;

const FIELD_TITLE: Record<FieldName, string> = {
  heroName: 'Hero Name',
  health: 'Health',
  speed: 'Speed',
  grip: 'Grip',
  maxSpeed: 'Max Speed',
  speedIncrease: 'Speed Increase Per Second',
  powerCooldown: 'Powerup Cooldown',
  rarity: 'Rarity',
  level: 'Level',
  healthMultiplier: 'Health Multiplier',
  speedMultiplier: 'Speed Multiplier',
  gripMultiplier: 'Grip Multiplier',
  activationDelay: 'Activation Delay',
  duration: 'Duration',
};

const COLUMN_SPEC: ColumnSpec<FieldName> = {
  labels: COLUMN_LABELS,
  titles: FIELD_TITLE,
  missingCode: 'hero-missing-column',
};

/** Resolves the required columns of a hero tab, reporting any that are absent. */
function resolveColumns(sheet: RawSheet, fields: FieldName[], issues: Issue[]): Columns<FieldName> {
  return resolveSheetColumns(sheet, fields, COLUMN_SPEC, issues);
}

const NUMBER_CODES: NumberCodes = { missing: 'hero-missing-value', nonNumeric: 'hero-non-numeric' };

/** Reads a required numeric cell, reporting rather than substituting on failure. */
function requireNumber(
  row: RawCell[],
  column: number | undefined,
  what: string,
  sheetRow: number,
  issues: Issue[],
): number | null {
  return requireSheetNumber(row, column, what, sheetRow, issues, NUMBER_CODES);
}

/* ----------------------------------------------------------- base stats -- */

interface BaseStats {
  name: string;
  Health: number;
  Speed: number;
  Grip: number;
  MaxSpeed: number;
  SpeedIncreasePerSecond: number;
  PowerCooldown: number;
  Rarity: string;
  sheetRow: number;
}

const BASE_FIELDS: FieldName[] = [
  'heroName',
  'health',
  'speed',
  'grip',
  'maxSpeed',
  'speedIncrease',
  'powerCooldown',
  'rarity',
];

/**
 * Reads the Base Stats tab. Its row order also decides hero order in the
 * output, so the sheet owns the ordering rather than the exporter.
 */
function readBaseStats(sheet: RawSheet, issues: Issue[]): BaseStats[] {
  const { index } = resolveColumns(sheet, BASE_FIELDS, issues);
  const out: BaseStats[] = [];

  for (let r = 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    const name = index.heroName === undefined ? null : cellText(row[index.heroName]);
    if (name === null) continue;

    const where = `"${name}" on the Base Stats tab`;
    const health = requireNumber(row, index.health, `${where}: Health`, sheetRow, issues);
    const speed = requireNumber(row, index.speed, `${where}: Speed`, sheetRow, issues);
    const grip = requireNumber(row, index.grip, `${where}: Grip`, sheetRow, issues);
    const maxSpeed = requireNumber(row, index.maxSpeed, `${where}: Max Speed`, sheetRow, issues);
    const increase = requireNumber(
      row,
      index.speedIncrease,
      `${where}: Speed Increase Per Second`,
      sheetRow,
      issues,
    );
    const cooldown = requireNumber(row, index.powerCooldown, `${where}: Powerup Cooldown`, sheetRow, issues);
    const rarity = index.rarity === undefined ? null : cellText(row[index.rarity]);

    if (rarity === null) {
      issues.push({
        severity: 'error',
        code: 'hero-missing-value',
        message: `${where}: Rarity is empty.`,
        sheetRow,
      });
    }
    if (
      health === null ||
      speed === null ||
      grip === null ||
      maxSpeed === null ||
      increase === null ||
      cooldown === null ||
      rarity === null
    ) {
      continue;
    }

    out.push({
      name,
      Health: health,
      Speed: speed,
      Grip: grip,
      MaxSpeed: maxSpeed,
      SpeedIncreasePerSecond: increase,
      PowerCooldown: cooldown,
      Rarity: rarity,
      sheetRow,
    });
  }
  return out;
}

/* -------------------------------------------------------------- factors -- */

interface LevelFactor {
  level: number;
  Health: number;
  Speed: number;
  Grip: number;
  sheetRow: number;
}

const FACTOR_FIELDS: FieldName[] = [
  'heroName',
  'level',
  'healthMultiplier',
  'speedMultiplier',
  'gripMultiplier',
];

function readLevelFactors(sheet: RawSheet, issues: Issue[]): Map<string, LevelFactor[]> {
  const { index } = resolveColumns(sheet, FACTOR_FIELDS, issues);
  const byHero = new Map<string, LevelFactor[]>();

  for (let r = 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    const name = index.heroName === undefined ? null : cellText(row[index.heroName]);
    if (name === null) continue;

    const where = `"${name}" on the Stats Level Factors tab (row ${sheetRow})`;
    const level = requireNumber(row, index.level, `${where}: Level`, sheetRow, issues);
    const health = requireNumber(row, index.healthMultiplier, `${where}: Health Multiplier`, sheetRow, issues);
    const speed = requireNumber(row, index.speedMultiplier, `${where}: Speed Multiplier`, sheetRow, issues);
    const grip = requireNumber(row, index.gripMultiplier, `${where}: Grip Multiplier`, sheetRow, issues);
    if (level === null || health === null || speed === null || grip === null) continue;

    const key = normalizeName(name);
    const list = byHero.get(key) ?? [];
    list.push({ level, Health: health, Speed: speed, Grip: grip, sheetRow });
    byHero.set(key, list);
  }

  // Levels must be a complete 1..N run: a gap would silently shift every level
  // above it, which is far worse than refusing to export.
  for (const [key, list] of byHero) {
    list.sort((a, b) => a.level - b.level);
    list.forEach((entry, i) => {
      if (entry.level !== i + 1) {
        issues.push({
          severity: 'error',
          code: 'hero-level-sequence',
          message: `"${key}" has a broken level sequence on the Stats Level Factors tab: expected level ${i + 1} but found ${entry.level}. Levels must run 1 to ${list.length} with no gaps or duplicates.`,
          sheetRow: entry.sheetRow,
        });
      }
    });
  }

  return byHero;
}

/* ---------------------------------------------------------------- power -- */

const POWER_FIELDS: FieldName[] = ['heroName', 'activationDelay', 'duration'];

function parseBoolean(cell: RawCell): boolean | null {
  if (typeof cell === 'boolean') return cell;
  const text = cellText(cell);
  if (text === null) return null;
  const lowered = text.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  return null;
}

/**
 * Reads the Power Settings tab: two fixed columns, then repeating
 * `Special Param Name N` / `Special Param Input N` pairs.
 *
 * Every parameter name is checked against the schema in `powerParams.ts`, so a
 * mistyped name is reported instead of silently becoming a JSON key the game
 * will never read.
 */
function readPower(sheet: RawSheet, issues: Issue[]): Map<string, HeroPower> {
  const { headers, index } = resolveColumns(sheet, POWER_FIELDS, issues);
  const byHero = new Map<string, HeroPower>();

  // Pair columns are everything to the right of the fixed columns.
  const fixed = [index.heroName, index.activationDelay, index.duration].filter(
    (value): value is number => value !== undefined,
  );
  const firstPair = fixed.length === 0 ? 0 : Math.max(...fixed) + 1;

  for (let r = 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    const name = index.heroName === undefined ? null : cellText(row[index.heroName]);
    if (name === null) continue;

    const where = `"${name}" on the Power Settings tab`;
    const delay = requireNumber(row, index.activationDelay, `${where}: Activation Delay`, sheetRow, issues);
    const duration = requireNumber(row, index.duration, `${where}: Duration`, sheetRow, issues);
    if (delay === null || duration === null) continue;

    // Built as a loose record so a boolean parameter can be assigned by name,
    // then handed back as a HeroPower once the two fixed keys are in place.
    const power: Record<string, number | boolean> = { ActivationDelay: delay, Duration: duration };
    const seen = new Set<PowerParamName>(FIXED_POWER_PARAMS);

    for (let c = firstPair; c + 1 < headers.length; c += 2) {
      const rawName = cellText(row[c]);
      const valueCell = row[c + 1] ?? null;
      const slot = headers[c] === '' ? `column ${c + 1}` : headers[c];

      if (rawName === null) {
        // A value with no name beside it is a real mistake, not an empty slot.
        if (!isBlank(valueCell)) {
          issues.push({
            severity: 'error',
            code: 'hero-param-orphan-value',
            message: `${where}: "${slot}" holds the value ${JSON.stringify(valueCell)} but has no parameter name beside it.`,
            sheetRow,
          });
        }
        continue;
      }

      const resolved = resolvePowerParamName(rawName);
      if (resolved.status === 'unknown') {
        const hint =
          resolved.suggestion === null
            ? 'It is not one of the power parameters the game reads.'
            : `Did you mean "${resolved.suggestion}"?`;
        issues.push({
          severity: 'error',
          code: 'hero-param-unknown',
          message: `${where}: "${rawName}" is not a valid power parameter name. ${hint}`,
          sheetRow,
        });
        continue;
      }

      const canonical = resolved.name;
      if (resolved.status === 'corrected') {
        issues.push({
          severity: 'warning',
          code: 'hero-param-spelling',
          message: `${where}: "${rawName}" is spelled differently from the schema and is exported as "${canonical}".`,
          sheetRow,
        });
      }

      if (seen.has(canonical)) {
        issues.push({
          severity: 'error',
          code: 'hero-param-duplicate',
          message: `${where}: "${canonical}" is set more than once.`,
          sheetRow,
        });
        continue;
      }

      if (isBlank(valueCell)) {
        issues.push({
          severity: 'error',
          code: 'hero-param-missing-value',
          message: `${where}: "${canonical}" has no value.`,
          sheetRow,
        });
        continue;
      }

      const expected = powerParamType(canonical);
      if (expected === 'boolean') {
        const parsed = parseBoolean(valueCell);
        if (parsed === null) {
          issues.push({
            severity: 'error',
            code: 'hero-param-type',
            message: `${where}: "${canonical}" must be TRUE or FALSE, not ${JSON.stringify(valueCell)}.`,
            sheetRow,
          });
          continue;
        }
        power[canonical] = parsed;
      } else {
        const parsed = parseNumber(valueCell);
        if (!parsed.ok) {
          issues.push({
            severity: 'error',
            code: 'hero-param-type',
            message: `${where}: "${canonical}" must be a number, not ${JSON.stringify(valueCell)}.`,
            sheetRow,
          });
          continue;
        }
        power[canonical] = parsed.value;
      }

      seen.add(canonical);
    }

    byHero.set(normalizeName(name), power as HeroPower);
  }

  return byHero;
}

/* ------------------------------------------------------------ transform -- */

export interface HeroTransformInput {
  baseStats: RawSheet;
  levelFactors: RawSheet;
  powerSettings: RawSheet;
  /** Hero name -> hero ID, built from the Heroes tab. */
  heroes: LookupTable;
}

/**
 * Builds the hero config. Hero order follows the Base Stats tab; IDs always
 * come from the Heroes lookup tab and are never constructed from a name.
 */
export function transformHeroes(input: HeroTransformInput): HeroTransformResult {
  const issues: Issue[] = [];
  const bases = readBaseStats(input.baseStats, issues);
  const factors = readLevelFactors(input.levelFactors, issues);
  const powers = readPower(input.powerSettings, issues);

  const heroes: HeroEntry[] = [];
  const preview: HeroPreviewRow[] = [];
  const usedFactors = new Set<string>();
  const usedPowers = new Set<string>();

  for (const base of bases) {
    const key = normalizeName(base.name);
    const resolved = resolveLookup(input.heroes, base.name);
    if (!resolved.ok) {
      issues.push({
        severity: 'error',
        code: resolved.reason === 'ambiguous' ? 'hero-id-ambiguous' : 'hero-id-missing',
        message:
          resolved.reason === 'ambiguous'
            ? `"${base.name}" appears more than once on the Heroes tab with different IDs (${(resolved.candidates ?? []).join(', ')}).`
            : `"${base.name}" has no entry on the Heroes tab, so there is no Hero ID to export.`,
        sheetRow: base.sheetRow,
      });
      continue;
    }

    const levels = factors.get(key);
    if (levels === undefined || levels.length === 0) {
      issues.push({
        severity: 'error',
        code: 'hero-no-levels',
        message: `"${base.name}" has no rows on the Stats Level Factors tab.`,
        sheetRow: base.sheetRow,
      });
      continue;
    }
    usedFactors.add(key);

    const power = powers.get(key);
    if (power === undefined) {
      issues.push({
        severity: 'error',
        code: 'hero-no-power',
        message: `"${base.name}" has no row on the Power Settings tab.`,
        sheetRow: base.sheetRow,
      });
      continue;
    }
    usedPowers.add(key);

    const Levels: HeroLevel[] = levels.map((factor) => ({
      Health: multiplyToOneDecimal(base.Health, factor.Health),
      Speed: multiplyToOneDecimal(base.Speed, factor.Speed),
      Grip: multiplyToOneDecimal(base.Grip, factor.Grip),
    }));

    heroes.push({
      ID: resolved.id,
      MaxSpeed: base.MaxSpeed,
      SpeedIncreasePerSecond: base.SpeedIncreasePerSecond,
      Rarity: base.Rarity,
      PowerCooldown: base.PowerCooldown,
      Levels,
      Power: power,
    });

    preview.push({
      name: base.name,
      id: resolved.id,
      rarity: base.Rarity,
      maxSpeed: base.MaxSpeed,
      levelCount: Levels.length,
      first: Levels[0] ?? null,
      last: Levels[Levels.length - 1] ?? null,
      powerParams: Object.keys(power).filter(
        (param) => !FIXED_POWER_PARAMS.includes(param as PowerParamName),
      ),
      sheetRow: base.sheetRow,
    });
  }

  // Rows that never reached the output are almost always a name mismatch.
  for (const key of factors.keys()) {
    if (!usedFactors.has(key)) {
      issues.push({
        severity: 'warning',
        code: 'hero-unused-rows',
        message: `The Stats Level Factors tab has rows for "${key}", which has no Base Stats row - they were ignored.`,
      });
    }
  }
  for (const key of powers.keys()) {
    if (!usedPowers.has(key)) {
      issues.push({
        severity: 'warning',
        code: 'hero-unused-rows',
        message: `The Power Settings tab has a row for "${key}", which has no Base Stats row - it was ignored.`,
      });
    }
  }
  if (bases.length === 0) {
    issues.push({
      severity: 'error',
      code: 'hero-empty',
      message: 'The Base Stats tab contains no hero rows.',
    });
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return {
    config: { Heroes: heroes },
    preview,
    issues,
    stats: {
      heroes: heroes.length,
      levels: heroes.reduce((sum, hero) => sum + hero.Levels.length, 0),
      powerParams: preview.reduce((sum, row) => sum + row.powerParams.length, 0),
      errors,
      warnings: issues.length - errors,
    },
  };
}
