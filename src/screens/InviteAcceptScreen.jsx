import { useEffect, useState } from 'react';
import { getInvite, acceptInvite } from '../services/authClient';
import { useAuth } from '../context/AuthContext';
import { AuthLayout, AuthInput, AuthError, AuthSubmit } from './AuthLayout';

const ROLE_PHRASES = { intern: 'an Intern', senior: 'a Senior Content Writer', admin: 'an Admin' };

export const InviteAcceptScreen = ({ token }) => {
  const { refreshCurrentUser } = useAuth();
  const [role, setRole] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getInvite(token).then(({ role }) => setRole(role)).catch(() => setInvalid(true));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await acceptInvite(token, form);
      // The top-level route gate (App.jsx) matches /invite/:token unconditionally, ahead of
      // auth status, so it never lets go of this screen unless the URL itself changes — clear it
      // before refreshing the current user so the gate falls through to the logged-in app tree.
      window.history.replaceState(null, '', '/');
      await refreshCurrentUser();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (invalid) {
    return (
      <AuthLayout title="Invite link invalid">
        <p className="text-sm text-muted">This invite link is invalid or has already been used. Ask whoever sent it to generate a new one.</p>
      </AuthLayout>
    );
  }

  if (!role) return null;

  return (
    <AuthLayout title="Join DegreeBaba Content Studio" subtitle={`You've been invited as ${ROLE_PHRASES[role]}.`}>
      <form onSubmit={handleSubmit}>
        <AuthInput label="Name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <AuthInput label="Email" type="email" placeholder="you@degreebaba.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <AuthInput label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required />
        <AuthError message={error} />
        <AuthSubmit loading={loading}>Create account</AuthSubmit>
      </form>
    </AuthLayout>
  );
};
