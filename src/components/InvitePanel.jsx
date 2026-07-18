import { useState } from 'react';
import { createInvite } from '../services/authClient';

// Mirrors the server's INVITE_PERMISSIONS in server/routes/auth.js — this only controls which
// buttons render; the actual rule is enforced server-side regardless of what this shows.
const INVITABLE_ROLES = {
  intern: [{ role: 'intern', label: 'Invite Intern' }],
  senior: [{ role: 'intern', label: 'Invite Intern' }, { role: 'senior', label: 'Invite Senior' }],
  admin: [{ role: 'intern', label: 'Invite Intern' }, { role: 'senior', label: 'Invite Senior' }, { role: 'admin', label: 'Invite Admin' }]
};

// Small popover off the user badge — the only way anyone gets into this app is via a link
// generated here (no self-signup), so this is a required piece of the auth flow, not a nicety.
export const InvitePanel = ({ role, onClose }) => {
  const [link, setLink] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = async (inviteRole) => {
    setError('');
    try {
      const { token } = await createInvite(inviteRole);
      setLink(`${window.location.origin}/invite/${token}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="absolute top-full right-0 mt-2 w-72 bg-white border border-border rounded-xl shadow-premium-hover p-4 text-sm z-50">
      <div className="flex justify-between items-center mb-3">
        <span className="font-bold text-navy">Invite someone</span>
        <button type="button" onClick={onClose} className="text-muted hover:text-navy">✕</button>
      </div>

      {!link && (
        <div className="flex gap-2">
          {(INVITABLE_ROLES[role] || INVITABLE_ROLES.intern).map(({ role: inviteRole, label }) => (
            <button
              key={inviteRole}
              type="button"
              onClick={() => generate(inviteRole)}
              className="flex-1 py-1.5 rounded-lg border border-border text-xs font-semibold text-navy hover:bg-navy-soft hover:border-navy/20 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs font-semibold text-danger mt-2">{error}</p>}

      {link && (
        <div>
          <p className="text-xs text-muted mb-2">Share this link — it works once and expires in 48 hours.</p>
          <div className="flex gap-1.5">
            <input readOnly value={link} className="flex-1 min-w-0 px-2 py-1.5 border border-border rounded-lg bg-off text-xs text-navy" />
            <button
              type="button"
              onClick={copy}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                copied ? 'bg-green-success text-white' : 'bg-navy text-white hover:bg-navy-hover'
              }`}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
