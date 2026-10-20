import { useCallback, useEffect, useState } from 'react'
import { api, everyRow, load } from './api'
import { dollars } from './Find'
import type { components } from './inventree'
import { amount } from './Receive'
import {
  isLow,
  lastSupplier,
  orderDrafts,
  purchaseOrderLines,
  stockPositions,
  suggestedQuantity,
  totalsInStock,
  type OrderDraft,
} from './stock-rules'

const PAGE = 500
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The low parts, plus the part the Owner came from Find to reorder (`?part=`), even if it isn't low. */
async function fetchReorder(focus?: number) {
  const [parts, stock, lines, supplierParts] = await Promise.all([
    everyRow((offset) => api.GET('/api/part/', { params: { query: { active: true, limit: PAGE, offset } } })),
    everyRow((offset) => api.GET('/api/stock/', { params: { query: { in_stock: true, limit: PAGE, offset } } })),
    everyRow((offset) =>
      api.GET('/api/order/po-line/', { params: { query: { order_detail: true, part_detail: true, limit: PAGE, offset } } }),
    ),
    everyRow((offset) => api.GET('/api/company/part/', { params: { query: { supplier_detail: true, limit: PAGE, offset } } })),
  ])
  const totals = totalsInStock(stock)
  const wanted = parts.filter((p) => isLow(p, totals.get(p.pk) ?? 0) || p.pk === focus)
  return { rows: stockPositions(wanted, stock, lines, []), lines, supplierParts }
}

type Props = { onError: (e: unknown) => void }

