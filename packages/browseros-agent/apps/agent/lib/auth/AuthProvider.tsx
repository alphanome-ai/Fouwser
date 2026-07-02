import type { FC, PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { getSession } from './auth-client'

export const AuthProvider: FC<PropsWithChildren> = ({ children }) => {
  useEffect(() => {
    void getSession()
  }, [])

  return <>{children}</>
}
