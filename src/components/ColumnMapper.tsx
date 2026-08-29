import { useId } from 'react';
import { Icon } from './Icon';
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
  note?: string;
  value: number | null;
  headers: string[];
  onChange: (index: number | null) => void;
  emptyLabel?: string;
  required?: boolean;
}

function ColumnSelect({
  label,
  note,
  value,
  headers,
  onChange,
  emptyLabel = 'Not mapped',
  required = false,
}: ColumnSelectProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const missing = required && value === null;

  return (
    <div className={missing ? 'field field--invalid' : 'field'}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value === null ? '' : String(value)}
        aria-invalid={missing || undefined}
        aria-describedby={note !== undefined || missing ? noteId : undefined}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      >
        <option value="">{emptyLabel}</option>
        {headers.map((_, index) => (
          <option key={index} value={index}>
            {optionLabel(headers, index)}
          </option>
        ))}
      </select>
      {missing ? (
        <span className="field__error" id={noteId}>
          <Icon name="alert" size={12} />
          Required - pick the column holding this value.
        </span>
      ) : note !== undefined ? (
        <span className="field__note" id={noteId}>
          {note}
        </span>
      ) : null}
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
    <div className="stack-md">
      <div className="row-between">
        <p className="step__note" style={{ margin: 0 }}>
          Columns are detected from the header row. Anything mapped wrong here shows up immediately in
          the preview.
        </p>
        <button type="button" className="btn btn--sm" onClick={onRedetect}>
          <Icon name="refresh" size={13} />
          Re-detect columns
        </button>
      </div>

      {uncertain.length > 0 && (
        <div className="banner banner--warn" role="status">
          <Icon name="alert" size={15} className="banner__icon" />
          <span>
            Detection was not confident about: <strong>{uncertain.join(', ')}</strong>. Confirm those
            below before exporting.
          </span>
        </div>
      )}

      <div className="grid-fields">
        <ColumnSelect
          label="Trophies"
          note="The trophy count that unlocks the row."
          value={mapping.trophiesIndex}
          headers={headers}
          required
          onChange={(trophiesIndex) => onChange({ ...mapping, trophiesIndex })}
        />
        <ColumnSelect
          label="Arena"
          note="The arena each milestone belongs to."
          value={mapping.arenaIndex}
          headers={headers}
          required
          onChange={(arenaIndex) => onChange({ ...mapping, arenaIndex })}
        />
      </div>

      <div>
        <p className="step__section-title">Reward slots</p>
        <p className="step__note">
          Each slot pairs a reward-name column with the column holding its amount. On the first row of
          an arena, a slot with no amount becomes that arena&apos;s unlock instead of a reward.
        </p>

        {mapping.rewardSlots.length === 0 ? (
          <p className="empty" style={{ marginBottom: 12 }}>
            No reward slots mapped yet. Add one to export rewards.
          </p>
        ) : (
          mapping.rewardSlots.map((slot, index) => (
            <div key={index} className="slot">
              <ColumnSelect
                label={`Reward ${index + 1} - name`}
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
                emptyLabel="No amount - arena unlock"
              />
              <button
                type="button"
                className="btn btn--danger-ghost"
                onClick={() => removeSlot(index)}
                aria-label={`Remove reward slot ${index + 1}`}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))
        )}

        <button
          type="button"
          className="btn"
          onClick={addSlot}
          disabled={mapping.rewardSlots.length >= headers.length}
        >
          <Icon name="plus" size={14} />
          Add reward slot
        </button>
      </div>
    </div>
  );
}
