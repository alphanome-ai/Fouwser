import { useEffect, useState } from 'react'
import { env } from '../env'
import {
  type AuthSession,
  type AuthUser,
  type SessionInfo,
  sessionStorage,
} from './sessionStorage'

type AuthTokenResponse = {
  access_token: string
  refresh_token: string
  token_type?: string
  user: {
    id: string
    email: string
    first_name: string
    last_name: string
    avatar_url: string | null
    is_active: boolean
    email_verified: boolean
    role: string
    last_login_at: string | null
    created_at: string
    updated_at: string
  }
}

type SessionData = {
  session: AuthSession
  user: AuthUser
}

type LoginInput = {
  email: string
  password: string
}

type RegisterInput = LoginInput & {
  firstName: string
  lastName: string
}

const ACCESS_TOKEN_EXPIRY_SKEW_MS = 30_000

const getApiBaseUrl = (): string => {
  const baseUrl = env.VITE_PUBLIC_BROWSEROS_API?.trim()
  if (!baseUrl) {
    throw new Error('VITE_PUBLIC_BROWSEROS_API is required')
  }
  return baseUrl.replace(/\/$/, '')
}

const toDisplayName = (firstName: string, lastName: string, email: string) => {
  const name = `${firstName} ${lastName}`.trim()
  return name || email
}

function normalizeUser(user: AuthTokenResponse['user']): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    avatarUrl: user.avatar_url,
    isActive: user.is_active,
    emailVerified: user.email_verified,
    role: user.role,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    name: toDisplayName(user.first_name, user.last_name, user.email),
    image: user.avatar_url,
  }
}

function toSessionData(payload: AuthTokenResponse): SessionData {
  return {
    session: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type ?? 'bearer',
    },
    user: normalizeUser(payload.user),
  }
}

function readSessionData(sessionInfo: SessionInfo | null | undefined): SessionData | null {
  if (!sessionInfo?.session || !sessionInfo.user) {
    return null
  }

  return {
    session: sessionInfo.session,
    user: sessionInfo.user,
  }
}

async function persistSession(payload: AuthTokenResponse): Promise<SessionData> {
  const data = toSessionData(payload)
  await sessionStorage.setValue(data)
  return data
}

async function clearSession(): Promise<void> {
  await sessionStorage.setValue({})
}

async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Accept', 'application/json')

  return fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
  })
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split('.')
  if (!payload) {
    return null
  }

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function isAccessTokenExpired(
  accessToken: string,
  skewMs = ACCESS_TOKEN_EXPIRY_SKEW_MS,
): boolean {
  const payload = decodeJwtPayload(accessToken)
  if (!payload || typeof payload.exp !== 'number') {
    return false
  }

  return payload.exp * 1000 <= Date.now() + skewMs
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getSession({ forceRefresh: true })
  return session?.session.accessToken ?? null
}

export async function refresh(): Promise<SessionData | null> {
  const sessionInfo = await sessionStorage.getValue()
  const refreshToken = sessionInfo.session?.refreshToken

  if (!refreshToken) {
    await clearSession()
    return null
  }

  const response = await apiFetch('/api/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })

  if (!response.ok) {
    await clearSession()
    return null
  }

  const payload = (await response.json()) as AuthTokenResponse
  return await persistSession(payload)
}

export async function authorizedFetch(
  path: string,
  init?: RequestInit,
  options?: { retryOnUnauthorized?: boolean },
): Promise<Response> {
  const retryOnUnauthorized = options?.retryOnUnauthorized ?? true
  let sessionInfo = await sessionStorage.getValue()
  let accessToken = sessionInfo.session?.accessToken

  if (accessToken && isAccessTokenExpired(accessToken)) {
    const refreshed = await refresh()
    accessToken = refreshed?.session.accessToken
    sessionInfo = refreshed ?? {}
  }

  if (!accessToken) {
    await clearSession()
    throw new Error('No active session')
  }

  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)

  let response = await apiFetch(path, {
    ...init,
    headers,
  })

  if (response.status !== 401 || !retryOnUnauthorized) {
    return response
  }

  const refreshed = await refresh()
  if (!refreshed) {
    return response
  }

  const retryHeaders = new Headers(init?.headers)
  retryHeaders.set('Authorization', `Bearer ${refreshed.session.accessToken}`)

  response = await apiFetch(path, {
    ...init,
    headers: retryHeaders,
  })

  return response
}

let restorePromise: Promise<SessionData | null> | null = null

