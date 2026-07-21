# Jubilee Workspace Production Deployment Guide

This document describes the deployment topology and configuration instructions for the full-stack (Express + Vite) Jubilee Workspace platform.

---

## 1. Deployment Topology

The application is structured as a **full-stack Node.js Express server (`server.ts`)** that acts as:
1. **API Server / Secure Backend Proxy**: Exposes custom endpoints (such as `/api/harvest` and `/api/ideas/:ideaId/versions/:versionId/abandon`) to run server-side validations and securely call Supabase RPC functions using the high-privilege `SUPABASE_SERVICE_ROLE_KEY`.
2. **Vite Development Middleware**: Serves hot-reloaded assets in development mode.
3. **Static File Server**: In production mode (`NODE_ENV=production`), it serves the compiled frontend single-page app (SPA) from the `dist/` directory and fallbacks all unmatched routes to `dist/index.html`.

### Key Security Rule
> ⚠️ **CRITICAL WARNING**: `SUPABASE_SERVICE_ROLE_KEY` bypasses all database Row Level Security (RLS) policies. It is **highly sensitive and MUST remain server-side only**. Never prefix it with `VITE_` or expose it to client-side code.

---

## 2. Configuration & Environment Variables

Make sure the following variables are configured in your deployment platform's environment settings (e.g. Cloud Run, Vercel, Heroku, or Render):

| Environment Variable | Access Level | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Public / Client | The API URL of your Supabase instance. |
| `VITE_SUPABASE_ANON_KEY` | Public / Client | Client-facing anonymous auth key for Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY`| **Strictly Secret / Server-Only** | Service key to authorize atomic database transactions and command executions on the ledger. |
| `GEMINI_API_KEY` | **Strictly Secret / Server-Only** | Key for the Google GenAI SDK used to draft proposals, mutations, and synthesis in the background. |
| `NODE_ENV` | Server | Set to `production` for optimized static serving and strict secret validation. |

---

## 3. Production Build & Start Commands

Your production environment must build and start the application using the scripts defined in `package.json`:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Build Phase**:
   ```bash
   npm run build
   ```
   *This command runs `vite build` (compiling the frontend SPA into `dist/`) and compiles the custom Node backend `server.ts` into CJS format (`dist/server.cjs`) using esbuild.*

3. **Start Phase**:
   ```bash
   npm run start
   ```
   *Launches the compiled Express server via `node dist/server.cjs`. The server binds to port `3000` and host `0.0.0.0` as required for container ingress routing.*

---

## 4. Supabase Database Schema Setup

Before running the application in production, you must execute the database migration scripts located in `/supabase/migrations/` sequentially on your Supabase Postgres database.

You can execute them using the Supabase CLI:
```bash
supabase db push
```
Or copy/paste their SQL contents in order into the Supabase SQL Editor:
1. `20260720220821_001_jubilee_workspace_core.sql`
2. `20260720222431_002_jubilee_kernel_transplant.sql`
3. `20260720223008_003_rls_security_hardening.sql`
4. `20260720223038_004_rls_owner_scoping.sql`
5. `20260720223056_005_owner_id_defaults.sql`
6. `20260720223525_006_ideas_rationale_witness_immutability.sql`
7. `20260720223540_007_owner_id_nullable.sql`
8. `20260720224500_008_production_boundary_enforcement.sql`
9. `20260720225000_009_atomic_harvest_function.sql`
10. `20260720230000_010_ledger_hardening.sql`
11. `20260720231000_011_atomic_abandon_function.sql`
