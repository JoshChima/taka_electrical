import createClient from 'openapi-fetch'
import type { paths } from './inventree'

// Typed client generated from InvenTree 1.6.0's OpenAPI schema (`npm run generate:api`).
// Same origin as InvenTree, so the session cookie does the auth; nothing is kept in browser storage.
export const api = createClient<paths>({ baseUrl: window.location.origin, credentials: 'same-origin' })

const csrfToken = () => document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] ?? ''

api.use({
  onRequest({ request }) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) request.headers.set('X-CSRFToken', csrfToken())
    return request
  },
})

/** InvenTree says the Owner is not signed in (never signed in, or the session expired). */
export class SignedOut extends Error {}
/** InvenTree can't be reached: the network failed or Caddy has no upstream. */
export class Unreachable extends Error {}

type Result<T> = { data?: T; error?: unknown; response: Response }

/** Awaits an `api` call and returns its data, or throws SignedOut / Unreachable / Error. */
export async function load<T>(call: Promise<Result<T>>): Promise<T> {
  let result: Result<T>
  try {
    result = await call
  } catch {
    throw new Unreachable()
  }
  const { status } = result.response
  if (status === 401) throw new SignedOut()
  if (status === 502 || status === 503 || status === 504) throw new Unreachable()
  if (result.data === undefined) throw new Error(`InvenTree answered ${status}`)
  return result.data
}

// InvenTree's session login (django-allauth headless, browser client).

/** The signed-in username, or throws SignedOut. Also sets the CSRF cookie that sign-in needs. */
export async function currentUser() {
  const { data } = await load(api.GET('/api/auth/v1/auth/session'))
  return data.user.username ?? data.user.display ?? ''
}

/** Signs in and returns the username; returns null when the username or password is wrong. */
export async function signIn(username: string, password: string) {
  const call = api.POST('/api/auth/v1/auth/login', { body: { username, password } })
  if ((await call.catch(() => null))?.response.status === 400) return null
  const { data } = await load(call)
  return data.user.username ?? data.user.display ?? ''
}

/** Ends the InvenTree session. allauth answers 401 ("now signed out") on success. */
export async function signOut() {
  await load(api.DELETE('/api/auth/v1/auth/session')).catch((e) => {
    if (!(e instanceof SignedOut)) throw e
  })
}

/** Fetches every row of a paginated list endpoint, page by page. */
export async function everyRow<T>(page: (offset: number) => Promise<Result<{ count: number; results: T[] }>>) {
  const rows: T[] = []
  let count = 0
  do {
    const data = await load(page(rows.length))
    rows.push(...data.results)
    count = data.count
    if (!data.results.length) break
  } while (rows.length < count)
  return rows
}
