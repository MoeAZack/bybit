/**
 * Dashboard session bootstrap.
 *
 * The server no longer infers "same origin" from sec-fetch-site / referer, because a caller
 * can set those to anything. Instead the dashboard exchanges the API token for an httpOnly
 * session cookie at /api/auth/login, and the browser attaches that cookie automatically.
 *
 * The token is never persisted client-side: the cookie is the credential, and it is not
 * readable from JS. A prompt therefore appears only when no valid session exists.
 */

const original = window.fetch.bind(window);

// Concurrent 401s must share one login, or a dashboard that fires a dozen parallel
// requests on mount would raise a dozen prompts.
let loginInFlight: Promise<boolean> | null = null;

function isGuardedApi(url: string): boolean {
  try {
    const path = new URL(url, window.location.origin).pathname;
    return path.startsWith('/api/') && !path.startsWith('/api/auth/');
  } catch {
    return false;
  }
}

async function login(): Promise<boolean> {
  const token = window.prompt('Dashboard locked. Enter API_AUTH_TOKEN:');
  if (!token) return false;

  const res = await original('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    window.alert(res.status === 429 ? 'Too many attempts. Wait 15 minutes.' : 'Invalid token.');
    return false;
  }
  return true;
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const res = await original(input as RequestInfo, init);

  if (res.status !== 401 || !isGuardedApi(url)) return res;

  if (!loginInFlight) {
    loginInFlight = login().finally(() => {
      loginInFlight = null;
    });
  }

  return (await loginInFlight) ? original(input as RequestInfo, init) : res;
};
