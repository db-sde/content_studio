import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const VARIANTS = {
  success: { icon: CheckCircle, bar: 'bg-green-success', iconColor: 'text-green-success' },
  error: { icon: AlertCircle, bar: 'bg-danger', iconColor: 'text-danger' },
  info: { icon: Info, bar: 'bg-info', iconColor: 'text-info' }
};

// Replaces every blocking alert()-shaped interaction in this app (the old workflowError header
// pill that lingered until overwritten, the validation-failed modal that needed a click to
// dismiss) with a transient, stacked notification that disappears on its own — the goal is that
// nothing in this app ever again requires a click just to acknowledge "ok, got it."
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const show = useCallback((type, message, durationMs = 5000) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => dismiss(id), durationMs);
  }, [dismiss]);

  const toast = {
    success: (message, durationMs) => show('success', message, durationMs),
    error: (message, durationMs) => show('error', message, durationMs ?? 7000),
    info: (message, durationMs) => show('info', message, durationMs)
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 w-full max-w-sm pointer-events-none">
        {toasts.map(t => {
          const variant = VARIANTS[t.type] || VARIANTS.info;
          const Icon = variant.icon;
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex items-start gap-2.5 bg-white rounded-xl shadow-premium-hover border border-border overflow-hidden animate-toast-in"
            >
              <div className={`w-1.5 self-stretch shrink-0 ${variant.bar}`} />
              <Icon className={`w-4 h-4 shrink-0 mt-3.5 ${variant.iconColor}`} />
              <p className="text-xs font-semibold text-navy py-3 pr-2 leading-relaxed">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="ml-auto p-2.5 text-muted hover:text-navy shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context + its hook belong in one file
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
