import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { Context } from '../src/context.js';
import { createUiServer, type UiServer } from '../src/ui/server.js';

// Running as root (as in CI containers) needs --no-sandbox or Chromium refuses to
// start; the box here also ships browser build 1194 while playwright expects a
// newer one, so the default launch misses and we fall back to the on-disk binary.
const LAUNCH_ARGS = ['--no-sandbox'];
const FALLBACK_EXECUTABLE = '/opt/pw-browsers/chromium';

let browser: Browser | undefined;
let server: UiServer | undefined;
let tmp: string | undefined;

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-ui-e2e-')));
  const globalRoot = path.join(tmp, 'ghome');
  const projectRoot = path.join(tmp, 'proj');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  // A pre-existing CLAUDE.md that will diverge from the freshly-made hub, so the
  // docs flow can demonstrate a SYNC badge going 불일치 → 동기화됨.
  fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), 'spoke original content\n');
  const ctx: Context = { globalRoot, projectRoot, cwd: projectRoot, home };
  server = await createUiServer(ctx, { port: 0 });

  try {
    browser = await chromium.launch({ args: LAUNCH_ARGS });
  } catch {
    try {
      browser = await chromium.launch({ executablePath: FALLBACK_EXECUTABLE, args: LAUNCH_ARGS });
    } catch {
      browser = undefined; // no usable browser — every test will skip
    }
  }
}, 60_000);

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('ui e2e — dashboard → skills → docs', () => {
  it(
    'drives the full flow in a real browser',
    async (t) => {
      if (!browser || !server) {
        t.skip();
        return;
      }
      const page = await browser.newPage();
      try {
        await page.goto(server.url);

        // --- 대시보드: six agents render ---
        await page.getByText('Claude Code').first().waitFor();
        const agentCount = await page.locator('table').first().locator('tbody tr').count();
        expect(agentCount).toBe(6);

        // --- 스킬: create a skill via the form ---
        await page.locator('.tab[data-tab="skills"]').click();
        await page.getByText('새 스킬').waitFor();
        await page.locator('.form-row input[type="text"]').first().fill('e2e-skill');
        await page.getByRole('button', { name: '생성' }).click();

        const skillRow = page.locator('tr', { hasText: 'e2e-skill' });
        await skillRow.first().waitFor();
        expect(await skillRow.count()).toBeGreaterThan(0);
        // enabled → green 활성 badge present
        await skillRow.first().locator('.badge-green', { hasText: '활성' }).waitFor();

        // --- 비활성 toggle ---
        await skillRow.first().getByRole('button', { name: '비활성' }).click();
        await page
          .locator('tr', { hasText: 'e2e-skill' })
          .first()
          .locator('.badge-red', { hasText: '비활성' })
          .waitFor();

        // --- 문서: create the hub, then sync ---
        await page.locator('.tab[data-tab="docs"]').click();
        await page.getByRole('button', { name: '허브 만들기' }).click();
        // CLAUDE.md now diverges from the new AGENTS.md hub
        await page.getByText('불일치').first().waitFor();

        await page.getByRole('button', { name: '전체 동기화' }).click();
        // after syncing, the spoke SYNC badge flips to 동기화됨
        await page.getByText('동기화됨').first().waitFor();
        expect(await page.getByText('동기화됨').count()).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    },
    60_000,
  );
});
