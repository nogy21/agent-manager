import { red } from './colors.js';
import { CliError } from './errors.js';

export function runAction<A extends unknown[]>(
  fn: (...args: A) => void | Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A): Promise<void> => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof CliError) {
        console.error(red(`error: ${err.message}`));
        process.exitCode = err.exitCode;
        return;
      }
      throw err;
    }
  };
}
