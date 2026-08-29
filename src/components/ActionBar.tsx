import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface ActionBarProps {
  tone: 'neutral' | 'ok' | 'danger';
  message: string;
  children: ReactNode;
}

const TONE_ICON: Record<ActionBarProps['tone'], IconName> = {
  neutral: 'info',
  ok: 'check',
  danger: 'alert',
};

const TONE_COLOR: Record<ActionBarProps['tone'], string> = {
  neutral: 'var(--text-faint)',
  ok: 'var(--ok)',
  danger: 'var(--danger)',
};

/**
 * Pinned to the bottom of the workspace so the export action and the reason it
 * is or is not available stay visible however far the page is scrolled.
 */
export function ActionBar({ tone, message, children }: ActionBarProps) {
  return (
    <div className="actionbar">
      <p className="actionbar__status">
        <span style={{ color: TONE_COLOR[tone], display: 'inline-flex' }}>
          <Icon name={TONE_ICON[tone]} size={15} />
        </span>
        <span aria-live="polite">{message}</span>
      </p>
      <div className="actionbar__actions">{children}</div>
    </div>
  );
}
