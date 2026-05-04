#!/usr/bin/env node
/**
 * Placeholder for one-off Firestore migrations removed with the legacy planner (see git f6dd703).
 * Recover `scripts/migrate-*.ts` and their imports from commit 481db97 if you still need them.
 */
const name = process.argv[2] || "migrate";
console.error(
  [
    `${name}: this repo no longer ships the legacy migration scripts or their dependencies.`,
    "To restore them, check out files from git commit 481db97 (e.g. scripts/migrate-diagram-to-firestore.ts,",
    "scripts/migrate-step-types-firestore.ts, and related lib/ imports), then add firebase-admin, uuid, and tsx.",
  ].join("\n")
);
process.exit(1);
