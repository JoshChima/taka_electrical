import { useCallback, useEffect, useState } from 'react'
import { currentUser, SignedOut } from './api'
import Overview from './Overview'
import SignIn from './SignIn'

type Session = { kind: 'checking' } | { kind: 'signed-in'; user: string } | { kind: 'signed-out'; notice?: string }

export default function App() {
  const [session, setSession] = useState<Session>({ kind: 'checking' })

  const onError = useCallback((e: unknown) => {
    if (e instanceof SignedOut) setSession({ kind: 'signed-out' })
    else throw e
  }, [])

  useEffect(() => {
    currentUser().then((user) => setSession({ kind: 'signed-in', user }), onError)
  }, [onError])

  if (session.kind === 'checking') return <p role="status">Checking sign-in…</p>
  if (session.kind === 'signed-out')
    return <SignIn onSignedIn={(user) => setSession({ kind: 'signed-in', user })} onError={onError} />
  return <Overview onError={onError} />
}
