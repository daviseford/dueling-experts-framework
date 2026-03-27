# Playwright Testing Guide for DEF UI

Guide for implementing agents adding or extending Playwright end-to-end tests in this codebase.

## Current State (as of main branch)

- **No `@playwright/test` in `src/ui/package.json` devDependencies.** You must install it.
- **No `playwright.config.ts` tracked on main.** You must create it.
- **No `e2e/` directory exists.** You must create `src/ui/e2e/`.
- **Mock mode is fully wired.** The app can run without a live backend -- use this for all e2e tests.

## Setup

### 1. Install Playwright

From `src/ui/`:

```sh
npm install -D @playwright/test
npx playwright install --with-deps chromium
```

Only install Chromium unless you have a specific reason for other browsers. The UI is a single-page dashboard, not a public website.

### 2. Create `src/ui/playwright.config.ts`

```ts
import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
      },
    },
  ],
  webServer: {
    command: "npm run dev:mock -- --port 5173",
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
})
```

Key points:
- `webServer.command` uses `dev:mock` so Vite serves with `VITE_MOCK=true`. No real backend needed.
- Two projects: desktop and a narrow mobile viewport. Test both.
- Traces captured on first retry for debugging CI failures.

### 3. Create the test directory

```
src/ui/e2e/
```

All Playwright specs go here as `*.spec.ts` files.

## Mock Mode -- How It Works

The UI has a built-in mock mode that replaces all API calls with static data:

- **Activation:** `VITE_MOCK=true` env var (set by `.env.mock`) or `?mock` query param
- **Vite script:** `npm run dev:mock` runs `vite --mode mock`, which loads `.env.mock`
- **Mock data lives in:**
  - `src/ui/src/mocks/mock-session.ts` -- 11 turns of a full debate/implement/review session
  - `src/ui/src/hooks/use-mock-explorer.ts` -- 4 sessions with varied statuses (completed, active, paused)
- **Detection:** `src/ui/src/lib/env.ts` exports `isMock` which hooks check to decide data source

When `isMock` is true, the explorer hook returns mock sessions instead of fetching `/api/sessions`. Individual session panels return mock turns instead of polling `/api/sessions/:id/turns`.

This means Playwright tests do not need network interception or API mocking -- the app serves deterministic data out of the box.

## Writing Tests

### File naming

```
src/ui/e2e/session-panel.spec.ts
src/ui/e2e/grid-view.spec.ts
src/ui/e2e/interjection.spec.ts
```

### Basic test structure

```ts
import { test, expect } from "@playwright/test"

test.describe("session panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("displays the session topic", async ({ page }) => {
    await expect(page.getByText("Add rate limiting middleware")).toBeVisible()
  })
})
```

### Targeting elements

The UI uses shadcn/ui components built on Radix primitives. Prefer these selectors in order:

1. **Text content:** `page.getByText("...")` or `page.getByRole("heading", { name: "..." })`
2. **ARIA roles:** `page.getByRole("button", { name: "..." })`, `page.getByRole("tab", { name: "..." })`
3. **`data-testid`:** Add these to components when role/text selectors are ambiguous. Follow the pattern `data-testid="turn-card-0001"`.

Avoid CSS class selectors -- Tailwind classes are not stable identifiers.

### What to test

The mock data provides a complete session with all phases and turn types. Key UI surfaces:

| Component | File | What to verify |
|-----------|------|---------------|
| Session tab bar | `session-tab-bar.tsx` | Tabs render for each session, selection works, dismiss works |
| Session panel | `session-panel.tsx` | Renders turns, shows session metadata |
| Turn cards | `turn-card.tsx` | Correct agent labels, phase badges, content rendering |
| Decision log | `decision-log.tsx` | Decisions extracted and displayed from turns |
| Interjection input | `interjection-input.tsx` | Textarea visible for active sessions, submit button |
| Status bar | `status-bar.tsx` | Shows session status, branch name, PR link |
| Theme toggle | `theme-toggle.tsx` | Toggles between light and dark mode |
| Grid view | `App.tsx` | Multiple panels render, maximize/dismiss work |
| Empty state | `empty-state.tsx` | Shows when no sessions exist |
| Markdown content | `markdown-content.tsx` | Renders markdown in turn bodies (code blocks, tables) |

