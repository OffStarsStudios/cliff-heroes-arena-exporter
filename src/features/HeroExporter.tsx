import { useEffect, useMemo, useState } from 'react';
import { HeroSheetPicker } from '../components/HeroSheetPicker';
import { HeroPreviewTable } from '../components/HeroPreviewTable';
import { HeroSummaryCard, IssueList } from '../components/SummaryCard';
import { JsonOutput } from '../components/JsonOutput';
import { buildLookup } from '../lib/lookups';
import { autoSelectHeroSheets, type HeroSheetSelection } from '../lib/sheetSelect';
import { transformHeroes } from '../lib/heroes';
import { serializeHeroesConfig, validateHeroesConfig } from '../lib/validateHeroes';
import { POWER_PARAM_NAMES } from '../lib/powerParams';
import type { HeroTransformResult, Issue, RawSheet, RawWorkbook } from '../lib/types';

const DOWNLOAD_FILENAME = 'heroes.json';

interface HeroExporterProps {
  workbook: RawWorkbook;
  onReset: () => void;
}

function findSheet(workbook: RawWorkbook, name: string | null): RawSheet | null {
  if (name === null) return null;
  return workbook.sheets.find((sheet) => sheet.name === name) ?? null;
}

const TAB_LABELS: Record<keyof HeroSheetSelection, string> = {
  heroes: 'Heroes lookup',
  baseStats: 'Base stats',
  levelFactors: 'Stats level factors',
  powerSettings: 'Power settings',
};

/** The parameter names the sheet is allowed to use, shown as a reference. */
function ParamReference() {
  return (
    <section className="card">
      <header className="card__header">
        <h2 className="card__title">Valid power parameters</h2>
        <span className="card__hint">{POWER_PARAM_NAMES.length} names</span>
      </header>
      <div className="card__body">
        <p className="card__hint" style={{ marginBottom: 10 }}>
          Special parameter names are checked against this list. Case and spacing do not matter -
          anything else is reported as an error rather than exported.
        </p>
        <p className="mono" style={{ lineHeight: 1.8, fontSize: 12 }}>
          {POWER_PARAM_NAMES.join(', ')}
        </p>
      </div>
    </section>
  );
}

export function HeroExporter({ workbook, onReset }: HeroExporterProps) {
  const [selection, setSelection] = useState<HeroSheetSelection>(() => autoSelectHeroSheets(workbook));
  const [generated, setGenerated] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  useEffect(() => {
    setSelection(autoSelectHeroSheets(workbook));
    setGenerated(null);
    setSchemaError(null);
  }, [workbook]);

  const analysis: { result: HeroTransformResult | null; issues: Issue[] } = useMemo(() => {
    const sheets = {
      heroes: findSheet(workbook, selection.heroes),
      baseStats: findSheet(workbook, selection.baseStats),
      levelFactors: findSheet(workbook, selection.levelFactors),
      powerSettings: findSheet(workbook, selection.powerSettings),
    };

    const issues: Issue[] = [];
    for (const key of Object.keys(TAB_LABELS) as (keyof HeroSheetSelection)[]) {
      if (sheets[key] === null) {
        issues.push({
          severity: 'error',
          code: 'missing-hero-tab',
          message: `Select the ${TAB_LABELS[key]} tab to continue.`,
        });
      }
    }
    if (
      sheets.heroes === null ||
      sheets.baseStats === null ||
      sheets.levelFactors === null ||
      sheets.powerSettings === null
    ) {
      return { result: null, issues };
    }

    const heroes = buildLookup(sheets.heroes, 'hero');
    const result = transformHeroes({
      baseStats: sheets.baseStats,
      levelFactors: sheets.levelFactors,
      powerSettings: sheets.powerSettings,
      heroes: heroes.table,
    });

    const combined = [...issues, ...heroes.issues, ...result.issues];
    const errors = combined.filter((issue) => issue.severity === 'error').length;

    return {
      result: {
        ...result,
        issues: combined,
        stats: { ...result.stats, errors, warnings: combined.length - errors },
      },
      issues: combined,
    };
  }, [workbook, selection]);

  const errorCount = analysis.issues.filter((issue) => issue.severity === 'error').length;
  const canGenerate = analysis.result !== null && errorCount === 0 && analysis.result.stats.heroes > 0;

  const generate = () => {
    if (analysis.result === null) return;
    // Independent schema check before anything can be copied or downloaded.
    const schemaIssues = validateHeroesConfig(analysis.result.config);
    if (schemaIssues.length > 0) {
      setGenerated(null);
      setSchemaError(schemaIssues.map((issue) => issue.message).join(' '));
      return;
    }
    setSchemaError(null);
    setGenerated(serializeHeroesConfig(analysis.result.config));
  };

  return (
    <div className="columns">
      <div className="stack">
        <HeroSheetPicker
          sheetNames={workbook.sheets.map((sheet) => sheet.name)}
          selection={selection}
          onChange={(next) => {
            setSelection(next);
            setGenerated(null);
          }}
          sourceName={workbook.sourceName}
          onReset={onReset}
        />

        {analysis.result !== null && <HeroSummaryCard result={analysis.result} />}

        {schemaError !== null && <p className="error-text">{schemaError}</p>}

        <IssueList issues={analysis.issues} severity="error" title="Validation errors" />
        <IssueList issues={analysis.issues} severity="warning" title="Warnings" />

        <ParamReference />

        <button type="button" className="btn btn--primary btn--large" onClick={generate} disabled={!canGenerate}>
          {errorCount > 0 ? `Fix ${errorCount} error${errorCount === 1 ? '' : 's'} to generate` : 'Generate JSON'}
        </button>
      </div>

      <div className="stack">
        {generated !== null ? (
          <JsonOutput json={generated} filename={DOWNLOAD_FILENAME} />
        ) : (
          <section className="card card--muted">
            <header className="card__header">
              <h2 className="card__title">Generated JSON</h2>
            </header>
            <div className="card__body">
              <p className="empty">
                {errorCount > 0
                  ? 'Resolve the validation errors on the left - no partial JSON is produced while a parameter name or lookup is failing.'
                  : 'Review the parsed heroes below, then press Generate JSON.'}
              </p>
            </div>
          </section>
        )}

        {analysis.result !== null && <HeroPreviewTable rows={analysis.result.preview} />}
      </div>
    </div>
  );
}
