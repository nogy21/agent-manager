// Starter templates for the memory documents `agman docs init` can create.
// Each is plain Markdown, in English, and ends with a trailing newline.

export const claudeGlobalTemplate = `# Global Claude Instructions

<!-- Personal defaults Claude Code applies in every project on this machine. -->

## Preferences

Describe coding style, tone, and tooling preferences here.

## Common commands

List the commands you reach for across projects.
`;

export const claudeProjectTemplate = `# CLAUDE.md

Guidance for Claude Code when working in this repository.

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

export const claudeLocalTemplate = `# CLAUDE.local.md

<!-- Personal, machine-local notes for this project. Add this file to .gitignore; do not commit it. -->

## Local notes

Jot down local setup details, scratch notes, or reminders here.
`;

export const agentsTemplate = `# AGENTS.md

<!-- Cross-tool agent instructions (the AGENTS.md standard), shared by Claude Code and other coding agents. -->

## Project overview

Describe what this project does in a sentence or two.

## Commands

List the build, test, lint, and run commands.

## Conventions

Note coding standards, naming, and patterns to follow.
`;