export default function Reorder({ onError }: Props) {
  const [focus] = useState(() => Number(new URLSearchParams(location.search).get('part')) || undefined)
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchReorder>>>()
  // The Owner's changes to the suggested quantity and the last supplier, per part pk.
  const [quantities, setQuantities] = useState<Record<number, string>>({})
  const [suppliers, setSuppliers] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState<number>()
  const [created, setCreated] = useState<string>()

  const refresh = useCallback(() => fetchReorder(focus).then(setData, onError), [focus, onError])
  useEffect(() => {
    refresh()
  }, [refresh])
  useEffect(() => {
    if (data && focus) document.getElementById(`quantity-${focus}`)?.focus()
  }, [data, focus])

  if (!data)
    return (
      <main className="page">
        <h1>Reorder</h1>
        <p role="status">Loading low parts…</p>
      </main>
    )

  const { rows, lines, supplierParts } = data
  const last = new Map(rows.map((p) => [p.pk, lastSupplier(p.pk, lines, supplierParts)]))
  const names = new Map(supplierParts.map((s) => [s.supplier, s.supplier_detail?.name ?? '']))
  const choices = rows.map((p) => ({
    part: p.pk,
    quantity: Number(quantities[p.pk] ?? suggestedQuantity(p)),
    supplier: suppliers[p.pk] ?? last.get(p.pk)?.pk,
  }))
  const drafts = orderDrafts(choices, lines)
  const low = rows.filter((p) => p.inStock < p.minimum).length

  const create = async (draft: OrderDraft) => {
    setSaving(draft.supplier)
    try {
      // The schema marks fields with server-side defaults as required; InvenTree doesn't. No Project code.
      const body = { supplier: draft.supplier, description: 'Warehouse restock' } as components['schemas']['PurchaseOrder']
      const order = await load(api.POST('/api/order/po/', { body }))
      for (const line of purchaseOrderLines(draft, supplierParts)) {
        const body = { order: order.pk, ...line } as unknown as components['schemas']['PurchaseOrderLineItem']
        await load(api.POST('/api/order/po-line/', { body }))
      }
      setCreated(`Created ${order.reference} for ${names.get(draft.supplier!)}. It is On Order now.`)
      const done = new Set(draft.lines.map((l) => l.part))
      setQuantities((q) => Object.fromEntries(Object.entries(q).filter(([pk]) => !done.has(Number(pk)))))
      await refresh()
    } catch (e) {
      onError(e)
    } finally {
      setSaving(undefined)
    }
  }

  return (
    <main className="page reorder">
      <div className="page-title">
        <h1>Reorder</h1>
        <p className="muted">
          {plural(low, 'part')} {low === 1 ? 'is' : 'are'} below Minimum Stock. Suggested quantities bring each one back up to
          its minimum after what is On Order, and each part goes to the supplier you last bought it from. Change a supplier
          and the part moves to that supplier's order.
        </p>
      </div>
      {created && (
        <p role="status" className="notice">
          {created}
        </p>
      )}
      {drafts.map((draft) => {
        const name = draft.supplier == null ? undefined : names.get(draft.supplier)
        const ordering = draft.lines.filter((l) => l.quantity > 0).length
        const invalid = draft.lines.some((l) => !Number.isFinite(l.quantity) || l.quantity < 0)
        return (
          <section
            key={draft.supplier ?? 'none'}
            className="card"
            aria-label={name ? `Purchase order draft for ${name}` : 'Parts with no supplier yet'}
          >
            <div className="card-head">
              <div className="stack">
                <span className="small muted">{name ? 'Purchase order draft' : 'No supplier yet'}</span>
                <h2>{name ?? 'Choose a supplier for these parts'}</h2>
              </div>
              <span className="small muted">{plural(draft.lines.length, 'part')}</span>
            </div>
            <ul>
              {draft.lines.map((l) => {
                const p = rows.find((r) => r.pk === l.part)!
                const lastUsed = last.get(p.pk)
                const options = supplierParts.filter((s) => s.part === p.pk)
                const each = p.units ? `per ${p.units}` : 'each'
                return (
                  <li key={p.pk}>
                    <div role="group" aria-labelledby={`part-${p.pk}`} className="line">
                      <div className="stack name">
                        <strong id={`part-${p.pk}`}>{p.name}</strong>
                        <span className="small muted">
                          <span className="mono">{p.ipn}</span> · {amount(p.inStock, p.units)} in stock · minimum{' '}
                          {amount(p.minimum, p.units)} · {amount(p.onOrder, p.units)} on order
                          {suggestedQuantity(p) === 0 && (
                            <span className="chip covered">{p.inStock < p.minimum ? 'Covered' : 'Not below minimum'}</span>
                          )}
                        </span>
                      </div>
                      <div className="field">
                        <label htmlFor={`quantity-${p.pk}`}>Quantity</label>
                        <span className="row">
                          <input
                            id={`quantity-${p.pk}`}
                            type="number"
                            min="0"
                            inputMode="decimal"
                            value={quantities[p.pk] ?? String(suggestedQuantity(p))}
                            onChange={(e) => setQuantities({ ...quantities, [p.pk]: e.target.value })}
                          />
                          <span className="small muted">{p.units || 'each'}</span>
                        </span>
                      </div>
                      <div className="field grow">
                        <label htmlFor={`supplier-${p.pk}`}>
                          Supplier{lastUsed ? ` · last used ${lastUsed.name}` : ''}
                        </label>
                        <select
                          id={`supplier-${p.pk}`}
                          value={l.supplier ?? ''}
                          onChange={(e) => setSuppliers({ ...suppliers, [p.pk]: Number(e.target.value) })}
                        >
                          <option value="" disabled>
                            Choose a supplier
                          </option>
                          {options.map((s) => (
                            <option key={s.supplier} value={s.supplier}>
                              {s.supplier_detail?.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="stack end price">
                        <strong>{l.unitCost == null ? 'No price yet' : dollars(l.unitCost * l.quantity)}</strong>
                        <span className="small muted">
                          {l.unitCost == null
                            ? l.supplier == null
                              ? 'Choose a supplier'
                              : 'Not bought from them before'
                            : `${dollars(l.unitCost)} ${each}`}
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            {name && (
              <div className="card-foot">
                <span>
                  <span className="muted">Order total</span> <strong>{dollars(draft.total)}</strong>
                  {draft.unpriced > 0 && (
                    <span className="muted">, excluding {plural(draft.unpriced, 'part')} with no price yet</span>
                  )}
                </span>
                <button
                  type="button"
                  className="primary"
                  disabled={saving != null || !ordering || invalid}
                  onClick={() => create(draft)}
                >
                  Create purchase order
                </button>
              </div>
            )}
          </section>
        )
      })}
      <p className="small muted">
        Creating an order records it in InvenTree as a draft. It isn't sent: send it to the supplier yourself, by phone,
        email or at the counter.
      </p>
    </main>
  )
}
