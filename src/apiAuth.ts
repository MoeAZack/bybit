/**
 * Dashboard session bootstrap.
 *
 * The server no longer infers "same origin" from sec-fetch-site / referer, because a caller
 * can set those to anything. Instead the dashboard exchanges the API token for an httpOnly
 * session cookie at /api/auth/login, and the browser attaches that cookie automatically.
 *
 * The token is never persisted client-side: the cookie is the credential, and it is not
 * readable from JS.
 *
 * Auth state is published so the UI can render an explicit locked screen. Previously a
 * dismissed window.prompt left every /api/* call returning 401 while React kept its
 * initial state, so the dashboard rendered plausible placeholder numbers (0.1 lot,
 * "BREAKER OFF", $10,000 balance) that were indistinguishable from live configuration.
 * On a trading terminal that is a dangerous thing to display.
 */

const original = window.fetch.bind(window);

export type AuthStatus = 'unknown' | 'authed' | 'locked';

let status: AuthStatus = 'unknown';
const listeners = new Set<(s: AuthStatus) => void>();

function setStatus(next: AuthStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach(fn => fn(status));
}

export function getAuthStatus(): AuthStatus {
  return status;
}

/** Subscribe to auth changes. Fires immediately with the current value. */
export function subscribeAuth(fn: (s: AuthStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => { listeners.delete(fn); };
}

function isGuardedApi(url: string): boolean {
  try {
    const path = new URL(url, window.location.origin).pathname;
    return path.startsWith('/api/') && !path.startsWith('/api/auth/');
  } catch {
    return false;
  }
}

/**
 * Exchange a token for a session cookie.
 * Returns null on success, or a human-readable error string.
 */
export async function loginWithToken(token: string): Promise<string | null> {
  const trimmed = token.trim();
  if (!trimmed) return 'Enter the API_AUTH_TOKEN value.';

  let res: Response;
  try {
    res = await original('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: trimmed }),
    });
  } catch {
    return 'Could not reach the server.';
  }

  if (res.ok) {
    setStatus('authed');
    return null;
  }
  if (res.status === 429) return 'Too many attempts. Wait 15 minutes before retrying.';
  if (res.status === 503) return 'Server auth is not configured (API_AUTH_TOKEN is unset).';
  return 'Invalid token.';
}

export async function logout(): Promise<void> {
  try { await original('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  setStatus('locked');
}

/** Probe a guarded endpoint to establish status without waiting for a component fetch. */
export async function refreshAuthStatus(): Promise<AuthStatus> {
  try {
    const res = await original('/api/settings');
    setStatus(res.status === 401 ? 'locked' : 'authed');
  } catch {
    // A network failure is not an auth verdict — leave the status untouched.
  }
  return status;
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const res = await original(input as RequestInfo, init);

  // Lock on any 401 so an expired session takes the dashboard down immediately rather
  // than leaving stale figures on screen.
  //
  // Only 401 is a verdict. A 200 is NOT proof of a session: some /api/* routes are
  // public (e.g. /api/bridge/status answers 200 unauthenticated), so treating any
  // success as "authed" would unlock the whole terminal off a single public endpoint.
  // Positive confirmation comes from refreshAuthStatus() probing a guarded route, or
  // from a successful loginWithToken().
  if (isGuardedApi(url) && res.status === 401) setStatus('locked');
  return res;
};

void refreshAuthStatus();
