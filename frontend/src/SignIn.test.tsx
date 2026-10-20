import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { fakeInvenTree, OWNER, sent } from './test/fake-inventree'

async function signIn(username: string, password: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Username'), username)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('Signing in', () => {
  it('signs the Owner in with their InvenTree username and password and lands on the overview', async () => {
    const fake = fakeInvenTree({ signedIn: false })
    render(<App />)

    await signIn(OWNER.username, OWNER.password)

    expect(await screen.findByRole('heading', { name: 'Stock overview' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'Vans' })).toBeTruthy()
    const [login] = sent(fake, 'POST', '/api/auth/v1/auth/login')
    expect(await login.json()).toEqual({ username: OWNER.username, password: OWNER.password })
    expect(login.headers.get('X-CSRFToken')).toBe('fake-csrf-token')
    expect(login.headers.get('Authorization')).toBeNull()
    expect([localStorage.length, sessionStorage.length]).toEqual([0, 0])
  })

  it('tells the Owner when the username or password is wrong', async () => {
    fakeInvenTree({ signedIn: false })
    render(<App />)

    await signIn(OWNER.username, 'wrong')

    expect((await screen.findByRole('alert')).textContent).toMatch(/username or password is not right/i)
    expect(screen.queryByRole('heading', { name: 'Stock overview' })).toBeNull()
  })

  it('skips sign-in when the Owner is still signed in to InvenTree', async () => {
    fakeInvenTree({ signedIn: true })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Stock overview' })).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })
})
