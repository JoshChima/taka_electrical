// The stock rules: turns raw InvenTree data into what the screens show.
// Pure functions only, so every screen reads the same rules (see spec #1).
import type { components } from './inventree'

export type Location = Pick<components['schemas']['Location'], 'pk' | 'name' | 'description' | 'pathstring' | 'level'>
export type StockItem = Pick<components['schemas']['StockItem'], 'pk' | 'part' | 'quantity' | 'location'> & {
  part_detail?: Pick<NonNullable<components['schemas']['StockItem']['part_detail']>, 'name'> | null
}

export type BoardLocation = {
  pk: number
  name: string
  description: string
  /** Distinct parts held here, including in any sub-locations. */
  partCount: number
  partNames: string[]
}
export type JobSite = BoardLocation & { project: string }
export type LocationBoard = { warehouse: BoardLocation[]; vans: BoardLocation[]; jobSites: JobSite[] }

export type PurchaseOrder = Pick<
  components['schemas']['PurchaseOrder'],
  | 'pk' | 'reference' | 'supplier_name' | 'supplier_reference' | 'status' | 'project_code_label'
  | 'target_date' | 'line_items' | 'completed_lines'
>

const PLACED = 20

/**
 * Expected deliveries: purchase orders placed with the supplier and not fully received,
 * the one due first at the top (orders with no due date last).
 */
export function expectedDeliveries(orders: PurchaseOrder[]) {
  return orders
    .filter((o) => o.status === PLACED && (o.completed_lines ?? 0) < (o.line_items ?? 0))
    .sort((a, b) => (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999'))
}

type Schemas = components['schemas']
export type PurchaseOrderLine = Pick<Schemas['PurchaseOrderLineItem'], 'pk' | 'quantity' | 'received' | 'internal_part_name' | 'ipn'> & {
  part_detail?: Pick<NonNullable<Schemas['PurchaseOrderLineItem']['part_detail']>, 'units' | 'default_location' | 'category_default_location'> | null
  supplier_part_detail?: Pick<NonNullable<Schemas['PurchaseOrderLineItem']['supplier_part_detail']>, 'pack_quantity_native'> | null
}

/** A purchase order line as the Owner books it in. Quantities are in the part's own units. */
export type DeliveryLine = {
  pk: number
  name: string
  ipn: string
  units: string
  ordered: number
  received: number
  outstanding: number
  /** Part units per supplier pack: InvenTree counts order quantities in packs (a 500 ft reel). */
  pack: number
  /** Where this kind of part normally lives: the part category's default location. */
  putAway: number | null
}

export function deliveryLines(lines: PurchaseOrderLine[]): DeliveryLine[] {
  return lines.map((l) => {
    const pack = l.supplier_part_detail?.pack_quantity_native || 1
    return {
      pk: l.pk,
      name: l.internal_part_name,
      ipn: l.ipn ?? '',
      units: l.part_detail?.units ?? '',
      ordered: l.quantity * pack,
      received: l.received * pack,
      outstanding: Math.max(0, l.quantity - l.received) * pack,
      pack,
      putAway: l.part_detail?.default_location ?? l.part_detail?.category_default_location ?? null,
    }
  })
}

/** What the Owner says arrived on one line, in the part's own units, and where it is put away. */
export type Arrival = { quantity: number; location: number | null }

/**
 * Why an arrival can't be booked in, or undefined when it can. InvenTree accepts more than is
 * outstanding (and puts stock with no location in the order's structural destination), so this guards both.
 */
export function arrivalProblem(line: DeliveryLine, arrival: Arrival) {
  if (!Number.isFinite(arrival.quantity) || arrival.quantity < 0) return 'Enter how many arrived, or 0.'
  if (arrival.quantity > line.outstanding)
    return `Only ${line.outstanding.toLocaleString('en-US')}${line.units ? ` ${line.units}` : ''} still to come on this order. Book in at most that.`
  if (arrival.quantity > 0 && arrival.location == null) return 'Choose where to put it away.'
}

/** The lines of InvenTree's receive action: what arrived, in supplier packs, each with its put-away location. */
export function receiveItems(lines: DeliveryLine[], arrivals: Arrival[]) {
  return lines.flatMap((line, i) => {
    const { quantity, location } = arrivals[i]
    return quantity > 0 && location != null ? [{ line_item: line.pk, quantity: String(quantity / line.pack), location }] : []
  })
}

/** Top-level locations of InvenTree's tree, and the board column each one feeds. */
const COLUMNS = { 'Main Warehouse': 'warehouse', 'Service Vans': 'vans', 'Job Sites': 'jobSites' } as const

/**
 * Overview A: one row per location on the second level of the tree (aisles, Vans, Job Sites),
 * grouped by the first level. Stock in deeper locations rolls up into its second-level ancestor.
 */
export function locationBoard(locations: Location[], stock: StockItem[]): LocationBoard {
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
    }
    if (column === 'jobSites') {
      // Job Site locations are named after their Project: "PRJ-101 Alvarez Residence".
      const [, project = '', name = loc.name] = loc.name.match(/^(\S+-\d+)\s+(.*)$/) ?? []
      board.jobSites.push({ ...row, name, project })
    } else board[column].push(row)
  }
  return board
}
