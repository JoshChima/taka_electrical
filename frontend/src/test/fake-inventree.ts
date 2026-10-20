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
    parts: structuredClone(seed.parts),
    projectCodes: structuredClone(seed.projectCodes),
    purchaseOrders: structuredClone(seed.purchaseOrders),
    poLines: structuredClone(seed.poLines),
    supplierParts: structuredClone(seed.supplierParts),
    parameters: structuredClone(seed.parameters),
    /** Every request the app sent, in order. */
    requests: [] as Request[],
  }
  server.events.on('request:start', ({ request }) => fake.requests.push(request.clone()))

  // List endpoints: a bare array, or a LimitOffset page when `limit` is given (as InvenTree does).
  // A query parameter named after a plain field filters on it (`?status=20`, `?order=1`).
  const api =
    (rows: (query: URLSearchParams) => Row[]) =>
    ({ request }: { request: Request }) => {
      if (!fake.signedIn) return notAuthenticated()
      const query = new URL(request.url).searchParams
      const all = rows(query).filter((row) =>
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
    http.get('*/api/part/', api(() => fake.parts)),
    http.get('*/api/project-code/', api(() => fake.projectCodes)),
    http.get('*/api/order/po/', api(() => fake.purchaseOrders)),
    http.get(
      '*/api/order/po-line/',
      api((query) =>
        fake.poLines
          .filter((line) => !query.has('base_part') || String(line.internal_part) === query.get('base_part'))
          .map((line) =>
            query.get('order_detail') === 'true'
              ? { ...line, order_detail: fake.purchaseOrders.find((o) => o.pk === line.order) }
              : line,
          ),
      ),
    ),
    http.get('*/api/company/part/', api(() => fake.supplierParts)),
    http.get('*/api/parameter/', api(() => fake.parameters)),
    // Like InvenTree 1.6.0: the reference comes from PO-{ref:04d}, a new order is pending (10).
    http.post('*/api/order/po/', async ({ request }) => {
      if (!fake.signedIn) return notAuthenticated()
      if (request.headers.get('X-CSRFToken') !== CSRF)
        return HttpResponse.json({ detail: 'CSRF Failed: CSRF token missing.' }, { status: 403 })
      const body = (await request.json()) as { supplier: number; description?: string; project_code?: number }
      const pk = Math.max(...fake.purchaseOrders.map((o) => o.pk)) + 1
      const order = {
        pk, reference: `PO-${String(pk).padStart(4, '0')}`, supplier: body.supplier,
        supplier_name: fake.supplierParts.find((s) => s.supplier === body.supplier)!.supplier_detail.name,
        supplier_reference: '', status: 10, status_text: 'Pending', project_code: body.project_code ?? null,
        project_code_label: null, description: body.description ?? '', target_date: null, issue_date: null,
        destination: null, line_items: 0, completed_lines: 0,
      }
      fake.purchaseOrders.push(order as unknown as (typeof fake.purchaseOrders)[number])
      return HttpResponse.json(order, { status: 201 })
    }),
    // `part` is the supplier part and `quantity` is in its packs.
    http.post('*/api/order/po-line/', async ({ request }) => {
      if (!fake.signedIn) return notAuthenticated()
      if (request.headers.get('X-CSRFToken') !== CSRF)
        return HttpResponse.json({ detail: 'CSRF Failed: CSRF token missing.' }, { status: 403 })
      const body = (await request.json()) as { order: number; part: number; quantity: number; purchase_price?: string }
      const order = fake.purchaseOrders.find((o) => o.pk === body.order)!
      const supplierPart = fake.supplierParts.find((s) => s.pk === body.part)!
      const part = fake.parts.find((p) => p.pk === supplierPart.part)!
      const line = {
        pk: Math.max(...fake.poLines.map((l) => l.pk)) + 1, order: order.pk, part: supplierPart.pk,
        quantity: Number(body.quantity), received: 0,
        purchase_price: body.purchase_price == null ? null : Number(body.purchase_price),
        project_code: order.project_code, project_code_label: order.project_code_label, destination: null,
        sku: supplierPart.SKU, ipn: part.IPN, internal_part: part.pk, internal_part_name: part.name,
        part_detail: { pk: part.pk, IPN: part.IPN, name: part.name, units: part.units }, supplier_part_detail: supplierPart,
      }
      fake.poLines.push(line as unknown as (typeof fake.poLines)[number])
      order.line_items += 1
      return HttpResponse.json(line, { status: 201 })
    }),
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
    // Like InvenTree 1.6.0: all lines in one transaction, errors keyed by line index, no structural
    // destinations, and a quantity above what the item holds is NOT rejected: the whole item moves.
    http.post('*/api/stock/transfer/', async ({ request }) => {
      if (!fake.signedIn) return notAuthenticated()
      if (request.headers.get('X-CSRFToken') !== CSRF)
        return HttpResponse.json({ detail: 'CSRF Failed: CSRF token missing.' }, { status: 403 })
      const body = (await request.json()) as { items: { pk: number; quantity: string }[]; location: number }
      if (fake.locations.find((l) => l.pk === body.location)?.structural)
        return HttpResponse.json({ location: ['Structural locations cannot be assigned stock items'] }, { status: 400 })
      const errors: Record<number, Record<string, string[]>> = {}
      body.items.forEach(({ pk, quantity }, i) => {
        if (!fake.stock.some((s) => s.pk === pk)) errors[i] = { pk: [`Invalid pk "${pk}" - object does not exist.`] }
        else if (!(Number(quantity) > 0)) errors[i] = { quantity: ['Quantity must be greater than zero'] }
      })
      if (Object.keys(errors).length) return HttpResponse.json({ items: errors }, { status: 400 })
      for (const { pk, quantity } of body.items) {
        const item = fake.stock.find((s) => s.pk === pk)!
        if (Number(quantity) >= item.quantity) item.location = body.location
        else {
          item.quantity -= Number(quantity)
          fake.stock.push({ ...item, pk: Math.max(...fake.stock.map((s) => s.pk)) + 1, quantity: Number(quantity), location: body.location })
        }
      }
      return HttpResponse.json(body, { status: 201 })
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
