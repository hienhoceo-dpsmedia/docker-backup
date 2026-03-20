# Stacks Manager Schedule UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Stacks Manager list compact, show each stack's occupied 30-minute schedule slot directly on its row, and move free-slot guidance into the schedule modal.

**Architecture:** Extract schedule-slot calculations into a focused helper module so UI state and rendering stay simple inside `app/dashboard-client.tsx`. Rebuild the stack list and schedule modal around those helper outputs while preserving the current server actions and storage schema.

**Tech Stack:** Next.js App Router, React client component, TypeScript, Tailwind CSS, Node built-in test runner

---

## Chunk 1: Schedule Slot Logic

### Task 1: Add failing tests for slot mapping and occupancy

**Files:**
- Create: `lib/stack-schedule.test.ts`
- Create: `lib/stack-schedule.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { getScheduleSlotSummary, getScheduleOccupancy, HALF_HOUR_SLOTS } from './stack-schedule';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/stack-schedule.test.ts`
Expected: FAIL because `./stack-schedule` does not exist yet

- [ ] **Step 3: Write minimal implementation**

Create helpers for:

- slot generation
- legacy time to slot mapping
- slot label formatting
- schedule summary for list rows
- occupancy map for the modal

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/stack-schedule.test.ts`
Expected: PASS

## Chunk 2: Stack List UI

### Task 2: Rebuild the stack row layout around occupied slots

**Files:**
- Modify: `app/dashboard-client.tsx`
- Use: `lib/stack-schedule.ts`

- [ ] **Step 1: Add the next failing test if new logic is needed**

If list rendering needs another helper, add a logic-level test first in `lib/stack-schedule.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/stack-schedule.test.ts`

- [ ] **Step 3: Write minimal implementation**

Update the stacks tab to:

- sort or render stacks in a compact row layout
- show `Manual` or occupied slot chips inline
- show conflict state directly on slot chips
- remove hover-only schedule disclosure

- [ ] **Step 4: Run tests to verify helper logic still passes**

Run: `node --test lib/stack-schedule.test.ts`
Expected: PASS

## Chunk 3: Schedule Modal UI

### Task 3: Replace the time input with a 30-minute slot picker

**Files:**
- Modify: `app/dashboard-client.tsx`
- Use: `lib/stack-schedule.ts`

- [ ] **Step 1: Add the next failing test if modal logic needs it**

Cover modal occupancy context differences for `daily` vs `weekly`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/stack-schedule.test.ts`

- [ ] **Step 3: Write minimal implementation**

Update the modal to:

- keep `manual` / `daily` / `weekly`
- show a 48-slot grid for scheduled modes
- surface available vs occupied states in-place
- show which other stacks are using an occupied slot
- save slot start times (`HH:00` or `HH:30`)

- [ ] **Step 4: Run tests to verify helper logic still passes**

Run: `node --test lib/stack-schedule.test.ts`
Expected: PASS

## Chunk 4: Verification

### Task 4: Run focused and app-level verification

**Files:**
- Verify: `lib/stack-schedule.test.ts`
- Verify: `app/dashboard-client.tsx`

- [ ] **Step 1: Run slot logic tests**

Run: `node --test lib/stack-schedule.test.ts`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: PASS
