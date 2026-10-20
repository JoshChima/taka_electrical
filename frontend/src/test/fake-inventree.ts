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
    purchaseOrders: structuredClone(seed.purchaseOrders),
    poLines: structuredClone(seed.poLines),
    /** Every request the app sent, in order. */
    requests: [] as Request[],
  }
  server.events.on('request:start', ({ request }) => fake.requests.push(request.clone()))

  // List endpoints: a bare array, or a LimitOffset page when `limit` is given (as InvenTree does).
  // A query parameter named after a plain field filters on it (`?status=20`, `?order=1`).
  const api =
    (rows: () => Row[]) =>
    ({ request }: { request: Request }) => {
      if (!fake.signedIn) return notAuthenticated()
      const query = new URL(request.url).searchParams
      const all = rows().filter((row) =>
        [...query].every(([key, value]) => typeof row[key] === 'object' || !(key in row) || String(row[key]) === value),
      )
      if (!query.has('limit')) return HttpResponse.json(all)
      const offset = Number(query.get('offset') ?? 0)
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
    http.get('*/api/order/po/', api(() => fake.purchaseOrders)),
    http.get('*/api/order/po-line/', api(() => fake.poLines)),
    // Like InvenTree 1.6.0: no over-receipt check, quantities are in supplier packs, a line without a
    // location lands in the order's destination, and the order completes once every line is received.
    http.post('*/api/order/po/:id/receive/', async ({ request, params }) => {
      if (!fake.signedIn) return notAuthenticated()
      if (request.headers.get('X-CSRFToken') !== CSRF)
        return HttpResponse.json({ detail: 'CSRF Failed: CSRF token missing.' }, { status: 403 })
      const order = fake.purchaseOrders.find((o) => o.pk === Number(params.id))!
      if (order.status !== 20)
        return HttpResponse.json(
          { non_field_errors: ["Lines can only be received against an order marked as 'PLACED'"] },
          { status: 400 },
        )
      const body = (await request.json()) as {
        items: { line_item: number; quantity: string; location?: number }[]
        location?: number
      }
      const created = body.items.map((item) => {
        const line = fake.poLines.find((l) => l.pk === item.line_item && l.order === order.pk)!
        line.received += Number(item.quantity)
        const stockItem = {
          pk: Math.max(...fake.stock.map((s) => s.pk)) + 1,
          part: line.internal_part,
          quantity: Number(item.quantity) * line.supplier_part_detail.pack_quantity_native,
          location: item.location ?? body.location ?? order.destination,
          status: 10,
          in_stock: true,
          part_detail: line.part_detail,
        }
        fake.stock.push(stockItem)
        return stockItem
      })
      const lines = fake.poLines.filter((l) => l.order === order.pk)
      order.completed_lines = lines.filter((l) => l.received >= l.quantity).length
      if (order.completed_lines === lines.length) order.status = 30
      return HttpResponse.json(created, { status: 201 })
    }),
  )
  return fake
}

type Row = Record<string, unknown>

/** The fake as seen when InvenTree is down: Caddy answers 502 for every API call. */
export function unreachableInvenTree() {
  server.use(http.all('*/api/*', () => new HttpResponse('Bad Gateway', { status: 502 })))
}

export const sent = (fake: { requests: Request[] }, method: string, path: string) =>
  fake.requests.filter((r) => r.method === method && new URL(r.url).pathname === path)
