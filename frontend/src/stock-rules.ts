// The stock rules: turns raw InvenTree data into what the screens show.
// Pure functions only, so every screen reads the same rules (see spec #1).
import type { components } from './inventree'

export type Location = Pick<components['schemas']['Location'], 'pk' | 'name' | 'description' | 'pathstring' | 'level'>
export type StockItem = Pick<components['schemas']['StockItem'], 'pk' | 'part' | 'quantity' | 'location'> & {
  part_detail?: Pick<NonNullable<components['schemas']['StockItem']['part_detail']>, 'name'> | null
}
export type Part = Pick<components['schemas']['Part'], 'pk' | 'name' | 'IPN' | 'units' | 'minimum_stock' | 'assembly'>

export type PurchaseOrderLine = Pick<components['schemas']['PurchaseOrderLineItem'], 'internal_part' | 'quantity' | 'received'> & {
  order_detail?: Pick<components['schemas']['PurchaseOrder'], 'status' | 'project_code'> | null
}

/** Purchase order statuses that are still open: pending, placed, on hold. */
const OPEN_ORDER = [10, 20, 25]

/**
 * On Order, per part pk: ordered minus received on open purchase orders that have no Project code
 * (a Project's material is spoken for). InvenTree's own `Part.ordering` counts Project orders too, so isn't used.
 * ponytail: quantities are in supplier packs; every stocked part has a pack of 1 except wire (500 ft reels).
 * Multiply by `supplier_part_detail.pack_quantity_native` once restock orders for wire are placed in reels.
 */
export function onOrder(lines: PurchaseOrderLine[]) {
  const totals = new Map<number, number>()
  for (const line of lines) {
    const order = line.order_detail
    if (!order || !OPEN_ORDER.includes(order.status) || order.project_code != null) continue
    const outstanding = Math.max(0, Number(line.quantity) - Number(line.received))
    totals.set(line.internal_part, (totals.get(line.internal_part) ?? 0) + outstanding)
  }
  return totals
}

export type LowPart = {
  pk: number
  name: string
  ipn: string
  units: string
  inStock: number
  minimum: number
  shortBy: number
  onOrder: number
  /** On Order makes up the whole shortfall. The part is still low until it arrives. */
  covered: boolean
  /** Where the part is, most first: short location name and quantity. */
  where: { name: string; quantity: number }[]
}

/** Parts tracked: every part the business stocks. Install kits (assemblies) are built for a Project, not stocked. */
export const partsTracked = (parts: Part[]) => parts.filter((p) => !p.assembly).length

/** Total in stock: the sum over every location, per part pk. */
export function totalsInStock(stock: StockItem[]) {
  const totals = new Map<number, number>()
  for (const item of stock) totals.set(item.part, (totals.get(item.part) ?? 0) + Number(item.quantity))
  return totals
}

/** "Aisle C - Boxes & Devices" -> "Aisle C", "Van 03 (Service Calls)" -> "Van 03". */
const shortName = (name: string) => name.replace(/ - .*| \(.*/, '')

/**
 * Low: total in stock is below Minimum Stock. A Minimum Stock of 0 is never low (stock can't go below 0).
 * Most short first.
 */
export function lowStock(parts: Part[], stock: StockItem[], lines: PurchaseOrderLine[], locations: Location[]): LowPart[] {
  const totals = totalsInStock(stock)
  const ordered = onOrder(lines)
  const nameOf = new Map(locations.map((l) => [l.pk, shortName(l.name)]))
  return parts
    .filter((p) => (totals.get(p.pk) ?? 0) < Number(p.minimum_stock ?? 0))
    .map((p) => {
      const inStock = totals.get(p.pk) ?? 0
      const minimum = Number(p.minimum_stock)
      const at = new Map<string, number>()
      for (const item of stock) {
        if (item.part !== p.pk) continue
        const name = nameOf.get(item.location ?? -1) ?? 'No location'
        at.set(name, (at.get(name) ?? 0) + Number(item.quantity))
      }
      return {
        pk: p.pk,
        name: p.name,
        ipn: p.IPN ?? '',
        units: p.units ?? '',
        inStock,
        minimum,
        shortBy: minimum - inStock,
        onOrder: ordered.get(p.pk) ?? 0,
        covered: inStock + (ordered.get(p.pk) ?? 0) >= minimum,
        where: [...at].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity),
      }
    })
    .sort((a, b) => b.shortBy - a.shortBy || a.name.localeCompare(b.name))
}

export type BoardLocation = {
  pk: number
  name: string
  description: string
  /** Distinct parts held here, including in any sub-locations. */
  partCount: number
  partNames: string[]
  /** How many of those parts are low (pks in `low`). */
  lowCount: number
}
export type JobSite = BoardLocation & { project: string }
export type LocationBoard = { warehouse: BoardLocation[]; vans: BoardLocation[]; jobSites: JobSite[] }

/** Top-level locations of InvenTree's tree, and the board column each one feeds. */
const COLUMNS = { 'Main Warehouse': 'warehouse', 'Service Vans': 'vans', 'Job Sites': 'jobSites' } as const

/**
 * Overview A: one row per location on the second level of the tree (aisles, Vans, Job Sites),
 * grouped by the first level. Stock in deeper locations rolls up into its second-level ancestor.
 */
export function locationBoard(locations: Location[], stock: StockItem[], low: Set<number>): LocationBoard {
  const pathOf = new Map(locations.map((l) => [l.pk, l.pathstring ?? l.name]))
  const parts = new Map<string, Map<number, string>>() // second-level path -> part pk -> part name
  for (const item of stock) {
    const path = item.location == null ? undefined : pathOf.get(item.location)
    if (!path) continue
    const rollUp = path.split('/').slice(0, 2).join('/')
    if (!parts.has(rollUp)) parts.set(rollUp, new Map())
    parts.get(rollUp)!.set(item.part, item.part_detail?.name ?? '')
  }

  const board: LocationBoard = { warehouse: [], vans: [], jobSites: [] }
  for (const loc of [...locations].sort((a, b) => (a.pathstring ?? '').localeCompare(b.pathstring ?? ''))) {
    if (loc.level !== 1) continue
    const column = COLUMNS[(loc.pathstring ?? '').split('/')[0] as keyof typeof COLUMNS]
    if (!column) continue
    const held = parts.get(loc.pathstring ?? '') ?? new Map()
    const row = {
      pk: loc.pk,
      name: loc.name,
      description: loc.description ?? '',
      partCount: held.size,
      partNames: [...held.values()],
      lowCount: [...held.keys()].filter((pk) => low.has(pk)).length,
    }
    if (column === 'jobSites') {
      // Job Site locations are named after their Project: "PRJ-101 Alvarez Residence".
      const [, project = '', name = loc.name] = loc.name.match(/^(\S+-\d+)\s+(.*)$/) ?? []
      board.jobSites.push({ ...row, name, project })
    } else board[column].push(row)
  }
  return board
}
