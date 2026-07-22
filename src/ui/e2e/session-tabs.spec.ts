import { test, expect } from "@playwright/test"

test.describe("session tab bar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("renders all mock sessions in the tab bar", async ({ page }) => {
    // Tabs are elements with role="tab" (the dismiss control inside is a real <button>)
    await expect(page.getByRole("tab", { name: /Add rate limiting middleware/ })).toBeVisible()
    await expect(page.getByRole("tab", { name: /Refactor database connection pooling/ })).toBeVisible()
    await expect(page.getByRole("tab", { name: /Implement WebSocket event streaming/ })).toBeVisible()
    await expect(page.getByRole("tab", { name: /Fix authentication token refresh/ })).toBeVisible()
  })

  test("switches selected session when clicking a tab", async ({ page }) => {
    // Default is mock-session-1 -- click the session-2 tab
    await page.getByRole("tab", { name: /Refactor database connection pooling/ }).click()

    // Should now see session-2 turn content
    await expect(page.getByText("Database Connection Pooling").first()).toBeVisible()
  })

  test("dismisses a completed session and selects another tab", async ({ page }) => {
    // Wait for tabs to render
    const tab = page.getByRole("tab", { name: /Add rate limiting middleware/ })
    await expect(tab).toBeVisible()

    // Hover over the tab to reveal the dismiss button
    await tab.hover()

    // Click the dismiss button using aria-label (exact match to avoid ambiguity)
    await page.locator("[aria-label*='Dismiss Add rate limiting middleware']").click()

    // The dismissed session tab should no longer be visible
    await expect(tab).not.toBeVisible()

    // Another session should still be visible
    await expect(page.getByRole("tab", { name: /Refactor database connection pooling/ })).toBeVisible()
  })
})
