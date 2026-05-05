# Dev Notes

## Current State

- `Stacks Manager` UI was redesigned to keep one stack per row, show occupied schedule slots inline, and move free/occupied slot guidance into the schedule modal.
- FD telemetry during backups now tracks per-PID file descriptor peaks and stores them in history as `resourceUsage.fdByPid`.

## Recent Commits

- `42760ab` `feat: redesign stack schedule UI`
- `d2a3396` `feat: track fd telemetry during backups`

## Important Files

- `app/dashboard-client.tsx`
  Stack list layout, schedule modal, history rendering for `fdByPid`
- `lib/stack-schedule.ts`
  30-minute slot helpers for stack schedules
- `lib/fd-telemetry.ts`
  FD snapshot parsing and peak aggregation helpers
- `app/actions.ts`
  Resource tracking, backup execution, FD snapshot collection
- `lib/storage.ts`
  History/resource telemetry types

## Known Caveats

- `npm run lint` is not currently usable in this repo.
  `next lint` no longer works as configured with the current Next version, and direct `eslint` also needs a proper `eslint.config.js`.
- GitHub Actions in `.github/workflows/deploy.yml` only builds and pushes the image to GHCR.
  Production does not update automatically unless something outside this repo pulls and redeploys.
- Node test runs currently emit `MODULE_TYPELESS_PACKAGE_JSON` warnings for `.ts` test files.
  They still pass, but the warning will stay until test/module config is cleaned up.

## Good Next Steps

1. Add a working lint setup for Next 16 / ESLint 9.
2. Consider extracting the remaining resource-tracking logic from `app/actions.ts` into smaller helpers.
3. If FD telemetry becomes noisy, cap or filter `fdByPid` output further before writing history.
4. If production rollout should be automatic, add an explicit deploy job instead of relying on image build alone.
