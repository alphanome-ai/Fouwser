import type { FC } from 'react'
import { LoginPage } from './LoginPage'

export const SignupPage: FC = () => {
  return <LoginPage initialMode="signup" />
}
