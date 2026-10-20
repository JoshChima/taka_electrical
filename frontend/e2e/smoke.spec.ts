import { expect, test } from '@playwright/test'

// The only test against the real stack (Caddy + InvenTree 1.6.0 + the demo seed). Keep it the only one:
// everything else is tested against the fake InvenTree in src/.
const { SMOKE_BASE_URL, SMOKE_USERNAME, SMOKE_PASSWORD } = process.env

test.skip(
  !SMOKE_BASE_URL || !SMOKE_USERNAME || !SMOKE_PASSWORD,
  'Seam 2 needs the running stack: set SMOKE_BASE_URL (e.g. http://localhost), SMOKE_USERNAME and SMOKE_PASSWORD',
)

test('the Owner signs in and sees 5 parts below Minimum Stock on the overview', async ({ page }) => {
  await page.goto('/app/')
  await page.getByLabel('Username').fill(SMOKE_USERNAME!)
  await page.getByLabel('Password').fill(SMOKE_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('group', { name: '5 parts below Minimum Stock' })).toBeVisible()
  expect((await page.request.get('/web/')).ok(), "InvenTree's own UI is still at /web").toBe(true)
})
