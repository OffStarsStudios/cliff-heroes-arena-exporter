import { useEffect, useState, type InputHTMLAttributes } from 'react';

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;
  onChange: (next: number) => void;
  /** Whole numbers only. */
  integer?: boolean;
  /** The number an empty box stands for. */
  emptyValue?: number;
  /** A number drawn as an empty box, e.g. 0 where 0 means "not set yet". */
  blankWhen?: number;
}

/**
 * A number box that can be emptied.
 *
 * Bound straight to a number, a box cannot hold nothing: clearing it reports 0,
 * the 0 is written back into the box, and the next key lands after it - which
 * is how 75 came out as 075. So the box keeps the text being typed, reports the
 * number that text reads as, and only takes a number back from outside when it
 * is not what the text already says. Leaving the box tidies the text.
 */
export function NumberInput({
  value,
  onChange,
  integer = false,
  emptyValue = 0,
  blankWhen,
  onBlur,
  step,
  ...rest
}: NumberInputProps) {
  const shown = (number: number) => (!Number.isFinite(number) || number === blankWhen ? '' : String(number));
  const read = (text: string) => {
    if (text.trim() === '') return emptyValue;
    const number = integer ? Number.parseInt(text, 10) : Number(text);
    return Number.isNaN(number) ? emptyValue : number;
  };

  const [text, setText] = useState(() => shown(value));

  useEffect(() => {
    if (!Object.is(read(text), value)) setText(shown(value));
    // Only a new value from outside is worth reacting to; the text is ours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      step={step ?? (integer ? 1 : 'any')}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(read(event.target.value));
      }}
      onBlur={(event) => {
        setText(shown(read(text)));
        onBlur?.(event);
      }}
    />
  );
}
