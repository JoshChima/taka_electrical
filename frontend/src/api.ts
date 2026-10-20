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