export async function getSession(
  options?: { forceRefresh?: boolean },
): Promise<SessionData | null> {
  if (!options?.forceRefresh && restorePromise) {
    return restorePromise
  }

  restorePromise = (async () => {
    const sessionInfo = await sessionStorage.getValue()
    if (!sessionInfo.session) {
      return null
    }

    if (
      options?.forceRefresh &&
      isAccessTokenExpired(sessionInfo.session.accessToken)
    ) {
      const refreshed = await refresh()
      if (!refreshed) {
        return null
      }
    }

    let response: Response
    try {
      response = await authorizedFetch('/api/v1/auth/me', {
        method: 'GET',
      })
    } catch {
      return readSessionData(sessionInfo)
    }

    if (!response.ok) {
      await clearSession()
      return null
    }

    const user = (await response.json()) as AuthTokenResponse['user']
    const current = await sessionStorage.getValue()
    const currentSession = current.session
    if (!currentSession) {
      return null
    }

    const data: SessionData = {
      session: currentSession,
      user: normalizeUser(user),
    }
    await sessionStorage.setValue(data)
    return data
  })()

  try {
    return await restorePromise
  } finally {
    restorePromise = null
  }
}

async function parseAuthError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as
      | { detail?: string }
      | { message?: string }
      | { errors?: Array<{ msg?: string }> }
    if ('detail' in data && typeof data.detail === 'string') {
      return data.detail
    }
    if ('message' in data && typeof data.message === 'string') {
      return data.message
    }
    if ('errors' in data && Array.isArray(data.errors) && data.errors[0]?.msg) {
      return data.errors[0].msg
    }
  } catch {
    // Fall through to generic message.
  }

  return `Request failed with status ${response.status}`
}

export async function login(input: LoginInput): Promise<SessionData> {
  const response = await apiFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email.trim(),
      password: input.password,
    }),
  })

  if (!response.ok) {
    throw new Error(await parseAuthError(response))
  }

  const payload = (await response.json()) as AuthTokenResponse
  return await persistSession(payload)
}

export async function register(input: RegisterInput): Promise<SessionData> {
  const registerResponse = await apiFetch('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email.trim(),
      password: input.password,
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
    }),
  })

  if (!registerResponse.ok) {
    throw new Error(await parseAuthError(registerResponse))
  }

  return await login({
    email: input.email,
    password: input.password,
  })
}

function requireGoogleClientId(): string {
  const clientId = env.VITE_PUBLIC_GOOGLE_CLIENT_ID?.trim()
  if (!clientId) {
    throw new Error('VITE_PUBLIC_GOOGLE_CLIENT_ID is required for Google sign-in')
  }
  return clientId
}

async function getGoogleIdToken(): Promise<string> {
  if (!chrome.identity?.launchWebAuthFlow) {
    throw new Error('Google sign-in is not available in this environment')
  }

  const redirectUri = chrome.identity.getRedirectURL('google-auth')
  const clientId = requireGoogleClientId()
  const state = crypto.randomUUID()
  const nonce = crypto.randomUUID()

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'id_token')
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('prompt', 'select_account')
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('state', state)

  const redirectedTo = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  })

  if (!redirectedTo) {
    throw new Error('Google sign-in did not return a callback URL')
  }

  const callbackUrl = new URL(redirectedTo)
  const hashParams = new URLSearchParams(callbackUrl.hash.replace(/^#/, ''))

  if (hashParams.get('state') !== state) {
    throw new Error('Google sign-in state mismatch')
  }

  const idToken = hashParams.get('id_token')
  if (!idToken) {
    throw new Error(hashParams.get('error_description') || 'Google sign-in failed')
  }

  return idToken
}

export async function loginWithGoogle(): Promise<SessionData> {
  const idToken = await getGoogleIdToken()

  const response = await apiFetch('/api/v1/auth/google', {
    method: 'POST',
    body: JSON.stringify({ id_token: idToken }),
  })

  if (!response.ok) {
    throw new Error(await parseAuthError(response))
  }

  const payload = (await response.json()) as AuthTokenResponse
  return await persistSession(payload)
}

export async function signOut(): Promise<void> {
  await clearSession()
}

export function useSession(): {
  data: SessionData | null
  isPending: boolean
  refetch: () => Promise<SessionData | null>
} {
  const [data, setData] = useState<SessionData | null>(null)
  const [isPending, setIsPending] = useState(true)

  useEffect(() => {
    let mounted = true

    const sync = async () => {
      const current = await sessionStorage.getValue()
      if (!mounted) return
      setData(readSessionData(current))

      try {
        const restored = await getSession()
        if (!mounted) return
        setData(restored)
      } catch {
        if (mounted) {
          setData(readSessionData(current))
        }
      } finally {
        if (mounted) {
          setIsPending(false)
        }
      }
    }

    void sync()

    const unwatch = sessionStorage.watch((value) => {
      if (!mounted) return
      setData(readSessionData(value))
    })

    return () => {
      mounted = false
      unwatch()
    }
  }, [])

  const refetch = async () => {
    setIsPending(true)
    try {
      const restored = await getSession({ forceRefresh: true })
      setData(restored)
      return restored
    } finally {
      setIsPending(false)
    }
  }

  return { data, isPending, refetch }
}
