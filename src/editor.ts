import { spawnSync } from 'node:child_process';
import { CliError } from './errors.js';

export function openInEditor(file: string): void {
  const cmd = process.env.VISUAL || process.env.EDITOR || 'vi';
  const parts = cmd.split(/\s+/).filter((p) => p.length > 0);
  const bin = parts[0];
  const args = parts.slice(1);

  const result = spawnSync(bin, [...args, file], { stdio: 'inherit' });

  if (result.error || result.status === null) {
    throw new CliError(`failed to launch editor "${cmd}"; set $EDITOR`);
  }
  // A nonzero exit status just means the user quit without saving; ignore it.
}
