import { useCallback, useEffect, useState } from 'react'
import { currentUser, signOut, SignedOut, Unreachable } from './api'
import Overview from './Overview'
import SignIn from './SignIn'

type Session =
  | { kind: 'checking' }
  | { kind: 'signed-in'; user: string }
  | { kind: 'signed-out'; notice?: string }
  | { kind: 'failed'; message: string }

const UNREACHABLE = "Can't reach the server. Check that InvenTree is running, then try again."

export default function App() {
  const [session, setSession] = useState<Session>({ kind: 'checking' })

  // Every page reports API failures here: a 401 anywhere means "sign in again".
  const onError = useCallback((e: unknown) => {
    setSession((prev) => {
      if (e instanceof SignedOut)
        return {
          kind: 'signed-out',
          notice: prev.kind === 'signed-in' ? 'Your session has ended. Sign in again.' : undefined,
        }
      if (e instanceof Unreachable) return { kind: 'failed', message: UNREACHABLE }
      return { kind: 'failed', message: `Something went wrong: ${e instanceof Error ? e.message : e}` }
    })
  }, [])

  useEffect(() => {
    if (session.kind === 'checking')
      currentUser().then((user) => setSession({ kind: 'signed-in', user }), onError)
  }, [session.kind, onError])

  switch (session.kind) {
    case 'checking':
      return <p role="status">Checking sign-in…</p>
    case 'failed':
      return (
        <main className="sign-in">
          <div className="card stack">
            <p role="alert" className="problem">{session.message}</p>
            <button className="primary" onClick={() => setSession({ kind: 'checking' })}>
              Try again
            </button>
          </div>
        </main>
      )
    case 'signed-out':
      return (
        <SignIn
          notice={session.notice}
          onSignedIn={(user) => setSession({ kind: 'signed-in', user })}
          onError={onError}
        />
      )
  }

  const leave = () => signOut().then(() => setSession({ kind: 'signed-out' }), onError)
  return (
    <>
      <header className="app-header">
        <div className="bar">
          <a className="brand" href={import.meta.env.BASE_URL}>
            <span className="logo" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round">
                <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
              </svg>
            </span>
            Taka Electrical
          </a>
          <nav aria-label="Main">
            <a href={import.meta.env.BASE_URL} aria-current="page">
              Overview
            </a>
          </nav>
          <span className="user">{session.user}</span>
          <button className="quiet" onClick={leave}>
            Sign out
          </button>
        </div>
      </header>
      <Overview onError={onError} />
    </>
  )
}
