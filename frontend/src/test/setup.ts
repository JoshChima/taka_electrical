import { afterAll, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { setupServer } from 'msw/node'

// The fake InvenTree. Each test installs its handlers with `fakeInvenTree()`.
export const server = setupServer()

// Listen now, not in beforeAll: the api client captures fetch when its module loads.
server.listen({ onUnhandledFrame: 'error' })
afterEach(() => {
  cleanup()
  server.resetHandlers()
  server.events.removeAllListeners()
  for (const c of document.cookie.split(';')) document.cookie = `${c.split('=')[0].trim()}=; max-age=0`
  history.replaceState(null, '', '/')
  localStorage.clear()
  sessionStorage.clear()
})
afterAll(() => server.close())
