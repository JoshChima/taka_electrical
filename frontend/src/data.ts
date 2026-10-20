// What the pages read from InvenTree: every row of each list, fetched a page at a time.
import { api, everyRow } from './api'
import type { paths } from './inventree'
import { expectedDeliveries, ORDER_STATUS } from './stock-rules'

/** Rows asked for per request. */
export const PAGE = 500

/** A list endpoint's filters, without the paging that `everyRow` does. */
type Filters<P extends keyof paths> = Omit<NonNullable<paths[P] extends { get: { parameters: { query?: infer Q } } } ? Q : never>, 'limit' | 'offset'>

export const fetchLocations = () =>
  everyRow((offset) => api.GET('/api/stock/location/', { params: { query: { limit: PAGE, offset } } }))

/** Stock items that are in stock. */
export const fetchStock = (filters: Filters<'/api/stock/'> = {}) =>
  everyRow((offset) => api.GET('/api/stock/', { params: { query: { in_stock: true, ...filters, limit: PAGE, offset } } }))

export const fetchParts = (filters: Filters<'/api/part/'> = {}) =>
  everyRow((offset) => api.GET('/api/part/', { params: { query: { ...filters, limit: PAGE, offset } } }))

export const fetchProjectCodes = () =>
  everyRow((offset) => api.GET('/api/project-code/', { params: { query: { limit: PAGE, offset } } }))

export const fetchOrderLines = (filters: Filters<'/api/order/po-line/'>) =>
  everyRow((offset) => api.GET('/api/order/po-line/', { params: { query: { ...filters, limit: PAGE, offset } } }))

export const fetchSupplierParts = (filters: Filters<'/api/company/part/'>) =>
  everyRow((offset) => api.GET('/api/company/part/', { params: { query: { ...filters, limit: PAGE, offset } } }))

/** Expected deliveries: placed purchase orders not fully received, the one due first at the top. */
export async function fetchExpected() {
  const orders = await everyRow((offset) =>
    api.GET('/api/order/po/', { params: { query: { status: ORDER_STATUS.PLACED, limit: PAGE, offset } } }),
  )
  return expectedDeliveries(orders)
}
