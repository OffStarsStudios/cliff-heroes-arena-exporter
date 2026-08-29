import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';

export type StepStatus = 'done' | 'current' | 'blocked' | 'pending';

export type ChipTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger';

interface ChipProps {
  tone?: ChipTone;
  children: ReactNode;
}

export function Chip({ tone = 'neutral', children }: ChipProps) {
  return <span className={`chip chip--${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<StepStatus, ChipTone> = {
  done: 'ok',
  current: 'info',
  blocked: 'danger',
  pending: 'neutral',
};

const STATUS_LABEL: Record<StepStatus, string> = {
  done: 'Ready',
  current: 'In progress',
  blocked: 'Needs attention',
  pending: 'Waiting',
};

interface StepProps {
  /** 1-based position, shown in the marker until the step is complete. */
  index: number;
  title: string;
  hint?: string;
  status: StepStatus;
  /** Overrides the default status chip text, e.g. "3 tabs selected". */
  statusLabel?: string;
  open: boolean;
  onToggle: () => void;
  /** Steps that cannot be opened yet - the previous step is unresolved. */
  locked?: boolean;
  children: ReactNode;
}

/**
 * One stage of the converter. The whole header is the disclosure control so the
 * hit target is a full row rather than a small chevron.
 */
export function Step({
  index,
  title,
  hint,
  status,
  statusLabel,
  open,
  onToggle,
  locked = false,
  children,
}: StepProps) {
  const bodyId = useId();
  const isOpen = open && !locked;

  return (
    <section className={`step step--${status}`}>
      <h3 style={{ margin: 0 }}>
        <button
          type="button"
          className="step__head"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={onToggle}
          disabled={locked}
        >
          <span className="step__marker" aria-hidden="true">
            {status === 'done' ? <Icon name="check" size={14} /> : index}
          </span>
          <span className="step__titles">
            <span className="step__title">{title}</span>
            {hint !== undefined && <span className="step__hint">{hint}</span>}
          </span>
          <span className="step__tail">
            <span className={`chip chip--${STATUS_TONE[status]}`}>
              {statusLabel ?? STATUS_LABEL[status]}
            </span>
            <Icon name="chevron" size={16} className="step__chevron" />
          </span>
        </button>
      </h3>
      {isOpen && (
        <div className="step__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
