import { useEffect, useState } from 'react'
import { api, everyRow } from './api'
import { locationBoard, lowStock, partsTracked, type BoardLocation } from './stock-rules'

const PAGE = 500
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

async function fetchOverview() {
  const [locations, stock, parts, lines, projects] = await Promise.all([
    everyRow((offset) => api.GET('/api/stock/location/', { params: { query: { limit: PAGE, offset } } })),
    everyRow((offset) =>
      api.GET('/api/stock/', { params: { query: { in_stock: true, part_detail: true, limit: PAGE, offset } } }),
    ),
    everyRow((offset) => api.GET('/api/part/', { params: { query: { active: true, limit: PAGE, offset } } })),
    everyRow((offset) =>
      api.GET('/api/order/po-line/', { params: { query: { pending: true, order_detail: true, limit: PAGE, offset } } }),
    ),
    everyRow((offset) => api.GET('/api/project-code/', { params: { query: { limit: PAGE, offset } } })),
  ])
  const low = lowStock(parts, stock, lines, locations)
  return {
    board: locationBoard(locations, stock, new Set(low.map((p) => p.pk))),
    low,
    activeProjects: projects.filter((p) => p.active).length,
    partsTracked: partsTracked(parts),
  }
}

export default function Overview({ onError }: { onError: (e: unknown) => void }) {
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof fetchOverview>>>()

  useEffect(() => {
    fetchOverview().then(setOverview, onError)
  }, [onError])
  const { board, low, activeProjects = 0, partsTracked: tracked = 0 } = overview ?? {}

  return (
    <main className="page">
      <div className="page-title">
        <h1>Stock overview</h1>
        <p className="muted">Everything the business holds, by where it is.</p>
      </div>
      {!board || !low ? (
        <p role="status">Loading stock…</p>
      ) : (
        <>
        <div className="tiles">
          <Tile label="Below Minimum Stock" value={plural(low.length, 'part')} low={low.length > 0} />
          <Tile
            label="Active Projects"
            value={String(activeProjects)}
            note={`Material staged at ${board.jobSites.filter((s) => s.partCount).length} of ${board.jobSites.length} Job Sites`}
          />
          <Tile
            label="Parts tracked"
            value={String(tracked)}
            note={`Across ${board.warehouse.length + board.vans.length + board.jobSites.length} locations`}
          />
        </div>
        <div className="columns">
          <Column title="Main Warehouse" note={`${board.warehouse.length} locations`}>
            {board.warehouse.map((l) => (
              <li key={l.pk} className="row">
                <span className="grow">{l.name}</span>
                {l.lowCount > 0 && <span className="chip">{l.lowCount} low</span>}
                <Count loc={l} />
              </li>
            ))}
          </Column>
          <Column title="Vans" note={plural(board.vans.length, 'Van')}>
            {board.vans.map((l) => (
              <li key={l.pk} className="stack">
                <div className="row">
                  <strong>{l.name}</strong>
                  <Count loc={l} />
                </div>
                <span className="muted small">{l.description}</span>
              </li>
            ))}
          </Column>
          <Column title="Job Sites" note="One per Project">
            {board.jobSites.map((s) => (
              <li key={s.pk} className="stack">
                <div className="row">
                  <strong>{s.name}</strong>
                  <span className="mono small muted">{s.project}</span>
                </div>
                <span className="muted small">{s.description}</span>
                <span className="small">
                  {s.partCount
                    ? `${plural(s.partCount, 'part')} staged: ${s.partNames.join(', ')}`
                    : 'Nothing staged yet'}
                </span>
              </li>
            ))}
          </Column>
        </div>
        <section className="card" aria-labelledby="low">
          <div className="card-head">
            <div className="stack">
              <h2 id="low">Below Minimum Stock</h2>
              <span className="muted small">Counted across the warehouse, every Van and every Job Site</span>
            </div>
          </div>
          <div className="scroll-x">
            <table aria-labelledby="low">
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  <th scope="col" className="num">In stock</th>
                  <th scope="col" className="num">Minimum</th>
                  <th scope="col" className="num">Short by</th>
                  <th scope="col" className="num">On Order</th>
                  <th scope="col">Where it is</th>
                </tr>
              </thead>
              <tbody>
                {low.map((p) => (
                  <tr key={p.pk}>
                    <td>
                      <div className="strong">{p.name}</div>
                      <div className="mono muted">{p.ipn}</div>
                    </td>
                    <td className="num">{qty(p.inStock, p.units)}</td>
                    <td className="num muted">{qty(p.minimum, p.units)}</td>
                    <td className="num short">{qty(p.shortBy, p.units)}</td>
                    <td className="num">
                      {p.onOrder ? qty(p.onOrder, p.units) : '—'}
                      {p.covered && <span className="chip covered">Covered</span>}
                    </td>
                    <td className="muted">{p.where.map((w) => `${w.name} ${qty(w.quantity, p.units)}`).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        </>
      )}
    </main>
  )
}

/** A quantity with its unit: "2,500 ft"; parts counted by the piece have no unit. */
const qty = (n: number, units: string) => `${n.toLocaleString('en-US')}${units ? ` ${units}` : ''}`

function Tile({ label, value, note, low }: { label: string; value: string; note?: string; low?: boolean }) {
  return (
    <div role="group" aria-label={`${value} ${label.replace(/^\w/, (c) => c.toLowerCase())}`} className={low ? 'tile low' : 'tile'}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {note && <span className="small muted">{note}</span>}
    </div>
  )
}

function Column({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  const id = `col-${title.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <section className="card" aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id}>{title}</h2>
        <span className="muted small">{note}</span>
      </div>
      <ul>{children}</ul>
    </section>
  )
}

const Count = ({ loc }: { loc: BoardLocation }) => <span className="muted count">{plural(loc.partCount, 'part')}</span>
