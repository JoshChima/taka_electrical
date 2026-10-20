import { useCallback, useEffect, useState } from 'react'
import { api, everyRow, SignedOut } from './api'
import type { components } from './inventree'
import { amount } from './Receive'
import { locationBoard, moveProblem, shortName, transferItems, warehouseStock, type Part } from './stock-rules'

const PAGE = 500
const BASE = import.meta.env.BASE_URL
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

async function fetchMove() {
  const [locations, stock, parts, projects] = await Promise.all([
    everyRow((offset) => api.GET('/api/stock/location/', { params: { query: { limit: PAGE, offset } } })),
    everyRow((offset) => api.GET('/api/stock/', { params: { query: { in_stock: true, limit: PAGE, offset } } })),
    everyRow((offset) => api.GET('/api/part/', { params: { query: { active: true, limit: PAGE, offset } } })),
    everyRow((offset) => api.GET('/api/project-code/', { params: { query: { limit: PAGE, offset } } })),
  ])
  // Destinations are never structural: InvenTree refuses transfers into them.
  const { vans, jobSites } = locationBoard(locations, stock)
  return { locations, stock, parts, vans, jobSites, projects }
}
type Data = Awaited<ReturnType<typeof fetchMove>>

/** A line as the Owner enters it. `from` is the aisle picked, or undefined for the one with the most stock. */
type Line = { part: Part; from?: number; qty: string }

type Props = { onError: (e: unknown) => void }

