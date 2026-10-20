import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { fakeInvenTree } from './test/fake-inventree'

/** Opens Find a part from the navigation and searches for `words`. */
async function search(words: string) {
  render(<App />)
  await userEvent.click(await screen.findByRole('link', { name: 'Find a part' }))
  await userEvent.type(await screen.findByRole('searchbox', { name: 'Part name or part number' }), words)
}

const results = () => within(screen.getByRole('list', { name: 'Matching parts' })).queryAllByRole('button')

describe('Find a part', () => {
  it('matches partial words in the name or part number, ignoring case', async () => {
    fakeInvenTree()
    await search('gfci')

    expect(results().map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^20A GFCI Receptacle, White/),
      expect.stringMatching(/^20A 1-Pole Dual Function AFCI\/GFCI/),
    ])
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'nmb-12')
    expect(results().map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^NM-B 12\/2 w\/G/),
      expect.stringMatching(/^NM-B 12\/3 w\/G/),
    ])
  })

  it('shows each result with its total in stock, marked when below Minimum Stock', async () => {
    fakeInvenTree()
    await search('gfci')

    expect(results().map((r) => r.textContent)).toEqual([
      '20A GFCI Receptacle, WhiteDEV-GFCI-20-WH28below minimum',
      '20A 1-Pole Dual Function AFCI/GFCIBRK-1P-20-DF14below minimum',
    ])
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'WIR-NMB-12-2')
    expect(results().map((r) => r.textContent)).toEqual(['NM-B 12/2 w/GWIR-NMB-12-22,500 ft'])
  })

  it('shows a chosen part: category, specs, total against Minimum Stock, where it is, last supplier and unit cost', async () => {
    fakeInvenTree()
    await search('gfci')
    await userEvent.click(results()[0])

    const part = await detail('20A GFCI Receptacle, White')
    expect(part.getByText('Wiring Devices › Receptacles')).toBeTruthy()
    expect(part.getByText(/DEV-GFCI-20-WH · 20 A · 125 V · White/)).toBeTruthy()
    expect(part.getByRole('group', { name: 'In stock, everywhere' }).textContent).toMatch(/28$/)
    expect(part.getByRole('group', { name: 'Minimum Stock' }).textContent).toMatch(/60$/)
    expect(part.getByRole('group', { name: 'Short by' }).textContent).toMatch(/32$/)
    expect(await places(part)).toEqual(['Aisle C18', 'Van 036', 'Van 014'])
    expect(await part.findByText('Last supplier · Northgate Electrical Supply')).toBeTruthy()
    expect(part.getByText('Unit cost · $18.50 each')).toBeTruthy()
  })

  it('shows cable in feet', async () => {
    fakeInvenTree()
    await search('WIR-NMB-12-2')
    await userEvent.click(results()[0])

    const part = await detail('NM-B 12/2 w/G')
    expect(await places(part)).toEqual(['Aisle A2,000 ft', 'Van 01500 ft'])
    expect(part.getByRole('group', { name: 'Above minimum by' }).textContent).toMatch(/1,500 ft$/)
  })

  it('suggests another word or part number when nothing matches', async () => {
    fakeInvenTree()
    await search('flux capacitor')

    expect(results()).toEqual([])
    expect(screen.getByText(/No parts match\. Try another word.*or a part number/)).toBeTruthy()
  })

  it('links a part to Move stock and Reorder with the part added', async () => {
    fakeInvenTree()
    await search('DEV-GFCI')
    await userEvent.click(results()[0])

    const part = await detail('20A GFCI Receptacle, White')
    expect(part.getByRole('link', { name: 'Move stock' }).getAttribute('href')).toMatch(/\/move\?part=37$/)
    expect(part.getByRole('link', { name: 'Reorder' }).getAttribute('href')).toMatch(/\/reorder\?part=37$/)
  })
})

describe('Last supplier', () => {
  const supplierOf = async (words: string) => {
    await search(words)
    await userEvent.click(results()[0])
    const footer = await screen.findByText(/^Last supplier/)
    return [footer.textContent, screen.getByText(/^Unit cost/).textContent]
  }

  it('is the supplier on the most recent purchase order line, at the price paid then', async () => {
    const fake = fakeInvenTree()
    const gfci = fake.poLines.find((l) => l.ipn === 'DEV-GFCI-20-WH')!
    fake.purchaseOrders.push({ ...fake.purchaseOrders[1], pk: 5, reference: 'PO-0005', status: 30 }) // Ridgeline
    fake.poLines.push({ ...gfci, pk: 9, order: 5, purchase_price: 17.25 })

    expect(await supplierOf('DEV-GFCI')).toEqual(['Last supplier · Ridgeline Wire & Cable', 'Unit cost · $17.25 each'])
  })

  it('prices cable per foot, though it is bought in 500 ft reels', async () => {
    const fake = fakeInvenTree()
    const nmb = fake.parts.find((p) => p.IPN === 'WIR-NMB-12-2')!
    const reel = fake.poLines.find((l) => l.ipn === 'WIR-MC-12-2')! // PO-0002, Ridgeline
    fake.poLines.push({ ...reel, pk: 9, internal_part: nmb.pk, purchase_price: 340 })

    expect(await supplierOf('WIR-NMB-12-2')).toEqual(['Last supplier · Ridgeline Wire & Cable', 'Unit cost · $0.68 per ft'])
  })

  it('falls back to the only supplier of a part never ordered, with no price yet', async () => {
    fakeInvenTree()

    expect(await supplierOf('WIR-NMB-12-2')).toEqual(['Last supplier · Ridgeline Wire & Cable', 'Unit cost · No price yet'])
  })

  it('is none for a part never ordered that several suppliers sell', async () => {
    const fake = fakeInvenTree()
    const nmb = fake.supplierParts.find((s) => s.SKU === 'RWC-10063')! // NM-B 12/2 from Ridgeline
    fake.supplierParts.push({ ...nmb, pk: 99, supplier: 1, supplier_detail: { pk: 1, name: 'Northgate Electrical Supply' } })

    expect((await supplierOf('WIR-NMB-12-2'))[0]).toBe('Last supplier · none yet, choose one when you reorder')
  })
})

const detail = async (name: string) => within(await screen.findByRole('region', { name }))
const places = async (part: ReturnType<typeof within>) =>
  within(await part.findByRole('list', { name: 'Where it is' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)
