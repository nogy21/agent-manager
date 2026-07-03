import { bold, dim, visibleWidth } from './colors.js';

export interface TableOptions {
  header?: string[];
  gap?: number;
}

export function renderTable(rows: string[][], opts: TableOptions = {}): string {
  const gap = opts.gap ?? 2;
  const header = opts.header;

  if (rows.length === 0 && !header) {
    return '';
  }

  const allRows: string[][] = [];
  if (header) allRows.push(header);
  for (const r of rows) allRows.push(r);

  const colCount = allRows.reduce((max, r) => Math.max(max, r.length), 0);

  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let w = 0;
    for (const r of allRows) {
      w = Math.max(w, visibleWidth(r[c] ?? ''));
    }
    widths[c] = w;
  }

  const separator = ' '.repeat(gap);

  const pad = (cell: string, width: number): string => {
    const diff = width - visibleWidth(cell);
    return diff > 0 ? cell + ' '.repeat(diff) : cell;
  };

  const renderRow = (cells: string[]): string => {
    const parts: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const cell = cells[c] ?? '';
      const isLast = c === colCount - 1;
      parts.push(isLast ? cell : pad(cell, widths[c]));
    }
    return parts.join(separator);
  };

  const lines: string[] = [];

  if (header) {
    lines.push(renderRow(header.map((h) => bold(h))));
    const sepCells = widths.map((w) => dim('-'.repeat(w)));
    lines.push(sepCells.join(separator));
  }

  for (const r of rows) {
    lines.push(renderRow(r));
  }

  return lines.join('\n');
}
