import { storage } from '@wxt-dev/storage'
import { useEffect, useState } from 'react'

export interface AuthSession {
  accessToken: string
  refreshToken: string
  tokenType: string
}

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  isActive: boolean
  emailVerified: boolean
  role: string
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  name: string
  image: string | null
}

export interface SessionInfo {
  session?: AuthSession
  user?: AuthUser
}

export const sessionStorage = storage.defineItem<SessionInfo>(
  'local:sessionInfo',
  {
    fallback: {},
  },
)

export const useSessionInfo = () => {
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({})
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    sessionStorage.getValue().then((value) => {
      setSessionInfo(value)
      setIsLoading(false)
    })
    const unwatch = sessionStorage.watch((newValue) => {
      setSessionInfo(newValue ?? {})
    })
    return unwatch
  }, [])

  const updateSessionInfo = async (info: SessionInfo) => {
    await sessionStorage.setValue(info)
  }

  const clearSessionInfo = async () => {
    await sessionStorage.setValue({})
  }

  return { sessionInfo, isLoading, updateSessionInfo, clearSessionInfo }
}
