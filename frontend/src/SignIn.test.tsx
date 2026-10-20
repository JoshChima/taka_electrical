import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import App from './App'
import { fakeInvenTree, OWNER, sent, unreachableInvenTree } from './test/fake-inventree'
import { server } from './test/setup'

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

describe('Signing out and expired sessions', () => {
  it('signing out ends the InvenTree session too', async () => {
    const fake = fakeInvenTree({ signedIn: true })
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByLabelText('Password')).toBeTruthy()
    const [logout] = sent(fake, 'DELETE', '/api/auth/v1/auth/session')
    expect(logout.headers.get('X-CSRFToken')).toBe('fake-csrf-token')
    expect(fake.signedIn).toBe(false)
  })

  it('sends the Owner to sign in when their session has expired, then back to the overview', async () => {
    fakeInvenTree({ signedIn: true })
    // InvenTree drops the session while the overview is loading.
    const expired = { detail: 'Authentication credentials were not provided.' }
    server.use(http.get('*/api/stock/', () => HttpResponse.json(expired, { status: 401 }), { once: true }))
    render(<App />)

    expect(await screen.findByText(/your session has ended/i)).toBeTruthy()
    await signIn(OWNER.username, OWNER.password)
    expect(await screen.findByRole('region', { name: 'Job Sites' })).toBeTruthy()
  })
})

describe('When InvenTree is down', () => {
  it('says the server cannot be reached, and recovers on retry', async () => {
    unreachableInvenTree()
    render(<App />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/can.t reach the server/i)

    server.resetHandlers()
    fakeInvenTree({ signedIn: true })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Main Warehouse' })).toBeTruthy()
  })

  it('says the server cannot be reached when the network is down', async () => {
    server.use(http.all('*/api/*', () => HttpResponse.error()))
    render(<App />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/can.t reach the server/i)
  })
})

describe('Header', () => {
  it('shows the navigation with Overview as the current page and who is signed in', async () => {
    fakeInvenTree({ signedIn: true })
    render(<App />)

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText(OWNER.username)).toBeTruthy()
  })
})
