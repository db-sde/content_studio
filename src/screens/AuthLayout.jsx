import { Sparkles } from 'lucide-react';

// Shared centered-card shell for every auth screen (bootstrap, login, invite-accept, reset) —
// keeps the four screens visually consistent without a component per screen re-deriving layout.
export const AuthLayout = ({ title, subtitle, children }) => (
  <div className="min-h-screen bg-off flex items-center justify-center p-6 relative overflow-hidden">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-navy/[0.05] via-orange/[0.025] to-transparent -z-10" />

    <div className="w-full max-w-sm">
      <div className="flex justify-center mb-6">
        <div className="relative inline-flex items-center justify-center">
          <div className="absolute inset-0 bg-orange/20 blur-xl rounded-full scale-150"></div>
          <div className="relative inline-flex items-center justify-center p-3 bg-navy text-white rounded-2xl shadow-premium">
            <Sparkles className="w-6 h-6 text-orange" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-premium border border-border p-8">
        <h1 className="text-xl font-extrabold text-navy tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1 mb-6 leading-relaxed">{subtitle}</p>}
        {!subtitle && <div className="mb-6" />}
        {children}
      </div>
    </div>
  </div>
);

export const AuthInput = ({ label, ...props }) => (
  <label className="block mb-4">
    <span className="block text-xs font-semibold uppercase tracking-wide text-navy mb-1.5">{label}</span>
    <input
      {...props}
      className="w-full px-3.5 py-2.5 border border-border rounded-lg bg-white text-navy text-sm placeholder:text-muted/60 transition-all duration-200 focus:outline-none focus:border-navy focus:ring-2 focus:ring-navy/15 hover:border-border-strong"
    />
  </label>
);

export const AuthError = ({ message }) =>
  message ? (
    <p className="text-xs font-semibold text-danger bg-danger-soft px-3 py-2 rounded-lg mb-4">{message}</p>
  ) : null;

export const AuthSubmit = ({ loading, children }) => (
  <button
    type="submit"
    disabled={loading}
    className="w-full py-2.5 rounded-lg bg-orange text-white text-sm font-bold hover:bg-orange-hover transition-all shadow-md active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
  >
    {loading ? 'Please wait…' : children}
  </button>
);
