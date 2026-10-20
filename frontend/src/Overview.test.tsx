import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import App from './App'
import { fakeInvenTree } from './test/fake-inventree'

const column = async (name: string) => within(await screen.findByRole('region', { name }))
const rows = (col: ReturnType<typeof within>) => col.getAllByRole('listitem').map((li) => li.textContent)

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
})
