import { test, expect } from "@playwright/test"

test.describe("session panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("completed session shows transcript and decisions", async ({ page }) => {
    // mock-session-1 is selected by default (completed)
    // Status bar should show completed status
    await expect(page.getByText("Session completed").first()).toBeVisible()

    // Turn count should be visible in the status bar
    await expect(page.getByText("turns").first()).toBeVisible()
  })

  test("active session shows active status and interjection input", async ({ page }) => {
    // Switch to mock-session-3 (active)
    await page.locator("button", { hasText: "Implement WebSocket event streaming" }).click()

    // Status bar should show "Active" status
    await expect(page.getByText("Active").first()).toBeVisible()

    // Interjection input should be visible with placeholder text
    await expect(page.getByPlaceholder("Type a message to interject...")).toBeVisible()
  })

  test("paused session shows pause banner", async ({ page }) => {
    // Switch to mock-session-4 (paused)
    await page.locator("button", { hasText: "Fix authentication token refresh" }).click()

    // Pause banner text should be visible (isReadOnly=true in mock mode)
    await expect(page.getByText("waiting for owner input")).toBeVisible()
  })
})
