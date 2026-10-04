export async function openSignatureSection(page, title) {
  const section = page.locator('details.ui-disclosure').filter({
    has: page.locator('summary strong').filter({ hasText: title }),
  })
  if (!(await section.evaluate((el) => el.open))) await section.locator('summary').click()
}
