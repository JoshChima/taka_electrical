import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { fakeInvenTree, sent } from './test/fake-inventree'

async function openReceive() {
  render(<App />)
  await userEvent.click(within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Receive' }))
  return within(await screen.findByRole('region', { name: 'Expected deliveries' }))
}

describe('Receive a delivery', () => {
  it('lists every expected delivery, the one due first at the top', async () => {
    fakeInvenTree()
    const expected = await openReceive()

    expect(screen.getByRole('heading', { level: 1, name: 'Receive a delivery' })).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Receive' }).getAttribute('aria-current')).toBe('page')
    const orders = expected.getAllByRole('button').map((b) => b.textContent)
    expect(orders).toEqual([
      expect.stringMatching(/Ridgeline Wire & Cable.*Due 26 Oct.*PO-0002.*1 part, for PRJ-103/),
      expect.stringMatching(/BrightPath Lighting Distributors.*Due 29 Oct.*PO-0001.*2 parts, for PRJ-103/),
    ])
  })

  it('shows the chosen order with its supplier ref, Project and lines, ready to book in what is outstanding', async () => {
    fakeInvenTree()
    await pick(await openReceive(), 'PO-0001')

    const order = await orderDetail('PO-0001 · BrightPath Lighting Distributors')
    expect(order.getByText(/Supplier ref BPL-88412 · for PRJ-103 · due 29 Oct/)).toBeTruthy()
    const [highBay, chainKit] = await order.findAllByRole('group')
    expect(highBay.textContent).toMatch(/LED High-Bay 150W 5000K.*LGT-HB-150 · ordered 40, received so far 0/)
    expect(arrived(highBay).value).toBe('40')
    expect(putAway(highBay)).toBe('Aisle E - Lighting & EV')
    expect(chainKit.textContent).toMatch(/High-Bay Chain Hanging Kit.*SUP-HB-CHAIN · ordered 20, received so far 0/)
    expect(arrived(chainKit).value).toBe('20')
    expect(putAway(chainKit)).toBe('Aisle F - Supports & Consumables')
  })

  it('books in everything that arrived, each line put away where the Owner chose', async () => {
    const fake = fakeInvenTree()
    await pick(await openReceive(), 'PO-0001')
    const order = await orderDetail('PO-0001 · BrightPath Lighting Distributors')
    const [highBay, chainKit] = await order.findAllByRole('group')

    await userEvent.clear(arrived(highBay))
    await userEvent.type(arrived(highBay), '3')
    await userEvent.click(order.getByRole('button', { name: 'Everything arrived' }))
    expect(arrived(highBay).value).toBe('40')
    await userEvent.selectOptions(
      within(chainKit).getByLabelText('Put away in'),
      within(chainKit).getByRole('option', { name: 'Aisle A - Wire & Cable' }),
    )
    await userEvent.click(order.getByRole('button', { name: 'Book in delivery for PO-0001' }))

    expect(await screen.findByText(/Booked in PO-0001/)).toBeTruthy()
    const [receive] = sent(fake, 'POST', '/api/order/po/1/receive/')
    expect(receive.headers.get('X-CSRFToken')).toBe('fake-csrf-token')
    expect(await receive.json()).toEqual({
      items: [
        { line_item: 1, quantity: '40', location: aisle(fake, 'Aisle E - Lighting & EV') },
        { line_item: 2, quantity: '20', location: aisle(fake, 'Aisle A - Wire & Cable') },
      ],
    })
  })

  it('a partial delivery leaves the rest outstanding and the order on the list', async () => {
    const fake = fakeInvenTree()
    await pick(await openReceive(), 'PO-0001')
    const order = await orderDetail('PO-0001 · BrightPath Lighting Distributors')
    const [highBay, chainKit] = await order.findAllByRole('group')

    await userEvent.clear(arrived(highBay))
    await userEvent.type(arrived(highBay), '10')
    await userEvent.clear(arrived(chainKit))
    await userEvent.type(arrived(chainKit), '0')
    await userEvent.click(order.getByRole('button', { name: 'Book in delivery for PO-0001' }))

    expect(await order.findByText(/ordered 40, received so far 10/)).toBeTruthy()
    const [receive] = sent(fake, 'POST', '/api/order/po/1/receive/')
    expect(await receive.json()).toEqual({
      items: [{ line_item: 1, quantity: '10', location: aisle(fake, 'Aisle E - Lighting & EV') }],
    })
    const [highBayNow] = order.getAllByRole('group')
    expect(arrived(highBayNow).value).toBe('30')
    expect(expectedOrders()).toEqual([expect.stringMatching(/PO-0002/), expect.stringMatching(/PO-0001/)])
  })

  it('blocks receiving more than is outstanding, with a clear message', async () => {
    const fake = fakeInvenTree()
    await pick(await openReceive(), 'PO-0001')
    const order = await orderDetail('PO-0001 · BrightPath Lighting Distributors')
    const [highBay] = await order.findAllByRole('group')

    await userEvent.clear(arrived(highBay))
    await userEvent.type(arrived(highBay), '41')

    expect(within(highBay).getByRole('alert').textContent).toMatch(/Only 40 still to come on this order/)
    const book = order.getByRole('button', { name: 'Book in delivery for PO-0001' }) as HTMLButtonElement
    expect(book.disabled).toBe(true)
    await userEvent.click(book)
    expect(sent(fake, 'POST', '/api/order/po/1/receive/')).toEqual([])
  })

  it('drops a fully received order off the list, and its stock shows on the overview straight away', async () => {
    fakeInvenTree()
    await pick(await openReceive(), 'PO-0001')
    const order = await orderDetail('PO-0001 · BrightPath Lighting Distributors')
    const [, chainKit] = await order.findAllByRole('group')
    await userEvent.selectOptions(
      within(chainKit).getByLabelText('Put away in'),
      within(chainKit).getByRole('option', { name: 'Aisle A - Wire & Cable' }),
    )
    await userEvent.click(order.getByRole('button', { name: 'Book in delivery for PO-0001' }))

    expect(await screen.findByText(/Booked in PO-0001/)).toBeTruthy()
    await waitFor(() => expect(expectedOrders()).toEqual([expect.stringMatching(/PO-0002/)]))
    expect(screen.queryByRole('region', { name: /PO-0001/ })).toBeNull()

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Overview' }))
    const warehouse = within(await screen.findByRole('region', { name: 'Main Warehouse' }))
    // Aisle A held 17 parts; the chain kits are new there.
    expect(warehouse.getByText('Aisle A - Wire & Cable').parentElement!.textContent).toMatch(/18 parts/)
  })

  it('shows reels of cable in feet and books them in as reels', async () => {
    const fake = fakeInvenTree()
    await pick(await openReceive(), 'PO-0002')
    const order = await orderDetail('PO-0002 · Ridgeline Wire & Cable')
    const [cable] = await order.findAllByRole('group')

    // The demo seed orders 2500 reels of 500 ft (it probably meant 2500 ft).
    expect(cable.textContent).toMatch(/MC 12\/2 Aluminum Armor.*ordered 1,250,000 ft, received so far 0 ft/)
    await userEvent.clear(arrived(cable))
    await userEvent.type(arrived(cable), '1000')
    await userEvent.click(order.getByRole('button', { name: 'Book in delivery for PO-0002' }))

    expect(await order.findByText(/received so far 1,000 ft/)).toBeTruthy()
    const [receive] = sent(fake, 'POST', '/api/order/po/2/receive/')
    expect(await receive.json()).toEqual({
      items: [{ line_item: 3, quantity: '2', location: aisle(fake, 'Aisle A - Wire & Cable') }],
    })
  })
})

const expectedOrders = () =>
  within(screen.getByRole('region', { name: 'Expected deliveries' }))
    .getAllByRole('button')
    .map((b) => b.textContent)
const aisle = (fake: ReturnType<typeof fakeInvenTree>, name: string) => fake.locations.find((l) => l.name === name)!.pk

const pick = (expected: ReturnType<typeof within>, reference: string) =>
  userEvent.click(expected.getByRole('button', { name: new RegExp(reference) }))
const orderDetail = async (name: string) => within(await screen.findByRole('region', { name }))
const arrived = (line: HTMLElement) => within(line).getByLabelText('Arrived today') as HTMLInputElement
const putAway = (line: HTMLElement) => {
  const select = within(line).getByLabelText('Put away in') as HTMLSelectElement
  return select.selectedOptions[0].textContent
}
