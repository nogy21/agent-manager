export type Frontmatter = Record<string, string>;

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseFrontmatter(content: string): { data: Frontmatter; body: string } {
  // Strip a leading BOM if present.
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  const lines = text.split('\n');

  // Frontmatter exists iff the very first line is exactly `---` (trailing \r allowed).
  if (stripCr(lines[0] ?? '') !== '---') {
    return { data: {}, body: text };
  }

  const data: Frontmatter = {};
  let closingIndex = -1;

  for (let i = 1; i < lines.length; i++) {
    const line = stripCr(lines[i]);
    if (line === '---') {
      closingIndex = i;
      break;
    }
    if (line.startsWith('#')) {
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    if (key.length === 0) {
      continue;
    }
    data[key] = stripQuotes(line.slice(colon + 1).trim());
  }

  // Unterminated frontmatter: treat the whole content as body.
  if (closingIndex === -1) {
    return { data: {}, body: text };
  }

  // Body = everything after the closing line; keep original line endings (CRLF).
  let bodyLines = lines.slice(closingIndex + 1);
  // Strip ONE leading blank line if present.
  if (bodyLines.length > 0 && stripCr(bodyLines[0]) === '') {
    bodyLines = bodyLines.slice(1);
  }
  return { data, body: bodyLines.join('\n') };
}

export function serializeFrontmatter(data: Frontmatter, body: string): string {
  let out = '---\n';
  for (const [key, value] of Object.entries(data)) {
    out += `${key}: ${value}\n`;
  }
  out += '---\n\n';
  out += body;
  // Ensure exactly one trailing newline.
  return out.replace(/\n+$/, '') + '\n';
}
