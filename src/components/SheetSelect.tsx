import { useId } from 'react';
import { Icon } from './Icon';

interface SheetSelectProps {
  label: string;
  /** Plain-language description of what this tab has to contain. */
  note: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
}

/**
 * A tab picker with its purpose spelled out under the control, and an inline
 * error when it is still unset - the exporter cannot run without it.
 */
export function SheetSelect({ label, note, value, options, onChange }: SheetSelectProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const noteId = `${id}-note`;
  const missing = value === null;

  return (
    <div className={missing ? 'field field--invalid' : 'field'}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        aria-invalid={missing}
        aria-describedby={missing ? `${noteId} ${errorId}` : noteId}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">Pick a tab...</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {missing ? (
        <span className="field__error" id={errorId}>
          <Icon name="alert" size={12} />
          Required - pick the tab that holds this data.
        </span>
      ) : null}
      <span className="field__note" id={noteId}>
        {note}
      </span>
    </div>
  );
}
