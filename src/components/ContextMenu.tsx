import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Portal } from './Portal';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  /** Why it cannot be chosen right now. Shown under the label, so a greyed item never leaves anyone guessing. */
  disabledReason?: string | null;
  /** Draws a rule above the item, to keep a destructive action apart from the rest. */
  separated?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  /** Where the pointer was, in viewport pixels. */
  x: number;
  y: number;
  /** Names the menu for a screen reader, and heads it on screen. */
  title: string;
  subtitle?: ReactNode;
  items: ContextMenuItem[];
  /**
   * Opened from the keyboard: focus goes straight to the first item. From a
   * pointer the menu itself takes focus, so no item looks picked before the
   * pointer reaches it - an arrow key still starts at the top.
   */
  focusFirst: boolean;
  /** `restoreFocus` is true when the menu was left from the keyboard or by choosing an item. */
  onClose: (restoreFocus: boolean) => void;
}

/** Kept clear of the window's edges, so a menu opened in a corner is never cut off. */
const EDGE = 8;

/**
 * A right-click menu.
 *
 * Opens where the pointer is, flipped back inside the window when it would run
 * off an edge, and behaves like a menu from the keyboard: arrows move between
 * items, Escape closes and returns focus. Anything outside it
 * - a click, a scroll, the window losing focus - closes it, because a menu left
 * hanging over a calendar that has moved underneath it points at the wrong
 * thing.
 */
export function ContextMenu({ x, y, title, subtitle, items, focusFirst, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    // Offset sizes, not the bounding box: the opening animation scales the menu down.
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = x + width + EDGE > window.innerWidth ? Math.max(EDGE, x - width) : x;
    const top = y + height + EDGE > window.innerHeight ? Math.max(EDGE, y - height) : y;
    setPosition({ left, top });
    (focusFirst ? (menu.querySelector<HTMLElement>('[role="menuitem"]') ?? menu) : menu).focus({ preventScroll: true });
  }, [x, y, focusFirst]);

  useEffect(() => {
    const outside = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node) === true) return;
      onClose(false);
    };
    const dismiss = () => onClose(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('wheel', outside, true);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('wheel', outside, true);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => entries[(index + entries.length) % entries.length]?.focus();

    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at === -1 ? entries.length - 1 : at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(entries.length - 1);
    else if (event.key === 'Escape' || event.key === 'Tab') onClose(true);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Portal>
      <div
        ref={menuRef}
        className="ctxmenu"
        role="menu"
        aria-label={title}
        tabIndex={-1}
        style={{ left: position.left, top: position.top }}
        onKeyDown={onKeyDown}
        // A right click on the menu itself must not open the browser's own on top of it.
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="ctxmenu__head" aria-hidden="true">
          <span className="ctxmenu__title">{title}</span>
          {subtitle !== undefined && <span className="ctxmenu__subtitle">{subtitle}</span>}
        </div>
        {items.map((item) => {
          const disabled = item.disabledReason !== undefined && item.disabledReason !== null;
          return (
            <div key={item.id} role="none">
              {item.separated === true && <div className="ctxmenu__rule" role="separator" />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                // Disabled items stay focusable, so the reason under them can be read.
                aria-disabled={disabled || undefined}
                className={[
                  'ctxmenu__item',
                  item.danger === true ? 'ctxmenu__item--danger' : '',
                  disabled ? 'ctxmenu__item--disabled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  if (disabled) return;
                  onClose(true);
                  item.onSelect();
                }}
              >
                <Icon name={item.icon} size={14} className="ctxmenu__icon" />
                <span className="ctxmenu__label">
                  {item.label}
                  {disabled && <span className="ctxmenu__reason">{item.disabledReason}</span>}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </Portal>
  );
}