export default function Move({ onError }: Props) {
  const query = new URLSearchParams(window.location.search)
  const [data, setData] = useState<Data>()
  const [toSite, setToSite] = useState(query.get('to') === 'job-site')
  const [van, setVan] = useState(query.get('van') ?? '')
  const [site, setSite] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [words, setWords] = useState('')
  const [saving, setSaving] = useState(false)
  const [moved, setMoved] = useState<string>()
  const [failed, setFailed] = useState<{ message: string; lines: Record<number, string> }>()

  const refresh = useCallback(() => fetchMove().then(setData, onError), [onError])
  useEffect(() => {
    fetchMove().then((data) => {
      setData(data)
      const part = data.parts.find((p) => String(p.pk) === query.get('part'))
      if (part) setLines([{ part, qty: '' }])
    }, onError)
  }, [onError]) // The query is read once, when the page opens.

  if (!data)
    return (
      <main className="page">
        <Title />
        <p role="status">Loading stock…</p>
      </main>
    )

  const vanTo = data.vans.find((v) => String(v.pk) === van) ?? data.vans[0]
  const siteTo = data.jobSites.find((s) => String(s.pk) === site) ?? data.jobSites[0]
  const to = toSite ? siteTo : vanTo
  const project = data.projects.find((p) => p.code === siteTo?.project)

  const rows = lines.map((l) => {
    const sources = warehouseStock(l.part.pk, data.stock, data.locations)
    const from = sources.find((s) => s.pk === l.from) ?? sources[0]
    return { ...l, sources, from, problem: moveProblem(Number(l.qty), from, l.part.units ?? '') }
  })
  const q = words.trim().toLowerCase()
  const matches = q
    ? data.parts
        .filter(
          (p) =>
            !lines.some((l) => l.part.pk === p.pk) &&
            warehouseStock(p.pk, data.stock, data.locations).length &&
            (p.name.toLowerCase().includes(q) || (p.IPN ?? '').toLowerCase().includes(q)),
        )
        .slice(0, 8)
    : []
  const change = (i: number, line: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...line } : l)))

  const count = plural(lines.length, 'part')
  const action = !lines.length
    ? 'Add parts to move'
    : toSite
      ? `Stage ${count} at ${siteTo?.project}`
      : `Move ${count} to ${shortName(vanTo?.name ?? '')}`
  const toLabel = toSite ? `Job Site for ${siteTo?.project} ${siteTo?.name}` : vanTo?.name

  const move = async () => {
    if (!to) return
    setSaving(true)
    setMoved(undefined)
    setFailed(undefined)
    const items = transferItems(
      rows.map((r) => ({ part: r.part.pk, from: r.from!.pk, quantity: Number(r.qty) })),
      data.stock,
    )
    const body = { items: items.map(({ pk, quantity }) => ({ pk, quantity })), location: to.pk }
    try {
      const answer = await api
        .POST('/api/stock/transfer/', { body: body as components['schemas']['StockTransfer'] })
        .catch(() => null)
      if (answer?.response.status === 401) throw new SignedOut()
      if (answer?.response.status === 400) {
        // InvenTree runs the whole transfer in one transaction, so nothing moved. Item errors are keyed by item index.
        const error = (answer.error ?? {}) as { items?: Record<string, Record<string, string[]>>; location?: string[] }
        const failedLines: Record<number, string> = {}
        for (const [i, fields] of Object.entries(error.items ?? {}))
          failedLines[items[Number(i)].line] = `Not moved: ${Object.values(fields).flat().join(' ')}`
        setFailed({ message: ['The move failed and nothing was moved.', ...(error.location ?? [])].join(' '), lines: failedLines })
        return
      }
      if (!answer?.response.ok) {
        const why = answer ? `InvenTree answered ${answer.response.status}` : "the server couldn't be reached"
        setFailed({ message: `The move failed: ${why}. Check the stock, then try again.`, lines: {} })
        return
      }
      setMoved(toSite ? `Staged ${count} at ${siteTo?.project} ${siteTo?.name}.` : `Moved ${count} to ${vanTo?.name}.`)
      setLines([])
      await refresh()
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="page">
      <Title />
      {moved && (
        <p role="status" className="notice">
          {moved}
        </p>
      )}
      {failed && (
        <p role="alert" className="problem">
          {failed.message}
        </p>
      )}
      <div className="split">
        <div className="move stack gap">
          <section className="card" aria-labelledby="route">
            <h2 id="route" className="card-head">
              From and to
            </h2>
            <div className="card-body stack gap">
              <div className="line">
                <div className="field grow">
                  <label htmlFor="from">From</label>
                  <select id="from">
                    <option>Main Warehouse</option>
                  </select>
                </div>
                <div className="field grow">
                  <span id="to-a" className="small muted">
                    To a
                  </span>
                  <div role="group" aria-labelledby="to-a" className="toggle">
                    <button type="button" aria-pressed={!toSite} onClick={() => setToSite(false)}>
                      Van
                    </button>
                    <button type="button" aria-pressed={toSite} onClick={() => setToSite(true)}>
                      Job Site
                    </button>
                  </div>
                </div>
                {toSite ? (
                  <div className="field grow">
                    <label htmlFor="site">Job Site</label>
                    <select id="site" value={siteTo?.pk ?? ''} onChange={(e) => setSite(e.target.value)}>
                      {data.jobSites.map((s) => (
                        <option key={s.pk} value={s.pk}>
                          {s.project} {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="field grow">
                    <label htmlFor="van">Van</label>
                    <select id="van" value={vanTo?.pk ?? ''} onChange={(e) => setVan(e.target.value)}>
                      {data.vans.map((v) => (
                        <option key={v.pk} value={v.pk}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {toSite && siteTo && (
                <p className="small muted">
                  {[`${siteTo.project} ${siteTo.name}`, siteTo.description, project?.description].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </section>
          <section className="card" aria-labelledby="parts-to-move">
            <h2 id="parts-to-move" className="card-head">
              Parts to move
            </h2>
            <ul>
              {rows.map((r, i) => (
                <li key={r.part.pk}>
                  <div role="group" aria-labelledby={`move-${r.part.pk}`} className="line">
                    <div className="stack name">
                      <strong id={`move-${r.part.pk}`}>{r.part.name}</strong>
                      <span className="small muted">
                        <span className="mono">{r.part.IPN}</span> ·{' '}
                        {r.from ? `${amount(r.from.quantity, r.part.units ?? '')} in ${r.from.name}` : 'none in the warehouse'}
                      </span>
                    </div>
                    {r.sources.length > 1 && (
                      <div className="field">
                        <label htmlFor={`from-${r.part.pk}`}>Take from</label>
                        <select
                          id={`from-${r.part.pk}`}
                          value={r.from?.pk}
                          onChange={(e) => change(i, { from: Number(e.target.value) })}
                        >
                          {r.sources.map((s) => (
                            <option key={s.pk} value={s.pk}>
                              {s.name} ({amount(s.quantity, r.part.units ?? '')})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor={`qty-${r.part.pk}`}>Qty</label>
                      <span className="row">
                        <input
                          id={`qty-${r.part.pk}`}
                          type="number"
                          min="0"
                          max={r.from?.quantity}
                          inputMode="decimal"
                          aria-invalid={!!(r.qty && r.problem)}
                          aria-describedby={r.qty && r.problem ? `move-problem-${r.part.pk}` : undefined}
                          value={r.qty}
                          onChange={(e) => change(i, { qty: e.target.value })}
                        />
                        <span className="small muted">{r.part.units || 'each'}</span>
                        <button
                          type="button"
                          className="remove"
                          aria-label={`Remove ${r.part.name}`}
                          onClick={() => {
                            setLines(lines.filter((_, j) => j !== i))
                            setFailed(undefined) // its line numbers no longer match
                          }}
                        >
                          ×
                        </button>
                      </span>
                    </div>
                    {((r.qty && r.problem) || failed?.lines[i]) && (
                      <p id={`move-problem-${r.part.pk}`} role="alert" className="problem full">
                        {failed?.lines[i] ?? r.problem}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="card-body stack">
              <label>
                Add a part
                <input
                  type="search"
                  placeholder="Name or part number"
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                />
              </label>
              {matches.map((p) => (
                <button
                  key={p.pk}
                  type="button"
                  className="secondary add"
                  aria-label={`Add ${p.name}`}
                  onClick={() => {
                    setLines([...lines, { part: p, qty: '' }])
                    setWords('')
                  }}
                >
                  {p.name} <span className="mono muted">{p.IPN}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
        <aside className="card summary" aria-labelledby="summary">
          <h2 id="summary" className="card-head">
            Summary
          </h2>
          <dl className="card-body">
            <dt>From</dt>
            <dd>Main Warehouse</dd>
            <dt>To</dt>
            <dd>{toLabel}</dd>
            <dt>Parts</dt>
            <dd>{count}</dd>
          </dl>
          <div className="card-foot stack">
            <span className="small muted">The stock leaves its warehouse aisle and shows up at the destination straight away.</span>
            <button
              type="button"
              className="primary"
              disabled={saving || !lines.length || rows.some((r) => r.problem)}
              onClick={move}
            >
              {action}
            </button>
            <a href={BASE}>Cancel</a>
          </div>
        </aside>
      </div>
    </main>
  )
}

const Title = () => (
  <div className="page-title">
    <h1>Move stock</h1>
    <p className="muted">Restock a Van, or stage material at a Job Site for its Project.</p>
  </div>
)
