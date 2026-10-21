const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

interface ErrorResponse {
  status: number
  code: string
  message: string
  details?: Record<string, string>
}

export class ApiError extends Error {
  public status: number
  public code: string
  public details?: Record<string, string>

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new Error('Could not reach the server. Check that the backend is running.')
  }

  if (response.status === 204) return undefined as T

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = body as Partial<ErrorResponse> | null
    if (token && response.status === 401) {
      window.dispatchEvent(new Event('auth:expired'))
    }
    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'The request could not be completed.',
      error?.details,
    )
  }

  return body as T
}
