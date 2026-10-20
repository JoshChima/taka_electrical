import { useCallback, useEffect, useState } from 'react'
import { currentUser, signOut, SignedOut, Unreachable } from './api'
import Find from './Find'
import Move from './Move'
import Overview from './Overview'
import Receive from './Receive'
import Reorder from './Reorder'
import SignIn from './SignIn'

// The pages, in navigation order. Adding a page is one line: its path under the app, nav label and component.
const PAGES = [
  { path: '', label: 'Overview', Page: Overview },
  { path: 'find', label: 'Find a part', Page: Find },
  { path: 'move', label: 'Move stock', Page: Move },
  { path: 'reorder', label: 'Reorder', Page: Reorder },
  { path: 'receive', label: 'Receive', Page: Receive },
]

const BASE = import.meta.env.BASE_URL
const currentPath = () =>
  location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length).replace(/\/$/, '') : ''

/** The current page's path. Links to app pages change it without reloading; back and forward work. */
function usePath() {
  const [path, setPath] = useState(currentPath)
  useEffect(() => {
    const sync = () => setPath(currentPath())
    const follow = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest('a') : null
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return
      if (a.origin !== location.origin || !a.pathname.startsWith(BASE)) return
      e.preventDefault()
      history.pushState(null, '', a.href)
      sync()
    }
    addEventListener('popstate', sync)
    document.addEventListener('click', follow)
    return () => {
      removeEventListener('popstate', sync)
      document.removeEventListener('click', follow)
    }
  }, [])
  return path
}

type Session =
  | { kind: 'checking' }
  | { kind: 'signed-in'; user: string }
  | { kind: 'signed-out'; notice?: string }
  | { kind: 'failed'; message: string }

const UNREACHABLE = "Can't reach the server. Check that InvenTree is running, then try again."

export default function App() {
  const [session, setSession] = useState<Session>({ kind: 'checking' })
  const path = usePath()
  const page = PAGES.find((p) => p.path === path) ?? PAGES[0]

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
      return <p role="status" className="page muted">Checking sign-in…</p>
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
          <a className="brand" href={BASE}>
            <span className="logo" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round">
                <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
              </svg>
            </span>
            Taka Electrical
          </a>
          <nav aria-label="Main">
            {PAGES.map((p) => (
              <a key={p.path} href={BASE + p.path} aria-current={p === page ? 'page' : undefined}>
                {p.label}
              </a>
            ))}
          </nav>
          <span className="user">{session.user}</span>
          <button className="quiet" onClick={leave}>
            Sign out
          </button>
        </div>
      </header>
      <page.Page onError={onError} />
    </>
  )
}
