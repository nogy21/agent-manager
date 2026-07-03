# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

`agman` is a TypeScript ESM CLI for managing Claude Code skills and memory
documents (CLAUDE.md, CLAUDE.local.md, AGENTS.md) across the global (`~/.claude`)
and per-project scopes.

## Commands

- `npm test` — run the vitest suite once (`vitest run`).
- `npm run typecheck` — type-check with `tsc --noEmit` (no emit).
- `npm run build` — compile `src/` to `dist/` with `tsc`.
- Run the built CLI: `node dist/index.js <command>` (e.g. `node dist/index.js status`,
  `node dist/index.js skills list`, `node dist/index.js docs diff`). Use `-C <dir>` to run
  as if started in another directory.

## Architecture

- **Context injection.** Core functions are pure over a `Context` ({ globalRoot,
  projectRoot, cwd }) built in `src/context.ts` from `src/paths.ts`. They take `ctx`
  explicitly and never touch `process.cwd()` directly, which keeps them testable with
  temp-dir fixtures. Command layers resolve the context lazily through a `getCtx()`
  callback wired in `src/index.ts`.
- **core / commands split.** Each feature has a `core.ts` (filesystem + domain logic,
  no commander) and a `commands.ts` (commander wiring, output formatting): `src/skills/`
  and `src/docs/`. `src/status.ts` composes both cores into an overview.
- **Shared utilities.** `src/frontmatter.ts` (SKILL.md YAML-ish frontmatter),
  `src/table.ts` (aligned columns), `src/colors.ts` (ANSI helpers), `src/run.ts`
  (`runAction` error boundary), `src/editor.ts` (`$EDITOR` launch), `src/errors.ts`
  (`CliError`).

## Conventions

- **ESM NodeNext.** Relative imports must carry the `.js` extension (e.g.
  `import { x } from './foo.js'`) even though the sources are `.ts`.
- **Strict TypeScript.** `strict` is on; keep it clean (`npm run typecheck` must pass).
- **Dependencies.** The only runtime dependency is `commander` — do not add more.
- **Errors.** User-facing failures throw `CliError`; command actions are wrapped in
  `runAction`, which prints `error: <message>` and sets the exit code. Never call
  `process.exit` inside an action for expected failures.
- **Tests.** vitest suites build fixtures with `fs.mkdtempSync` + `fs.realpathSync`
  and a literal `Context`, cleaning up in `afterEach`.

## Gotchas

- **Table alignment** must measure with `visibleWidth` from `src/colors.ts` — it is
  ANSI-aware, so padding stays correct once cells are colored. Never pad on `.length`
  of a colored string.
- **Symlink handling** uses `lstat` before `stat`: `lstat` detects the link itself,
  then a following `stat`/`readFile` resolves it (a dangling link leaves `exists`
  false while `isSymlink` stays true).
- **`CLAUDE_CONFIG_DIR`** overrides the global root (`~/.claude`); a relative value is
  resolved to an absolute path against the process cwd.
- **AGENTS.md is a synced copy of CLAUDE.md** in this repo (a real file, not a
  symlink). After editing CLAUDE.md, regenerate it with
  `node dist/index.js docs sync --source claude` and confirm with
  `node dist/index.js docs diff`.
