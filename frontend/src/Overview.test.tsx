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
      pk: 99, name: 'Spare Truck', description: 'Loaner', parent: serviceVans.pk,
      pathstring: 'Service Vans/Spare Truck', level: 1, structural: false,
    })
    render(<App />)

    expect(rows(await column('Vans'))).toContainEqual(expect.stringMatching(/Spare Truck.*0 parts.*Loaner/))
    expect(rows(await column('Main Warehouse'))).not.toContainEqual(expect.stringMatching(/Spare Truck/))
  })
})
