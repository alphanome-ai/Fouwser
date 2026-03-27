# Supabase Platform Documentation Skill

Complete Supabase platform documentation packaged as an OpenClaw AgentSkill.

## Contents

- **Authentication** (email, OAuth, magic links, phone, SSO, MFA)
- **Database** (PostgreSQL, RLS, migrations, triggers, functions)
- **Storage** (file uploads, CDN, image transformations)
- **Edge Functions** (serverless, Deno runtime)
- **Realtime** (subscriptions, broadcast, presence)
- **AI & Embeddings** (pgvector, similarity search, RAG)
- **Platform** (organizations, billing, monitoring)
- **Self-Hosting** (Docker, configuration)
- **Framework Integrations** (Next.js, React, SvelteKit, etc.)

## Structure

```
references/
├── guides/
│   ├── getting-started/    # Quickstarts
│   ├── auth/               # Authentication
│   ├── database/           # PostgreSQL
│   ├── storage/            # File storage
│   ├── functions/          # Edge functions
│   ├── realtime/           # Realtime subscriptions
│   ├── ai/                 # AI & embeddings
│   ├── platform/           # Platform management
│   ├── self-hosting/       # Self-hosted Supabase
│   ├── cron/               # Scheduled jobs
│   ├── queues/             # Background jobs
│   ├── integrations/       # Third-party tools
│   └── local-development/  # CLI & local setup
├── troubleshooting/        # Common issues
└── errorCodes/             # Error reference
```

## Installation

Via ClawHub:
```bash
clawhub install lb-supabase-skill
```

Or manually: Download and extract into your OpenClaw workspace `skills/` folder.

## Usage

This skill triggers automatically when you ask questions about Supabase authentication, database, storage, edge functions, realtime, AI features, or platform management.

## Covered Topics

### Authentication
- Email & password auth
- OAuth providers (Google, GitHub, Apple, Discord, etc.)
- Magic links
- Phone auth (SMS, WhatsApp)
- SSO & SAML
- Multi-factor authentication (MFA/2FA)
- Row Level Security (RLS)
- Server-side auth
- Session management

### Database
- PostgreSQL setup
- Schema design
- Relationships and foreign keys
- Functions and triggers
- Extensions (pgvector, postgis, etc.)
- Full-text search
- Migrations
- Connection pooling
- Webhooks

### Storage
- File uploads
- Download and delete files
- Image transformations
- CDN configuration
- Access control with RLS
- Resumable uploads

### Edge Functions
- Serverless Deno functions
- Database access
- Auth integration
- Environment variables
- Secrets management
- Logging and monitoring

### Realtime
- Postgres changes subscriptions
- Broadcast messages
- Presence tracking
- Authorization

### AI & Vector Search
- pgvector extension
- Embeddings and similarity search
- RAG patterns
- OpenAI integration

### Platform
- Organizations and projects
- Billing and usage
- Logs and monitoring
- Performance tuning
- Backups and restore
- Custom domains

### Framework Integrations
- Next.js (App Router, Pages Router)
- React
- SvelteKit
- Nuxt
- Vue
- Angular
- Flutter
- React Native

## Source

Documentation extracted from [supabase/supabase](https://github.com/supabase/supabase) (latest version).

## License

Documentation content: Apache 2.0 (from Supabase project)
