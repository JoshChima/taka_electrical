import { useState, type FormEvent } from 'react'
import { signIn } from './api'

type Props = { notice?: string; onSignedIn: (username: string) => void; onError: (e: unknown) => void }

export default function SignIn({ notice, onSignedIn, onError }: Props) {
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    try {
      const user = await signIn(String(form.get('username')), String(form.get('password')))
      if (user) onSignedIn(user)
      else setProblem('That username or password is not right. Use your InvenTree account.')
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="sign-in">
      <form className="card stack" onSubmit={submit}>
        <h1>Sign in</h1>
        <p className="muted">Use your InvenTree username and password.</p>
        {notice && <p role="status" className="notice">{notice}</p>}
        {problem && <p role="alert" className="problem">{problem}</p>}
        <label>
          Username
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="primary" disabled={busy}>
          Sign in
        </button>
      </form>
    </main>
  )
}
