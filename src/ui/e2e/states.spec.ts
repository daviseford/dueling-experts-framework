import { test, expect } from "@playwright/test"

test.describe("Mock scenario states", () => {
  test("empty scenario shows waiting message", async ({ page }) => {
    await page.goto("/?mock=empty")
    await expect(page.getByText("Waiting for agents to start...")).toBeVisible()
    // No turn cards should be rendered
    await expect(page.locator("[class*='border-l-blue-500']")).toHaveCount(0)
  })

  test("loading scenario shows skeleton cards then resolves", async ({ page }) => {
    await page.goto("/?mock=loading")
    // Skeleton cards should appear (pulse animations)
    await expect(page.locator(".animate-pulse").first()).toBeVisible()
    // Status badge should show "Loading..."
    await expect(page.getByText("Loading...")).toBeVisible()
    // Wait for loading to complete
    await page.waitForTimeout(2000)
    await expect(page.getByText("Loading...")).not.toBeVisible()
  })

  test("paused scenario shows pause banner", async ({ page }) => {
    await page.goto("/?mock=paused")
    // The pause banner has specific text about the session being paused
    await expect(page.getByText("Paused session waiting for human input")).toBeVisible()
    // Should have turns from CLAUDE
    await expect(page.getByText("CLAUDE").first()).toBeVisible()
  })

  test("thinking scenario shows thinking indicator", async ({ page }) => {
    await page.goto("/?mock=thinking")
    await expect(page.locator(".thinking-glow").first()).toBeVisible()
    // Agent badge should be visible in thinking indicator
    await expect(page.locator(".animate-scan").first()).toBeAttached()
  })

  test("default scenario shows completed session with all turns", async ({ page }) => {
    await page.goto("/?mock")
    // Wait for summary heading (use role to avoid matching status bar badge)
    await expect(page.getByRole("heading", { name: "Session Completed" })).toBeVisible()
    // Should show CLAUDE, CODEX, USER, SYSTEM badges
    await expect(page.getByText("CLAUDE").first()).toBeVisible()
    await expect(page.getByText("CODEX").first()).toBeVisible()
    await expect(page.getByText("USER").first()).toBeVisible()
    await expect(page.getByText("SYSTEM").first()).toBeVisible()
  })

  test("completed session shows summary with PR link and decisions", async ({ page }) => {
    await page.goto("/?mock")
    await expect(page.getByRole("heading", { name: "Session Completed" })).toBeVisible()
    // PR link
    await expect(page.getByText("PR #42")).toBeVisible()
    // Branch name
    await expect(page.getByText("def/a1b2c3d4-rate-limiting-middleware")).toBeVisible()
    // Key decisions section
    await expect(page.getByText("Key Decisions")).toBeVisible()
  })

  test("error turn renders with error styling", async ({ page }) => {
    await page.goto("/?mock")
    // Turn 7 is an error from "system"
    const errorBadge = page.locator(".border-l-red-500").first()
    await expect(errorBadge).toBeAttached()
  })
})
