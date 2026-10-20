import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { fakeInvenTree, sent } from './test/fake-inventree'

async function openMove(path = '/move') {
  history.replaceState(null, '', path)
  render(<App />)
  return await screen.findByRole('region', { name: 'Parts to move' })
}

async function addPart(words: string, name: string) {
  const parts = screen.getByRole('region', { name: 'Parts to move' })
  await userEvent.clear(within(parts).getByLabelText('Add a part'))
  await userEvent.type(within(parts).getByLabelText('Add a part'), words)
  await userEvent.click(within(parts).getByRole('button', { name: `Add ${name}` }))
  return within(parts).getByRole('group', { name })
}

async function setQty(line: HTMLElement, qty: string) {
  const input = within(line).getByLabelText('Qty')
  await userEvent.clear(input)
  await userEvent.type(input, qty)
}

const loc = (fake: ReturnType<typeof fakeInvenTree>, name: string) => fake.locations.find((l) => l.name.startsWith(name))!.pk

const item = (fake: ReturnType<typeof fakeInvenTree>, ipn: string, at: string) =>
  fake.stock.find((s) => s.part_detail.IPN === ipn && s.location === loc(fake, at))!.pk

describe('Move stock', () => {
  it('moves 250 ft of NM-B 12/2 from Aisle A to Van 01 in one stock transfer', async () => {
    const fake = fakeInvenTree()
    await openMove()

    const line = await addPart('nm-b 12/2', 'NM-B 12/2 w/G')
    expect(line.textContent).toMatch(/WIR-NMB-12-2 · 2,000 ft in Aisle A/)
    await setQty(line, '250')
    await userEvent.click(screen.getByRole('button', { name: 'Move 1 part to Van 01' }))

    expect(await screen.findByText('Moved 1 part to Van 01 (Residential).')).toBeTruthy()
    const [transfer] = sent(fake, 'POST', '/api/stock/transfer/')
    expect(transfer.headers.get('X-CSRFToken')).toBe('fake-csrf-token')
    expect(await transfer.json()).toEqual({ items: [{ pk: item(fake, 'WIR-NMB-12-2', 'Aisle A'), quantity: '250' }], location: loc(fake, 'Van 01') })
  })

  it('is in the navigation', async () => {
    fakeInvenTree()
    render(<App />)
    await userEvent.click(within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Move stock' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Move stock' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'Parts to move' })).toBeTruthy()
  })

  it('stages material at a Job Site, showing its Project and address', async () => {
    const fake = fakeInvenTree()
    await openMove()

    await userEvent.click(screen.getByRole('button', { name: 'Job Site' }))
    await userEvent.selectOptions(screen.getByLabelText('Job Site'), 'PRJ-103 Harbor Point Warehouse')
    expect(
      screen.getByText(
        'PRJ-103 Harbor Point Warehouse · 75 Harbor Point Rd, Bldg C · Harbor Point Logistics - warehouse LED high-bay retrofit (40 fixtures)',
      ),
    ).toBeTruthy()
    await setQty(await addPart('chain', 'High-Bay Chain Hanging Kit'), '5')
    const summary = within(screen.getByRole('complementary', { name: 'Summary' }))
    expect(summary.getByText('Job Site for PRJ-103 Harbor Point Warehouse')).toBeTruthy()
    await userEvent.click(summary.getByRole('button', { name: 'Stage 1 part at PRJ-103' }))

    expect(await screen.findByText('Staged 1 part at PRJ-103 Harbor Point Warehouse.')).toBeTruthy()
    const [transfer] = sent(fake, 'POST', '/api/stock/transfer/')
    expect((await transfer.json()).location).toBe(loc(fake, 'PRJ-103'))
  })

  it('moves several parts in one transfer, after removing a line, with a summary first', async () => {
    const fake = fakeInvenTree()
    await openMove()

    await userEvent.selectOptions(screen.getByLabelText('Van'), 'Van 03 (Service Calls)')
    await setQty(await addPart('15a duplex', '15A Duplex Receptacle TR, White'), '20')
    await setQty(await addPart('old-work', 'Single-Gang Old-Work Box'), '25')
    await setQty(await addPart('gfci receptacle', '20A GFCI Receptacle, White'), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Single-Gang Old-Work Box' }))

    expect(screen.queryByRole('group', { name: 'Single-Gang Old-Work Box' })).toBeNull()
    const summary = within(screen.getByRole('complementary', { name: 'Summary' }))
    expect(summary.getByText('Main Warehouse')).toBeTruthy()
    expect(summary.getByText('Van 03 (Service Calls)')).toBeTruthy()
    expect(summary.getByText('2 parts')).toBeTruthy()
    await userEvent.click(summary.getByRole('button', { name: 'Move 2 parts to Van 03' }))

    expect(await screen.findByText('Moved 2 parts to Van 03 (Service Calls).')).toBeTruthy()
    expect(sent(fake, 'POST', '/api/stock/transfer/')).toHaveLength(1)
    expect(await sent(fake, 'POST', '/api/stock/transfer/')[0].json()).toEqual({
      items: [
        { pk: item(fake, 'DEV-REC-15-WH', 'Aisle C'), quantity: '20' },
        { pk: item(fake, 'DEV-GFCI-20-WH', 'Aisle C'), quantity: '4' },
      ],
      location: loc(fake, 'Van 03'),
    })
  })

  it('takes a part in several aisles from the one with the most stock, unless the Owner picks another', async () => {
    const fake = fakeInvenTree()
    const gfci = fake.stock.find((s) => s.part_detail.IPN === 'DEV-GFCI-20-WH')!
    fake.stock.push({ ...gfci, pk: 9001, quantity: 30, location: loc(fake, 'Aisle E') })
    fake.stock.push({ ...gfci, pk: 9002, quantity: 10, location: loc(fake, 'Aisle C') })
    await openMove()

    const line = await addPart('gfci receptacle', '20A GFCI Receptacle, White')
    expect(line.textContent).toMatch(/30 in Aisle E/)
    await userEvent.selectOptions(within(line).getByLabelText('Take from'), 'Aisle C (28)')
    expect(line.textContent).toMatch(/28 in Aisle C/)
    await setQty(line, '25')
    await userEvent.click(screen.getByRole('button', { name: 'Move 1 part to Van 01' }))

    await screen.findByText('Moved 1 part to Van 01 (Residential).')
    expect((await sent(fake, 'POST', '/api/stock/transfer/')[0].json()).items).toEqual([
      { pk: gfci.pk, quantity: '18' },
      { pk: 9002, quantity: '7' },
    ])
  })

  it('blocks asking for more than is in the aisle', async () => {
    const fake = fakeInvenTree()
    await openMove()

    const line = await addPart('nm-b 12/2', 'NM-B 12/2 w/G')
    await setQty(line, '2500')

    expect(within(line).getByRole('alert').textContent).toBe('Only 2,000 ft in Aisle A. Move at most that.')
    expect(screen.getByRole('button', { name: 'Move 1 part to Van 01' }).hasAttribute('disabled')).toBe(true)
    await setQty(line, '2000')
    expect(within(line).queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Move 1 part to Van 01' }).hasAttribute('disabled')).toBe(false)
    expect(sent(fake, 'POST', '/api/stock/transfer/')).toHaveLength(0)
  })

  it('shows the new quantities on the overview and in Find after a move', async () => {
    fakeInvenTree()
    await openMove()
    await setQty(await addPart('gfci receptacle', '20A GFCI Receptacle, White'), '10')
    await userEvent.selectOptions(screen.getByLabelText('Van'), 'Van 02 (Commercial)')
    await userEvent.click(screen.getByRole('button', { name: 'Move 1 part to Van 02' }))
    await screen.findByText('Moved 1 part to Van 02 (Commercial).')

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Overview' }))
    const gfci = (await screen.findByRole('cell', { name: /DEV-GFCI-20-WH/ })).closest('tr')!
    expect(gfci.textContent).toMatch(/Van 02 10 · Aisle C 8 · Van 03 6 · Van 01 4/)

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Find a part' }))
    await userEvent.type(await screen.findByRole('searchbox'), 'DEV-GFCI-20')
    const part = within(await screen.findByRole('region', { name: '20A GFCI Receptacle, White' }))
    expect(part.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Van 0210', 'Aisle C8', 'Van 036', 'Van 014'])
  })

  it('reports which lines failed and keeps the form as entered', async () => {
    const fake = fakeInvenTree()
    await openMove()
    await setQty(await addPart('nm-b 12/2', 'NM-B 12/2 w/G'), '250')
    const gfci = await addPart('gfci receptacle', '20A GFCI Receptacle, White')
    await setQty(gfci, '4')
    // Someone moves the GFCIs out of Aisle C in InvenTree's own UI meanwhile.
    fake.stock = fake.stock.filter((s) => s.pk !== item(fake, 'DEV-GFCI-20-WH', 'Aisle C'))
    await userEvent.click(screen.getByRole('button', { name: 'Move 2 parts to Van 01' }))

    expect((await screen.findByText(/The move failed/)).textContent).toBe('The move failed and nothing was moved.')
    expect(within(gfci).getByRole('alert').textContent).toMatch(/^Not moved: Invalid pk/)
    const nmb = screen.getByRole('group', { name: 'NM-B 12/2 w/G' })
    expect(within(nmb).queryByRole('alert')).toBeNull()
    expect((within(nmb).getByLabelText('Qty') as HTMLInputElement).value).toBe('250')
    expect((within(gfci).getByLabelText('Qty') as HTMLInputElement).value).toBe('4')
    expect((screen.getByLabelText('Van') as HTMLSelectElement).selectedOptions[0].text).toBe('Van 01 (Residential)')
  })

  it('opens with the part chosen in Find already added', async () => {
    fakeInvenTree()
    render(<App />)
    await userEvent.click(await screen.findByRole('link', { name: 'Find a part' }))
    await userEvent.type(await screen.findByRole('searchbox'), 'WIR-NMB-12-2')
    const part = within(await screen.findByRole('region', { name: 'NM-B 12/2 w/G' }))
    await userEvent.click(part.getByRole('link', { name: 'Move stock' }))

    const parts = within(await screen.findByRole('region', { name: 'Parts to move' }))
    expect((await parts.findByRole('group', { name: 'NM-B 12/2 w/G' })).textContent).toMatch(/2,000 ft in Aisle A/)
  })

  it('opens from the overview with a Van, or Job Site, already chosen', async () => {
    fakeInvenTree()
    render(<App />)
    const vans = within(await screen.findByRole('region', { name: 'Vans' }))
    await userEvent.click(vans.getByRole('link', { name: 'Restock Van 02' }))
    await screen.findByRole('region', { name: 'Parts to move' })
    expect((screen.getByLabelText('Van') as HTMLSelectElement).selectedOptions[0].text).toBe('Van 02 (Commercial)')

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Overview' }))
    const sites = within(await screen.findByRole('region', { name: 'Job Sites' }))
    await userEvent.click(sites.getByRole('link', { name: 'Stage material at a Job Site' }))
    await screen.findByRole('region', { name: 'Parts to move' })
    expect(screen.getByRole('button', { name: 'Job Site' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('Job Site') as HTMLSelectElement).selectedOptions[0].text).toBe('PRJ-101 Alvarez Residence')
  })
})
