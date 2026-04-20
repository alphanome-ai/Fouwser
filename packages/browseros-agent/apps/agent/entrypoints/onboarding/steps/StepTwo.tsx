import { AlertCircle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { login, loginWithGoogle, register } from '@/lib/auth/auth-client'
import {
  ONBOARDING_SIGNIN_COMPLETED_EVENT,
  ONBOARDING_SIGNIN_SKIPPED_EVENT,
  ONBOARDING_STEP_COMPLETED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import { type StepDirection, StepTransition } from './StepTransition'

interface StepTwoProps {
  direction: StepDirection
  onContinue: () => void
}

type AuthMode = 'signin' | 'signup'
type SignInState = 'idle' | 'loading' | 'error'

export const StepTwo = ({ direction, onContinue }: StepTwoProps) => {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<SignInState>('idle')
  const [error, setError] = useState<string | null>(null)

  const completeStep = (method: string) => {
    track(ONBOARDING_SIGNIN_COMPLETED_EVENT, { method })
    track(ONBOARDING_STEP_COMPLETED_EVENT, { step: 4, step_name: 'signin' })
    onContinue()
  }

  const handleSkip = () => {
    track(ONBOARDING_SIGNIN_SKIPPED_EVENT)
    track(ONBOARDING_STEP_COMPLETED_EVENT, {
      step: 4,
      step_name: 'signin',
      skipped: true,
    })
    onContinue()
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('loading')
    setError(null)

    try {
      if (mode === 'signup') {
        await register({
          firstName,
          lastName,
          email,
          password,
        })
      } else {
        await login({
          email,
          password,
        })
      }

      completeStep(mode === 'signup' ? 'password_signup' : 'password')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Authentication failed')
    }
  }

  const handleGoogleAuth = async () => {
    setState('loading')
    setError(null)

    try {
      await loginWithGoogle()
      completeStep(mode === 'signup' ? 'google_signup' : 'google')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Google sign-in failed')
    }
  }

  return (
    <StepTransition direction={direction}>
      <div className="flex min-h-[550px] flex-col items-center justify-start pt-2 md:justify-center md:pt-0">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center">
            <h2 className="font-bold text-3xl tracking-tight">
              {mode === 'signup'
                ? 'Create your Fouwser account'
                : 'Sign in to Fouwser'}
            </h2>
            {/* <p className="text-base text-muted-foreground">
              Sync your settings and unlock cloud features
            </p> */}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogleAuth}
            disabled={state === 'loading'}
          >
            {state === 'loading' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <GoogleIcon />
            )}
            {mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with email
              </span>
            </div>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {mode === 'signup' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="signin-first-name">First name</Label>
                  <Input
                    id="signin-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={state === 'loading'}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-last-name">Last name</Label>
                  <Input
                    id="signin-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={state === 'loading'}
                    required
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="signin-email">Email</Label>
              <Input
                id="signin-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={state === 'loading'}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signin-password">Password</Label>
              <Input
                id="signin-password"
                type="password"
                placeholder={
                  mode === 'signup'
                    ? 'At least 8 characters'
                    : 'Enter your password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={state === 'loading'}
                minLength={mode === 'signup' ? 8 : undefined}
                required
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-primary text-white hover:bg-primary/90"
              disabled={state === 'loading'}
            >
              {state === 'loading' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {mode === 'signup' ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <div className="space-y-3 text-center">
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() =>
                setMode((current) =>
                  current === 'signup' ? 'signin' : 'signup',
                )
              }
            >
              {mode === 'signup'
                ? 'Already have an account? Sign in'
                : "Don't have an account? Sign up"}
            </Button>
            {/* <Button
              variant="ghost"
              onClick={handleSkip}
              className="text-muted-foreground"
            >
              Skip for now
            </Button> */}
          </div>
        </div>
      </div>
    </StepTransition>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" role="img" aria-label="Google">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}
