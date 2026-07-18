import { useState } from 'react';
import { bootstrap } from '../services/authClient';
import { useAuth } from '../context/AuthContext';
import { AuthLayout, AuthInput, AuthError, AuthSubmit } from './AuthLayout';

// Shown only while the users table is empty. Creates the very first account, always Admin —
// there's nobody yet to invite them, and only an Admin can invite another Admin, a Senior, or an
// Intern.
export const BootstrapScreen = () => {
  const { refreshCurrentUser } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await bootstrap(form);
      await refreshCurrentUser();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Set up your account" subtitle="No accounts exist yet — you'll be the first Admin.">
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
