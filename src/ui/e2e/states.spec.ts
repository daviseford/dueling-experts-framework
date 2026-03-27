import { test, expect } from "@playwright/test"

test.describe("Mock scenario states", () => {
  test("empty scenario shows waiting message", async ({ page }) => {
    await page.goto("/?mock=empty")
    await expect(page.getByText("Waiting for agents to start...")).toBeVisible()
    // No turn cards should be rendered -- check there are no CLAUDE/CODEX badges
    await expect(page.getByText("CLAUDE")).toHaveCount(0)
  })

  test("loading scenario shows skeleton cards then resolves to content", async ({ page }) => {
    await page.goto("/?mock=loading")
    // Skeleton cards should appear
    await expect(page.getByTestId("skeleton-turn-card").first()).toBeVisible()
    // Status should show "Loading..."
    await expect(page.getByText("Loading...")).toBeVisible()
    // Wait for loading to complete -- transcript content should appear
    await expect(page.getByText("CLAUDE").first()).toBeVisible({ timeout: 5000 })
    // Skeleton should be gone
    await expect(page.getByTestId("skeleton-turn-card")).toHaveCount(0)
    // Loading text should be replaced
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
    const indicator = page.getByTestId("thinking-indicator")
    await expect(indicator).toBeVisible()
    // Agent badge should be visible inside the thinking indicator
    await expect(indicator.getByText("CLAUDE")).toBeVisible()
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
    // Turn 7 is an error -- uses data-testid for structurally ambiguous error state
    const errorTurn = page.getByTestId("turn-card-error")
    await expect(errorTurn).toBeAttached()
    // Error turn should show SYSTEM badge
    await expect(errorTurn.getByText("SYSTEM")).toBeVisible()
  })

  test("queued human interjection shows PendingTurnCard with Queued label", async ({ page }) => {
    // Use thinking scenario -- an active session where InterjectionInput is visible
    await page.goto("/?mock=thinking")
    // Wait for turns to load
    await expect(page.getByText("CLAUDE").first()).toBeVisible()

    // Intercept the POST /api/interject to return 200 so the onSent callback fires
    await page.route("**/api/interject", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    )

    // Type a message and submit
    const textarea = page.getByPlaceholder("Type a message to interject...")
    await textarea.fill("Please consider edge cases for rate limiting")
    await page.getByRole("button", { name: "Send" }).click()

    // PendingTurnCard should appear with "Queued" label and USER badge
    await expect(page.getByText("Queued")).toBeVisible()
    // The pending card shows the message content
    await expect(page.getByText("Please consider edge cases for rate limiting")).toBeVisible()
  })
})
