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
    const tabs = page.getByRole("tab")
    const initialCount = await tabs.count()
    expect(initialCount).toBeGreaterThanOrEqual(2)

    // Click the dismiss button (force: true to bypass opacity-0 visibility)
    const dismissBtn = page.getByRole("button", { name: /Dismiss/i }).first()
    await dismissBtn.click({ force: true })

    // A session should be dismissed (fewer tabs visible)
    await expect(tabs).toHaveCount(initialCount - 1)
  })

  test("tab bar has proper tablist semantics with roving tabindex", async ({ page }) => {
    await page.goto("/?mock")
    // Verify tablist role exists
    const tablist = page.getByRole("tablist", { name: "Sessions" })
    await expect(tablist).toBeAttached()

    // Verify only the selected tab has tabIndex=0
    const tabs = page.getByRole("tab")
    const tabCount = await tabs.count()
    let focusableCount = 0
    for (let i = 0; i < tabCount; i++) {
      const tabIndex = await tabs.nth(i).getAttribute("tabindex")
      if (tabIndex === "0") focusableCount++
    }
    expect(focusableCount).toBe(1)
  })

  test("arrow keys navigate between tabs", async ({ page }) => {
    await page.goto("/?mock")
    const tabs = page.getByRole("tab")
    const firstTab = tabs.first()

    // Focus the first tab and press ArrowRight
    await firstTab.focus()
    const firstTabSelected = await firstTab.getAttribute("aria-selected")
    expect(firstTabSelected).toBe("true")

    await page.keyboard.press("ArrowRight")
    // After ArrowRight, the second tab should be selected
    const secondTab = tabs.nth(1)
    await expect(secondTab).toHaveAttribute("aria-selected", "true")
  })

  test("prefers-reduced-motion disables animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/?mock=thinking")
    // Wait for the thinking indicator to appear
    const indicator = page.getByTestId("thinking-indicator")
    await expect(indicator).toBeAttached()
    // Check that animation is disabled on the thinking-glow span inside
    const animationName = await indicator.locator(".thinking-glow").first().evaluate(
      (el) => getComputedStyle(el).animationName
    )
    expect(animationName).toBe("none")
  })

  test("animations play when motion is not reduced", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.goto("/?mock=thinking")
    const indicator = page.getByTestId("thinking-indicator")
    await expect(indicator).toBeAttached()
    const animationName = await indicator.locator(".thinking-glow").first().evaluate(
      (el) => getComputedStyle(el).animationName
    )
    expect(animationName).not.toBe("none")
  })
})
