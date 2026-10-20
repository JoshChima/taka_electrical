import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { fakeInvenTree } from './test/fake-inventree'

const column = async (name: string) => within(await screen.findByRole('region', { name }))
const rows = (col: ReturnType<typeof within>) => col.getAllByRole('listitem').map((li: HTMLElement) => li.textContent)

describe('Overview A, the locations board', () => {
  it('shows the Main Warehouse aisle by aisle with part counts', async () => {
    fakeInvenTree()
    render(<App />)

    const warehouse = await column('Main Warehouse')
    expect(rows(warehouse)).toEqual([
      expect.stringMatching(/Aisle A - Wire & Cable.*17 parts/),
      expect.stringMatching(/Aisle B - Conduit & Fittings.*11 parts/),
      expect.stringMatching(/Aisle C - Boxes & Devices.*17 parts/),
      expect.stringMatching(/Aisle D - Breakers & Panels.*10 parts/),
      expect.stringMatching(/Aisle E - Lighting & EV.*5 parts/),
      expect.stringMatching(/Aisle F - Supports & Consumables.*10 parts/),
      expect.stringMatching(/Tool Crib.*4 parts/),
    ])
  })

  it('shows each Van with its part count and what it carries', async () => {
    fakeInvenTree()
    render(<App />)

    const vans = await column('Vans')
    expect(rows(vans)).toEqual([
      expect.stringMatching(/Van 01 \(Residential\).*26 parts.*Residential crew truck stock/),
      expect.stringMatching(/Van 02 \(Commercial\).*27 parts.*Commercial crew truck stock/),
      expect.stringMatching(/Van 03 \(Service Calls\).*12 parts.*Service technician truck stock/),
    ])
  })

  it('shows each Job Site with its Project code, address and what is staged there', async () => {
    fakeInvenTree()
    render(<App />)

    const sites = await column('Job Sites')
    const [alvarez, riverside, harbor, oakview] = sites.getAllByRole('listitem')
    expect(alvarez.textContent).toMatch(/Alvarez Residence.*PRJ-101.*418 Maple St.*6 parts staged/)
    expect(alvarez.textContent).toMatch(/200A Ringless Meter Socket/)
    expect(riverside.textContent).toMatch(/Riverside Medical Suite 300.*PRJ-102.*2200 Riverside Dr, Suite 300.*1 part staged: LED Troffer 2x4 40W 4000K/)
    expect(harbor.textContent).toMatch(/Harbor Point Warehouse.*PRJ-103.*75 Harbor Point Rd, Bldg C.*Nothing staged yet/)
    expect(oakview.textContent).toMatch(/Oakview Apartments Garage.*PRJ-104.*901 Oakview Blvd, Level P1.*Nothing staged yet/)
  })

  it('shows how many deliveries are expected and which arrives next, linking to Receive', async () => {
    fakeInvenTree()
    render(<App />)

    const tile = await screen.findByRole('link', { name: /Deliveries expected/ })
    expect(tile.textContent).toMatch(/Deliveries expected\s*2\s*Next: Ridgeline Wire & Cable, 26 Oct/)
    await userEvent.click(tile)
    expect(await screen.findByRole('heading', { level: 1, name: 'Receive a delivery' })).toBeTruthy()
  })

  it('groups locations by the first level of the location tree, not by their names', async () => {
    const fake = fakeInvenTree()
    const serviceVans = fake.locations.find((l) => l.pathstring === 'Service Vans')!
    fake.locations.push({
      pk: 99, name: 'Spare Van', description: 'Loaner', parent: serviceVans.pk,
      pathstring: 'Service Vans/Spare Van', level: 1, structural: false,
    })
    render(<App />)

    expect(rows(await column('Vans'))).toContainEqual(expect.stringMatching(/Spare Van.*0 parts.*Loaner/))
    expect(rows(await column('Main Warehouse'))).not.toContainEqual(expect.stringMatching(/Spare Van/))
  })
})

/** Each body row of the Below Minimum Stock table, as its cell texts. */
const lowRows = async () =>
  within(await screen.findByRole('table', { name: 'Below Minimum Stock' }))
    .getAllByRole('row')
    .slice(1)
    .map((tr) => within(tr).getAllByRole('cell').map((td) => td.textContent))

describe('Overview tiles', () => {
  it('shows the active Projects, how many Job Sites have material staged, and the parts tracked', async () => {
    fakeInvenTree()
    render(<App />)

    expect((await screen.findByRole('group', { name: '4 active Projects' })).textContent).toMatch(
      /Material staged at 2 of 4 Job Sites/,
    )
    expect(screen.getByRole('group', { name: '74 parts tracked' }).textContent).toMatch(/Across 14 locations/)
  })

  it('leaves out inactive Projects and the install kits', async () => {
    const fake = fakeInvenTree()
    fake.projectCodes[0].active = false
    render(<App />)

    expect(await screen.findByRole('group', { name: '3 active Projects' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '74 parts tracked' })).toBeTruthy()
  })
})

