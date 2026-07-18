import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getCurrentUser, getBootstrapStatus, logout as logoutRequest } from '../services/authClient';

const AuthContext = createContext(null);

// Single source of truth for "who is using this app right now," loaded once on mount and
// refreshable after login/logout/invite-accept. `status` drives which top-level screen App.jsx
// renders: 'loading' | 'needs-bootstrap' | 'logged-out' | 'logged-in'.
export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [status, setStatus] = useState('loading');

  const refreshCurrentUser = useCallback(async () => {
    try {
      const { user } = await getCurrentUser();
      setCurrentUser(user);
      setStatus('logged-in');
    } catch {
      setCurrentUser(null);
      try {
        const { needsBootstrap: needs } = await getBootstrapStatus();
        setNeedsBootstrap(needs);
        setStatus(needs ? 'needs-bootstrap' : 'logged-out');
      } catch {
        setStatus('logged-out');
      }
    }
  }, []);

  // One-time "who's logged in on load" check; there's no external-system subscription to attach
  // to here, only an async fetch whose result must set state once, on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCurrentUser();
  }, [refreshCurrentUser]);

  const logout = useCallback(async () => {
    await logoutRequest();
    setCurrentUser(null);
    setStatus('logged-out');
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, status, needsBootstrap, refreshCurrentUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context + its hook belong in one file
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
