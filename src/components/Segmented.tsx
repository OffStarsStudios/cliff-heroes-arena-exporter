import type { CSSProperties, ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedProps<T extends string> {
  /** Accessible name for the group, e.g. "Environment". */
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * A two-or-three-way switch. The selected pill is one element that slides
 * between the options rather than a background that blinks from button to
 * button, so the eye follows the change instead of re-finding it.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedProps<T>) {
  const activeIndex = options.findIndex((option) => option.value === value);

  const style = {
    '--seg-count': options.length,
    '--seg-active': Math.max(activeIndex, 0),
  } as CSSProperties;

  return (
    <div className="segmented" role="group" aria-label={label} style={style}>
      {/* Hidden until something is selected, so an unset switch shows no pill. */}
      <span className={`segmented__thumb${activeIndex < 0 ? ' segmented__thumb--none' : ''}`} aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
