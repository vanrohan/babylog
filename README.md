# Babylog

A shared baby care diary for phones, tablets, and desktop browsers.

- Record feeds, sleep, nappy changes, baths, notes, and custom activities.
- Track active feeds and sleep, breast sides, daily tasks, and care patterns.
- Share one diary and household login across devices.
- Review Assistant proposals before applying changes. Typing and recording use OpenRouter.

The frontend uses React, TypeScript, and Vite. The server uses Bun, Express, and Postgres.
Household dates use Europe/Berlin.

The [hosted instance](https://babylog.vanderwalt.de) requires a household login.

## Run locally

Install Node.js 24, Bun, and Postgres.

```sh
npm ci
cp .env.example .env
```

Set `DEV_DATABASE_URL`, `AUTH_USERNAME`, and `AUTH_PASSWORD` in `.env`.
Use a development database with synthetic records.

Start the API:

```sh
npm run dev
```

Start Vite in another terminal:

```sh
npm run dev:ui
```

The API listens on `http://127.0.0.1:3005`. Vite proxies API requests to that address.
The development command loads `.env`. Tests and production do not.

## Assistant

Set `OPENROUTER_API_KEY` to enable Assistant. The key stays on the server.
`OPENROUTER_MODEL` selects the chat model. `OPENROUTER_STT_MODEL` selects transcription; a blank value disables recording.
See [.env.example](.env.example) for defaults.

Without the key, manual entry still works and Assistant stays hidden.
OpenRouter receives instructions, relevant diary records, and recordings submitted for transcription.
Assistant changes require confirmation.

## Tests

Export `TEST_DATABASE_URL` for a separate Postgres database that permits schema creation.
Tests create and remove isolated schemas. They never fall back to `DATABASE_URL`.

```sh
npm test
npm run test:browser
python3 scripts/test-stt-benchmark.py
npm run build:compute
```

Browser tests cover Chrome and WebKit. They do not replace physical device checks.

## Documentation

- [Product scope](PRODUCT.md)
- [Interface behavior](docs/design.md)
- [Architecture](docs/architecture.md)
- [Prisma deployment](docs/prisma-deployment.md)
