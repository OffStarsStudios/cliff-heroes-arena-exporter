import { useEffect, useRef, type RefObject } from 'react';

/** Sideways travel, in pixels, that turns one page: about one notch of a thumb wheel. */
const STEP_PX = 80;
/** After a page turns, the rest of that flick is swallowed for this long, so one flick is one page. */
const SETTLE_MS = 280;
/** A pause this long starts a fresh gesture, so stray nudges minutes apart never add up to a page. */
const GESTURE_GAP_MS = 180;

/** Pixels per line for a wheel that reports lines rather than pixels (Firefox, some mice). */
const LINE_PX = 16;

/**
 * Turns sideways scrolling over an element into paging: scroll right for the
 * next page, left for the previous one.
 *
 * For a mouse with a thumb wheel (an MX Master), a trackpad's two-finger swipe,
 * and shift + wheel, which browsers on Windows report as sideways. Vertical
 * scrolling is left alone, so the page still scrolls over the element.
 *
 * Wheel deltas arrive in small, uneven pieces and keep coming after a flick, so
 * they are added up to a threshold, and a turn is followed by a short settle.
 * A long, steady roll still turns page after page.
 *
 * The listener is attached natively rather than through React because React's
 * wheel listeners are passive: only a non-passive one can stop the browser
 * treating a sideways swipe as Back or Forward.
 */
export function useSideScrollPaging(ref: RefObject<HTMLElement>, onStep: ((step: -1 | 1) => void) | undefined) {
  const latest = useRef(onStep);
  useEffect(() => {
    latest.current = onStep;
  }, [onStep]);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;

    let travel = 0;
    let lastAt = -Infinity;
    let settledUntil = -Infinity;

    const onWheel = (event: WheelEvent) => {
      const step = latest.current;
      // Ctrl + wheel is a pinch or a zoom, never a page turn.
      if (step === undefined || event.ctrlKey) return;
      const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? node.clientWidth : 1;
      const dx = event.deltaX * scale;
      if (Math.abs(dx) <= Math.abs(event.deltaY * scale)) return;
      event.preventDefault();

      const at = event.timeStamp;
      const quiet = at - lastAt > GESTURE_GAP_MS;
      lastAt = at;
      if (at < settledUntil) return;
      if (quiet || Math.sign(dx) !== Math.sign(travel)) travel = 0;

      travel += dx;
      if (Math.abs(travel) >= STEP_PX) {
        step(travel > 0 ? 1 : -1);
        travel = 0;
        settledUntil = at + SETTLE_MS;
      }
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [ref]);
}
