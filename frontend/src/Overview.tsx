import { useEffect, useState } from 'react'
import { api, everyRow } from './api'
import { locationBoard, type BoardLocation, type LocationBoard } from './stock-rules'

const PAGE = 500
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

async function fetchBoard() {
  const [locations, stock] = await Promise.all([
    everyRow((offset) => api.GET('/api/stock/location/', { params: { query: { limit: PAGE, offset } } })),
    everyRow((offset) =>
      api.GET('/api/stock/', { params: { query: { in_stock: true, part_detail: true, limit: PAGE, offset } } }),
    ),
  ])
  return locationBoard(locations, stock)
}

export default function Overview({ onError }: { onError: (e: unknown) => void }) {
  const [board, setBoard] = useState<LocationBoard>()

  useEffect(() => {
    fetchBoard().then(setBoard, onError)
  }, [onError])

  return (
    <main className="page">
      <div className="page-title">
        <h1>Stock overview</h1>
        <p className="muted">Everything the business holds, by where it is.</p>
      </div>
      {!board ? (
        <p role="status">Loading stock…</p>
      ) : (
        <div className="columns">
          <Column title="Main Warehouse" note={`${board.warehouse.length} locations`}>
            {board.warehouse.map((l) => (
              <li key={l.pk} className="row">
                <span>{l.name}</span>
                <Count loc={l} />
              </li>
            ))}
          </Column>
        </div>
      )}
    </main>
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
