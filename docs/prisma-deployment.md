# Prisma deployment

Babylog uses Prisma Compute, Bun, and Postgres in Frankfurt (`eu-central-1`).
The source branch is `master`. The Prisma production branch is `main`.

[module.ts](../module.ts) declares the service and database. [prisma.config.ts](../prisma.config.ts) selects the region and build configuration.
The public origin in `module.ts` must match the deployment's domain.

Keep existing Composer database node names. Renaming or removing a node can replace its database and delete records.

## Configuration

Set production values in the linked Prisma project's variables.
Compute does not load `.env`.

| Variable | Purpose |
| --- | --- |
| `AUTH_USERNAME` | Household username. |
| `AUTH_PASSWORD` | Household password. |
| `OPENROUTER_API_KEY` | Optional server-side Assistant key. |
| `OPENROUTER_MODEL` | Chat model. Default: `deepseek/deepseek-v4.1-flash-1017`. |
| `OPENROUTER_STT_MODEL` | Transcription model. Default: `qwen/qwen3-asr-0.6b`. Blank disables recording. |

Configuration changes need a deployment. Unchanged login credentials preserve device sessions; changed credentials revoke them.
Obtain approval before changing credentials, access, domains, certificates, or network settings.

## Release

Install Node.js 24 and Bun. Export `TEST_DATABASE_URL` for an isolated test database.

```sh
npm ci
npm test
npm run test:browser
npm run build:compute
```

Link the intended project with `npx prisma project link <project-id>`.
Run `npx prisma project show` and check the project before deployment.

```sh
npx prisma deploy --environment production --report data/deploy-report.json
```

Use a different report filename for each release.
Keep reports, credentials, household data, audio, and generated state outside Git.

Preserve `.public-assets` between builds. Restore it from the CI cache before a clean build.
See [asset retention](architecture.md#release-assets) for the archive rules.

## Verify

Check HTTPS and `/api/health`.
Export `AUTH_USERNAME` and `AUTH_PASSWORD`, then run:

```sh
npm run test:cloud -- --origin https://your-domain.example
```

This check compares authenticated diary reads, checks anonymous rejection, and closes its temporary sessions.
It does not change diary records.

Open the app on a phone and check that the page and assets load.
Run write tests only against isolated schemas with synthetic records.
