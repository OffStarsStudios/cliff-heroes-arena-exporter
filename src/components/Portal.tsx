import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children at the end of `<body>`.
 *
 * Modals need this for a reason that is easy to miss: `.page` animates a
 * transform, and an element with a transform - even a finished one held by
 * `animation-fill-mode: both` - becomes the containing block for every
 * `position: fixed` descendant. A dialog written as `position: fixed; inset: 0`
 * was therefore not covering the window at all. It was covering the page
 * column, which starts under the top bar and stops at the reading width, so the
 * dialog's own header sat behind the app's.
 *
 * Escaping to `<body>` fixes it at the root rather than by unpicking the
 * animation, and it is what a dialog wants anyway: nothing in the page can clip
 * it, overflow it, or stack above it.
 */
export function Portal({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement | null>(null);

  if (host.current === null && typeof document !== 'undefined') {
    host.current = document.createElement('div');
    host.current.className = 'portal';
  }

  // A layout effect, so the host is in the document before its children's
  // parents lay out: a menu measures itself against the window to stay on
  // screen, and a node outside the document measures as nothing and cannot
  // take focus.
  useLayoutEffect(() => {
    const node = host.current;
    if (node === null) return;
    document.body.appendChild(node);
    return () => {
      node.remove();
    };
  }, []);

  return host.current === null ? null : createPortal(children, host.current);
}
