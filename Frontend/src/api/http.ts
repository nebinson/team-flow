/** Shared JSON transport and error decoding for the TeamFlow API modules. */

export const apiBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly emailHint?: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

let refreshTokenValue = '';
let refreshInFlight: Promise<string | null> | null = null;

export function setRefreshToken(token: string) {
  refreshTokenValue = token;
}

export function getRefreshToken() {
  return refreshTokenValue;
}

export function clearRefreshToken() {
  refreshTokenValue = '';
}

async function renewAccessToken(): Promise<string | null> {
  if (!refreshTokenValue) return null;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshTokenValue }),
      });
    } catch {
      return null;
    }
    if (response.status === 401 || response.status === 400) {
      clearRefreshToken();
      window.dispatchEvent(new Event('teamflow:auth-expired'));
      return null;
    }
    if (!response.ok) return null;
    const session = await response.json() as { access_token?: string; refresh_token?: string };
    if (!session.access_token || !session.refresh_token) return null;
    refreshTokenValue = session.refresh_token;
    window.dispatchEvent(new CustomEvent('teamflow:token-refreshed', { detail: { accessToken: session.access_token } }));
    return session.access_token;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function sendRequest(path: string, init: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${apiBaseUrl}${path}`, { ...init, headers });
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let response = await sendRequest(path, init, token);
  if (response.status === 401 && token && !path.startsWith('/api/v1/auth/')) {
    const renewedToken = await renewAccessToken();
    if (renewedToken) response = await sendRequest(path, init, renewedToken);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail;
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(' ')
        : typeof detail?.message === 'string'
          ? detail.message
          : 'TeamFlow could not complete that request. Please try again.';
    throw new ApiRequestError(message, response.status, detail?.code, detail?.email_hint);
  }
  return payload as T;
}
