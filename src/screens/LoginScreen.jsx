import { useState } from 'react';
import { login } from '../services/authClient';
import { useAuth } from '../context/AuthContext';
import { AuthLayout, AuthInput, AuthError, AuthSubmit } from './AuthLayout';

export const LoginScreen = () => {
  const { refreshCurrentUser } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form);
      await refreshCurrentUser();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="DegreeBaba Content Studio" subtitle="Sign in to continue.">
      <form onSubmit={handleSubmit}>
        <AuthInput label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <AuthInput label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <AuthError message={error} />
        <AuthSubmit loading={loading}>Sign in</AuthSubmit>
      </form>
      <p className="text-xs text-muted mt-4">
        No account yet? Ask an existing Intern, Senior Content Writer, or Admin for an invite link.
      </p>
    </AuthLayout>
  );
};
