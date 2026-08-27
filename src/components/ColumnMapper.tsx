import { useId } from 'react';
import { columnLetter } from '../lib/columnDetect';
import type { ColumnMapping, ColumnRole, RewardSlot } from '../lib/types';

interface ColumnMapperProps {
  headers: string[];
  mapping: ColumnMapping;
  uncertain: ColumnRole[];
  onChange: (mapping: ColumnMapping) => void;
  onRedetect: () => void;
}

function optionLabel(headers: string[], index: number): string {
  const header = headers[index]?.trim();
  return header ? `${columnLetter(index)} - ${header}` : `${columnLetter(index)} - (no header)`;
}

interface ColumnSelectProps {
  label: string;
  value: number | null;
  headers: string[];
  onChange: (index: number | null) => void;
  emptyLabel?: string;
}

function ColumnSelect({ label, value, headers, onChange, emptyLabel = 'Not mapped' }: ColumnSelectProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value === null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      >
        <option value="">{emptyLabel}</option>
        {headers.map((_, index) => (
          <option key={index} value={index}>
            {optionLabel(headers, index)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ColumnMapper({ headers, mapping, uncertain, onChange, onRedetect }: ColumnMapperProps) {
  const updateSlot = (position: number, patch: Partial<RewardSlot>) => {
    const rewardSlots = mapping.rewardSlots.map((slot, index) =>
      index === position ? { ...slot, ...patch } : slot,
    );
    onChange({ ...mapping, rewardSlots });
  };

  const removeSlot = (position: number) => {
    onChange({
      ...mapping,
      rewardSlots: mapping.rewardSlots.filter((_, index) => index !== position),
    });
  };

  const addSlot = () => {
    const used = new Set(mapping.rewardSlots.map((slot) => slot.nameIndex));
    const nameIndex = headers.findIndex((_, index) => !used.has(index));
    if (nameIndex < 0) return;
    onChange({
      ...mapping,
      rewardSlots: [
        ...mapping.rewardSlots,
        {
          nameIndex,
          amountIndex: null,
          label: headers[nameIndex]?.trim() || `Column ${columnLetter(nameIndex)}`,
        },
      ],
    });
  };

  return (
    <section className="card">
      <header className="card__header">
        <h2 className="card__title">Column mapping</h2>
        <button type="button" className="btn btn--ghost" onClick={onRedetect}>
          Re-detect
        </button>
      </header>
      <div className="card__body">
        {uncertain.length > 0 && (
          <div className="banner banner--error" role="status" style={{ marginBottom: 16 }}>
            <span aria-hidden="true">⚠</span>
            <span>
              Automatic detection was not confident about: {uncertain.join(', ')}. Assign the columns
              below.
            </span>
          </div>
        )}

        <div className="grid-fields">
          <ColumnSelect
            label="Trophies"
            value={mapping.trophiesIndex}
            headers={headers}
            onChange={(trophiesIndex) => onChange({ ...mapping, trophiesIndex })}
          />
          <ColumnSelect
            label="Arena"
            value={mapping.arenaIndex}
            headers={headers}
            onChange={(arenaIndex) => onChange({ ...mapping, arenaIndex })}
          />
        </div>

        <p className="field__label" style={{ margin: '20px 0 10px' }}>
          Reward slots
        </p>
        <p className="field__note" style={{ marginBottom: 12 }}>
          Each slot is a reward-name column plus the column holding its amount. On the first row of an
          arena, slots with no amount become that arena&apos;s unlocks.
        </p>

        {mapping.rewardSlots.length === 0 && (
          <p className="field__note">No reward slots mapped yet.</p>
        )}

        {mapping.rewardSlots.map((slot, index) => (
          <div
            key={index}
            style={{
              alignItems: 'end',
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto',
              marginBottom: 12,
            }}
          >
            <ColumnSelect
              label={`Reward ${index + 1}`}
              value={slot.nameIndex}
              headers={headers}
              onChange={(nameIndex) => {
                if (nameIndex === null) removeSlot(index);
                else
                  updateSlot(index, {
                    nameIndex,
                    label: headers[nameIndex]?.trim() || `Column ${columnLetter(nameIndex)}`,
                  });
              }}
              emptyLabel="Remove this slot"
            />
            <ColumnSelect
              label="Amount"
              value={slot.amountIndex}
              headers={headers}
              onChange={(amountIndex) => updateSlot(index, { amountIndex })}
              emptyLabel="No amount column"
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => removeSlot(index)}
              aria-label={`Remove reward slot ${index + 1}`}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          type="button"
          className="btn"
          onClick={addSlot}
          disabled={mapping.rewardSlots.length >= headers.length}
        >
          Add reward slot
        </button>
      </div>
    </section>
  );
}