### Mobile viewport testing

The `mobile` project in the config uses a 375x667 viewport. Test that:
- The tab bar is usable at narrow widths
- Grid view degrades gracefully (the app requires >= 768px for grid mode)
- Turn cards don't overflow horizontally
- The interjection input is accessible

## API Endpoints (for reference)

These are the real API endpoints the UI calls. In mock mode they are bypassed, but you should understand them for context:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/sessions` | List all sessions |
| GET | `/api/sessions/:id/turns` | Get turns for a session |
| POST | `/api/interject` | Send a human interjection |
| POST | `/api/end-session` | Gracefully end a session |

The Vite dev server proxies `/api` to `http://localhost:${DEF_PORT || 3001}` (see `vite.config.ts`).

## Running Tests

From `src/ui/`:

```sh
# Run all tests
npx playwright test

# Run a single spec
npx playwright test e2e/session-panel.spec.ts

# Run with UI mode (interactive)
npx playwright test --ui

# Run only desktop project
npx playwright test --project=desktop-chromium

# View last test report
npx playwright show-report
```

## Windows Compatibility

This is a Windows-primary codebase. Keep these in mind:

- **Use forward slashes in imports and config paths.** Node and Vite handle them correctly on Windows.
- **The `webServer.command` in playwright config must work with npm on Windows.** `npm run dev:mock -- --port 5173` works cross-platform. Do not use Unix-only shell syntax (e.g., `PORT=5173 vite`).
- **Process cleanup:** Playwright handles `webServer` process cleanup, but if you need manual cleanup, use `taskkill /T /F /PID <pid>` on Windows (see `src/util.ts` for the pattern).
- **File paths in assertions:** If you ever assert on file paths, normalize with forward slashes or use `path.posix`.

## Adding `data-testid` Attributes

When Radix roles and visible text are not sufficient to target an element, add `data-testid` to the component. Convention:

```tsx
<div data-testid="turn-card-0001">...</div>
<div data-testid="session-tab-mock-session-1">...</div>
<div data-testid="decision-log">...</div>
```

Keep the test ID descriptive and include dynamic identifiers where needed (turn ID, session ID).

## CI Integration

The Playwright config is already CI-aware:

- `forbidOnly: !!process.env.CI` -- prevents `.only` from sneaking into CI
- `retries: process.env.CI ? 2 : 0` -- retries flaky tests in CI
- `workers: process.env.CI ? 1` -- serial execution in CI to avoid resource contention
- `trace: "on-first-retry"` -- captures traces only when a test fails and retries

To add Playwright to a GitHub Actions workflow:

```yaml
- name: Install Playwright
  working-directory: src/ui
  run: npx playwright install --with-deps chromium

- name: Run Playwright tests
  working-directory: src/ui
  run: npx playwright test
  env:
    CI: true
```

## Gotchas

- **The app uses `localStorage`** for view mode preference and dismissed sessions. Use `page.evaluate(() => localStorage.clear())` in `beforeEach` if your tests depend on a clean slate.
- **Theme is managed by `next-themes`** (despite this not being a Next.js app -- it's used standalone). The theme toggle writes to `localStorage` and applies a class to `<html>`. Test both themes if testing visual elements.
- **Polling:** In mock mode the explorer hook does not poll, but individual session panels may still use interval-based fetching. Mock mode returns static data so this is safe, but be aware of it if you see flaky timing issues.
- **The `Toaster` component** (from `sonner`) renders toast notifications at `bottom-right`. If testing interactions that trigger toasts, wait for them explicitly.
