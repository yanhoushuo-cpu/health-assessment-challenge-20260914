# Health assessment implementation plan

> Execute in this session using superpowers:subagent-driven-development. Specification: docs/design.md.

- [ ] 1. Foundation and domain: initialize npm/TypeScript/Vitest, write failing numeric boundary and algorithm tests, implement pure validated calculateHealth(input, now), verify test:unit.
- [ ] 2. Persistence and HTTP: define Prisma schema/migration, launch PostgreSQL, write failing HTTP integration cases, implement session/auth, step version CAS, completion transaction, result DTO and payment lock/idempotency. Verify real database tests.
- [ ] 3. Funnel: write browser journey first, implement responsive progressive questions, recovery, validation, results and accessible simulated paywall; run Playwright against real server.
- [ ] 4. Delivery: seed synthetic demos, document API/ER/decisions/test gaps, configure CI, audit, run lint/typecheck/test/coverage/build. Create GitHub repository and deploy Vercel/Supabase when authenticated; verify online.

Shared interfaces: calculateHealth(input: unknown, now: Date) returns JSON-safe health results. HTTP {data: value} or {error:{code,message,details?}}. Assessment response contains id, currentStep, completedSteps, progress, data, version, status. Step PATCH includes version plus step fields. App uses only same-origin cookie authentication. Payment body {plan:"premium"} and Idempotency-Key.

Review gates: domain test outputs; database migration and HTTP tests; browser E2E; independent final concurrency/security review. Never count mocked persistence as integration coverage.
