import { useId } from 'react';
import type { HeroSheetSelection } from '../lib/sheetSelect';

interface HeroSheetPickerProps {
  sheetNames: string[];
  selection: HeroSheetSelection;
  onChange: (selection: HeroSheetSelection) => void;
  sourceName: string;
  onReset: () => void;
}

interface SelectFieldProps {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
}

function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">Not selected</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function HeroSheetPicker({
  sheetNames,
  selection,
  onChange,
  sourceName,
  onReset,
}: HeroSheetPickerProps) {
  return (
    <section className="card">
      <header className="card__header">
        <h2 className="card__title">Sheet selection</h2>
        <span className="card__hint">{sheetNames.length} tabs found</span>
      </header>
      <div className="card__body">
        <div className="source-line" style={{ marginBottom: 16 }}>
          <span>
            Loaded <strong>{sourceName}</strong>
          </span>
          <button type="button" className="btn btn--ghost" onClick={onReset}>
            Load another file
          </button>
        </div>

        <div className="grid-fields">
          <SelectField
            label="Heroes lookup"
            value={selection.heroes}
            options={sheetNames}
            onChange={(heroes) => onChange({ ...selection, heroes })}
          />
          <SelectField
            label="Base stats"
            value={selection.baseStats}
            options={sheetNames}
            onChange={(baseStats) => onChange({ ...selection, baseStats })}
          />
          <SelectField
            label="Stats level factors"
            value={selection.levelFactors}
            options={sheetNames}
            onChange={(levelFactors) => onChange({ ...selection, levelFactors })}
          />
          <SelectField
            label="Power settings"
            value={selection.powerSettings}
            options={sheetNames}
            onChange={(powerSettings) => onChange({ ...selection, powerSettings })}
          />
        </div>
      </div>
    </section>
  );
}
