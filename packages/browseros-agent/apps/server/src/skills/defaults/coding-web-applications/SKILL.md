---
name: coding-web-applications
description: Build or modify full-stack web applications with a Next.js-first (App Router), Vercel-focused approach. Use when the user asks for web app features, backend integrations, database connections, auth, or production deployment guidance.
metadata:
  display-name: Coding Web Applications
  enabled: "true"
  version: "1.1"
---

# Coding Web Applications

Use this skill when implementing or extending a full-stack web application, specifically relying on Next.js (App Router), React, and Vercel.

## Supporting Skills

For frontend work involving the database, always load and apply `vercel-react-best-practices` as a supporting skill before implementation details are finalized and use the skills.

For backend work involving the database, always load and apply `supabase-postgres-best-practices` as a supporting skill before implementation details are finalized and use the skills.

For tasks related to deploying the application to vercel user `deploy-to-vercel` and `vercel-cli-with-tokens` as supporting skills.

Use appropriate skills specifically for:
- Frontend work and optimization
- Database schema design and migrations
- Query design and performance/indexing decisions
- Supabase auth and Postgres role/permission design
- Row-Level Security (RLS) policy design and review
- Tasks

## Default Stack

- Framework: Next.js (App Router) + TypeScript
- Styling: Tailwind CSS (default to latest stable v4 for new projects); for existing application use the existing styling technology
- External APIs/Webhooks: Next.js Route Handlers (`app/api`)
- Database: PostgreSQL (Supabase) via Supabase JS Client or Prima ORM
- Validation: Zod for end-to-end type safety
- Deploy target: Vercel

Follow the existing stack if the repository already has established patterns.

## Workflow

### 1. Align Scope First

Before coding, confirm:

- Feature goal and success criteria
- Data model changes (if any)
- Auth/authorization expectations
- Client vs. Server Component boundaries

If ambiguous, make safe assumptions and state them in your final response.

### 1. Design a Next.js-Native Architecture

Prefer this order for data flow and logic:

1. **Server Components:** Use for read-only data fetching directly from the database to keep payload sizes small.
2. **Server Actions:** Use for form submissions, database mutations, and revalidating cache paths.
3. **Route Handlers (`app/api/...`):** Use ONLY when the endpoint is consumed by third-party services, mobile clients, or webhooks. 

### 2. Implement End-to-End

For any feature, implement complete vertical slices:

- **UI:** Server/Client components, plus loading (`loading.tsx`) and error (`error.tsx`) states.
- **Backend Logic:** Server Actions with strict input validation using Zod.
- **Data:** Schema updates + Supabase query logic.
- **Authorization:** Verify user session and permissions on the server before executing mutations.

Do not leave TODO placeholders for core behavior unless explicitly requested.

### 3. Data, Types, and Error Handling

- **Type Safety:** Share TypeScript types/Zod schemas between Client Components and Server Actions to ensure predictable payloads.
- **State Management:** Rely on the Next.js cache and Server Components for standard data. Use TanStack Query (React Query) or Zustand only if highly interactive, client-side state is required.
- **Error Handling:** Return a "Result" pattern from Server Actions (e.g., `{ success: false, error: "Validation failed" }`) so the UI can handle expected errors gracefully without crashing.
- **Security:** Keep DB access in server-only modules (`.server.ts` conventions). Never expose secrets to client components.

### 4. Tailwind/PostCSS Compatibility (Prevention First)

When creating or modifying projects that use Tailwind + PostCSS, configure versions and plugins correctly before running the app:

1. Detect installed Tailwind major version from `package.json` (or lockfile if needed).
2. For new projects with no legacy browser constraint, choose latest stable Tailwind v4.
3. If Tailwind is v4:
   - Use `@tailwindcss/postcss` in PostCSS config.
   - For Vite projects, prefer `@tailwindcss/vite`.
   - Do not configure `tailwindcss` directly as a PostCSS plugin.
4. If Tailwind is v3:
   - Use `tailwindcss` + `autoprefixer` in PostCSS config.
   - Do not use `@tailwindcss/postcss` unless the project is explicitly migrated.
5. If project config and dependency versions are mixed/mismatched, normalize them before first dev-server run.
6. If the task explicitly requires older browser support incompatible with v4, keep/pin v3 and apply the v3 plugin pattern consistently.

Hard rule:

- Do not scaffold or commit a Tailwind/PostCSS setup that is known to produce startup/runtime CSS plugin errors.

### 5. Vercel Readiness

Before finishing, ensure:

- Environment variables are documented and used correctly.
- Caching/revalidation strategy is explicit (use `revalidatePath` or `revalidateTag` in Server Actions after mutations).
- No Node-only packages are used in Edge runtime contexts unless explicitly configured.
- Build succeeds with production settings.

If deployment is requested, include concise Vercel steps:

1. Configure project and env vars in the Vercel Dashboard.
2. Run migrations for the production database.
3. Deploy and verify critical flows.

### 6. Verify Locally

Run relevant checks after changes:

- `npm run lint` (or project equivalent)
- `npm run test` for touched behavior
- `npm run build` for production readiness

If any check cannot run, explain exactly why and what remains unverified.

After building or making code changes, ensure a local dev server is running:

- Open the code repository directory in a browser tab using `vscode_web` with `action: "open"` and `folder` set to the project/repo.
- If a dev server is not running, start it immediately.
- If one is already running for the same project, reuse it instead of starting duplicates.
- After ensuring that the dev server is running, open the application URL in a browser tab using `new_page(URL)`.
- Do not finalize the task without an active dev server preview, unless the user explicitly says to skip it.

### 6.1 Dev Server Host and Port Recovery

- Always run dev servers on `127.0.0.1` (not `localhost`, `0.0.0.0`, or `::`).
- Prefer explicit host/port flags when available (for example `--host 127.0.0.1`).

If dev server startup fails due to port-in-use errors (`EADDRINUSE`, "address already in use"):

1. Identify the blocked port from logs/error output.
2. Kill the process listening on that port using OS-appropriate command:
   - macOS/Linux:
     - `lsof -ti:<port> | xargs kill -9`
   - Windows (PowerShell):
     - `$pids = Get-NetTCPConnection -LocalPort <port> -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($pids) { $pids | ForEach-Object { Stop-Process -Id $_ -Force } }`
3. Restart the dev server on `127.0.0.1` and continue.

### 7. Manual Handoff When Automation Is Blocked

If you cannot finish a requested step because tooling or access is unavailable (missing CLI install, auth/2FA/CAPTCHA, permission limits), do not stop at "blocked."

Instead:

1. State exactly what failed and where.
2. Give short numbered UI steps for the user.
3. Give exact next commands to run after the user completes those steps.
4. Continue once the user confirms completion.

## Execution Style

- Prefer minimal, targeted diffs over broad refactors.
- Preserve repository conventions (naming, folder layout, tooling).
- Add or update tests when behavior changes.
- Explain assumptions and tradeoffs clearly in the handoff.

## Quick Decision Rules

- **User asks to fetch data:** Default to React Server Components; pass data to Client Components as props.
- **User asks to update data:** Default to Server Actions with `revalidatePath`.
- **User asks for an API endpoint:** Use Next.js Route Handlers (`app/api`) ONLY if requested by an external service; otherwise, stick to Server Actions.
- **Existing repo conflicts with defaults:** Follow repo conventions, not this baseline.
