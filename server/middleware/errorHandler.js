// Centralized error handler — routes call next(err) and let this format the response,
// so route handlers don't each hand-roll try/catch/status logic.
export function errorHandler(err, req, res, _next) {
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
}

// Wraps an async route handler so a rejected promise reaches errorHandler instead of hanging.
export function asyncRoute(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
