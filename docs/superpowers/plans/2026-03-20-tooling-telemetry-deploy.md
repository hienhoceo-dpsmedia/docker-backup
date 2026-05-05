# Tooling, Telemetry, and Deploy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working lint setup, reduce telemetry noise, extract resource-tracking helpers, and add a manual production deploy workflow.

**Architecture:** Migrate lint to ESLint flat config, move telemetry/resource helpers into focused library files, filter persisted FD telemetry before history writes, and separate production deploy from image build using a dedicated manual workflow. Version is bumped to `1.7.0` in the same change set.

**Tech Stack:** Next.js 16, ESLint 9 flat config, TypeScript, Node test runner, GitHub Actions

---

## Chunk 1: Tooling

### Task 1: Add failing lint verification and migrate to ESLint flat config

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `eslint.config.mjs`

- [ ] **Step 1: Write the failing config expectation**

Run: `npm run lint`
Expected: FAIL because current script uses `next lint`

- [ ] **Step 2: Implement minimal lint config**

Create flat config using Next + TypeScript support and switch the lint script to `eslint .`.

- [ ] **Step 3: Run lint to verify it passes**

Run: `npm run lint`
Expected: PASS

## Chunk 2: Resource Tracking Helpers

### Task 2: Extract the remaining resource helper logic with TDD

**Files:**
- Create: `lib/resource-tracking.ts`
- Create: `lib/resource-tracking.test.ts`
- Modify: `app/actions.ts`

- [ ] **Step 1: Write the failing tests**

Cover disk pressure and telemetry filtering/finalization behavior.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/resource-tracking.test.ts`

- [ ] **Step 3: Implement minimal helpers and wire them in**

Move pure helper logic out of `app/actions.ts`, keeping docker/system calls only where needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/resource-tracking.test.ts lib/fd-telemetry.test.ts lib/stack-schedule.test.ts`
Expected: PASS

## Chunk 3: FD Noise Reduction

### Task 3: Filter persisted `fdByPid` data before writing history

**Files:**
- Modify: `lib/fd-telemetry.ts`
- Modify: `lib/fd-telemetry.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test**

Add a test for top-N or threshold filtering behavior.

- [ ] **Step 2: Run tests to verify it fails**

Run: `node --test lib/fd-telemetry.test.ts`

- [ ] **Step 3: Implement minimal filtering**

Support env-tunable filtering and keep persisted output concise.

- [ ] **Step 4: Run tests to verify it passes**

Run: `node --test lib/fd-telemetry.test.ts`
Expected: PASS

## Chunk 4: Deploy Workflow

### Task 4: Add a manual production deploy workflow

**Files:**
- Create: `.github/workflows/deploy-production.yml`
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Add workflow and docs**

Create a workflow that deploys only on `workflow_dispatch`, using SSH-based deployment and explicit environment secrets.

- [ ] **Step 2: Verify workflow syntax**

Run: `npm run build`
Expected: PASS for app; workflow should be reviewed manually in diff

## Chunk 5: Versioning and Docs

### Task 5: Bump version and update dev notes

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/DEV_NOTES.md`

- [ ] **Step 1: Bump version to minor**

Update package version from `1.6.0` to `1.7.0`.

- [ ] **Step 2: Refresh notes**

Document new lint setup, helper locations, telemetry filtering, and manual deploy flow.

- [ ] **Step 3: Run full verification**

Run:
- `npm run lint`
- `node --test lib/stack-schedule.test.ts lib/fd-telemetry.test.ts lib/resource-tracking.test.ts`
- `npm run build`

Expected: PASS
