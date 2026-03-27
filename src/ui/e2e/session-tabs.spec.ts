import { test, expect } from "@playwright/test"

test.describe("session tab bar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("renders all mock sessions in the tab bar", async ({ page }) => {
    // Tab buttons are <button> elements containing topic text
    // Use locator("button") to avoid matching dismiss spans with role="button"
    await expect(page.locator("button", { hasText: "Add rate limiting middleware" })).toBeVisible()
    await expect(page.locator("button", { hasText: "Refactor database connection pooling" })).toBeVisible()
    await expect(page.locator("button", { hasText: "Implement WebSocket event streaming" })).toBeVisible()
    await expect(page.locator("button", { hasText: "Fix authentication token refresh" })).toBeVisible()
  })

  test("switches selected session when clicking a tab", async ({ page }) => {
    // Default is mock-session-1 -- click the session-2 tab
    await page.locator("button", { hasText: "Refactor database connection pooling" }).click()

    // Should now see session-2 turn content
    await expect(page.getByText("Database Connection Pooling").first()).toBeVisible()
  })

  test("dismisses a completed session and selects another tab", async ({ page }) => {
    // Wait for tabs to render
    const tab = page.locator("button", { hasText: "Add rate limiting middleware" })
    await expect(tab).toBeVisible()

    // Hover over the tab to reveal the dismiss button
    await tab.hover()

    // Click the dismiss button using aria-label (exact match to avoid ambiguity)
    await page.locator("[aria-label*='Dismiss Add rate limiting middleware']").click()

    // The dismissed session tab should no longer be visible
    await expect(tab).not.toBeVisible()

    // Another session should still be visible
    await expect(page.locator("button", { hasText: "Refactor database connection pooling" })).toBeVisible()
  })
})
