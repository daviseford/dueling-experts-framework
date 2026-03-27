import { test, expect } from "@playwright/test"

test.describe("Accessibility", () => {
  test("dismiss button is a real <button> and keyboard-accessible", async ({ page }) => {
    await page.goto("/?mock")
    // Tab bar has dismiss buttons on session tabs
    const dismissBtn = page.getByRole("button", { name: /Dismiss/i }).first()
    await expect(dismissBtn).toBeAttached()
    // Verify it's an actual <button> element, not a span
    const tagName = await dismissBtn.evaluate((el) => el.tagName.toLowerCase())
    expect(tagName).toBe("button")
  })

  test("dismiss button responds to click and removes session tab", async ({ page }) => {
    await page.goto("/?mock")
    // The default mock has 4 sessions, so tab bar is visible with role="tab" elements
    const tabs = page.locator("[role='tab']")
    const initialCount = await tabs.count()
    expect(initialCount).toBeGreaterThanOrEqual(2)

    // Click the dismiss button (force: true to bypass opacity-0 visibility)
    const dismissBtn = page.getByRole("button", { name: /Dismiss/i }).first()
    await dismissBtn.click({ force: true })

    // A session should be dismissed (fewer tabs visible)
    await expect(tabs).toHaveCount(initialCount - 1)
  })

  test("prefers-reduced-motion disables animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/?mock=thinking")
    // Wait for the thinking indicator to appear
    await expect(page.locator(".thinking-glow").first()).toBeAttached()
    // Check that animation is disabled
    const animationName = await page.locator(".thinking-glow").first().evaluate(
      (el) => getComputedStyle(el).animationName
    )
    expect(animationName).toBe("none")
  })

  test("animations play when motion is not reduced", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.goto("/?mock=thinking")
    await expect(page.locator(".thinking-glow").first()).toBeAttached()
    const animationName = await page.locator(".thinking-glow").first().evaluate(
      (el) => getComputedStyle(el).animationName
    )
    expect(animationName).not.toBe("none")
  })
})
