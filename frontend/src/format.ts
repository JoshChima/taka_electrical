// How the app writes quantities, money, counts and dates, so every page says them the same way.

/** A quantity with its unit: "2,500 ft". Parts counted by the piece have no unit: "28". */
export const amount = (n: number, units?: string | null) => n.toLocaleString('en-US') + (units ? ` ${units}` : '')

/** "$1,298.00". */
export const dollars = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** "1 part", "2 parts". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "2026-10-26" → "26 Oct". */
export const dueDate = (date?: string | null) =>
  date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'not set'
