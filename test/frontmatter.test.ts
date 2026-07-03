import { describe, expect, it } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from '../src/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses name and description', () => {
    const { data, body } = parseFrontmatter(
      '---\nname: my-skill\ndescription: does things\n---\n\nBody here\n',
    );
    expect(data).toEqual({ name: 'my-skill', description: 'does things' });
    expect(body).toBe('Body here\n');
  });

  it('strips surrounding single and double quotes', () => {
    const { data } = parseFrontmatter(`---\nname: "quoted"\ndescription: 'single'\n---\n`);
    expect(data).toEqual({ name: 'quoted', description: 'single' });
  });

  it('keeps a colon that appears inside the value', () => {
    const { data } = parseFrontmatter('---\ndescription: use this: often\n---\n');
    expect(data.description).toBe('use this: often');
  });

  it('returns the whole content as body when there is no frontmatter', () => {
    const content = '# Title\n\nSome text\n';
    const { data, body } = parseFrontmatter(content);
    expect(data).toEqual({});
    expect(body).toBe(content);
  });

  it('treats unterminated frontmatter as body', () => {
    const content = '---\nname: x\nnever closes\n';
    const { data, body } = parseFrontmatter(content);
    expect(data).toEqual({});
    expect(body).toBe(content);
  });

  it('handles CRLF input and preserves CRLF in the body', () => {
    const { data, body } = parseFrontmatter('---\r\nname: win\r\n---\r\n\r\nBody line\r\n');
    expect(data).toEqual({ name: 'win' });
    expect(body).toBe('Body line\r\n');
  });

  it('ignores comment lines and lines without a colon', () => {
    const { data } = parseFrontmatter('---\n# a comment\nno-colon-here\nname: ok\n---\n');
    expect(data).toEqual({ name: 'ok' });
  });

  it('strips a leading BOM', () => {
    const { data } = parseFrontmatter('﻿---\nname: bom\n---\n');
    expect(data).toEqual({ name: 'bom' });
  });
});

describe('serializeFrontmatter', () => {
  it('roundtrips through parseFrontmatter', () => {
    const data = { name: 'x', description: 'y' };
    const body = 'Body text\n';
    const parsed = parseFrontmatter(serializeFrontmatter(data, body));
    expect(parsed.data).toEqual(data);
    expect(parsed.body).toBe(body);
  });

  it('ends with exactly one trailing newline', () => {
    const out = serializeFrontmatter({ name: 'x' }, 'body without trailing newline');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});
