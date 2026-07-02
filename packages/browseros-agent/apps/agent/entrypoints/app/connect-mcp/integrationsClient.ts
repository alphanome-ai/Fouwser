/**
 * Helpers for talking to the backend integrations API
 * (`/api/v1/integrations/*`). The backend returns errors as
 * `{ error: { message, code } }`.
 */

interface BackendErrorEnvelope {
  error?: { message?: string; code?: string }
  detail?: unknown
}

/** Extract a human-readable message from a failed integrations response. */
export async function readIntegrationError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const data = (await response.json()) as BackendErrorEnvelope
    if (data.error?.message) return data.error.message
    if (typeof data.detail === 'string') return data.detail
  } catch {
    // body was not JSON
  }
  return fallback
}
