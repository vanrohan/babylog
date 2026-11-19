# Babylog

## Project

Use the existing Prisma Compute, Bun, and Postgres resources.
Use `master` in Git. The Prisma production branch is `main`.
Do not add another hosting path or database backend.

Read PRODUCT.md, docs/design.md, and docs/architecture.md before changing behavior.
Use README.md for development and docs/prisma-deployment.md for releases.

## Safety

Obtain approval before changing credentials, permissions, access, DNS, certificates, firewall rules, or network access.
Keep Composer database node names during releases.
Keep credentials, household records, audio, reports, and generated state outside Git.
Use synthetic records in isolated test schemas. Never test against the production database.
Require DEV_DATABASE_URL for development and TEST_DATABASE_URL for tests. Neither falls back to DATABASE_URL.
Do not give Assistant filesystem, shell, or direct database write tools.
Request device permissions only after a user action.

## Changes

Read relevant files before editing. Prefer the simplest working change.
Keep manual entry available when external services fail.
Validate Assistant proposals and confirmations on the server. Apply confirmed changes in one transaction.
Preserve exact timestamps, stale checks, drafts, and Undo.
Keep .public-assets between builds for pages that use older bundles.
Update documentation when behavior or operating steps change.
Run the required tests after edits and review fixes. Do not declare completion with failing tests.

## Reviews

Request an independent plan review before implementation. Resolve material user and UX findings first.
Request an independent code review after implementation. Check bugs, regressions, and plan adherence.
Keep reviewers independent from implementation. Apply material findings before completion.

## Test Case Review

Request an independent test review when adding tests.
Cover likely user actions, including rename, stale updates, failures, and feature interactions where relevant.
Add missing cases before completion. Record substantive findings in the relevant documentation's Test Case Review section.

## Interface

Use Impeccable and request an independent iOS design review before interface changes.
Review the rendered phone interface before release.
Use compact rows, one label per control, and one value per summary.
Put routine help behind an info control.
Use shared SVG icons, specific accessible names, and targets of at least 44px.
Show permission, error, destructive confirmation, Offline, and No record states clearly.
Do not use color alone for state. Show secondary details on request.
Use date choices, a calendar, and hour/minute wheels. Do not add typed time fallbacks.

## Writing

Use ASD-STE100 Simplified Technical English in responses, comments, and documentation.
Use ASCII, active voice, and simple tenses. Keep sentences at 20 words or fewer.
Keep comments that explain a non-obvious reason. Remove comments that repeat the code.
Put release receipts and one-time decisions in commit or PR descriptions, not standing instructions.
State uncertainty instead of guessing.
