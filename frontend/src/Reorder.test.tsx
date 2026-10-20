import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { http, HttpResponse } from 'msw'
import { fakeInvenTree, sent } from './test/fake-inventree'
import { server } from './test/setup'

type Fake = ReturnType<typeof fakeInvenTree>

async function openReorder() {
  render(<App />)
  await userEvent.click(within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Reorder' }))
  await screen.findAllByRole('region', { name: /Purchase order draft/ })
}

async function reorderFromFind(words: string, name: string) {
  await userEvent.type(await screen.findByRole('searchbox', { name: 'Part name or part number' }), words)
  await userEvent.click(within(await screen.findByRole('region', { name })).getByRole('link', { name: 'Reorder' }))
  await screen.findAllByRole('region', { name: /Purchase order draft/ })
}
const openFind = async () =>
  userEvent.click(within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Find a part' }))

/** A part's line on the Reorder page, wherever it is. */
const line = (name: string) => screen.getByRole('group', { name })
const quantity = (name: string) => within(line(name)).getByLabelText('Quantity') as HTMLInputElement
const supplier = (name: string) => within(line(name)).getByRole('combobox') as HTMLSelectElement
const draft = (supplier: string) => within(screen.getByRole('region', { name: `Purchase order draft for ${supplier}` }))
const drafts = () => screen.getAllByRole('region', { name: /Purchase order draft for/ }).map((d) => d.getAttribute('aria-label'))
const partsIn = (region: ReturnType<typeof within>) =>
  region.getAllByRole('group').map((g: HTMLElement) => g.querySelector('strong')!.textContent)
const total = (supplier: string) => draft(supplier).getByText('Order total').parentElement!.textContent

const NORTHGATE = 1
const BRIGHTPATH = 3
const supplierPartOf = (fake: Fake, ipn: string, supplier: number) =>
  fake.supplierParts.find((s) => s.part === fake.parts.find((p) => p.IPN === ipn)!.pk && s.supplier === supplier)!.pk
const ipnOf = (fake: Fake, supplierPart: number) =>
  fake.parts.find((p) => p.pk === fake.supplierParts.find((s) => s.pk === supplierPart)!.part)!.IPN

/** Adds a second supplier part for a part, from another supplier. */
function alsoSupplies(fake: Fake, supplier: number, ipn: string) {
  const part = fake.parts.find((p) => p.IPN === ipn)!
  fake.supplierParts.push({
    ...fake.supplierParts.find((s) => s.part === part.pk)!,
    pk: Math.max(...fake.supplierParts.map((s) => s.pk)) + 1,
    supplier,
    SKU: `X-${ipn}`,
    supplier_detail: fake.supplierParts.find((s) => s.supplier === supplier)!.supplier_detail,
  })
}

describe('Reorder', () => {
  it('lists every low part with in stock, Minimum Stock, On Order and a suggested quantity', async () => {
    fakeInvenTree()
    await openReorder()

    expect(screen.getByRole('heading', { level: 1, name: 'Reorder' })).toBeTruthy()
    expect(line('20A GFCI Receptacle, White').textContent).toMatch(/DEV-GFCI-20-WH · 28 in stock · minimum 60 · 60 on order.*Covered/)
    expect(quantity('20A GFCI Receptacle, White').value).toBe('0')
    expect(line('20A 1-Pole Dual Function AFCI/GFCI').textContent).toMatch(/14 in stock · minimum 20 · 24 on order.*Covered/)
    expect(quantity('20A 1-Pole Dual Function AFCI/GFCI').value).toBe('0')
    expect(line('LED High-Bay 150W 5000K').textContent).toMatch(/6 in stock · minimum 20 · 0 on order/)
    expect(line('LED High-Bay 150W 5000K').textContent).not.toMatch(/Covered/)
    expect(quantity('LED High-Bay 150W 5000K').value).toBe('14')
    expect(quantity('60A 2-Pole Breaker').value).toBe('4')
    expect(quantity('Level 2 EV Charger 48A Hardwired').value).toBe('2')
  })

  it('lets the Owner change a suggested quantity, and the totals follow', async () => {
    fakeInvenTree()
    await openReorder()

    await userEvent.clear(quantity('LED High-Bay 150W 5000K'))
    await userEvent.type(quantity('LED High-Bay 150W 5000K'), '20')

    expect(quantity('LED High-Bay 150W 5000K').value).toBe('20')
    expect(line('LED High-Bay 150W 5000K').textContent).toMatch(/\$2,580\.00\$129\.00 each/)
    expect(total('BrightPath Lighting Distributors')).toBe('Order total $2,580.00')
  })

  it('puts each part in a draft for its last supplier, priced at the last price paid', async () => {
    fakeInvenTree()
    await openReorder()

    expect(drafts()).toEqual([
      'Purchase order draft for Northgate Electrical Supply',
      'Purchase order draft for BrightPath Lighting Distributors',
    ])
    expect(partsIn(draft('Northgate Electrical Supply'))).toEqual([
      '20A GFCI Receptacle, White',
      '20A 1-Pole Dual Function AFCI/GFCI',
      '60A 2-Pole Breaker',
      'Level 2 EV Charger 48A Hardwired',
    ])
    expect(partsIn(draft('BrightPath Lighting Distributors'))).toEqual(['LED High-Bay 150W 5000K'])
    expect(supplier('60A 2-Pole Breaker').selectedOptions[0].textContent).toBe('Northgate Electrical Supply')
    expect(within(line('60A 2-Pole Breaker')).getByLabelText('Supplier · last used Northgate Electrical Supply')).toBeTruthy()
    expect(line('Level 2 EV Charger 48A Hardwired').textContent).toMatch(/\$1,298\.00\$649\.00 each/)
    // 4 × $19.80 + 2 × $649.00; the covered parts add nothing.
    expect(total('Northgate Electrical Supply')).toBe('Order total $1,377.20')
    expect(total('BrightPath Lighting Distributors')).toBe('Order total $1,806.00')
    expect(screen.getByText(/records it in InvenTree as a draft\. It isn't sent/)).toBeTruthy()
  })

  it("moves a part to another supplier's draft, with no price yet, and recalculates both totals", async () => {
    const fake = fakeInvenTree()
    alsoSupplies(fake, BRIGHTPATH, 'BRK-2P-60')
    await openReorder()

    await userEvent.selectOptions(supplier('60A 2-Pole Breaker'), 'BrightPath Lighting Distributors')

    expect(partsIn(draft('BrightPath Lighting Distributors'))).toEqual(['LED High-Bay 150W 5000K', '60A 2-Pole Breaker'])
    expect(partsIn(draft('Northgate Electrical Supply'))).not.toContain('60A 2-Pole Breaker')
    expect(line('60A 2-Pole Breaker').textContent).toMatch(/No price yetNot bought from them before/)
    expect(total('BrightPath Lighting Distributors')).toBe('Order total $1,806.00, excluding 1 part with no price yet')
    expect(total('Northgate Electrical Supply')).toBe('Order total $1,298.00')
  })

  it('says "No price yet" for a part never bought with a price, and the total excludes it', async () => {
    const fake = fakeInvenTree()
    for (const l of fake.poLines) if (l.ipn === 'EV-L2-48') Object.assign(l, { purchase_price: null })
    await openReorder()

    expect(line('Level 2 EV Charger 48A Hardwired').textContent).toMatch(/No price yet/)
    expect(total('Northgate Electrical Supply')).toBe('Order total $79.20, excluding 1 part with no price yet')
  })

  it('asks for a supplier for a part never ordered that has more than one supplier part, and keeps it on the page', async () => {
    const fake = fakeInvenTree()
    fake.poLines = fake.poLines.filter((l) => l.ipn !== 'LGT-HB-150')
    alsoSupplies(fake, NORTHGATE, 'LGT-HB-150')
    await openReorder()

    expect(partsIn(within(screen.getByRole('region', { name: 'Parts with no supplier yet' })))).toEqual(['LED High-Bay 150W 5000K'])
    expect(supplier('LED High-Bay 150W 5000K').value).toBe('')
    expect(quantity('LED High-Bay 150W 5000K').value).toBe('14')
    expect(within(supplier('LED High-Bay 150W 5000K')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose a supplier',
      'BrightPath Lighting Distributors',
      'Northgate Electrical Supply',
    ])

    await userEvent.selectOptions(supplier('LED High-Bay 150W 5000K'), 'BrightPath Lighting Distributors')

    expect(screen.queryByRole('region', { name: 'Parts with no supplier yet' })).toBeNull()
    expect(partsIn(draft('BrightPath Lighting Distributors'))).toEqual(['LED High-Bay 150W 5000K'])
  })

  it("creates one supplier's purchase order, a draft with no Project code, with its lines", async () => {
    const fake = fakeInvenTree()
    await openReorder()

    await userEvent.click(draft('BrightPath Lighting Distributors').getByRole('button', { name: 'Create purchase order' }))

    expect(await screen.findByText('Created PO-0005 for BrightPath Lighting Distributors. It is On Order now.')).toBeTruthy()
    const [order] = sent(fake, 'POST', '/api/order/po/')
    expect(order.headers.get('X-CSRFToken')).toBe('fake-csrf-token')
    expect(await order.json()).toEqual({ supplier: BRIGHTPATH, description: 'Warehouse restock' })
    const lines = await Promise.all(sent(fake, 'POST', '/api/order/po-line/').map((r) => r.json()))
    expect(lines).toEqual([
      { order: 5, part: supplierPartOf(fake, 'LGT-HB-150', BRIGHTPATH), quantity: 14, purchase_price: '129' },
    ])
  })

  it('sends only the lines with a quantity, and On Order rises on Reorder and the overview', async () => {
    const fake = fakeInvenTree()
    await openReorder()

    await userEvent.click(draft('Northgate Electrical Supply').getByRole('button', { name: 'Create purchase order' }))

    await screen.findByText(/Created PO-0005 for Northgate Electrical Supply/)
    const lines = await Promise.all(sent(fake, 'POST', '/api/order/po-line/').map((r) => r.json()))
    expect(lines.map((l) => [ipnOf(fake, l.part), l.quantity, l.purchase_price])).toEqual([
      ['BRK-2P-60', 4, '19.8'],
      ['EV-L2-48', 2, '649'],
    ])
    await waitFor(() => expect(line('60A 2-Pole Breaker').textContent).toMatch(/6 in stock · minimum 10 · 4 on order.*Covered/))
    expect(quantity('60A 2-Pole Breaker').value).toBe('0')
    expect(quantity('Level 2 EV Charger 48A Hardwired').value).toBe('0')
    expect(quantity('LED High-Bay 150W 5000K').value).toBe('14')

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Overview' }))
    const low = within(await screen.findByRole('table', { name: 'Below Minimum Stock' }))
    expect(low.getByText('60A 2-Pole Breaker').closest('tr')!.textContent).toMatch(/4Covered/)
  })

  it('opens from the overview: "Reorder these" on the low-stock table and "Review and reorder" on the low tile', async () => {
    fakeInvenTree()
    render(<App />)
    const low = await screen.findByRole('region', { name: /Below Minimum Stock/ })
    await userEvent.click(within(low).getByRole('link', { name: 'Reorder these 5' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Reorder' })).toBeTruthy()

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Overview' }))
    const tile = await screen.findByRole('group', { name: '5 parts below Minimum Stock' })
    await userEvent.click(within(tile).getByRole('link', { name: 'Review and reorder' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Reorder' })).toBeTruthy()
  })

  it('opens from a part in Find focused on that part, adding it when it is not low', async () => {
    fakeInvenTree()
    render(<App />)
    await openFind()
    await reorderFromFind('LGT-HB-150', 'LED High-Bay 150W 5000K')
    await waitFor(() => expect(document.activeElement).toBe(quantity('LED High-Bay 150W 5000K')))

    await openFind()
    await reorderFromFind('DEV-REC-20-WH', '20A Duplex Receptacle TR, White')
    await waitFor(() => expect(document.activeElement).toBe(quantity('20A Duplex Receptacle TR, White')))
    expect(line('20A Duplex Receptacle TR, White').textContent).toMatch(/Not below minimum/)
    expect(quantity('20A Duplex Receptacle TR, White').value).toBe('0')
  })

  it('asks for a supplier when the last supplier no longer sells the part', async () => {
    const fake = fakeInvenTree()
    alsoSupplies(fake, NORTHGATE, 'LGT-HB-150')
    fake.supplierParts = fake.supplierParts.filter((s) => s.pk !== supplierPartOf(fake, 'LGT-HB-150', BRIGHTPATH))
    render(<App />)
    await userEvent.click(within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Reorder' }))

    const none = within(await screen.findByRole('region', { name: 'Parts with no supplier yet' }))
    expect(partsIn(none)).toEqual(['LED High-Bay 150W 5000K'])
    expect(supplier('LED High-Bay 150W 5000K').value).toBe('')
  })

  it('keeps the draft and says nothing was ordered when the purchase order cannot be created', async () => {
    const fake = fakeInvenTree()
    server.use(http.post('*/api/order/po/', () => new HttpResponse('Server Error', { status: 500 })))
    await openReorder()

    await userEvent.click(draft('BrightPath Lighting Distributors').getByRole('button', { name: 'Create purchase order' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't create the purchase order for BrightPath Lighting Distributors. Nothing was ordered; try again.",
    )
    expect(partsIn(draft('BrightPath Lighting Distributors'))).toEqual(['LED High-Bay 150W 5000K'])
    expect(sent(fake, 'POST', '/api/order/po-line/')).toHaveLength(0)
  })

  it('names the lines that were not added, and the order they are missing from', async () => {
    const fake = fakeInvenTree()
    const evCharger = supplierPartOf(fake, 'EV-L2-48', NORTHGATE)
    server.use(
      http.post('*/api/order/po-line/', async ({ request }) => {
        if (((await request.clone().json()) as { part: number }).part === evCharger) return new HttpResponse('Server Error', { status: 500 })
      }),
    )
    await openReorder()

    await userEvent.click(draft('Northgate Electrical Supply').getByRole('button', { name: 'Create purchase order' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Created PO-0005 for Northgate Electrical Supply, but these lines were not added: Level 2 EV Charger 48A Hardwired. Add them to PO-0005 in InvenTree, or create another order for them.',
    )
    expect(partsIn(draft('Northgate Electrical Supply'))).toContain('Level 2 EV Charger 48A Hardwired')
    expect(quantity('Level 2 EV Charger 48A Hardwired').value).toBe('2')
  })

  it('orders cable in 500 ft reels, rounding up', async () => {
    const fake = fakeInvenTree()
    const cable = fake.parts.find((p) => p.IPN === 'WIR-NMB-12-2')!
    cable.minimum_stock = 3200 // 2,500 ft in stock
    await openReorder()

    expect(quantity(cable.name).value).toBe('700')
    await userEvent.click(draft('Ridgeline Wire & Cable').getByRole('button', { name: 'Create purchase order' }))

    await screen.findByText(/Created PO-0005 for Ridgeline Wire & Cable/)
    const [l] = await Promise.all(sent(fake, 'POST', '/api/order/po-line/').map((r) => r.json()))
    expect([ipnOf(fake, l.part), l.quantity]).toEqual(['WIR-NMB-12-2', 2])
  })
})
