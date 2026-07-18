import { useEffect, useState } from 'react';
import { getPasswordReset, submitPasswordReset } from '../services/authClient';
import { AuthLayout, AuthInput, AuthError, AuthSubmit } from './AuthLayout';

export const PasswordResetScreen = ({ token }) => {
  const [valid, setValid] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getPasswordReset(token).then(() => setValid(true)).catch(() => setValid(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await submitPasswordReset(token, password);
      setDone(true);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (valid === false) {
    return (
      <AuthLayout title="Reset link invalid">
        <p className="text-sm text-muted">This password reset link is invalid or has already been used. Ask a Senior Content Writer or Admin to generate a new one.</p>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Password updated">
        <p className="text-sm text-muted">
          Your password has been changed. <a href="/" className="text-orange font-semibold hover:underline">Go to sign in</a>.
        </p>
      </AuthLayout>
    );
  }

  if (valid === null) return null;

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={handleSubmit}>
        <AuthInput label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        <AuthError message={error} />
        <AuthSubmit loading={loading}>Update password</AuthSubmit>
      </form>
    </AuthLayout>
  );
};
