# Playwright Testing Guide for DEF UI

Guide for agents adding or extending Playwright end-to-end tests in this codebase.

## Current State

- **`@playwright/test`** is installed as a devDependency in `src/ui/package.json`.
- **`src/ui/playwright.config.ts`** is tracked and configures Chromium-only testing.
- **`src/ui/e2e/`** contains 3 spec files with 9 tests (16 run across 2 projects, 2 skipped by design).
- **All tests run against mock mode** (`dev:mock`) -- no live backend required.

### Test inventory

| Spec file | Tests | What it covers |
|-----------|-------|----------------|
| `session-tabs.spec.ts` | 3 | Tab rendering, tab switching, session dismissal |
| `session-panel.spec.ts` | 3 | Completed session transcript, active session interjection input, paused session pause banner |
| `view-mode.spec.ts` | 3 | Grid mode toggle, narrow viewport single-panel lock, theme toggle |

### Not yet covered

- Interjection submission (would need mock API intercept or form validation test)
- Turn card expand/collapse behavior
- Decision log rendering
- Markdown content rendering (code blocks, tables)
- Empty state (no sessions)
- Grid panel maximize/dismiss

## Configuration

### `src/ui/playwright.config.ts`

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
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "narrow-viewport",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
      },
    },
  ],
  webServer: {
    command: "npm run dev:mock -- --port 4173",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
})
```

Key points:
- **Port 4173** avoids collision with Vite's default dev port (5173).
- **`reuseExistingServer: !process.env.CI`** -- locally reuses a running dev server, CI always starts fresh.
- **Two projects:** `desktop-chromium` (default Desktop Chrome viewport) and `narrow-viewport` (375x667). Chromium only.
- **`webServer.command`** uses `dev:mock` so Vite serves with `VITE_MOCK=true`. No real backend needed.
- Traces captured on first retry for debugging CI failures.

### npm scripts (in `src/ui/package.json`)

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

### Gitignored artifacts

The root `.gitignore` excludes:
```
src/ui/test-results/
src/ui/playwright-report/
src/ui/blob-report/
```

## Mock Mode -- How It Works

The UI has a built-in mock mode that replaces all API calls with static data:

- **Activation:** `VITE_MOCK=true` env var (set by `.env.mock`) or `?mock` query param
- **Vite script:** `npm run dev:mock` runs `vite --mode mock`, which loads `.env.mock`
- **Mock data lives in:**
  - `src/ui/src/mocks/mock-session.ts` -- per-session turn data for all 4 mock sessions, keyed by session ID in `MOCK_TURNS_BY_SESSION`
  - `src/ui/src/hooks/use-mock-explorer.ts` -- 4 sessions with varied statuses (completed, active, paused)
- **Detection:** `src/ui/src/lib/env.ts` exports `isMock` which hooks check to decide data source

### Mock sessions

| Session ID | Topic | Status | Turns |
|------------|-------|--------|-------|
| `mock-session-1` | Add rate limiting middleware | completed | 11 (full plan/implement/review cycle) |
| `mock-session-2` | Refactor database connection pooling | completed | 6 |
| `mock-session-3` | Implement WebSocket event streaming | active | 4 |
| `mock-session-4` | Fix authentication token refresh | paused | 2 (waiting for human input) |

When `isMock` is true, the explorer hook returns mock sessions instead of fetching `/api/sessions`. The `useMockSessionTurns` hook returns turns from `MOCK_TURNS_BY_SESSION` for the selected session.

This means Playwright tests do not need network interception or API mocking -- the app serves deterministic data out of the box.

## Writing Tests

### File naming

Existing specs follow the pattern `src/ui/e2e/<feature>.spec.ts`:
```
src/ui/e2e/session-tabs.spec.ts
src/ui/e2e/session-panel.spec.ts
src/ui/e2e/view-mode.spec.ts
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
2. **ARIA roles/labels:** `page.getByRole("button", { name: "..." })`, `page.locator("[aria-label*='...']")`
3. **Locator with `hasText`:** `page.locator("button", { hasText: "..." })` -- useful when multiple element types contain the same text (e.g., distinguishing a `<button>` tab from a dismiss `<span role="button">`)
4. **`data-testid`:** Only when role/text selectors are ambiguous. Existing test IDs:
   - `data-testid="view-mode-toggle"` -- on the grid/single view toggle button in `session-header.tsx`
   - `data-testid="grid-container"` -- on the grid layout div in `App.tsx`
   - `data-testid="single-session-container"` -- on the single-session wrapper in `App.tsx`

Avoid CSS class selectors -- Tailwind classes are not stable identifiers.

### Project-specific tests

Use `testInfo.project.name` to skip tests that only apply to a specific viewport:

```ts
test("desktop can toggle to grid mode", async ({ page }, testInfo) => {
  if (testInfo.project.name === "narrow-viewport") {
    test.skip()
  }
  // ... desktop-only assertions
})
```

### What to test

The mock data provides 4 sessions covering completed, active, and paused states. Key UI surfaces:

| Component | File | What to verify |
|-----------|------|---------------|
| Session tab bar | `session-tab-bar.tsx` | Tabs render for each session, selection works, dismiss works |
| Session panel | `session-panel.tsx` | Renders turns, shows session metadata |
| Turn cards | `turn-card.tsx` | Correct agent labels, phase badges, content rendering |
| Decision log | `decision-log.tsx` | Decisions extracted and displayed from turns |
| Interjection input | `interjection-input.tsx` | Textarea visible for active sessions, hidden for read-only |
| Pause banner | `pause-banner.tsx` | Visible for paused sessions with "waiting for owner input" text |
| Status bar | `status-bar.tsx` | Shows session status, turn count |
| Theme toggle | `theme-toggle.tsx` | Toggles between light and dark mode |
| Grid view | `App.tsx` | Multiple panels render at >= 768px with >= 2 sessions |
| Empty state | `empty-state.tsx` | Shows when no sessions exist |

## Running Tests

From `src/ui/`:

```sh
# Run all tests
npx playwright test

# Run via npm script
npm run test:e2e

# Run a single spec
npx playwright test e2e/session-panel.spec.ts

# Run with UI mode (interactive)
npm run test:e2e:ui

# Run only desktop project
npx playwright test --project=desktop-chromium

# View last test report
npx playwright show-report
```

## Windows Compatibility

This is a Windows-primary codebase. Keep these in mind:

- **Use forward slashes in imports and config paths.** Node and Vite handle them correctly on Windows.
- **The `webServer.command` in playwright config must work with npm on Windows.** `npm run dev:mock -- --port 4173` works cross-platform. Do not use Unix-only shell syntax (e.g., `PORT=4173 vite`).
- **Process cleanup:** Playwright handles `webServer` process cleanup, but if you need manual cleanup, use `taskkill /T /F /PID <pid>` on Windows (see `src/util.ts` for the pattern).
- **File paths in assertions:** If you ever assert on file paths, normalize with forward slashes or use `path.posix`.

## Adding `data-testid` Attributes

Only add `data-testid` when Radix roles and visible text are not sufficient to target an element. Convention:

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
- `workers: process.env.CI ? 1 : undefined` -- serial execution in CI to avoid resource contention
- `reuseExistingServer: !process.env.CI` -- CI always starts a fresh server
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
- **Tab bar visibility:** The tab bar is hidden when in grid mode OR when there is only 1 visible session. Tests that dismiss sessions should account for this.
- **Interjection input visibility:** The `InterjectionInput` component returns `null` when `isReadOnly` is true (any status other than "active"). Only mock-session-3 (active) renders the interjection textarea.
