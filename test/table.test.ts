import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderTable } from '../src/table.js';

// Force color OFF so bold()/dim() are no-ops and output is deterministic.
let savedForceColor: string | undefined;
let savedNoColor: string | undefined;

beforeEach(() => {
  savedForceColor = process.env.FORCE_COLOR;
  savedNoColor = process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.env.NO_COLOR = '1';
});

afterEach(() => {
  if (savedForceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = savedForceColor;
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

describe('renderTable', () => {
  it('left-aligns columns to the max width', () => {
    const out = renderTable([
      ['a', 'one'],
      ['bbb', 'two'],
    ]);
    expect(out.split('\n')).toEqual(['a    one', 'bbb  two']);
  });

  it('preserves alignment when a cell contains ANSI color codes', () => {
    const colored = '\x1b[32mok\x1b[0m'; // visible width 2
    const out = renderTable([
      [colored, 'yes'],
      ['fail', 'no'],
    ]);
    const lines = out.split('\n');
    // col0 width = max(2, 4) = 4; colored cell gets 2 padding spaces, then a 2-space gap.
    expect(lines[0]).toBe(`${colored}    yes`);
    expect(lines[1]).toBe('fail  no');
  });

  it('renders a bold header and a dim separator matching each column width', () => {
    const out = renderTable([['x', 'y']], { header: ['NAME', 'VAL'] });
    const lines = out.split('\n');
    // widths: col0 = max(4,1) = 4, col1 = max(3,1) = 3
    expect(lines[0]).toBe('NAME  VAL');
    expect(lines[1]).toBe('----  ---');
    expect(lines[2]).toBe('x     y');
  });

  it('leaves no trailing whitespace on any line and does not pad the last column', () => {
    const out = renderTable(
      [
        ['a', 'b'],
        ['ccc', 'd'],
      ],
      { header: ['H1', 'H2'] },
    );
    for (const line of out.split('\n')) {
      expect(line).toBe(line.replace(/\s+$/, ''));
    }
  });

  it('returns an empty string for no rows and no header', () => {
    expect(renderTable([])).toBe('');
  });

  it('respects a custom gap', () => {
    const out = renderTable([['a', 'b']], { gap: 4 });
    expect(out).toBe('a    b');
  });
});
