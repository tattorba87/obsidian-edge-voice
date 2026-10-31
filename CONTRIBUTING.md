# Contributing to Edge Voice

These rules apply to everyone working in this repository, people and coding agents alike.

## Setup

```bash
npm install          # also installs the git hooks (lefthook)
npm run dev          # rebuild main.js on every change
```

Link the folder into a test vault (`ln -s "$PWD" <vault>/.obsidian/plugins/edge-voice`), enable **Edge Voice**, and use its one-click setup for the speech engine. The Python checks need [uv](https://docs.astral.sh/uv/).

## Checks

| Command                | What it does                                                                     |
| ---------------------- | -------------------------------------------------------------------------------- |
| `npm run check`        | Everything below; CI runs the same                                               |
| `npm run typecheck`    | TypeScript, including tests                                                      |
| `npm run lint`         | ESLint with Obsidian's community-review rules (`eslint-plugin-obsidianmd`)       |
| `npm run format`       | Prettier for TypeScript, CSS, JSON and Markdown; ruff for Python                 |
| `npm run format:check` | The same, checking only                                                          |
| `npm test`             | Vitest: text processing, PDF reading (generated PDFs), sidecar protocol, storage |
| `npm run test:python`  | pytest: `server.py` against a stub engine                                        |
| `npm run build`        | Type-check and bundle `main.js`                                                  |

The pre-commit hook formats and lint-fixes staged files and type-checks; the pre-push hook runs both test suites. Don't skip them (`--no-verify`) except to commit work in progress on a branch of your own.

## Rules

**Code**

- Formatting is whatever Prettier and ruff produce. Tabs in TypeScript and CSS, 120 columns.
- Lint errors fail CI. Warnings are allowed only where `eslint.config.mjs` explains why.
- No `any`: type what crosses a boundary (`JSON.parse`, `loadData`, pdf.js, the sidecar protocol).
- Comments say why, not what. Match the density of the code around them.
- UI text is in sentence case, plain English, and names no internals the reader doesn't need.
- Use `window.setTimeout` and similar so pop-out windows work; register listeners and events through the plugin (`registerDomEvent`, `registerEvent`) so they're removed on unload.

**Behaviour**

- Nothing leaves the computer except the documented downloads: uv (pinned, checksummed), Python and the engine package during setup, and voice files on first use. Don't add network calls or telemetry.
- `server.py` ships inside `main.js` (Obsidian installs only `main.js`, `manifest.json` and `styles.css`). Keep it to the standard library plus the engine package, and keep its JSON-lines protocol backward compatible within a minor version. Document new requests in its docstring.
- Text normalization rules (`src/normalize.ts`) must be checked against the engine's pronunciation before they're added. Add a test with the written form and the spoken form.
- The engine is replaceable: keep engine specifics in `server.py` and `src/setup.ts`, out of the reader, sources and UI.

**Tests**

- New behaviour comes with a test. Fixes come with a test that failed before the fix.
- Tests don't use copyrighted documents. Build what you need, as `tests/pdf.test.ts` builds its PDFs with pdf-lib.

## Commits and branches

- `main` is always releasable. Work on a branch and open a pull request; CI must pass before merging.
- Commit messages: a short imperative summary line ("Skip footnotes in PDFs"), then a blank line and the why, when it isn't obvious.
- User-facing changes get a line in `CHANGELOG.md` under _Unreleased_.

## Releases

1. Move the _Unreleased_ entries in `CHANGELOG.md` under the new version.
2. `npm version 0.2.0` (updates `package.json`, `manifest.json` and `versions.json`, commits and tags `0.2.0`).
3. `git push --follow-tags`. The release workflow builds and attaches `main.js`, `manifest.json` and `styles.css` to a draft GitHub release; check it and publish it.
