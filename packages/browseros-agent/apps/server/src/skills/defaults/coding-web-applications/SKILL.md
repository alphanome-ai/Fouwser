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

## Default Stack

- Framework: Next.js (App Router)/ React + TypeScript
- Styling: Tailwind CSS unless the repo already uses another system
- Backend: Next.js Route Handlers (`app/api/.../route.ts`) and Server Actions
- Database: PostgreSQL with Prisma by default
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

### 2. Design the Smallest Safe Architecture

Prefer this order for backend logic:

1. Server Components for read-heavy UI composition
2. Server Actions for form-like mutations
3. Route Handlers for external or programmatic API access

Use Route Handlers when:

- The endpoint is consumed by third-party clients
- You need explicit REST contracts
- Webhooks are involved

### 3. Implement End-to-End

For any feature, implement complete vertical slices:

- UI: pages/components and loading/error states
- Backend: route handler or server action
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

- User says "build a web app": scaffold Next.js app with App Router and TypeScript
- User asks for backend: use Route Handlers and/or Server Actions
- User asks for deploy: optimize for Vercel defaults and environment-based config
- Existing repo conflicts with defaults: follow repo conventions, not this baseline
