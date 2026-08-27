import { useId } from 'react';
import type { SheetSelection } from '../lib/sheetSelect';

interface SheetPickerProps {
  sheetNames: string[];
  selection: SheetSelection;
  onChange: (selection: SheetSelection) => void;
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

export function SheetPicker({ sheetNames, selection, onChange, sourceName, onReset }: SheetPickerProps) {
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
            label="Progression"
            value={selection.progression}
            options={sheetNames}
            onChange={(progression) => onChange({ ...selection, progression })}
          />
          <SelectField
            label="Arenas lookup"
            value={selection.arenas}
            options={sheetNames}
            onChange={(arenas) => onChange({ ...selection, arenas })}
          />
          <SelectField
            label="Rewards lookup"
            value={selection.rewards}
            options={sheetNames}
            onChange={(rewards) => onChange({ ...selection, rewards })}
          />
        </div>
      </div>
    </section>
  );
}
