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

test.describe("Active implement-phase transcript", () => {
  test("shows decision log, thinking indicator, and no session summary", async ({ page }) => {
    // thinking scenario is active with implement phase and all mock turns loaded
    await page.goto("/?mock=thinking")
    // Wait for turns to render
    await expect(page.getByText("CLAUDE").first()).toBeVisible()

    // Decision Log should be visible (non-completed session with decisions)
    await expect(page.getByText("Decision Log")).toBeVisible()

    // ThinkingIndicator should be active
    const indicator = page.getByTestId("thinking-indicator")
    await expect(indicator).toBeVisible()

    // Session summary should NOT appear (session is active, not completed)
    await expect(page.getByRole("heading", { name: "Session Completed" })).toHaveCount(0)
  })

  test("implement and review phase turns are present in transcript", async ({ page }) => {
    await page.goto("/?mock=thinking")
    await expect(page.getByText("CLAUDE").first()).toBeVisible()

    // Mock turns include plan, implement, and review phases
    await expect(page.getByText("PLAN").first()).toBeVisible()
    await expect(page.getByText("IMPLEMENT").first()).toBeVisible()
    await expect(page.getByText("REVIEW").first()).toBeVisible()
  })

  test("interjection input is available for active sessions", async ({ page }) => {
    await page.goto("/?mock=thinking")
    await expect(page.getByText("CLAUDE").first()).toBeVisible()

    // InterjectionInput should be rendered (not read-only)
    await expect(page.getByPlaceholder("Send a message to agents at the next turn boundary...")).toBeVisible()
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
  })
})
