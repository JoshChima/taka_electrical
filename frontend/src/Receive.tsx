import { useCallback, useEffect, useState } from 'react'
import { api, everyRow, load } from './api'
import type { components } from './inventree'
import {
  arrivalProblem,
  deliveryLines,
  expectedDeliveries,
  locationBoard,
  receiveItems,
  type BoardLocation,
  type DeliveryLine,
  type PartWithCategory,
  type PurchaseOrder,
} from './stock-rules'

const PAGE = 500
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
export const amount = (n: number, units: string) => n.toLocaleString('en-US') + (units ? ` ${units}` : '')

/** "2026-10-26" → "26 Oct". */
export const dueDate = (date?: string | null) =>
  date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'not set'

export async function fetchExpected() {
  const orders = await everyRow((offset) =>
    api.GET('/api/order/po/', { params: { query: { status: 20, limit: PAGE, offset } } }),
  )
  return expectedDeliveries(orders)
}

type Props = { onError: (e: unknown) => void }

export default function Receive({ onError }: Props) {
  const [orders, setOrders] = useState<PurchaseOrder[]>()
  const [aisles, setAisles] = useState<BoardLocation[]>([])
  const [parts, setParts] = useState<PartWithCategory[]>([])
  const [picked, setPicked] = useState<number>()
  const [booked, setBooked] = useState<string>()

  const refresh = useCallback(() => fetchExpected().then(setOrders, onError), [onError])
  useEffect(() => {
    Promise.all([
      fetchExpected(),
      everyRow((offset) => api.GET('/api/stock/location/', { params: { query: { limit: PAGE, offset } } })),
      everyRow((offset) => api.GET('/api/part/', { params: { query: { category_detail: true, limit: PAGE, offset } } })),
    ]).then(([orders, locations, parts]) => {
      // Put-away choices: the warehouse aisles and the Tool Crib, never a structural location.
      setAisles(locationBoard(locations, []).warehouse)
      setParts(parts)
      setOrders(orders)
    }, onError)
  }, [onError])

  const order = orders?.find((o) => o.pk === picked) ?? orders?.[0]

  return (
    <main className="page">
      <div className="page-title">
        <h1>Receive a delivery</h1>
        <p className="muted">Pick the purchase order the delivery is for, check the counts, and book it into the warehouse.</p>
      </div>
      {booked && (
        <p role="status" className="notice">
          {booked}
        </p>
      )}
      {!orders ? (
        <p role="status">Loading deliveries…</p>
      ) : (
        <div className="split">
          <section className="card orders" aria-labelledby="expected">
            <h2 id="expected" className="card-head">
              Expected deliveries
            </h2>
            {!orders.length && <p className="card-body muted">No deliveries expected.</p>}
            <ul>
              {orders.map((o) => (
                <li key={o.pk}>
                  <button type="button" aria-pressed={o === order} onClick={() => setPicked(o.pk)}>
                    <span className="row">
                      <strong>{o.supplier_name}</strong>
                      <span className="small muted">Due {dueDate(o.target_date)}</span>
                    </span>
                    <span className="small muted">
                      <span className="mono">{o.reference}</span> · {plural(o.line_items ?? 0, 'part')}
                      {o.project_code_label && `, for ${o.project_code_label}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {order && (
            <Delivery
              key={order.pk}
              order={order}
              aisles={aisles}
              parts={parts}
              onError={onError}
              onBooked={(message) => {
                setBooked(message)
                refresh()
              }}
            />
          )}
        </div>
      )}
    </main>
  )
}

function Delivery({
  order,
  aisles,
  parts,
  onError,
  onBooked,
}: Props & { order: PurchaseOrder; aisles: BoardLocation[]; parts: PartWithCategory[]; onBooked: (message: string) => void }) {
  const [lines, setLines] = useState<DeliveryLine[]>()
  const [arrived, setArrived] = useState<Record<number, string>>({})
  const [where, setWhere] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)

  const loadLines = useCallback(
    () =>
      everyRow((offset) =>
        api.GET('/api/order/po-line/', { params: { query: { order: order.pk, part_detail: true, limit: PAGE, offset } } }),
      ).then((rows) => {
        const lines = deliveryLines(rows, parts)
        setLines(lines)
        setArrived(Object.fromEntries(lines.map((l) => [l.pk, String(l.outstanding)])))
        setWhere(Object.fromEntries(lines.map((l) => [l.pk, String(l.putAway ?? '')])))
      }, onError),
    [order.pk, parts, onError],
  )
  useEffect(() => {
    loadLines()
  }, [loadLines])

  const arrivals = (lines ?? []).map((l) => ({
    quantity: Number(arrived[l.pk] ?? 0),
    location: where[l.pk] ? Number(where[l.pk]) : null,
  }))
  const problems = (lines ?? []).map((l, i) => arrivalProblem(l, arrivals[i]))
  const items = receiveItems(lines ?? [], arrivals)

  const book = async () => {
    setSaving(true)
    try {
      // The schema marks fields with server-side defaults (batch code, status, …) as required; InvenTree doesn't.
      const body = { items } as components['schemas']['PurchaseOrderReceive']
      await load(api.POST('/api/order/po/{id}/receive/', { params: { path: { id: order.pk } }, body }))
      onBooked(`Booked in ${order.reference}: ${plural(items.length, 'line')} put away.`)
      await loadLines()
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }

  const title = `${order.reference} · ${order.supplier_name}`
  return (
    <section className="card delivery" aria-label={title}>
      <div className="card-head">
        <div className="stack">
          <h2>{title}</h2>
          <span className="small muted">
            Supplier ref {order.supplier_reference || 'none'}
            {order.project_code_label && ` · for ${order.project_code_label}`} · due {dueDate(order.target_date)}
          </span>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={!lines}
          onClick={() => setArrived(Object.fromEntries((lines ?? []).map((l) => [l.pk, String(l.outstanding)])))}
        >
          Everything arrived
        </button>
      </div>
      {!lines ? (
        <p role="status" className="card-body">
          Loading lines…
        </p>
      ) : (
        <ul>
          {lines.map((l, i) => (
            <li key={l.pk}>
              <div role="group" aria-labelledby={`line-${l.pk}`} className="line">
                <div className="stack name">
                  <strong id={`line-${l.pk}`}>{l.name}</strong>
                  <span className="small muted">
                    <span className="mono">{l.ipn}</span> · ordered {amount(l.ordered, l.units)}, received so far{' '}
                    {amount(l.received, l.units)}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor={`arrived-${l.pk}`}>Arrived today</label>
                  <span className="row">
                    <input
                      id={`arrived-${l.pk}`}
                      type="number"
                      min="0"
                      max={l.outstanding}
                      inputMode="decimal"
                      aria-invalid={!!problems[i]}
                      aria-describedby={problems[i] ? `problem-${l.pk}` : undefined}
                      value={arrived[l.pk] ?? ''}
                      onChange={(e) => setArrived({ ...arrived, [l.pk]: e.target.value })}
                    />
                    <span className="small muted">{l.units || 'each'}</span>
                  </span>
                </div>
                <div className="field grow">
                  <label htmlFor={`put-away-${l.pk}`}>Put away in</label>
                  <select
                    id={`put-away-${l.pk}`}
                    value={where[l.pk] ?? ''}
                    onChange={(e) => setWhere({ ...where, [l.pk]: e.target.value })}
                  >
                    <option value="" disabled>
                      Choose an aisle
                    </option>
                    {aisles.map((a) => (
                      <option key={a.pk} value={a.pk}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                {problems[i] && (
                  <p id={`problem-${l.pk}`} role="alert" className="problem full">
                    {problems[i]}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="card-foot">
        <span className="small muted">Book in less than was ordered and the rest stays open on the order.</span>
        <button
          type="button"
          className="primary"
          disabled={saving || !items.length || problems.some(Boolean)}
          onClick={book}
        >
          {items.length ? `Book in delivery for ${order.reference}` : 'Enter what arrived'}
        </button>
      </div>
    </section>
  )
}
