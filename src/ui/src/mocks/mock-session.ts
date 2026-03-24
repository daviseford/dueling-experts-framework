import type { Turn, TurnsResponse } from "@/lib/types"

const BASE_TIME = new Date("2026-03-24T14:00:00.000Z").getTime()

function ts(offsetMinutes: number): string {
  return new Date(BASE_TIME + offsetMinutes * 60_000).toISOString()
}

export const MOCK_TURNS: Turn[] = [
  {
    id: "turn-0001-claude",
    turn: 1,
    from: "claude",
    phase: "plan",
    status: "complete",
    timestamp: ts(0),
    duration_ms: 95_000,
    decisions: [
      "Add token-bucket rate limiter as Express middleware in src/middleware/rate-limit.ts",
      "Use Redis for distributed counter storage with graceful fallback to in-memory Map",
      "Default limits: 100 req/min for authenticated, 20 req/min for anonymous",
    ],
    content: `## Rate Limiting Middleware — Initial Proposal

### Architecture

I propose adding a token-bucket rate limiter as Express middleware. The core design:

\`\`\`ts
// src/middleware/rate-limit.ts
export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const store = opts.redis
    ? new RedisStore(opts.redis)
    : new MemoryStore()

  return async (req, res, next) => {
    const key = opts.keyGenerator(req)
    const result = await store.consume(key, opts.limit, opts.window)
    if (!result.allowed) {
      res.set("Retry-After", String(result.retryAfter))
      return res.status(429).json({ error: "Rate limit exceeded" })
    }
    next()
  }
}
\`\`\`

### Default Limits

| Tier | Limit | Window |
|------|-------|--------|
| Authenticated | 100 requests | 1 minute |
| Anonymous | 20 requests | 1 minute |
| Admin | No limit | — |

### Key Generation

- Authenticated requests: keyed by \`user.id\`
- Anonymous requests: keyed by \`X-Forwarded-For\` or \`req.ip\`

### Storage

Redis is preferred for multi-instance deployments. If Redis is unavailable, fall back to an in-memory \`Map\` with TTL cleanup. The fallback is per-process, which means limits won't be shared across instances — but it's better than crashing.

### Open questions

1. Should we apply rate limiting before or after authentication middleware?
2. Do we need per-endpoint overrides (e.g., higher limits for /health)?
3. Should 429 responses include the \`X-RateLimit-*\` headers?`,
  },
  {
    id: "turn-0002-codex",
    turn: 2,
    from: "codex",
    phase: "plan",
    status: "complete",
    timestamp: ts(5),
    duration_ms: 72_000,
    decisions: [],
    content: `Claude's proposal is mostly sound, but I disagree on two points.

**1. Token bucket is wrong here — use sliding window.**

Token bucket allows bursts up to the bucket size, which means a client could send 100 requests in the first second, then be blocked for 59 seconds. A sliding window counter distributes load more evenly. The implementation cost is comparable:

\`\`\`ts
// Sliding window is one MULTI + two commands in Redis
const current = await redis.multi()
  .zremrangebyscore(key, 0, windowStart)
  .zadd(key, now, requestId)
  .zcard(key)
  .expire(key, windowSec)
  .exec()
\`\`\`

**2. In-memory fallback is a footgun.**

If Redis goes down in production, the in-memory fallback gives each process its own counter. With 8 instances, a client effectively gets 8x the rate limit. This is worse than no rate limiting because it creates a false sense of security.

Better options:
- **Fail open** with a warning log — at least operators know the limiter is degraded
- **Fail closed** (503) with a short circuit breaker — aggressive but honest

I'd go with fail-open + alerting. The rate limiter is a guardrail, not a security boundary. If you need hard enforcement, that belongs in the API gateway (nginx, Cloudflare), not in app middleware.

**Agreed on everything else.** The key generation strategy, default limits, and middleware placement are fine. Apply it after auth so we have \`user.id\` available for keying.`,
  },
  {
    id: "turn-0003-claude",
    turn: 3,
    from: "claude",
    phase: "plan",
    status: "complete",
    timestamp: ts(11),
    duration_ms: 65_000,
    decisions: [],
    content: `Codex raises valid points. Let me respond to each:

### Sliding window vs token bucket — I'll concede

You're right that the burst behavior of token bucket is undesirable for our use case. We're protecting against sustained abuse, not traffic shaping. Sliding window with sorted sets is the better fit and Redis complexity is comparable.

### In-memory fallback — I'll push back partially

I agree the per-process counter issue is real. But "fail open with a warning" means our rate limiter does nothing during Redis outages, which could last minutes. Here's a middle ground:

**Use in-memory as a degraded mode with tighter limits.** When Redis is unreachable, apply limits at 1/N of the configured value (where N is the expected instance count, read from an env var). It's not precise, but it's better than nothing:

\`\`\`ts
const degradedLimit = Math.max(1, Math.floor(opts.limit / (opts.instanceCount ?? 4)))
\`\`\`

Pair this with a health check that reports \`degraded\` status when using the fallback, so monitoring catches it.

### Placement after auth — agreed

Applying after auth middleware makes key generation straightforward. We'll have access to \`req.user?.id\` for authenticated requests.

### X-RateLimit headers — yes, include them

Standard practice. Helps clients implement backoff:

\`\`\`
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1711288800
\`\`\``,
  },
  {
    id: "turn-0004-human",
    turn: 4,
    from: "human",
    phase: "plan",
    status: "complete",
    timestamp: ts(15),
    decisions: [],
    content: `Quick note — we're behind Cloudflare already, so we have basic DDoS protection at the edge. The app-level rate limiter is more about preventing API abuse from authenticated users (scraping, aggressive polling, etc).

So the in-memory fallback debate is less critical. If Redis is down, fail open is fine for us — Cloudflare still has our back for volumetric attacks. Just make sure we log it loudly.

Also, please add a /health endpoint exemption. Our k8s liveness probes hit it every 10 seconds and I don't want those counted.`,
  },
  {
    id: "turn-0005-codex",
    turn: 5,
    from: "codex",
    phase: "plan",
    status: "decided",
    timestamp: ts(20),
    duration_ms: 48_000,
    decisions: [
      "Use sliding window counter (Redis sorted sets) instead of token bucket",
      "Fail open with warning log when Redis is unreachable — Cloudflare handles volumetric protection",
      "Apply middleware after authentication for access to user.id",
      "Include X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset headers",
      "Exempt /health and /readiness endpoints from rate limiting",
      "Default limits: 100 req/min authenticated, 20 req/min anonymous, no limit for admin role",
    ],
    content: `The human's input simplifies our decision. With Cloudflare at the edge, the app-level limiter is purely for API abuse prevention. That changes the calculus on the fallback debate.

## Final Consensus

| Decision | Detail |
|----------|--------|
| Algorithm | Sliding window counter via Redis sorted sets |
| Redis failure mode | Fail open + \`logger.warn("rate-limiter-degraded")\` |
| Placement | After auth middleware |
| Headers | \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\` |
| Exemptions | \`/health\`, \`/readiness\` |
| Limits | 100/min auth, 20/min anon, unlimited admin |

Claude's degraded-mode proposal was reasonable but unnecessary given the Cloudflare layer. Keep the implementation simple — one store, one failure mode.

I'm marking this as decided. Claude, confirm.`,
  },
  {
    id: "turn-0006-claude",
    turn: 6,
    from: "claude",
    phase: "plan",
    status: "decided",
    timestamp: ts(23),
    duration_ms: 32_000,
    decisions: [
      "Use sliding window counter (Redis sorted sets) instead of token bucket",
      "Fail open with warning log when Redis is unreachable — Cloudflare handles volumetric protection",
      "Apply middleware after authentication for access to user.id",
      "Include X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset headers",
      "Exempt /health and /readiness endpoints from rate limiting",
      "Default limits: 100 req/min authenticated, 20 req/min anonymous, no limit for admin role",
    ],
    content: `Confirmed. The consensus is clean and the simplification from the human input is the right call. I withdraw my degraded-mode counter proposal — fail open + logging is sufficient given the Cloudflare backstop.

Moving to implementation.`,
  },
  {
    id: "turn-0007-system",
    turn: 7,
    from: "system",
    phase: "implement",
    status: "error",
    timestamp: ts(28),
    duration_ms: 15_000,
    decisions: [],
    content: `Agent execution failed: claude implementation timed out after 900s.

Error: ETIMEOUT — The Claude agent did not produce output within the allowed window.
Retry 1/2 exhausted. The orchestrator will retry with a fresh context.

Stack trace:
  at AgentRunner.execute (src/orchestrator/runner.ts:142:11)
  at SessionLoop.runTurn (src/orchestrator/session.ts:88:22)
  at async SessionLoop.advance (src/orchestrator/session.ts:55:5)`,
  },
  {
    id: "turn-0008-claude",
    turn: 8,
    from: "claude",
    phase: "implement",
    status: "complete",
    timestamp: ts(35),
    duration_ms: 420_000,
    decisions: [],
    content: `## Implementation Complete

Created the rate limiting middleware with all agreed-upon decisions.

### Files Created

**\`src/middleware/rate-limit.ts\`** — Core middleware

\`\`\`ts
import { Redis } from "ioredis"
import { RequestHandler } from "express"
import { logger } from "../lib/logger"

interface RateLimitOptions {
  redis: Redis
  limit: number
  window: number // seconds
  keyGenerator: (req: Express.Request) => string
  skip?: (req: Express.Request) => boolean
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    // Skip exempted paths
    if (opts.skip?.(req)) return next()

    const key = \`rl:\${opts.keyGenerator(req)}\`
    const now = Date.now()
    const windowStart = now - opts.window * 1000

    try {
      const results = await opts.redis.multi()
        .zremrangebyscore(key, 0, windowStart)
        .zadd(key, now, \`\${now}:\${Math.random()}\`)
        .zcard(key)
        .expire(key, opts.window)
        .exec()

      const count = results?.[2]?.[1] as number ?? 0
      const remaining = Math.max(0, opts.limit - count)
      const reset = Math.ceil((now + opts.window * 1000) / 1000)

      res.set("X-RateLimit-Limit", String(opts.limit))
      res.set("X-RateLimit-Remaining", String(remaining))
      res.set("X-RateLimit-Reset", String(reset))

      if (count > opts.limit) {
        const retryAfter = Math.ceil(opts.window - (now - windowStart) / 1000)
        res.set("Retry-After", String(retryAfter))
        return res.status(429).json({
          error: "Rate limit exceeded",
          retryAfter,
        })
      }

      next()
    } catch (err) {
      logger.warn("rate-limiter-degraded", { error: err })
      next() // Fail open
    }
  }
}
\`\`\`

**\`src/middleware/__tests__/rate-limit.test.ts\`** — Tests covering the sliding window, headers, exemptions, and fail-open behavior.

**\`src/routes/api.ts\`** — Applied middleware after auth:

\`\`\`ts
app.use(
  rateLimit({
    redis,
    limit: req => req.user?.role === "admin" ? Infinity : req.user ? 100 : 20,
    window: 60,
    keyGenerator: req => req.user?.id ?? req.ip,
    skip: req => ["/health", "/readiness"].includes(req.path),
  })
)
\`\`\`

### Changes Summary
- 2 files created, 1 file modified
- 94 lines of implementation, 156 lines of tests
- All tests passing`,
  },
  {
    id: "turn-0009-codex",
    turn: 9,
    from: "codex",
    phase: "review",
    status: "complete",
    timestamp: ts(45),
    duration_ms: 85_000,
    verdict: "fix",
    decisions: [],
    content: `## Review — verdict: fix

The implementation is structurally sound but has two issues that need correction before merge.

### Issue 1: Race condition in sliding window (HIGH)

The \`zadd\` uses \`\${now}:\${Math.random()}\` as the member value. If two requests arrive at the exact same millisecond, \`Math.random()\` could theoretically collide (astronomically unlikely, but the real issue is different): the score is \`now\`, so all requests in the same millisecond get the same score, and \`zremrangebyscore\` will remove them all at once when the window slides. Use a proper unique ID:

\`\`\`ts
// Use crypto.randomUUID() instead
.zadd(key, now, crypto.randomUUID())
\`\`\`

### Issue 2: Dynamic limit function not matching interface (MEDIUM)

The \`rateLimit\` function signature defines \`limit: number\`, but the usage in \`api.ts\` passes a function. Either:
- Change the interface to accept \`number | ((req) => number)\`
- Resolve the limit before passing it (preferred — keeps the middleware simple)

\`\`\`ts
// Preferred: resolve outside the middleware
const getLimit = (req) => req.user?.role === "admin" ? Infinity : req.user ? 100 : 20

app.use((req, res, next) => {
  rateLimit({ ...baseOpts, limit: getLimit(req) })(req, res, next)
})
\`\`\`

### Minor: Missing \`Vary\` header

The 429 response should include \`Vary: Authorization\` so CDN caches don't serve a 429 to a different user.

Please fix issues 1 and 2. The Vary header is optional but recommended.`,
  },
  {
    id: "turn-0010-claude",
    turn: 10,
    from: "claude",
    phase: "implement",
    status: "complete",
    timestamp: ts(52),
    duration_ms: 180_000,
    decisions: [],
    content: `## Review Fixes Applied

### Fix 1: Unique member IDs
Switched from \`Math.random()\` to \`crypto.randomUUID()\`:

\`\`\`ts
import { randomUUID } from "node:crypto"

// In the middleware:
.zadd(key, now, randomUUID())
\`\`\`

### Fix 2: Limit resolution
Changed the interface to accept a static number and moved the dynamic resolution to the call site:

\`\`\`ts
// src/routes/api.ts
const LIMITS = { admin: Infinity, authenticated: 100, anonymous: 20 }

function resolveLimit(req: Express.Request): number {
  if (req.user?.role === "admin") return LIMITS.admin
  if (req.user) return LIMITS.authenticated
  return LIMITS.anonymous
}

app.use((req, res, next) => {
  rateLimit({
    redis,
    limit: resolveLimit(req),
    window: 60,
    keyGenerator: req => req.user?.id ?? req.ip,
    skip: req => ["/health", "/readiness"].includes(req.path),
  })(req, res, next)
})
\`\`\`

### Bonus: Added Vary header
\`\`\`ts
res.set("Vary", "Authorization")
\`\`\`

All tests updated and passing. The type mismatch is resolved — \`limit\` is always \`number\` in the middleware interface.`,
  },
  {
    id: "turn-0011-codex",
    turn: 11,
    from: "codex",
    phase: "review",
    status: "done",
    timestamp: ts(58),
    duration_ms: 60_000,
    verdict: "approve",
    decisions: [],
    content: `## Review — verdict: approve

Both fixes are correctly applied:

1. **\`randomUUID()\`** — Eliminates the collision vector. Using \`node:crypto\` is the right import for Node.js.
2. **Static limit interface** — Clean separation. The limit resolution at the call site keeps the middleware testable with plain numbers.
3. **Vary header** — Good addition for CDN correctness.

Tests cover the key paths: within-limit, over-limit with 429, header values, exempted paths, and Redis failure with fail-open. Coverage looks solid.

Approved for merge. The PR is ready.`,
  },
]

export const MOCK_RESPONSE: TurnsResponse = {
  turns: MOCK_TURNS,
  session_status: "completed",
  phase: "review",
  topic: "Add rate limiting middleware to the API gateway",
  turn_count: 11,
  thinking: null,
  branch_name: "def/a1b2c3d4-rate-limiting-middleware",
  pr_url: "https://github.com/example/repo/pull/42",
  pr_number: 42,
  turns_path: ".def/sessions/mock-session-id/turns",
  artifacts_path: ".def/sessions/mock-session-id/artifacts",
  artifact_names: ["decisions.md", "diff-0008.patch", "pr-body.md"],
}
