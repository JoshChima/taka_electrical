import { useEffect, useState } from 'react'
import { api, everyRow } from './api'
import { fetchLocations, fetchOrderLines, fetchParts, fetchStock, fetchSupplierParts, PAGE } from './data'
import { amount, dollars } from './format'
import { isLow, lastSupplier, totalsInStock, whereIs, type Location, type StockItem } from './stock-rules'

const BASE = import.meta.env.BASE_URL

async function fetchFind() {
  const [parts, stock, locations] = await Promise.all([
    fetchParts({ active: true, category_detail: true }),
    fetchStock(),
    fetchLocations(),
  ])
  return { parts, stock, locations, totals: totalsInStock(stock) }
}
type Found = Awaited<ReturnType<typeof fetchFind>>
type FoundPart = Found['parts'][number]

type Props = { onError: (e: unknown) => void }

export default function Find({ onError }: Props) {
  const [data, setData] = useState<Found>()
  const [searchText, setSearchText] = useState('')
  const [picked, setPicked] = useState<number>()

  useEffect(() => {
    fetchFind().then(setData, onError)
  }, [onError])

  const search = searchText.trim().toLowerCase()
  const found = (data?.parts ?? []).filter(
    (p) => p.name.toLowerCase().includes(search) || (p.IPN ?? '').toLowerCase().includes(search),
  )
  const part = found.find((p) => p.pk === picked) ?? found[0]
  const total = (p: FoundPart) => data?.totals.get(p.pk) ?? 0

  return (
    <main className="page">
      <div className="page-title">
        <h1>Find a part</h1>
        <p className="muted">Search by name or part number to see how many there are and exactly where.</p>
      </div>
      <label className="search">
        Part name or part number
        <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
      </label>
      {!data ? (
        <p role="status">Loading parts…</p>
      ) : (
        <div className="split">
          <section className="card results" aria-labelledby="found">
            <h2 id="found" className="card-head">
              {found.length === 1 ? '1 part found' : `${found.length} parts found`}
            </h2>
            {!found.length && (
              <p className="card-body muted">
                No parts match. Try another word, like “breaker”, or a part number, like DEV-REC.
              </p>
            )}
            <ul aria-label="Matching parts">
              {found.map((p) => (
                <li key={p.pk}>
                  <button type="button" aria-pressed={p === part} onClick={() => setPicked(p.pk)}>
                    <span className="stack">
                      <strong>{p.name}</strong>
                      <span className="mono muted">{p.IPN}</span>
                    </span>
                    <span className="stack end">
                      <span>{amount(total(p), p.units)}</span>
                      {isLow(p, total(p)) && <span className="chip">below minimum</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {part && (
            <PartDetail key={part.pk} part={part} inStock={total(part)} stock={data.stock} locations={data.locations} onError={onError} />
          )}
        </div>
      )}
    </main>
  )
}

async function fetchDetail(part: number) {
  const [specs, lines, supplierParts] = await Promise.all([
    everyRow((offset) =>
      api.GET('/api/parameter/', { params: { query: { model_type: 'part.part', model_id: part, limit: PAGE, offset } } }),
    ),
    fetchOrderLines({ base_part: part, order_detail: true, part_detail: true }),
    fetchSupplierParts({ part, supplier_detail: true }),
  ])
  return {
    specs: specs.map((s) => [s.data, s.template_detail?.units].filter(Boolean).join(' ')),
    supplier: lastSupplier(part, lines, supplierParts),
  }
}

function PartDetail({
  part,
  inStock,
  stock,
  locations,
  onError,
}: Props & { part: FoundPart; inStock: number; stock: StockItem[]; locations: Location[] }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchDetail>>>()
  useEffect(() => {
    fetchDetail(part.pk).then(setDetail, onError)
  }, [part.pk, onError])

  const units = part.units ?? ''
  const minimum = Number(part.minimum_stock ?? 0)
  const low = isLow(part, inStock)
  const where = whereIs(part.pk, stock, locations)
  const supplier = detail?.supplier

  return (
    <section className="card part" aria-labelledby={`part-${part.pk}`}>
      <div className="card-head">
        <div className="stack">
          <span className="small muted">{part.category_detail?.pathstring?.replaceAll('/', ' › ')}</span>
          <h2 id={`part-${part.pk}`}>{part.name}</h2>
          <span className="small muted">{[part.IPN, ...(detail?.specs ?? [])].join(' · ')}</span>
        </div>
        <span className="row">
          <a className="button secondary" href={`${BASE}move?part=${part.pk}`}>
            Move stock
          </a>
          <a className="button primary" href={`${BASE}reorder?part=${part.pk}`}>
            Reorder
          </a>
        </span>
      </div>
      <div className="card-body stack gap">
        <div className="figures">
          <Figure label="In stock, everywhere" value={amount(inStock, units)} low={low} />
          <Figure label="Minimum Stock" value={amount(minimum, units)} />
          <Figure label={low ? 'Short by' : 'Above minimum by'} value={amount(Math.abs(inStock - minimum), units)} />
        </div>
        <h3 id={`where-${part.pk}`}>Where it is</h3>
        {where.length ? (
          <ul aria-labelledby={`where-${part.pk}`} className="where">
            {where.map((w) => (
              <li key={w.name} className="row">
                <span>{w.name}</span>
                <span className="num">{amount(w.quantity, units)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None in stock anywhere.</p>
        )}
      </div>
      <div className="card-foot">
        {!detail ? (
          <span role="status" className="small muted">Loading supplier…</span>
        ) : (
          <>
            <span>Last supplier · {supplier?.name ?? 'none yet, choose one when you reorder'}</span>
            <span>
              Unit cost ·{' '}
              {supplier?.unitCost == null ? 'No price yet' : `${dollars(supplier.unitCost)} ${units ? `per ${units}` : 'each'}`}
            </span>
          </>
        )}
      </div>
    </section>
  )
}

function Figure({ label, value, low }: { label: string; value: string; low?: boolean }) {
  return (
    <div role="group" aria-label={label} className={low ? 'figure low' : 'figure'}>
      <span className="small muted">{label}</span>
      <span className="figure-value">{value}</span>
    </div>
  )
}
