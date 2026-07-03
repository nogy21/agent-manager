function colorEnabled(): boolean {
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== '' && force !== '0') {
    return true;
  }
  return process.env.NO_COLOR === undefined && process.stdout.isTTY === true;
}

function wrap(open: number, close: number): (s: string) => string {
  return (s: string): string => (colorEnabled() ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}
