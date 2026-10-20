// The stock rules: turns raw InvenTree data into what the screens show.
// Pure functions only, so every screen reads the same rules (see spec #1).
import type { components } from './inventree'

export type Location = Pick<components['schemas']['Location'], 'pk' | 'name' | 'description' | 'pathstring' | 'level'>
export type StockItem = Pick<components['schemas']['StockItem'], 'pk' | 'part' | 'quantity' | 'location'> & {
  part_detail?: Pick<NonNullable<components['schemas']['StockItem']['part_detail']>, 'name'> | null
}
export type Part = Pick<components['schemas']['Part'], 'pk' | 'name' | 'IPN' | 'units' | 'minimum_stock' | 'assembly'>

/** Purchase order statuses that are still open: pending, placed, on hold. */
const OPEN_ORDER = [10, 20, 25]

/**
 * On Order, per part pk, in the part's own units: ordered minus received on open purchase orders that have
 * no Project code (a Project's material is spoken for). InvenTree's `Part.ordering` counts Project orders too.
 * Needs the lines' `order_detail` and `supplier_part_detail`.
 */
export function onOrder(lines: PurchaseOrderLine[]) {
  const totals = new Map<number, number>()
  for (const line of lines) {
    const order = line.order_detail
    if (!order || !OPEN_ORDER.includes(order.status) || order.project_code != null) continue
    const outstanding =
      Math.max(0, Number(line.quantity) - Number(line.received)) * (line.supplier_part_detail?.pack_quantity_native || 1)
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

/** Low: total in stock is below Minimum Stock. A Minimum Stock of 0 is never low (stock can't go below 0). */
export const isLow = (part: Part, inStock: number) => inStock < Number(part.minimum_stock ?? 0)

/** Where a part is, most first: each location's short name and the quantity there. */
export function whereIs(part: number, stock: StockItem[], locations: Location[]) {
  const nameOf = new Map(locations.map((l) => [l.pk, shortName(l.name)]))
  const at = new Map<string, number>()
  for (const item of stock) {
    if (item.part !== part) continue
    const name = nameOf.get(item.location ?? -1) ?? 'No location'
    at.set(name, (at.get(name) ?? 0) + Number(item.quantity))
  }
  return [...at].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity)
}

/** The parts below Minimum Stock, most short first. */
export function lowStock(parts: Part[], stock: StockItem[], lines: PurchaseOrderLine[], locations: Location[]) {
  const totals = totalsInStock(stock)
  return stockPositions(parts.filter((p) => isLow(p, totals.get(p.pk) ?? 0)), stock, lines, locations)
}

/** Each part's stock against its Minimum Stock and On Order, most short first. */
export function stockPositions(parts: Part[], stock: StockItem[], lines: PurchaseOrderLine[], locations: Location[]): LowPart[] {
  const totals = totalsInStock(stock)
  const ordered = onOrder(lines)
  return parts
    .map((p) => {
      const inStock = totals.get(p.pk) ?? 0
      const minimum = Number(p.minimum_stock)
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
        where: whereIs(p.pk, stock, locations),
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
export type PurchaseOrderLine = Pick<
  Schemas['PurchaseOrderLineItem'],
  'pk' | 'order' | 'quantity' | 'received' | 'purchase_price' | 'internal_part' | 'internal_part_name' | 'ipn'
> & {
  part_detail?: Pick<NonNullable<Schemas['PurchaseOrderLineItem']['part_detail']>, 'units' | 'default_location' | 'category_default_location'> | null
  supplier_part_detail?: Pick<NonNullable<Schemas['PurchaseOrderLineItem']['supplier_part_detail']>, 'pack_quantity_native'> | null
  order_detail?: Pick<Schemas['PurchaseOrder'], 'status' | 'project_code' | 'supplier' | 'supplier_name'> | null
}

export type SupplierPart = Pick<Schemas['SupplierPart'], 'pk' | 'part' | 'supplier' | 'pack_quantity_native'> & {
  supplier_detail?: Pick<NonNullable<Schemas['SupplierPart']['supplier_detail']>, 'name'> | null
}

/** A supplier of a part, with the last price paid them per unit of the part (undefined: no price yet). */
export type Supplier = { pk: number; name: string; unitCost?: number }

/** A part's purchase order lines, most recent first: later orders were created later (higher pk). */
const latestFirst = (part: number, lines: PurchaseOrderLine[]) =>
  lines.filter((l) => l.internal_part === part).sort((a, b) => b.order - a.order || b.pk - a.pk)

/**
 * Last price paid `supplier` for one unit of the part (a foot of cable, one breaker): the most recent priced line.
 * Lines are priced per supplier pack (a 500 ft reel). Needs the lines' `order_detail` and `supplier_part_detail`.
 */
export function lastPricePaid(part: number, supplier: number, lines: PurchaseOrderLine[]) {
  const line = latestFirst(part, lines).find((l) => l.order_detail?.supplier === supplier && l.purchase_price != null)
  return line && Number(line.purchase_price) / (line.supplier_part_detail?.pack_quantity_native || 1)
}

/**
 * Last supplier: the supplier on the most recent purchase order line for the part. A part never ordered falls back
 * to its only supplier part; with several (or none) there is no default and the Owner chooses.
 * Needs the lines' `order_detail` and the supplier parts' `supplier_detail`.
 */
export function lastSupplier(part: number, lines: PurchaseOrderLine[], supplierParts: SupplierPart[]): Supplier | undefined {
  const order = latestFirst(part, lines)[0]?.order_detail
  const only = supplierParts.filter((s) => s.part === part)
  const [pk, name] =
    order?.supplier != null
      ? [order.supplier, order.supplier_name]
      : only.length === 1
        ? [only[0].supplier, only[0].supplier_detail?.name ?? '']
        : []
  return pk == null ? undefined : { pk, name: name ?? '', unitCost: lastPricePaid(part, pk, lines) }
}

/** Suggested reorder quantity: what brings the part back to Minimum Stock after On Order. 0 means covered. */
export const suggestedQuantity = (p: Pick<LowPart, 'minimum' | 'inStock' | 'onOrder'>) =>
  Math.max(0, p.minimum - p.inStock - p.onOrder)

/** What the Owner wants to reorder of a part, in the part's own units, and from whom (undefined: not chosen yet). */
export type ReorderChoice = { part: number; quantity: number; supplier?: number }
/** A line priced at the last price paid that supplier per unit (undefined: no price yet). */
export type DraftLine = ReorderChoice & { unitCost?: number }
/** One purchase order draft per supplier. `total` leaves out the `unpriced` lines. */
export type OrderDraft = { supplier?: number; lines: DraftLine[]; total: number; unpriced: number }

/**
 * Order drafts: the reorder lines grouped by chosen supplier, in the order each supplier first appears.
 * Lines with no supplier yet come last, in a draft with no supplier.
 */
export function orderDrafts(choices: ReorderChoice[], lines: PurchaseOrderLine[]): OrderDraft[] {
  const drafts = new Map<number | undefined, OrderDraft>()
  for (const choice of choices) {
    const unitCost = choice.supplier == null ? undefined : lastPricePaid(choice.part, choice.supplier, lines)
    const draft = drafts.get(choice.supplier) ?? { supplier: choice.supplier, lines: [], total: 0, unpriced: 0 }
    drafts.set(choice.supplier, draft)
    draft.lines.push({ ...choice, unitCost })
    if (unitCost == null) draft.unpriced++
    else draft.total += unitCost * choice.quantity
  }
  return [...drafts.values()].sort((a, b) => Number(a.supplier == null) - Number(b.supplier == null))
}

/**
 * A draft's purchase order lines as InvenTree takes them: the supplier part, the quantity in supplier packs
 * (rounded up), and the last price paid per pack when known. Lines of 0 are left out.
 */
export function purchaseOrderLines(draft: OrderDraft, supplierParts: SupplierPart[]) {
  return draft.lines
    .filter((l) => l.quantity > 0)
    .map((l) => {
      const supplierPart = supplierParts.find((s) => s.part === l.part && s.supplier === draft.supplier)!
      const pack = supplierPart.pack_quantity_native || 1
      return {
        part: supplierPart.pk,
        quantity: Math.ceil(l.quantity / pack),
        ...(l.unitCost != null && { purchase_price: String(+(l.unitCost * pack).toFixed(6)) }),
      }
    })
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
export function locationBoard(locations: Location[], stock: StockItem[], low = new Set<number>()): LocationBoard {
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
