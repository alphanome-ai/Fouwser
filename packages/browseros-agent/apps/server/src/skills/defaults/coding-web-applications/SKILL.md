---
name: coding-web-applications
description: Build or modify full-stack web applications with a Next.js-first, Vercel-focused approach. Use when the user asks for web app features, backend APIs, database integrations, auth, or production deployment guidance.
metadata:
  display-name: Coding Web Applications
  enabled: "true"
  version: "1.0"
---

# Coding Web Applications

Use this skill when implementing or extending a web application, especially when the user prefers Next.js/React and Vercel.

## Supporting Skills

For backend-heavy work, always load and apply `supabase-postgres-best-practices`
as a supporting skill before implementation details are finalized.

Use it specifically for:

- Database schema design and migrations
- Query design and performance/indexing decisions
- Supabase auth and Postgres role/permission design
- Row-Level Security (RLS) policy design and review
- Connection management and production database tuning

## Default Stack

- Frontend Framework: React/Next.js + TypeScript
- Styling: Tailwind CSS unless the repo already uses another system
- Backend: Fastify (preferred) or Express API service with TypeScript
- Database: PostgreSQL (Supabase)
- Deploy target: Vercel

Follow the existing stack if the repository already has established patterns.

## Workflow

### 1. Align Scope First

Before coding, confirm:

- Feature goal and success criteria
- Data model changes (if any)
- Auth/authorization expectations
- Runtime constraints (edge vs node)

If ambiguous, make safe assumptions and state them in the final response.

### 2. Design a Safe Architecture

Prefer this order for backend logic:

1. API server layer with Fastify (preferred) or Express
2. Service/domain layer for business logic
3. Data access layer for database queries and transactions

Use a dedicated API service when:

- The endpoint is consumed by third-party or mobile clients
- You need explicit REST contracts and middleware control
- Webhooks, queues, or long-running jobs are involved

### 3. Implement End-to-End

For any feature, implement complete vertical slices:

- UI: pages/components and loading/error states
- Backend: Express/Fastify API routes + service layer (preferred: REST - CRUD)
- Data: schema + migration + query logic
- Validation: input validation (for example with Zod)
- Authorization: verify access on the server

Do not leave TODO placeholders for core behavior unless explicitly requested.

### 4. Data and API Conventions

- Keep DB access in server-only modules
- Never expose secrets to client components
- Validate all API inputs server-side
- Return typed, predictable payloads and explicit error status codes
- Add optimistic UI only when rollback behavior is clear

### 5. Vercel Readiness

Before finishing, ensure:

- Environment variables are documented and used correctly
- No Node-only API is used in Edge runtime code
- Caching/revalidation strategy is explicit (`revalidatePath`, tags, or route config)
- Build succeeds with production settings

If deployment is requested, include concise Vercel steps:

1. Configure project and env vars
2. Run migrations for production database
3. Deploy and verify critical flows

### 6. Verify Locally

Run relevant checks after changes:

- `npm run lint` (or project equivalent)
- `npm run test` for touched behavior
- `npm run build` for production readiness

If any check cannot run, explain exactly why and what remains unverified.

### 7. Manual Handoff When Automation Is Blocked

If you cannot finish a requested step because tooling or access is unavailable
(missing CLI install, auth/2FA/CAPTCHA, permission limits, org policy), do not
stop at "blocked."

Instead:

1. State exactly what failed and where
2. Give short numbered UI steps for the user
3. Give exact next commands to run after the user completes those steps
4. Continue once the user confirms completion

Common cases:

- GitHub push blocked: guide repo creation/access on GitHub, then provide
  `git remote add origin ...` and `git push -u origin <branch>`
- Vercel deploy blocked: guide project/env setup in Vercel, then provide
  `vercel link` and `vercel --prod` (or dashboard deploy path)

## Execution Style

- Prefer minimal, targeted diffs over broad refactors
- Preserve repository conventions (naming, folder layout, tooling)
- Add or update tests when behavior changes
- Explain assumptions and tradeoffs clearly in the handoff

## Quick Decision Rules

- User says "build a web app": scaffold React app or Next.js app
- User asks for backend: use Fastify or Express API (not Next.js Route Handlers)
- User asks for deploy: optimize for Vercel defaults and environment-based config
- Existing repo conflicts with defaults: follow repo conventions, not this baseline
