import { test, expect } from "@playwright/test"

test.describe("view mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("desktop can toggle to grid mode and render multiple panels", async ({ page }, testInfo) => {
    // Only run in desktop-chromium project (needs >= 768px viewport)
    if (testInfo.project.name === "mobile") {
      test.skip()
    }

    // The view-mode toggle should be visible on desktop (>= 768px, 4 sessions)
    const toggle = page.getByTestId("view-mode-toggle")
    await expect(toggle).toBeVisible()

    // Click to switch to grid view
    await toggle.click()

    // Grid container should appear with multiple session panels
    const gridContainer = page.getByTestId("grid-container")
    await expect(gridContainer).toBeVisible()
  })

  test("narrow viewport stays in single-panel mode", async ({ page }, testInfo) => {
    // This test only runs in the narrow-viewport project (375px wide)
    if (testInfo.project.name !== "mobile") {
      test.skip()
    }

    // View-mode toggle should not be visible at narrow width
    const toggle = page.getByTestId("view-mode-toggle")
    await expect(toggle).not.toBeVisible()

    // Single session container should be present
    const singleContainer = page.getByTestId("single-session-container")
    await expect(singleContainer).toBeVisible()
  })

  test("theme toggle switches between light and dark", async ({ page }) => {
    // Find the theme toggle button
    const themeToggle = page.getByRole("button", { name: "Toggle theme" })
    await expect(themeToggle).toBeVisible()

    // Click to toggle theme
    await themeToggle.click()

    // The html element should have a class indicating the theme changed
    const htmlEl = page.locator("html")
    const classAfterToggle = await htmlEl.getAttribute("class")

    // Toggle again
    await themeToggle.click()

    const classAfterSecondToggle = await htmlEl.getAttribute("class")

    // The class should have changed between toggles
    expect(classAfterToggle).not.toEqual(classAfterSecondToggle)
  })
})
