import { useEffect, useRef } from 'react';

// How often the app re-checks the server while someone is actually using it. Every poll is a real
// database round trip, and the database (Neon) is billed on how long it's awake and how much data
// leaves it - so this was raised from 12s, and polling now also stops entirely whenever nobody is
// looking (see useActivePolling).
export const POLL_INTERVAL_MS = 30 * 1000;

// The Saved Drafts list is the heaviest thing polled (it carries every draft and grows with each
// one) and it legitimately changes whenever anyone is typing - every autosave bumps a draft's
// "Last Edited" - so the server's "nothing changed" shortcut helps less here than for notifications.
// A minute is plenty for a table of statuses; notifications, which drive the pop-ups, stay at 30s.
export const LIST_POLL_INTERVAL_MS = 60 * 1000;

// Counts and sums that only matter on one screen change slowly - no reason to fetch them every poll.
export const SLOW_POLL_INTERVAL_MS = 5 * 60 * 1000;

// No click/key/scroll/mouse movement for this long counts as "walked away" - a browser tab left open
// overnight or over a weekend used to keep hitting the database (and keep it awake) around the clock.
const IDLE_AFTER_MS = 10 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

// Calls `callback` immediately and then every `intervalMs` - but only while the tab is visible AND
// the user has done something within the last IDLE_AFTER_MS. The moment they come back (switch back
// to the tab, or touch the mouse/keyboard after being idle) it fires once straight away, so nothing
// looks stale after a gap, then resumes the normal interval.
//
// `immediate: false` skips the call on mount, for a poll whose data was literally just loaded.
//
// `callback` may change every render; it's read through a ref so the timer isn't torn down and
// restarted each time (which would reset the countdown and could starve the poll entirely).
export function useActivePolling(callback, intervalMs, { enabled = true, immediate = true } = {}) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return undefined;

    let lastActivity = Date.now();
    const isActive = () => document.visibilityState === 'visible' && Date.now() - lastActivity < IDLE_AFTER_MS;
    const run = () => callbackRef.current();

    const onActivity = () => {
      const wasIdle = Date.now() - lastActivity >= IDLE_AFTER_MS;
      lastActivity = Date.now();
      if (wasIdle && document.visibilityState === 'visible') run();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      lastActivity = Date.now();
      run();
    };

    if (immediate) run();
    const timer = setInterval(() => { if (isActive()) run(); }, intervalMs);
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timer);
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled, immediate]);
}
