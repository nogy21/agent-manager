// Starter templates for the memory documents `agman docs init` can create.
// Each is plain Markdown, in English, and ends with a trailing newline.
//
// In the hub-and-spoke model the project AGENTS.md is the single source of
// truth (the hub); per-agent files (CLAUDE.md, GEMINI.md) are spokes that
// agman keeps synced from it.

// The HUB. This is the primary document — the full template lives here.
export const agentsTemplate = `# AGENTS.md

Single source of truth for AI coding agents in this repository. Every tool
reads this file (Claude Code, Codex, Cursor, Copilot, Gemini CLI, Windsurf);
agman syncs the per-agent spokes (CLAUDE.md, GEMINI.md) from it.

## Project overview

Describe what this project does in a sentence or two.

## Commands

List the build, test, lint, and run commands.

## Architecture

Outline the main modules and how they fit together.

## Conventions

Note coding standards, naming, and patterns to follow.

## Gotchas

Call out non-obvious pitfalls and things to avoid.
`;

// SPOKE for Claude Code. Kept in sync with AGENTS.md by agman.
export const claudeProjectTemplate = `# CLAUDE.md

Synced from AGENTS.md by agman — edit AGENTS.md instead.

## Project overview

Describe what this project does in a sentence or two.

## Commands

List the build, test, lint, and run commands.

## Architecture

Outline the main modules and how they fit together.

## Conventions

Note coding standards, naming, and patterns to follow.

## Gotchas

Call out non-obvious pitfalls and things to avoid.
`;

// SPOKE for Gemini CLI. Kept in sync with AGENTS.md by agman (Gemini CLI does
// not read symlinked GEMINI.md, so this is always a real, copied file).
export const geminiTemplate = `# GEMINI.md

Synced from AGENTS.md by agman — edit AGENTS.md instead.

## Project overview

Describe what this project does in a sentence or two.

## Commands

List the build, test, lint, and run commands.

## Architecture

Outline the main modules and how they fit together.

## Conventions

Note coding standards, naming, and patterns to follow.

## Gotchas

Call out non-obvious pitfalls and things to avoid.
`;

// AUX: optional GitHub Copilot instructions. Copilot also reads AGENTS.md
// natively, so this file is an extra, not a required spoke.
export const copilotTemplate = `# GitHub Copilot instructions

Optional Copilot-specific guidance. Copilot also reads AGENTS.md natively, so
keep shared context there and use this file only for Copilot-only notes.

## Guidance

Add instructions Copilot should follow in this repository.
`;

// AUX: personal, machine-local project notes (git-ignored).
export const claudeLocalTemplate = `# CLAUDE.local.md

<!-- Personal, machine-local notes for this project. Add this file to .gitignore; do not commit it. -->

## Local notes

Jot down local setup details, scratch notes, or reminders here.
`;

// AUX: global Claude Code defaults (~/.claude/CLAUDE.md or $CLAUDE_CONFIG_DIR).
export const claudeGlobalTemplate = `# Global Claude Instructions

<!-- Personal defaults Claude Code applies in every project on this machine. -->

## Preferences

Describe coding style, tone, and tooling preferences here.

## Common commands

List the commands you reach for across projects.
`;

// AUX: global Codex defaults (~/.codex/AGENTS.md).
export const codexGlobalTemplate = `# Global Codex instructions

<!-- Personal defaults OpenAI Codex applies across every project on this machine. -->

## Preferences

Describe coding style, tone, and tooling preferences here.

## Common commands

List the commands you reach for across projects.
`;

// AUX: global Gemini CLI defaults (~/.gemini/GEMINI.md).
export const geminiGlobalTemplate = `# Global Gemini instructions

<!-- Personal defaults Gemini CLI applies across every project on this machine. -->

## Preferences

Describe coding style, tone, and tooling preferences here.

## Common commands

List the commands you reach for across projects.
`;

// AUX: global Windsurf rules (~/.codeium/windsurf/memories/global_rules.md).
export const windsurfGlobalTemplate = `# Windsurf global rules

<!-- Global rules Windsurf applies in every workspace. Keep this under ~6k characters. -->

## Preferences

Describe coding style, tone, and tooling preferences here.

## Common commands

List the commands you reach for across projects.
`;