describe('Low stock on the overview', () => {
  it('counts and lists the parts below Minimum Stock, across every location', async () => {
    fakeInvenTree()
    render(<App />)

    expect(await screen.findByRole('group', { name: '5 parts below Minimum Stock' })).toBeTruthy()
    // Part, In stock, Minimum, Short by, On Order, Where it is
    expect((await lowRows()).map((r) => [r[0], r[1], r[2], r[3], r[5]])).toEqual([
      ['20A GFCI Receptacle, WhiteDEV-GFCI-20-WH', '28', '60', '32', 'Aisle C 18 · Van 03 6 · Van 01 4'],
      ['LED High-Bay 150W 5000KLGT-HB-150', '6', '20', '14', 'Aisle E 6'],
      ['20A 1-Pole Dual Function AFCI/GFCIBRK-1P-20-DF', '14', '20', '6', 'Aisle D 12 · Van 01 2'],
      ['60A 2-Pole BreakerBRK-2P-60', '6', '10', '4', 'Aisle D 6'],
      ['Level 2 EV Charger 48A HardwiredEV-L2-48', '2', '4', '2', 'Aisle E 2'],
    ])
  })

  it('shows On Order from open purchase orders without a Project code, and when it covers the shortfall', async () => {
    fakeInvenTree()
    render(<App />)

    // PO-0004 (no Project) restocks the GFCI and the Dual Function breaker. The LED High-Bay, the 60A breaker and
    // the EV charger are on order only for Projects (PO-0001, PO-0003), which is not On Order.
    expect((await lowRows()).map((r) => [r[0].slice(0, 12), r[4]])).toEqual([
      ['20A GFCI Rec', '60Covered'],
      ['LED High-Bay', '—'],
      ['20A 1-Pole D', '24Covered'],
      ['60A 2-Pole B', '—'],
      ['Level 2 EV C', '—'],
    ])
  })

  it('counts only what is still to come, on open purchase orders', async () => {
    const fake = fakeInvenTree()
    const gfci = fake.poLines.find((l) => l.internal_part_name === '20A GFCI Receptacle, White')!
    gfci.received = 40 // 20 still to come, short by 32: not covered
    fake.purchaseOrders.push({ ...fake.purchaseOrders[3], pk: 5, reference: 'PO-0005', status: 25 }) // on hold
    fake.poLines.push({ ...gfci, pk: 9, order: 5, quantity: 5, received: 0 })
    fake.purchaseOrders.push({ ...fake.purchaseOrders[3], pk: 6, reference: 'PO-0006', status: 30 }) // complete
    fake.poLines.push({ ...gfci, pk: 10, order: 6, quantity: 100, received: 0 })
    render(<App />)

    expect((await lowRows())[0][4]).toBe('25')
  })

  it('marks the aisles that hold low parts', async () => {
    fakeInvenTree()
    render(<App />)

    expect(rows(await column('Main Warehouse')).map((r: string | null) => r?.match(/^Aisle \w|^Tool Crib|\d+ low/g)?.join(' '))).toEqual([
      'Aisle A',
      'Aisle B',
      'Aisle C 1 low',
      'Aisle D 2 low',
      'Aisle E 2 low',
      'Aisle F',
      'Tool Crib',
    ])
  })

  it('never counts a part with a Minimum Stock of 0 as low, and counts a part with none in stock', async () => {
    const fake = fakeInvenTree()
    fake.parts.push(
      { ...fake.parts[0], pk: 80, IPN: 'TL-NEW', name: 'Fish Tape 100 ft', minimum_stock: 0 },
      { ...fake.parts[0], pk: 81, IPN: 'DEV-NEW', name: 'USB-C Receptacle', units: '', minimum_stock: 10 },
    )
    render(<App />)

    expect(await screen.findByRole('group', { name: '6 parts below Minimum Stock' })).toBeTruthy()
    expect((await lowRows()).find((r) => r[0]?.startsWith('USB-C'))).toEqual(['USB-C ReceptacleDEV-NEW', '0', '10', '10', '—', '—'])
    expect((await lowRows()).find((r) => r[0]?.startsWith('Fish Tape'))).toBeUndefined()
  })

  it('shows quantities with their unit', async () => {
    const fake = fakeInvenTree()
    fake.parts.find((p) => p.IPN === 'WIR-THHN-12-BLK')!.minimum_stock = 5000
    render(<App />)

    expect((await lowRows())[0]).toEqual([
      'THHN 12 AWG BlackWIR-THHN-12-BLK', '3,500 ft', '5,000 ft', '1,500 ft', '—', 'Aisle A 2,500 ft · Van 01 500 ft · Van 02 500 ft',
    ])
  })

  it('counts wire On Order in feet, though it is ordered in 500 ft reels', async () => {
    const fake = fakeInvenTree()
    const wire = fake.parts.find((p) => p.IPN === 'WIR-THHN-12-BLK')!
    wire.minimum_stock = 5000
    const restock = fake.poLines.find((l) => l.order === 4)! // PO-0004, no Project
    fake.poLines.push({
      ...restock, pk: 99, part: wire.pk, internal_part: wire.pk, internal_part_name: wire.name, quantity: 3,
      supplier_part_detail: { ...restock.supplier_part_detail, pack_quantity_native: 500 },
    })
    render(<App />)

    expect((await lowRows())[0][4]).toBe('1,500 ftCovered')
  })
})
