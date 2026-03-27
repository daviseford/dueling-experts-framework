import { test, expect } from "@playwright/test"

test.describe("Transcript behavior", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?mock")
  })

  test("turn cards are expandable and collapsible", async ({ page }) => {
    // Find a turn card trigger (they are collapsible)
    const firstTurn = page.getByText("#1").first()
    await expect(firstTurn).toBeVisible()

    // Click to collapse (turns default to open)
    await firstTurn.click()
    // Click again to expand
    await firstTurn.click()
  })

  test("completed session shows summary instead of decision log", async ({ page }) => {
    // For completed sessions, decision log is hidden and summary is shown
    await expect(page.getByRole("heading", { name: "Session Completed" })).toBeVisible()
    // Key Decisions section appears inside the summary card
    await expect(page.getByText("Key Decisions")).toBeVisible()
  })

  test("status bar shows turn count and timer", async ({ page }) => {
    // Use data-testid to reliably locate the status bar
    const statusBar = page.getByTestId("status-bar")
    await expect(statusBar.getByText("turns")).toBeVisible()
    // Timer
    await expect(statusBar.getByText("58m 0s")).toBeVisible()
  })

  test("expand/collapse all button works", async ({ page }) => {
    // Wait for turns to load (the mock data is lazy-loaded)
    await expect(page.getByRole("heading", { name: "Session Completed" })).toBeVisible()
    // The toggle button should exist (11 turns > 1)
    const collapseBtn = page.getByRole("button", { name: /Collapse all|Expand all/ })
    await expect(collapseBtn).toBeVisible()
    // Click to collapse all
    await collapseBtn.click()
    // Button text should change
    await expect(page.getByRole("button", { name: /Expand all/ })).toBeVisible()
    // Click to expand all
    await page.getByRole("button", { name: /Expand all/ }).click()
    await expect(page.getByRole("button", { name: /Collapse all/ })).toBeVisible()
  })

  test("phase badges are visible on turn cards", async ({ page }) => {
    // Wait for turns to load
    await expect(page.getByRole("heading", { name: "Session Completed" })).toBeVisible()
    // PLAN phase should appear on turn cards
    await expect(page.getByText("PLAN").first()).toBeVisible()
  })
})
