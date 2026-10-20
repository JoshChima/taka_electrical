import { http, HttpResponse } from 'msw'
import { server } from './setup'
import seed from './seed-fixtures.json'

// A fake InvenTree 1.6.0 answering like the real one (see inventree-api notes in the README),
// serving rows generated from the demo seed (`npm run generate:fixtures`).

export const OWNER = { username: 'owner', password: 'test-password' }
const CSRF = 'fake-csrf-token'

const signedOutBody = {
  status: 401,
  data: { flows: [{ id: 'login' }] },
  meta: { is_authenticated: false },
}
const sessionBody = () => ({
  status: 200,
  data: { user: { id: 1, display: OWNER.username, username: OWNER.username } },
  meta: { is_authenticated: true },
})
const notAuthenticated = () =>
  HttpResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 })

export function fakeInvenTree({ signedIn = true } = {}) {
  const fake = {
    signedIn,
    locations: structuredClone(seed.locations),
    stock: structuredClone(seed.stock),
    /** Every request the app sent, in order. */
    requests: [] as Request[],
  }
  server.events.on('request:start', ({ request }) => fake.requests.push(request.clone()))

  // List endpoints: a bare array, or a LimitOffset page when `limit` is given (as InvenTree does).
  const api =
    (rows: () => unknown[]) =>
    ({ request }: { request: Request }) => {
      if (!fake.signedIn) return notAuthenticated()
      const query = new URL(request.url).searchParams
      if (!query.has('limit')) return HttpResponse.json(rows())
      const offset = Number(query.get('offset') ?? 0)
      const all = rows()
      return HttpResponse.json({
        count: all.length,
        next: null,
        previous: null,
        results: all.slice(offset, offset + Number(query.get('limit'))),
      })
    }

  server.use(
    http.get('*/api/auth/v1/auth/session', () => {
      document.cookie = `csrftoken=${CSRF}; path=/`
      return fake.signedIn
        ? HttpResponse.json(sessionBody())
        : HttpResponse.json(signedOutBody, { status: 401 })
    }),
    http.post('*/api/auth/v1/auth/login', async ({ request }) => {
      if (request.headers.get('X-CSRFToken') !== CSRF)
        return HttpResponse.json({ detail: 'CSRF verification failed.' }, { status: 403 })
      const { username, password } = (await request.json()) as typeof OWNER
      if (username !== OWNER.username || password !== OWNER.password)
        return HttpResponse.json(
          {
            status: 400,
            errors: [
              {
                message: 'The username and/or password you specified are not correct.',
                code: 'username_password_mismatch',
                param: 'password',
              },
            ],
          },
          { status: 400 },
        )
      fake.signedIn = true
      return HttpResponse.json(sessionBody())
    }),
    http.delete('*/api/auth/v1/auth/session', ({ request }) => {
      if (request.headers.get('X-CSRFToken') !== CSRF)
        return HttpResponse.json({ detail: 'CSRF verification failed.' }, { status: 403 })
      fake.signedIn = false
      return HttpResponse.json(signedOutBody, { status: 401 }) // allauth's "you are now signed out"
    }),
    http.get('*/api/stock/location/', api(() => fake.locations)),
    http.get('*/api/stock/', api(() => fake.stock)),
  )
  return fake
}

/** The fake as seen when InvenTree is down: Caddy answers 502 for every API call. */
export function unreachableInvenTree() {
  server.use(http.all('*/api/*', () => new HttpResponse('Bad Gateway', { status: 502 })))
}

export const sent = (fake: { requests: Request[] }, method: string, path: string) =>
  fake.requests.filter((r) => r.method === method && new URL(r.url).pathname === path)
