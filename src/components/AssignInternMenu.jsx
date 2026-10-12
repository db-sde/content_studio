import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, UserX } from 'lucide-react';

// Dropdown a Senior/Admin uses to hand a draft to an Intern - shows who owns the draft right now
// and opens a list of active interns to reassign it to. The menu is positioned with `fixed` from
// the trigger's on-screen rect rather than `absolute` inside it: the Saved Drafts table lives in an
// overflow-x scroll container, which would clip an absolutely positioned dropdown on the last rows.
//
// `loadInterns` fetches the list each time the menu opens (cheap, and picks up a newly invited
// intern without a page reload); `onAssign(userId, internName)` performs the assignment and is
// expected to surface its own error toast and then throw, so this menu stays open on failure.
export const AssignInternMenu = ({ ownerName, ownerUserId, isAssigned, loadInterns, onAssign, variant = 'table' }) => {
  const [open, setOpen] = useState(false);
  const [interns, setInterns] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onOutsideClick = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // Anything that moves the trigger would leave a fixed menu floating in the wrong place - but
    // scrolling the menu's own list must not count.
    const onMove = (e) => {
      if (e.target && menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onOutsideClick);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const toggle = async (e) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }

    const rect = triggerRef.current.getBoundingClientRect();
    const MENU_WIDTH = 224;
    const flipUp = rect.bottom + 280 > window.innerHeight;
    setPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)),
      ...(flipUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 })
    });
    setError('');
    setOpen(true);
    try {
      setInterns(await loadInterns());
    } catch (err) {
      setError(err.message || 'Could not load interns');
    }
  };

  const choose = async (userId, name) => {
    setBusy(true);
    try {
      await onAssign(userId, name);
      setOpen(false);
    } catch {
      // onAssign already told the user what went wrong - just leave the menu open to retry.
    } finally {
      setBusy(false);
    }
  };

  const triggerStyle = variant === 'header'
    ? 'text-white font-bold hover:bg-white/10 rounded px-1.5 py-0.5 -mx-1'
    : 'text-xs font-bold text-navy hover:bg-navy-soft rounded px-1.5 py-1 -mx-1.5';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        title="Assign to an intern"
        className={`inline-flex items-center gap-1 transition-colors ${triggerStyle}`}
      >
        {ownerName || 'Unassigned'}
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>

      {open && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', width: 224, ...pos }}
          className="z-[70] bg-white border border-border rounded-lg shadow-premium-hover overflow-hidden text-left"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted border-b border-border">
            Assign to intern
          </p>
          <div className="max-h-56 overflow-y-auto styled-scrollbar">
            {error ? (
              <p className="px-3 py-3 text-xs text-danger">{error}</p>
            ) : interns === null ? (
              <p className="px-3 py-3 text-xs text-muted">Loading…</p>
            ) : interns.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted">No active interns yet - invite one from the user menu.</p>
            ) : (
              interns.map(intern => (
                <button
                  key={intern.id}
                  type="button"
                  disabled={busy}
                  onClick={() => choose(intern.id, intern.name)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-navy hover:bg-off disabled:opacity-50 transition-colors"
                >
                  <span className="truncate">{intern.name}</span>
                  {intern.id === ownerUserId && <Check className="w-3.5 h-3.5 text-green-success shrink-0" />}
                </button>
              ))
            )}
          </div>
          {isAssigned && (
            <button
              type="button"
              disabled={busy}
              onClick={() => choose(null, null)}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted hover:text-navy hover:bg-off border-t border-border disabled:opacity-50 transition-colors"
              title="Remove the assignment - the draft goes back to whoever created it"
            >
              <UserX className="w-3.5 h-3.5" />
              Clear assignment
            </button>
          )}
        </div>
      )}
    </>
  );
};
