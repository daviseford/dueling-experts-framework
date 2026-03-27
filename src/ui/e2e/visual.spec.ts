import { test, expect } from "@playwright/test"

test.describe("Visual golden screenshots", () => {
  test("desktop default mock - light theme", async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop-only screenshot")
    await page.goto("/?mock")
    await expect(page.getByRole("heading", { name: "Session Completed" })).toBeVisible()
    await expect(page).toHaveScreenshot("desktop-default-light.png", {
      maxDiffPixelRatio: 0.02,
    })
  })

  test("desktop default mock - dark theme", async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop-only screenshot")
    await page.goto("/?mock")
    await expect(page.getByRole("heading", { name: "Session Completed" })).toBeVisible()
    // Toggle dark mode via the theme toggle button
    const themeToggle = page.getByRole("button", { name: /theme|Toggle|dark|light/i })
    if (await themeToggle.isVisible()) {
      await themeToggle.click()
      await page.waitForTimeout(300) // allow theme transition
    }
    await expect(page).toHaveScreenshot("desktop-default-dark.png", {
      maxDiffPixelRatio: 0.02,
    })
  })

  test("mobile default mock", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile-only screenshot")
    await page.goto("/?mock")
    await expect(page.getByRole("heading", { name: "Session Completed" })).toBeVisible()
    await expect(page).toHaveScreenshot("mobile-default.png", {
      maxDiffPixelRatio: 0.02,
    })
  })
})
