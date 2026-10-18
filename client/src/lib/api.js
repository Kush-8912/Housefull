// Single entry point for talking to the API. Every failure — HTTP error,
// malformed response or network outage — becomes an ApiError with a
// user-presentable message, a machine-readable code and optional field details.
export class ApiError extends Error {
  constructor(status, { message, code, details } = {}) {
    super(message || 'Something went wrong');
    this.status = status;
    this.code = code;
    this.details = details;
  }

  // Map of field -> message for forms.
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.map((d) => [d.field, d.message]));
  }
}

// A Blob/File body (e.g. a photo) is sent as-is with its own type; anything else as JSON.
export async function api(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const raw = body instanceof Blob;
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: { ...(body !== undefined ? { 'Content-Type': raw ? body.type : 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, { message: "Can't reach SeatLock. Check your connection and try again.", code: 'NETWORK' });
  }

  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response (e.g. proxy error page)
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? { message: res.status >= 500 ? 'The server ran into a problem. Please try again.' : 'Request failed' });
  }
  return data;
}

export const isAbort = (err) => err?.name === 'AbortError';
