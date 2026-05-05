# Dev Notes

## Current State

- `Stacks Manager` UI keeps one stack per row, shows occupied schedule slots inline, and uses the schedule modal for free/occupied slot guidance.
- Backup resource telemetry now includes filtered per-PID FD peaks in `resourceUsage.fdByPid`.
- Lint now runs with flat-config ESLint 9 on Next 16 via `npm run lint`.
- Production delivery is split into image build on push and a separate manual production deploy workflow.
- **NEW**: Automated backups are now hardened with `safeRevalidatePath`, improved DB dump diagnostics (stderr capture), and extended timeouts.

## Recent Commits

- `fix: improve backup stability, logging, and error reporting` (Current)
- `42760ab` `feat: redesign stack schedule UI`
- `d2a3396` `feat: track fd telemetry during backups`

## Important Files

- `app/dashboard-client.tsx`
  Stack list layout, schedule modal, history rendering for `fdByPid`
- `app/actions.ts`
  Backup orchestration, resource tracking, and stability wrappers
- `lib/stack-schedule.ts`
  30-minute slot helpers for stack schedules
- `lib/fd-telemetry.ts`
  FD snapshot parsing, aggregation, and filtering helpers
- `lib/resource-tracking.ts`
  CPU, memory, disk, and final summary helpers for backup telemetry
- `eslint.config.mjs`
  Flat ESLint config for Next 16 / ESLint 9
- `.github/workflows/deploy.yml`
  Build-and-push image workflow
- `.github/workflows/deploy-production.yml`
  Manual production deploy workflow

## Known Caveats

- Node test runs still emit `MODULE_TYPELESS_PACKAGE_JSON` warnings for `.ts` test files.
  Tests still pass, but module/test config is not cleaned up yet.
- Manual production deploy assumes the target VPS already has Docker, Compose, and repository files in `PRODUCTION_APP_PATH`.
- If GHCR package access is private, GitHub Environment `production` also needs `GHCR_USERNAME` and `GHCR_TOKEN`.
- Production deploy workflow pulls `latest`. If pinning by sha is needed later, introduce a deploy-time image override instead of editing the compose file manually.

## Good Next Steps

1. If tests keep growing, add a dedicated test runner config instead of relying on raw `node --test`.
2. Consider surfacing filtered FD telemetry more intentionally in the UI if operators start using it for diagnostics.
3. If production deploy needs rollback, add a workflow input for image tag or sha.
4. Monitor the new `logStep` output in production to identify any remaining backup bottlenecks.
