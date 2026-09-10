# Repository Guidelines

## Project Structure & Module Organization

- `web/src/` contains the browser app. Keep pure learning logic in `core/`, IndexedDB access in `storage/`, dictionary loading in `data/`, and DOM rendering in `ui/`.
- `builder/src/` contains dictionary pipeline stages and source adapters; `builder/scripts/` contains standalone maintenance commands. Configuration and curated inputs live under `builder/` and `builder/data/`.
- `shared/` holds alphabet definitions, schemas, and types used by both runtimes.
- `tests/` contains Vitest suites and offline fixtures. Static assets belong in `web/public/`; generated output goes to `web/dist/` and should not be committed.

## Build, Test, and Development Commands

Use Node.js 24 or later and install exact dependencies with `npm ci`.

- `npm run dev` downloads the runtime dictionary and starts Vite on localhost.
- `npm run test:run` runs the complete Vitest suite once; `npm test` watches during development.
- `npm run lint` checks formatting and lint rules with Biome; `npm run lint:fix` applies safe fixes.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm run build` type-checks and creates the static site in `web/dist/`.
- `npm run ci` runs the full local quality gate, including seed generation, Knip, tests, lint, type-checking, and build.

## Coding Style & Naming Conventions

Write ESM TypeScript with space indentation, single quotes, and Biome defaults. Use `camelCase` for values and functions, `PascalCase` for types, and descriptive kebab-case filenames such as `answer-checker.ts`. Keep modules focused and reuse existing shared/core helpers before adding abstractions. Do not use non-null assertions; configured Biome security, style, complexity, and performance rules are mandatory.

## Testing Guidelines

Use TDD for core logic wherever practical: failing test, smallest passing change, refactor. Add focused `*.test.ts` files under `tests/`, using Vitest `describe`, `it`, and `expect`. Cover behavioral and failure paths, especially persistence, schema validation, scoring, and builder boundaries. Tests must remain offline; use `tests/fixtures/` and `fake-indexeddb` instead of live Wiktionary or OpenRouter calls. Run `npm run test:run` before submitting.

## Commit & Pull Request Guidelines

Write short, imperative commit subjects (for example, `Add configurable Armenian training fonts`). Do not use prefixes such as `feat:`, `fix:`, or `ci:`. Pull requests should explain the user-visible change, list verification commands, link relevant issues, and include screenshots for UI changes. Call out dictionary/configuration changes and any generated artifacts reviewers must rebuild.

## Security & Configuration

Keep provider credentials in ignored `.env` files using `.env.example` as the template. Never commit API keys, caches, generated dictionaries, or learner data.
