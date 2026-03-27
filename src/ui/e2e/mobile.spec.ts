import { test, expect } from "@playwright/test"

test.describe("Mobile viewport (375x667)", () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test("status bar wraps without overflow", async ({ page }) => {
    await page.goto("/?mock")
    const statusBar = page.locator("[class*='border-t'][class*='bg-card']").last()
    await expect(statusBar).toBeVisible()

    // Check that the status bar does not cause horizontal overflow on the page
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 1) // 1px tolerance
  })

  test("session content is visible on mobile", async ({ page }) => {
    await page.goto("/?mock")
    // Session completion heading should be visible
    await expect(page.getByRole("heading", { name: "Session Completed" })).toBeVisible()
    // Turn cards should be rendered
    await expect(page.getByText("CLAUDE").first()).toBeVisible()
  })

  test("empty state is readable on mobile", async ({ page }) => {
    await page.goto("/?mock=empty")
    await expect(page.getByText("Waiting for agents to start...")).toBeVisible()
  })

  test("thinking state renders on mobile without overflow", async ({ page }) => {
    await page.goto("/?mock=thinking")
    await expect(page.locator(".thinking-glow").first()).toBeVisible()
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 1)
  })
})
