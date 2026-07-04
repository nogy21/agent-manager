// agman web dashboard — vanilla ES module, no build step, no external resources.
// The token travels in the URL fragment (location.hash) so it never hits the server
// logs as a query string; every /api/* request carries it as x-agman-token.

const token = location.hash.slice(1);

const SKILL_LOCATIONS = ['claude', 'agents', 'cursor', 'copilot', 'gemini', 'windsurf'];

// ---- tiny DOM helper (textContent only — never innerHTML with data) ----

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// SVG sibling of el(): creates namespaced elements so the hub-and-spoke diagram
// can be built with the same declarative style. Attributes go through
// setAttribute (SVG has no className/textContent shortcuts we rely on); text
// nodes are appended as-is. Security rule holds — never innerHTML, textContent
// only via appended text nodes.
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, props = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, String(v));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function badge(text, cls) {
  return el('span', { class: `badge badge-${cls}`, text });
}

// dim em-dash placeholder for empty cells
function emDash() {
  return el('span', { class: 'dim', text: '—' });
}

// Classic LCS line diff: DP table over the two line arrays, then backtrace into
// an ordered list of rows. `oldLines`/`newLines` are string arrays. Each row is
// { type: 'ctx'|'del'|'add', text, oldNo, newNo } where the line number is null
// on the side a del/add doesn't touch. Pure — no DOM, no libraries.
function computeLineDiff(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  // lcs[i][j] = length of the LCS of oldLines[i..] and newLines[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ type: 'ctx', text: oldLines[i], oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: 'del', text: oldLines[i], oldNo: i + 1, newNo: null });
      i++;
    } else {
      rows.push({ type: 'add', text: newLines[j], oldNo: null, newNo: j + 1 });
      j++;
    }
  }
  while (i < n) rows.push({ type: 'del', text: oldLines[i], oldNo: ++i, newNo: null });
  while (j < m) rows.push({ type: 'add', text: newLines[j], oldNo: null, newNo: ++j });
  return rows;
}

// Shorten an absolute path for display: repo-relative under projectRoot,
// `<global>/…` under globalRoot, `~/…` under home. Order matters because
// projectRoot/globalRoot can sit under home.
function shortenPath(p, status) {
  if (!p || !status) return p || '';
  const { projectRoot, globalRoot, home } = status;
  if (projectRoot && (p === projectRoot || p.startsWith(projectRoot + '/'))) {
    return p.slice(projectRoot.length).replace(/^\/+/, '') || '.';
  }
  if (globalRoot && (p === globalRoot || p.startsWith(globalRoot + '/'))) {
    return '<global>' + p.slice(globalRoot.length);
  }
  if (home && (p === home || p.startsWith(home + '/'))) {
    return '~' + p.slice(home.length);
  }
  return p;
}

function field(label, input) {
  return el('div', { class: 'field' }, el('label', { text: label }), input);
}

function checkbox(labelText) {
  const input = el('input', { type: 'checkbox' });
  const label = el('label', { class: 'checkbox' }, input, labelText);
  return { input, label };
}

function selectEl(options, value) {
  const sel = el('select', {});
  for (const opt of options) {
    const o = el('option', { value: opt, text: opt });
    if (opt === value) o.selected = true;
    sel.append(o);
  }
  return sel;
}

// Headers may be plain strings or { text, cls } for alignment (e.g. numeric
// columns get cls:'num', the actions column gets cls:'col-actions').
function headerCell(h) {
  if (typeof h === 'string') return el('th', { text: h });
  return el('th', { class: h.cls, text: h.text });
}

function tableWrap(headers, rows) {
  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      {},
      el('thead', {}, el('tr', {}, ...headers.map(headerCell))),
      el('tbody', {}, ...rows),
    ),
  );
}


// ---- formatting (mirrors src/docs/commands.ts) ----

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatMtime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// ---- api + toast + modal ----

async function api(method, path, body) {
  const opts = { method, headers: { 'x-agman-token': token } };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
  }
  return data;
}

function toast(message, kind = 'ok') {
  const node = el('div', { class: `toast ${kind}`, text: message });
  document.getElementById('toasts').append(node);
  setTimeout(() => node.remove(), 4500);
}

// Focus management state for the currently open modal. `modalTrigger` is the
// element focus should return to on close; `modalKeydown` is the trap listener
// we install on open and must remove on close (no leftover listeners).
let modalTrigger = null;
let modalKeydown = null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter(
    (n) => n.offsetParent !== null || n === document.activeElement,
  );
}

function closeModal() {
  if (modalKeydown) {
    document.removeEventListener('keydown', modalKeydown);
    modalKeydown = null;
  }
  document.getElementById('modal-root').replaceChildren();
  // Restore focus to whatever opened the modal, if it is still in the document.
  const trigger = modalTrigger;
  modalTrigger = null;
  if (trigger && document.contains(trigger)) trigger.focus();
}

function cancelBtn() {
  return el('button', { class: 'btn', type: 'button', text: '취소', onclick: closeModal });
}

function openModal({ title, body, footer, initialFocus }) {
  closeModal();
  modalTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const overlay = el('div', { class: 'modal-overlay' });
  const heading = el('h3', { id: 'modal-title', text: title });
  const modal = el(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', tabindex: '-1' },
    el(
      'div',
      { class: 'modal-head' },
      heading,
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', text: '×', onclick: closeModal }),
    ),
    el('div', { class: 'modal-body' }, body),
    footer ? el('div', { class: 'modal-foot' }, ...footer) : null,
  );
  overlay.append(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Trap Tab / Shift+Tab within the modal, wrapping at both ends.
  modalKeydown = (e) => {
    if (e.key !== 'Tab') return;
    const items = focusableIn(modal);
    if (items.length === 0) {
      e.preventDefault();
      modal.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !modal.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !modal.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', modalKeydown);

  document.getElementById('modal-root').append(overlay);

  // Move focus into the modal: explicit initialFocus, else first focusable, else
  // the modal container itself (which is tabindex=-1 and thus focusable).
  const target =
    (typeof initialFocus === 'string' ? modal.querySelector(initialFocus) : initialFocus) ||
    focusableIn(modal)[0] ||
    modal;
  target.focus();
}

// Reusable confirm dialog built on openModal. Cancel is focused by default so a
// stray Enter/Space never fires a destructive action.
function confirmModal({ title, message, confirmText = '확인', danger = false, onConfirm }) {
  const cancel = cancelBtn();
  const confirm = el('button', {
    class: danger ? 'btn danger' : 'btn primary',
    type: 'button',
    text: confirmText,
    onclick: () => onConfirm(),
  });
  openModal({
    title,
    body: el('div', { class: 'confirm-message', text: message }),
    footer: [cancel, confirm],
    initialFocus: cancel,
  });
}

// Shared editor modal: monospace textarea with a line-number gutter, 취소/저장
// footer, ⌘S/Ctrl+S to save. onSave(value) is async and owns the PUT + toast +
// closeModal + render.
function openEditorModal({ title, content, onSave }) {
  const textarea = el('textarea', { class: 'editor-area', spellcheck: 'false' });
  textarea.value = content;
  const gutter = el('div', { class: 'editor-gutter', 'aria-hidden': 'true' });
  const editor = el('div', { class: 'editor' }, gutter, textarea);

  // The gutter mirrors one <div> per source line; keep the count in sync on
  // every edit and align its scroll to the textarea's.
  const syncGutter = () => {
    const count = textarea.value.split('\n').length;
    const nums = Array.from({ length: count }, (_, i) =>
      el('div', { class: 'editor-lineno', text: String(i + 1) }),
    );
    gutter.replaceChildren(...nums);
    gutter.scrollTop = textarea.scrollTop;
  };
  syncGutter();

  const runSave = () => onSave(textarea.value);
  const save = el('button', { class: 'btn primary', type: 'button', text: '저장', onclick: runSave });
  textarea.addEventListener('input', syncGutter);
  textarea.addEventListener('scroll', () => {
    gutter.scrollTop = textarea.scrollTop;
  });
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      runSave();
      return;
    }
    // Tab inserts two spaces at the caret instead of leaving the field.
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart, selectionEnd, value } = textarea;
      textarea.value = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd);
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
      syncGutter();
    }
  });
  openModal({ title, body: editor, footer: [cancelBtn(), save], initialFocus: textarea });
}

// ---- overflow menu (⋯) ----
// A single popover at a time, rendered into #popover-root (top level) so its
// position:fixed escapes the tables' overflow-x:auto clipping. `openPopover`
// holds the live { menu, trigger, cleanup } so Escape can prefer the popover
// over the modal and only one is ever mounted.
let openPopover = null;

function closePopover() {
  if (!openPopover) return;
  const { trigger, cleanup } = openPopover;
  cleanup();
  document.getElementById('popover-root').replaceChildren();
  openPopover = null;
  trigger.setAttribute('aria-expanded', 'false');
  if (document.contains(trigger)) trigger.focus();
}

// Place the menu anchored to the trigger, right-aligned under it, flipping up
// or left when it would overflow the viewport. Measured after mount so we know
// the menu's real size. Coordinates are viewport-relative (position:fixed).
function positionPopover(menu, trigger) {
  const r = trigger.getBoundingClientRect();
  const gap = 6;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // Right edge aligns with the trigger's right; flip to left-align if it would
  // spill off the left edge.
  let left = r.right - mw;
  if (left < gap) left = Math.min(r.left, vw - mw - gap);
  left = Math.max(gap, left);

  // Open downward; flip above the trigger if there isn't room below.
  let top = r.bottom + gap;
  if (top + mh > vh - gap && r.top - gap - mh > gap) top = r.top - gap - mh;
  top = Math.max(gap, Math.min(top, vh - mh - gap));

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

// Factory: items = [{ label, onClick, danger? }] → a ⋯ trigger button. Opening
// mounts the menu, focuses its first item, and closes on item click, outside
// click, Escape, scroll, or resize (returning focus to the trigger).
function overflowMenu(items) {
  const trigger = el('button', {
    class: 'icon-btn overflow-trigger',
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': '추가 작업',
    text: '⋯',
  });

  const open = () => {
    if (openPopover && openPopover.trigger === trigger) {
      closePopover();
      return;
    }
    closePopover();

    const menu = el('div', { class: 'overflow-menu', role: 'menu' });
    for (const item of items) {
      menu.append(
        el('button', {
          class: item.danger ? 'overflow-item danger' : 'overflow-item',
          type: 'button',
          role: 'menuitem',
          text: item.label,
          onclick: () => {
            closePopover();
            item.onClick();
          },
        }),
      );
    }

    const root = document.getElementById('popover-root');
    root.append(menu);
    positionPopover(menu, trigger);

    // Arrow keys walk the menu items; Escape closes (handled globally too, but
    // stopped here so it never also closes an underlying modal).
    const onKeydown = (e) => {
      const menuItems = Array.from(menu.querySelectorAll('.overflow-item'));
      const idx = menuItems.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePopover();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        (menuItems[idx + 1] || menuItems[0]).focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        (menuItems[idx - 1] || menuItems[menuItems.length - 1]).focus();
      } else if (e.key === 'Tab') {
        // Tabbing away dismisses the popover rather than trapping focus.
        closePopover();
      }
    };
    // Outside click / reposition triggers. Scroll listens in capture so it fires
    // for any scrolling ancestor (the table wrap), not just the window.
    const onPointer = (e) => {
      if (!menu.contains(e.target) && e.target !== trigger) closePopover();
    };
    const onReflow = () => closePopover();

    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);

    openPopover = {
      menu,
      trigger,
      cleanup: () => {
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('pointerdown', onPointer, true);
        window.removeEventListener('scroll', onReflow, true);
        window.removeEventListener('resize', onReflow);
      },
    };
    trigger.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('.overflow-item');
    if (first) first.focus();
  };

  trigger.addEventListener('click', open);
  return trigger;
}

// ---- command palette (⌘K / Ctrl+K) ----
// A keyboard-first launcher rendered into #popover-root. It is fully additive:
// opened only by ⌘K or the header pill, never on load. Independent of openModal
// so its Escape + focus-trap never tangle with an open editor/diff modal.
// `openPalette` holds the live { close, trigger } singleton; a null value means
// the palette is closed. Data (skills/docs/status) is fetched once per open —
// simple, no caching.
let openPalette = null;

// Build the flat command list from freshly-fetched data, grouped for display.
// Each command is { group, label, hint?, run } where run() performs the action.
// Groups: 이동 (nav) · 작업 (global actions) · 스킬 · 문서. Nav/actions always
// present; skills/docs are matched by their label text against the query.
function buildPaletteCommands({ skills, docs, status }) {
  const commands = [];

  // 이동 — tab navigation.
  for (const [tab, label] of [
    ['dashboard', '개요'],
    ['skills', '스킬'],
    ['docs', '문서'],
  ]) {
    commands.push({ group: '이동', label, hint: '이동', run: () => setTab(tab) });
  }

  // 작업 — global actions. 허브 만들기 only surfaces when no hub exists yet.
  const hubExists = status ? status.hubExists : docs.some((d) => d.role === 'hub' && d.exists);
  if (!hubExists) {
    commands.push({
      group: '작업',
      label: '허브 만들기',
      hint: 'AGENTS.md',
      run: () => initDoc('agents'),
    });
  }
  commands.push({
    group: '작업',
    label: '허브 → 전체 동기화',
    hint: '문서',
    run: () => syncAll(),
  });

  // 스킬 — open the editor for a matched skill.
  for (const s of skills) {
    commands.push({
      group: '스킬',
      label: s.name,
      hint: s.description || `${s.locationKey}:${s.scope}`,
      search: `${s.name} ${s.description || ''}`,
      run: () => editSkill(s),
    });
  }

  // 문서 — open the editor for a matched doc (existing files only).
  for (const d of docs.filter((doc) => doc.exists)) {
    commands.push({
      group: '문서',
      label: d.label,
      hint: '편집',
      run: () => editDoc(d),
    });
  }

  return commands;
}

const PALETTE_GROUP_ORDER = ['이동', '작업', '스킬', '문서'];
const PALETTE_GROUP_CAP = 6;

// Filter by case-insensitive substring over each command's searchable text
// (label + optional richer `search`), then cap each group to PALETTE_GROUP_CAP,
// tracking how many were truncated so the list can show "그 외 N개".
function filterPaletteCommands(commands, query) {
  const q = query.trim().toLowerCase();
  const byGroup = new Map();
  for (const cmd of commands) {
    const hay = (cmd.search || cmd.label).toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (!byGroup.has(cmd.group)) byGroup.set(cmd.group, []);
    byGroup.get(cmd.group).push(cmd);
  }
  const groups = [];
  for (const name of PALETTE_GROUP_ORDER) {
    const all = byGroup.get(name);
    if (!all || all.length === 0) continue;
    groups.push({ name, items: all.slice(0, PALETTE_GROUP_CAP), overflow: all.length - PALETTE_GROUP_CAP });
  }
  return groups;
}

function closeCommandPalette() {
  if (openPalette) openPalette.close();
}

async function openCommandPalette() {
  if (openPalette) return; // already open — ⌘K is idempotent
  closePopover(); // a stray overflow menu shares #popover-root; clear it first
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  let data;
  try {
    const [skills, docs, status] = await Promise.all([
      api('GET', '/api/skills'),
      api('GET', '/api/docs'),
      api('GET', '/api/status'),
    ]);
    data = { skills, docs, status };
  } catch (err) {
    toast(err.message, 'err');
    return;
  }
  // A late failure elsewhere could have opened another palette while we awaited;
  // bail rather than stack two overlays.
  if (openPalette) return;

  const commands = buildPaletteCommands(data);

  const input = el('input', {
    type: 'text',
    class: 'palette-input',
    placeholder: '명령 또는 스킬·문서 검색…',
    'aria-label': '명령 또는 스킬·문서 검색',
    'aria-controls': 'palette-results',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const results = el('div', { class: 'palette-results', id: 'palette-results', role: 'listbox' });
  const panel = el(
    'div',
    {
      class: 'palette',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '명령 팔레트',
    },
    el(
      'div',
      { class: 'palette-input-wrap' },
      el('span', { class: 'palette-search-icon', 'aria-hidden': 'true', text: '⌕' }),
      input,
    ),
    results,
  );
  const overlay = el('div', { class: 'palette-overlay' }, panel);

  // Flat list of the currently-visible command buttons + their command objects,
  // kept in sync with the rendered groups so ↑/↓ can walk them and Enter can run
  // the selected one. `selected` indexes into `flat`.
  let flat = [];
  let selected = 0;

  const paintSelection = () => {
    flat.forEach((entry, i) => {
      const isSel = i === selected;
      entry.node.classList.toggle('selected', isSel);
      entry.node.setAttribute('aria-selected', isSel ? 'true' : 'false');
      if (isSel) {
        entry.node.setAttribute('aria-current', 'true');
        entry.node.scrollIntoView({ block: 'nearest' });
      } else {
        entry.node.removeAttribute('aria-current');
      }
    });
  };

  const rerender = () => {
    const groups = filterPaletteCommands(commands, input.value);
    flat = [];
    const children = [];
    for (const g of groups) {
      children.push(el('div', { class: 'palette-group-label', text: g.name }));
      for (const cmd of g.items) {
        const idx = flat.length;
        const node = el(
          'button',
          {
            class: 'palette-item',
            type: 'button',
            role: 'option',
            onclick: () => runPaletteItem(idx),
            onmousemove: () => {
              // Hover moves the highlight without re-firing on every pixel.
              if (selected !== idx) {
                selected = idx;
                paintSelection();
              }
            },
          },
          el('span', { class: 'palette-item-label', text: cmd.label }),
          cmd.hint ? el('span', { class: 'palette-item-hint', text: cmd.hint }) : null,
        );
        flat.push({ node, cmd });
        children.push(node);
      }
      if (g.overflow > 0) {
        children.push(el('div', { class: 'palette-more', text: `그 외 ${g.overflow}개` }));
      }
    }
    if (flat.length === 0) {
      children.push(el('div', { class: 'palette-empty', text: '결과가 없습니다.' }));
    }
    results.replaceChildren(...children);
    selected = 0;
    paintSelection();
  };

  const runPaletteItem = (idx) => {
    const entry = flat[idx];
    if (!entry) return;
    const run = entry.cmd.run;
    close(); // close first so focus/DOM are clean before the action opens its own UI
    run();
  };

  const move = (delta) => {
    if (flat.length === 0) return;
    selected = (selected + delta + flat.length) % flat.length;
    paintSelection();
  };

  // Keydown on the panel: arrows navigate, Enter runs, Esc closes, Tab is trapped
  // to the input (the only tabbable control — results are driven by arrows). All
  // handled here and never allowed to bubble to the global ⌘K/Esc listeners.
  const onKeydown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPaletteItem(selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // Keep focus on the input; there is nothing else to tab to.
      e.preventDefault();
      input.focus();
    }
  };
  panel.addEventListener('keydown', onKeydown);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  input.addEventListener('input', rerender);

  function close() {
    if (!openPalette) return;
    openPalette = null;
    panel.removeEventListener('keydown', onKeydown);
    document.getElementById('popover-root').replaceChildren();
    if (trigger && document.contains(trigger)) trigger.focus();
  }

  openPalette = { close, trigger };
  document.getElementById('popover-root').append(overlay);
  rerender();
  input.focus();
}

// ---- overview view (Mission Control home) ----

// One source of truth for how an agent's instruction state maps to a color
// bucket. The bucket name is both a CSS class suffix (.s-ok/.s-linked/…) and,
// via STATE_COLOR, a concrete color for the SVG diagram (which can't use CSS
// classes for stroke/fill as cleanly across themes). native/in-sync → healthy
// green, linked → teal, diverged → amber, missing/no-hub → idle gray.
function stateBucket(state) {
  if (state === 'native' || state === 'in-sync') return 'ok';
  if (state === 'linked') return 'linked';
  if (state === 'diverged') return 'warn';
  return 'idle'; // missing | no-hub | anything unexpected
}

// CSS custom properties resolved to values for SVG stroke/fill. Read live so
// the diagram picks up the light/dark palette without duplicating hex codes.
function stateColor(bucket) {
  const varName = {
    ok: '--state-ok',
    linked: '--state-linked',
    warn: '--state-warn',
    idle: '--state-idle',
  }[bucket];
  return `var(${varName})`;
}

// Human label per bucket, reused by the fleet pill title and legend.
const STATE_LABEL = { ok: '동기화됨', linked: '심링크', warn: '불일치', idle: '미설정' };

// Build the hub-and-spoke SVG: a center AGENTS.md node with 6 agent nodes on a
// circle around it, an edge to each. Edge + node stroke color come from the
// agent's state bucket; undetected agents get a dashed edge and muted label.
// Pure SVG via svgEl (textContent only) — teaches the hub→spoke model.
function hubSpokeDiagram(agents) {
  const W = 420;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const radius = 104;
  const nodeR = 22;

  const svg = svgEl('svg', {
    class: 'hub-diagram',
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': 'AGENTS.md 허브와 6개 에이전트의 연결 상태',
  });

  // Layout the 6 agents evenly. Start a touch past vertical (−80°) so no node
  // lands exactly on the top axis where its label would fight the node.
  const placed = agents.map((a, i) => {
    const angle = (Math.PI * 2 * i) / agents.length - Math.PI / 2 + 0.18;
    return { agent: a, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });

  // Edges first so nodes paint on top of the line ends.
  const edges = svgEl('g', {});
  for (const p of placed) {
    const bucket = stateBucket(p.agent.instruction.state);
    edges.append(
      svgEl('line', {
        x1: cx,
        y1: cy,
        x2: p.x,
        y2: p.y,
        stroke: p.agent.detected ? stateColor(bucket) : 'var(--border-strong)',
        'stroke-width': p.agent.detected ? 2 : 1.5,
        'stroke-dasharray': p.agent.detected ? null : '4 4',
        'stroke-linecap': 'round',
        opacity: p.agent.detected ? 0.9 : 0.6,
      }),
    );
  }
  svg.append(edges);

  // Agent nodes + outside labels.
  for (const p of placed) {
    const bucket = stateBucket(p.agent.instruction.state);
    const color = p.agent.detected ? stateColor(bucket) : 'var(--state-idle)';
    svg.append(
      svgEl('circle', {
        cx: p.x,
        cy: p.y,
        r: nodeR,
        fill: 'var(--panel)',
        stroke: color,
        'stroke-width': 2,
        'stroke-dasharray': p.agent.detected ? null : '4 4',
      }),
      svgEl('circle', { cx: p.x, cy: p.y, r: 4, fill: color }),
    );
    // Label is centered on the node's x and placed above (top half) or below
    // (bottom half) so it never overlaps the node and stays within the wide
    // viewBox band — cleaner than radial anchoring near the vertical axis.
    const above = p.y < cy;
    const ly = above ? p.y - nodeR - 8 : p.y + nodeR + 15;
    svg.append(
      svgEl(
        'text',
        {
          x: p.x,
          y: ly,
          'text-anchor': 'middle',
          'font-size': 11,
          class: p.agent.detected ? 'diagram-node-label' : 'diagram-node-label idle',
        },
        p.agent.name,
      ),
    );
  }

  // Center hub: accent-tinted rounded rect with the AGENTS.md label.
  const hubW = 112;
  const hubH = 44;
  svg.append(
    svgEl('rect', {
      x: cx - hubW / 2,
      y: cy - hubH / 2,
      width: hubW,
      height: hubH,
      rx: 10,
      fill: 'var(--accent)',
    }),
    svgEl(
      'text',
      { x: cx, y: cy + 4, 'text-anchor': 'middle', 'font-size': 13, class: 'diagram-hub-label' },
      'AGENTS.md',
    ),
  );

  return svg;
}

// Derive the actionable to-do list from status. Each item carries its own
// severity (drives the card's left accent) and a build() that renders the card.
// Order: missing hub → diverged docs → starved agents → shadowed skills.
function computeNeedsAttention(status) {
  const items = [];

  if (!status.hubExists) {
    items.push({
      severity: 'danger',
      title: 'AGENTS.md 허브가 없습니다',
      desc: '허브를 만들면 각 에이전트의 지시문을 한곳에서 관리할 수 있어요.',
      actions: [{ text: '허브 만들기', primary: true, onClick: () => initDoc('agents') }],
    });
  }

  for (const d of status.docs.filter((doc) => doc.sync === 'diverged')) {
    items.push({
      severity: 'danger',
      title: `${d.label}가 허브와 불일치합니다`,
      desc: '스포크 문서의 내용이 허브와 달라요. 차이를 확인하고 동기화하세요.',
      actions: [
        { text: '차이 보기', onClick: () => diffDoc(d) },
        { text: '동기화', primary: true, onClick: () => syncAll() },
      ],
    });
  }

  for (const a of status.agents.filter((ag) => ag.detected && ag.skillCount === 0)) {
    items.push({
      severity: 'warn',
      title: `${a.name}가 볼 수 있는 스킬이 없습니다`,
      desc: '이 에이전트에 스킬을 연결하면 작업에 활용할 수 있어요.',
      actions: [{ text: '스킬 연결', onClick: () => setTab('skills') }],
    });
  }

  if (status.shadowedCount > 0) {
    items.push({
      severity: 'warn',
      title: `가려진 전역 스킬 ${status.shadowedCount}개`,
      desc: '같은 이름의 로컬 스킬이 전역 스킬을 가리고 있어요.',
      actions: [{ text: '살펴보기', onClick: () => setTab('skills') }],
    });
  }

  return items;
}

function attentionCard(item) {
  const actions = el(
    'div',
    { class: 'attn-actions' },
    ...item.actions.map((a) =>
      el('button', {
        class: a.primary ? 'btn primary' : 'btn',
        type: 'button',
        text: a.text,
        onclick: a.onClick,
      }),
    ),
  );
  return el(
    'div',
    { class: `attn-card sev-${item.severity}` },
    el(
      'div',
      { class: 'attn-text' },
      el('div', { class: 'attn-title', text: item.title }),
      el('div', { class: 'attn-desc', text: item.desc }),
    ),
    actions,
  );
}

// Compact one-per-agent strip: color dot + name + skill count. Undetected
// agents render muted/dashed with "미설정". Stable .fleet-agent hook for e2e.
function fleetStrip(agents) {
  return el(
    'div',
    { class: 'fleet-strip' },
    ...agents.map((a) => {
      const bucket = stateBucket(a.instruction.state);
      const dotBucket = a.detected ? bucket : 'idle';
      const meta = a.detected ? `스킬 ${a.skillCount}` : '미설정';
      return el(
        'div',
        {
          class: a.detected ? 'fleet-agent' : 'fleet-agent idle',
          title: `${a.name} · ${STATE_LABEL[dotBucket]}`,
        },
        el('span', { class: `fleet-dot s-${dotBucket}`, 'aria-hidden': 'true' }),
        el('span', { class: 'fleet-name', text: a.name }),
        el('span', { class: 'fleet-meta', text: meta }),
      );
    }),
  );
}

// The health hero: eyebrow + display-size statement (+ subtitle breakdown when
// something needs attention) + legend, beside the hub-and-spoke diagram.
function healthHero(status, attention) {
  const n = attention.length;

  const legend = el(
    'div',
    { class: 'health-legend' },
    ...[
      ['ok', '동기화됨'],
      ['warn', '불일치'],
      ['linked', '심링크'],
      ['idle', '미설정'],
    ].map(([bucket, label]) =>
      el(
        'span',
        { class: 'legend-item' },
        el('span', { class: `legend-dot s-${bucket}`, 'aria-hidden': 'true' }),
        label,
      ),
    ),
  );

  let statement;
  let subtitle = null;
  if (n === 0) {
    statement = el('h1', { class: 't-display health-statement ok', text: '모두 정상이에요' });
  } else {
    statement = el('h1', {
      class: 't-display health-statement attn',
      text: `${n}개 항목이 주의가 필요해요`,
    });
    // Break the count down by domain so the number is legible at a glance.
    const hubN = status.hubExists ? 0 : 1;
    const docN = status.docs.filter((d) => d.sync === 'diverged').length;
    const skillN =
      status.agents.filter((a) => a.detected && a.skillCount === 0).length +
      (status.shadowedCount > 0 ? 1 : 0);
    const parts = [];
    if (hubN) parts.push(`허브 ${hubN}`);
    if (docN) parts.push(`문서 ${docN}`);
    if (skillN) parts.push(`스킬 ${skillN}`);
    subtitle = el('p', { class: 'health-subtitle', text: parts.join(' · ') });
  }

  const copy = el(
    'div',
    { class: 'health-copy' },
    el('div', { class: 'eyebrow', text: '시스템 상태' }),
    statement,
    subtitle,
    legend,
  );

  return el(
    'section',
    { class: 'section raised' },
    el('div', { class: 'health-hero' }, copy, hubSpokeDiagram(status.agents)),
  );
}

async function renderDashboard(main) {
  const status = await api('GET', '/api/status');
  setProjectPath(status.projectRoot, status);

  const attention = computeNeedsAttention(status);

  // Needs-attention: task cards, or a calm all-clear when the list is empty.
  const attnBody =
    attention.length > 0
      ? el('div', { class: 'attn-list' }, ...attention.map(attentionCard))
      : el(
          'div',
          { class: 'attn-clear' },
          el('span', { class: 'attn-clear-glyph', 'aria-hidden': 'true', text: '✓' }),
          '모든 문서가 동기화되어 있고 모든 에이전트에 스킬이 연결돼 있어요.',
        );
  const attnSection = el(
    'section',
    { class: 'section' },
    el('h2', { text: '주의가 필요한 항목' }),
    attnBody,
  );

  const fleetSection = el(
    'section',
    { class: 'section' },
    el('h2', { text: '에이전트' }),
    fleetStrip(status.agents),
  );

  main.replaceChildren(healthHero(status, attention), attnSection, fleetSection);
}

// ---- skills view ----

// Client-side list filters, kept at module scope so post-action re-renders
// (toggle/edit/delete) preserve what the user typed/selected.
let skillsQuery = '';
let skillsStatus = 'all'; // 'all' | 'enabled' | 'disabled'

function skillMatchesFilter(s) {
  if (skillsStatus === 'enabled' && !s.enabled) return false;
  if (skillsStatus === 'disabled' && s.enabled) return false;
  const q = skillsQuery.trim().toLowerCase();
  if (!q) return true;
  const hay = `${s.name} ${s.description || ''}`.toLowerCase();
  return hay.includes(q);
}

function skillRow(s) {
  // Per-project Claude Code applicability (a SEPARATE axis from enabled/disabled):
  // only the excluded state is called out, with a calm muted 제외됨 tag beside the
  // name. Default 'on' / name-only / user-invocable-only / non-Claude skills show
  // nothing here, keeping the list quiet.
  const excludedFromClaude = s.claudeApplicability === 'off';

  // 이름: bold name (+ inline 가려짐 / 제외됨 tags) over a mono locationKey:scope
  // subtitle (reuses the docs 파일-cell pattern via the shared .cell-sub style).
  const nameCell = el(
    'td',
    {},
    el(
      'div',
      { class: 'cell-title' },
      s.name,
      s.shadowed ? el('span', { class: 'badge badge-amber inline-tag', text: '가려짐' }) : null,
      excludedFromClaude
        ? el('span', {
            class: 'badge badge-idle inline-tag',
            title: '이 프로젝트에서 Claude Code가 사용하지 않음',
            text: '제외됨',
          })
        : null,
    ),
    el('div', { class: 'cell-sub', title: s.path, text: `${s.locationKey}:${s.scope}` }),
  );
  const isPlaceholder = !s.hasSkillMd || !s.description;
  const descCell = el('td', {
    class: isPlaceholder ? 'desc muted' : 'desc',
    text: s.hasSkillMd ? s.description || '(설명 없음)' : '(SKILL.md 없음)',
  });
  // 에이전트: compact count pill (full list on hover); em-dash when disabled/empty.
  const visCell = el(
    'td',
    { 'data-label': '에이전트' },
    s.enabled && s.visibleTo.length > 0
      ? el('span', { class: 'badge badge-gray', title: s.visibleTo.join(', '), text: String(s.visibleTo.length) })
      : emDash(),
  );
  const statusCell = el('td', { 'data-label': '상태' }, s.enabled ? badge('활성', 'green') : badge('비활성', 'red'));

  // Toggle stays inline (highest-frequency action + the e2e clicks it directly);
  // 편집/복사/[적용·제외]/삭제 fold into the ⋯ menu, 삭제 danger and last. The
  // applicability item appears ONLY for Claude-visible skills (claudeApplicability
  // defined) and sits just above the destructive 삭제.
  const menuItems = [
    { label: '편집', onClick: () => editSkill(s) },
    { label: '복사', onClick: () => copySkillModal(s) },
  ];
  if (s.claudeApplicability !== undefined) {
    menuItems.push(
      excludedFromClaude
        ? { label: '이 프로젝트에 적용', onClick: () => toggleApplicability(s, 'on') }
        : { label: '이 프로젝트에서 제외', onClick: () => toggleApplicability(s, 'off') },
    );
  }
  menuItems.push({ label: '삭제', danger: true, onClick: () => deleteSkill(s) });

  const actions = el(
    'td',
    { class: 'col-actions' },
    el(
      'div',
      { class: 'row-actions' },
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: s.enabled ? '비활성' : '활성',
        onclick: () => toggleSkill(s),
      }),
      overflowMenu(menuItems),
    ),
  );

  return el('tr', {}, nameCell, descCell, visCell, statusCell, actions);
}

async function toggleSkill(s) {
  try {
    await api('POST', '/api/skills/toggle', {
      name: s.name,
      locationKey: s.locationKey,
      scope: s.scope,
      enabled: !s.enabled,
    });
    toast(`${s.name} ${!s.enabled ? '활성화' : '비활성화'}됨`);
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// Per-project Claude Code applicability — a distinct axis from toggleSkill's
// enable/disable (which owns the skill's directory presence). 'off' excludes the
// skill from Claude Code IN THIS PROJECT (via .claude/settings.local.json);
// 'on' restores the default. The toast names both scopes so it never reads like
// the enable/disable action above.
async function toggleApplicability(s, state) {
  try {
    await api('POST', '/api/skills/applicability', { name: s.name, state });
    const verb = state === 'off' ? '제외됨' : '적용됨';
    toast(`${verb}: ${s.name} (이 프로젝트 · Claude Code)`);
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function editSkill(s) {
  let data;
  try {
    const qs = new URLSearchParams({ name: s.name, loc: s.locationKey, scope: s.scope });
    data = await api('GET', `/api/skills/content?${qs.toString()}`);
  } catch (err) {
    toast(err.message, 'err');
    return;
  }
  openEditorModal({
    title: `편집 · ${s.name} (${s.locationKey}:${s.scope})`,
    content: data.content,
    onSave: async (content) => {
      try {
        await api('PUT', '/api/skills/content', {
          name: s.name,
          locationKey: s.locationKey,
          scope: s.scope,
          content,
        });
        toast(`저장됨: ${s.name}`);
        closeModal();
        render();
      } catch (err) {
        toast(err.message, 'err');
      }
    },
  });
}

function copySkillModal(s) {
  const locSelect = selectEl(SKILL_LOCATIONS, s.locationKey === 'claude' ? 'agents' : 'claude');
  const global = checkbox('전역');
  const force = checkbox('덮어쓰기');
  const copy = el('button', {
    class: 'btn primary',
    type: 'button',
    text: '복사',
    onclick: async () => {
      try {
        await api('POST', '/api/skills/copy', {
          name: s.name,
          locationKey: locSelect.value,
          scope: global.input.checked ? 'global' : 'local',
          force: force.input.checked,
        });
        toast(`복사됨: ${s.name} → ${locSelect.value}`);
        closeModal();
        render();
      } catch (err) {
        toast(err.message, 'err');
      }
    },
  });
  openModal({
    title: `복사 · ${s.name}`,
    body: el('div', { class: 'form-row' }, field('대상 위치', locSelect), global.label, force.label),
    footer: [cancelBtn(), copy],
  });
}

function deleteSkill(s) {
  confirmModal({
    title: '스킬 삭제',
    message: `"${s.name}" (${s.locationKey}:${s.scope}) 스킬을 삭제합니다. 되돌릴 수 없습니다.`,
    confirmText: '삭제',
    danger: true,
    onConfirm: async () => {
      try {
        await api('POST', '/api/skills/delete', {
          name: s.name,
          locationKey: s.locationKey,
          scope: s.scope,
        });
        toast(`삭제됨: ${s.name}`);
        closeModal();
        render();
      } catch (err) {
        toast(err.message, 'err');
      }
    },
  });
}

async function renderSkills(main) {
  const skills = await api('GET', '/api/skills');

  const nameInput = el('input', { type: 'text', placeholder: 'my-skill' });
  const descInput = el('input', { type: 'text', placeholder: '한 줄 설명 (선택)' });
  const locSelect = selectEl(SKILL_LOCATIONS, 'agents');
  const global = checkbox('전역');
  const createBtn = el('button', {
    class: 'btn primary',
    type: 'button',
    text: '생성',
    onclick: async () => {
      const name = nameInput.value.trim();
      if (!name) {
        toast('스킬 이름을 입력하세요.', 'err');
        return;
      }
      try {
        await api('POST', '/api/skills', {
          name,
          location: locSelect.value,
          scope: global.input.checked ? 'global' : 'local',
          description: descInput.value.trim() || undefined,
        });
        toast(`스킬 생성됨: ${name}`);
        render();
      } catch (err) {
        toast(err.message, 'err');
      }
    },
  });

  const createSection = el(
    'section',
    { class: 'section' },
    el('h2', { text: '새 스킬' }),
    el(
      'div',
      { class: 'form-row' },
      field('이름', nameInput),
      field('설명', descInput),
      field('위치', locSelect),
      global.label,
      createBtn,
    ),
  );

  // Search + status filter toolbar (lives in the section head, not the create
  // form, so the e2e create-form selector stays intact). State is module-level
  // so it also survives the full re-render that follows toggle/delete/create.
  // On keystroke we re-render only the list body in place, keeping the input
  // mounted so focus and caret position are preserved.
  const searchInput = el('input', {
    type: 'text',
    class: 'search-input',
    placeholder: '스킬 검색…',
    'aria-label': '스킬 검색',
  });
  searchInput.value = skillsQuery;
  const statusFilter = selectEl(['전체', '활성', '비활성'], statusFilterLabel(skillsStatus));
  statusFilter.setAttribute('aria-label', '상태 필터');
  const listToolbar = el('div', { class: 'toolbar' }, searchInput, statusFilter);

  // The body wrapper is stable; only its children swap when the filter changes.
  const listBody = el('div', { class: 'list-body' });
  const renderListBody = () => {
    if (skills.length === 0) {
      listBody.replaceChildren(
        el(
          'div',
          { class: 'empty empty-state' },
          el('div', { class: 'empty-title', text: '아직 스킬이 없습니다' }),
          el('div', { class: 'muted', text: '위 폼에서 첫 스킬을 만들어 보세요.' }),
        ),
      );
      return;
    }
    const visible = skills.filter(skillMatchesFilter);
    listBody.replaceChildren(
      visible.length > 0
        ? tableWrap(
            ['이름', '설명', '에이전트', '상태', { text: '작업', cls: 'col-actions' }],
            visible.map(skillRow),
          )
        : el('div', { class: 'empty', text: '검색 결과가 없습니다.' }),
    );
  };
  searchInput.addEventListener('input', () => {
    skillsQuery = searchInput.value;
    renderListBody();
  });
  statusFilter.addEventListener('change', () => {
    skillsStatus = statusFilterValue(statusFilter.value);
    renderListBody();
  });
  renderListBody();

  const listSection = el(
    'section',
    { class: 'section' },
    el('div', { class: 'section-head' }, el('h2', { text: '스킬 목록' }), listToolbar),
    listBody,
  );

  main.replaceChildren(createSection, listSection);
}

// Bridge between the display labels in the status <select> and the module-level
// filter value (kept separate so the visible options stay Korean).
function statusFilterLabel(value) {
  return value === 'enabled' ? '활성' : value === 'disabled' ? '비활성' : '전체';
}

function statusFilterValue(label) {
  return label === '활성' ? 'enabled' : label === '비활성' ? 'disabled' : 'all';
}

// ---- docs view ----

// Single status badge folding file-existence and hub-relationship into one
// meaningful state. Broken symlinks win over sync state; hubs and spokes read
// off `sync`; everything else falls back to plain existence.
function docStatusBadge(d) {
  if (d.isSymlink && !d.exists) return badge('깨진 링크', 'amber');
  const map = {
    hub: ['hub', 'blue'],
    linked: ['심링크', 'cyan'],
    'in-sync': ['동기화됨', 'green'],
    diverged: ['불일치', 'amber'],
    missing: ['없음', 'gray'],
  };
  if (d.sync in map) {
    const [text, cls] = map[d.sync];
    return badge(text, cls);
  }
  return d.exists ? badge('있음', 'green') : badge('없음', 'gray');
}

function docRow(d, status) {
  const fileCell = el(
    'td',
    { class: 'desc' },
    el('div', { class: 'cell-title', text: d.label }),
    el('div', { class: 'cell-sub', title: d.path, text: shortenPath(d.path, status) }),
  );
  const scopeCell = el(
    'td',
    { 'data-label': '스코프' },
    d.scope === 'global' ? badge('global', 'gray') : badge('local', 'cyan'),
  );
  // Primary action stays inline; spokes fold 차이 보기 (first) and 링크/링크 해제
  // into the ⋯ menu. Non-spoke rows have a single action and show no menu.
  const actions = el('div', { class: 'row-actions' });
  actions.append(
    d.exists
      ? el('button', {
          class: 'btn btn-sm',
          type: 'button',
          text: '보기·편집',
          onclick: () => editDoc(d),
        })
      : el('button', {
          class: 'btn btn-sm',
          type: 'button',
          text: '만들기',
          onclick: () => initDoc(d.key),
        }),
  );
  if (d.role === 'spoke') {
    actions.append(
      overflowMenu([
        { label: '차이 보기', onClick: () => diffDoc(d) },
        d.isSymlink
          ? { label: '링크 해제', onClick: () => unlinkDocAction(d) }
          : { label: '링크', onClick: () => linkDocAction(d) },
      ]),
    );
  }

  return el(
    'tr',
    {},
    fileCell,
    el('td', { 'data-label': '상태' }, docStatusBadge(d)),
    scopeCell,
    el(
      'td',
      { class: 'num', 'data-label': '크기' },
      d.size !== undefined && d.size !== null ? humanSize(d.size) : emDash(),
    ),
    el('td', { class: 'num mono', 'data-label': '수정' }, d.mtime ? formatMtime(d.mtime) : emDash()),
    el('td', { class: 'col-actions' }, actions),
  );
}

async function editDoc(d) {
  let data;
  try {
    data = await api('GET', `/api/docs/content?key=${encodeURIComponent(d.key)}`);
  } catch (err) {
    toast(err.message, 'err');
    return;
  }
  openEditorModal({
    title: `편집 · ${d.label}`,
    content: data.content,
    onSave: async (content) => {
      try {
        await api('PUT', '/api/docs/content', { key: d.key, content });
        toast(`저장됨: ${d.label}`);
        closeModal();
        render();
      } catch (err) {
        toast(err.message, 'err');
      }
    },
  });
}

async function initDoc(key) {
  try {
    await api('POST', '/api/docs/init', { key });
    toast(`생성됨: ${key}`);
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function diffDoc(d) {
  let data;
  try {
    data = await api('GET', `/api/docs/diffpair?key=${encodeURIComponent(d.key)}`);
  } catch (err) {
    toast(err.message, 'err');
    return;
  }
  // Unified diff, old = spoke, new = hub: − removes lines only in the current
  // spoke, + adds the hub's lines (what a sync would produce). Split on \n; a
  // trailing newline yields a final empty line, harmless in the diff.
  const oldLines = data.spoke.content.split('\n');
  const newLines = data.hub.content.split('\n');
  const rows = computeLineDiff(oldLines, newLines);
  const mark = { ctx: ' ', del: '−', add: '+' };
  const diffRows = rows.map((r) =>
    el(
      'div',
      { class: `diff-line ${r.type}` },
      el(
        'span',
        { class: 'diff-gutter', 'aria-hidden': 'true' },
        el('span', { class: 'diff-no', text: r.oldNo === null ? '' : String(r.oldNo) }),
        el('span', { class: 'diff-no', text: r.newNo === null ? '' : String(r.newNo) }),
      ),
      el('span', { class: 'diff-mark', 'aria-hidden': 'true', text: mark[r.type] }),
      el('span', { class: 'diff-text', text: r.text }),
    ),
  );
  const header = data.same
    ? el('div', { class: 'muted mb-10', text: '허브와 동일합니다.' })
    : el(
        'div',
        { class: 'muted mb-10 diff-legend' },
        `− 현재 스포크 (${data.spoke.label}) · + 허브 (${data.hub.label})`,
      );
  const body = el('div', {}, header, el('div', { class: 'diff' }, ...diffRows));
  openModal({ title: `차이 · ${d.label}`, body, footer: [cancelBtn()] });
}

async function linkDocAction(d) {
  try {
    await api('POST', '/api/docs/link', { key: d.key });
    toast(`링크됨: ${d.label} → AGENTS.md`);
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function unlinkDocAction(d) {
  try {
    await api('POST', '/api/docs/unlink', { key: d.key });
    toast(`링크 해제됨: ${d.label}`);
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function syncAll() {
  try {
    const results = await api('POST', '/api/docs/sync', {});
    if (!results.length) {
      toast('동기화할 스포크가 없습니다.');
    } else {
      toast('동기화: ' + results.map((r) => `${r.key} ${r.result}`).join(', '));
    }
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// AI refresh is fire-and-forget on the server ("UI는 트리거만"); after triggering
// we re-render the docs table on a timer so the rewritten hub shows up on its own.
let docsRefreshTimer = null;

function stopDocsRefreshPoll() {
  if (docsRefreshTimer !== null) {
    clearInterval(docsRefreshTimer);
    docsRefreshTimer = null;
  }
}

function startDocsRefreshPoll() {
  stopDocsRefreshPoll();
  const startedAt = Date.now();
  docsRefreshTimer = setInterval(() => {
    if (current !== 'docs' || Date.now() - startedAt > 60000) {
      stopDocsRefreshPoll();
      return;
    }
    render();
  }, 5000);
}

async function refreshHub(tools, toolId) {
  const installed = tools.filter((t) => t.installed);
  if (installed.length === 0) {
    toast(tools.length > 0 ? tools[0].installHint : '설치된 AI 에이전트 CLI가 없습니다.', 'err');
    return;
  }
  const chosen = tools.find((t) => t.id === toolId) || installed[0];
  try {
    await api('POST', '/api/docs/refresh', { tool: chosen.id });
    toast(`백그라운드에서 ${chosen.bin} 실행됨 — 완료되면 문서 표가 갱신됩니다`);
    startDocsRefreshPoll();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function refreshToolSelect(tools) {
  const select = el('select', { id: 'refresh-tool' });
  let firstInstalled = null;
  for (const t of tools) {
    const label = `${t.bin} (${t.installed ? '설치됨' : '미설치'})`;
    const opt = el('option', { value: t.id, text: label, disabled: !t.installed });
    if (t.installed && firstInstalled === null) {
      firstInstalled = t.id;
      opt.selected = true;
    }
    select.append(opt);
  }
  return select;
}

async function renderDocs(main) {
  const [docs, refreshTools, status] = await Promise.all([
    api('GET', '/api/docs'),
    api('GET', '/api/docs/refresh-tools'),
    api('GET', '/api/status'),
  ]);
  setProjectPath(status.projectRoot, status);
  const hub = docs.find((d) => d.role === 'hub');
  const hubExists = Boolean(hub && hub.exists);

  const tools = (refreshTools && refreshTools.tools) || [];
  const toolSelect = refreshToolSelect(tools);

  // Toolbar: [허브 만들기?] · grouped [tool + AI 갱신] · separated primary sync.
  const toolbar = el('div', { class: 'toolbar' });
  if (!hubExists) {
    toolbar.append(
      el('button', {
        class: 'btn',
        type: 'button',
        text: '허브 만들기',
        onclick: () => initDoc('agents'),
      }),
    );
  }
  toolbar.append(
    el(
      'div',
      { class: 'toolbar-group' },
      toolSelect,
      el('button', {
        class: 'btn',
        type: 'button',
        text: 'AI로 허브 갱신',
        onclick: () => refreshHub(tools, toolSelect.value),
      }),
    ),
    el('button', {
      class: 'btn primary',
      type: 'button',
      text: '허브 → 전체 동기화',
      onclick: syncAll,
    }),
  );

  const section = el(
    'section',
    { class: 'section' },
    el('div', { class: 'section-head' }, el('h2', { text: '문서' }), toolbar),
    tableWrap(
      [
        '파일',
        '상태',
        '스코프',
        { text: '크기', cls: 'num' },
        { text: '수정', cls: 'num' },
        { text: '작업', cls: 'col-actions' },
      ],
      docs.map((d) => docRow(d, status)),
    ),
  );
  main.replaceChildren(section);
}

// ---- shell ----

const views = { dashboard: renderDashboard, skills: renderSkills, docs: renderDocs };
let current = 'dashboard';

// Header chip. Show the project root as a home-relative path (~/projects/… over
// a raw temp path) while keeping the absolute path in the tooltip. shortenPath
// resolves projectRoot to '.', so for the chip we collapse home ourselves and
// only fall back to shortenPath (→ <global>/…) for roots outside home.
function setProjectPath(p, status) {
  const node = document.getElementById('project-path');
  let shown = p || '';
  if (p && status) {
    const { home } = status;
    if (home && (p === home || p.startsWith(home + '/'))) shown = '~' + p.slice(home.length);
    else shown = shortenPath(p, status);
  }
  node.textContent = shown;
  node.title = p || '';
}

// A lightweight shimmering placeholder painted before a view resolves, so tab
// switches never flash blank. Swapped out by the view's replaceChildren.
function renderSkeleton(main) {
  const rows = Array.from({ length: 5 }, () => el('div', { class: 'skeleton-row' }));
  main.replaceChildren(el('section', { class: 'section' }, el('div', { class: 'skeleton' }, ...rows)));
}

// Full error panel with a retry affordance, replacing the bare error text.
function renderErrorPanel(main, message, onRetry) {
  main.replaceChildren(
    el(
      'section',
      { class: 'section' },
      el(
        'div',
        { class: 'error-panel', role: 'alert' },
        el('div', { class: 'error-glyph', 'aria-hidden': 'true', text: '⚠' }),
        el('div', { class: 'error-message', text: `불러오기 실패: ${message}` }),
        el('button', { class: 'btn', type: 'button', text: '다시 시도', onclick: onRetry }),
      ),
    ),
  );
}

async function render(showSkeleton = false) {
  const main = document.getElementById('main');
  if (showSkeleton) renderSkeleton(main);
  try {
    await views[current](main);
  } catch (err) {
    renderErrorPanel(main, err.message, () => render(true));
  }
}

function setTab(name) {
  current = name;
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  render(true);
}

function init() {
  if (!token) {
    document
      .getElementById('main')
      .replaceChildren(
        el('div', {
          class: 'empty',
          text: '토큰이 없습니다. `agman ui` 가 출력한 URL(#토큰 포함)로 접속하세요.',
        }),
      );
    return;
  }
  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  }
  const paletteTrigger = document.getElementById('palette-trigger');
  if (paletteTrigger) paletteTrigger.addEventListener('click', openCommandPalette);
  document.addEventListener('keydown', (e) => {
    // ⌘K / Ctrl+K toggles the command palette. Guarded so it never fires with
    // other modifiers (e.g. ⌘⇧K) and never swallows the editor's own ⌘S.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (openPalette) closeCommandPalette();
      else openCommandPalette();
      return;
    }
    // Escape precedence: palette → popover → modal. The palette and popover own
    // their own Escape (their handlers stop propagation), so this fallback only
    // reaches the modal. Still, if the palette is somehow open, close it first.
    if (e.key === 'Escape') {
      if (openPalette) closeCommandPalette();
      else closeModal();
    }
  });
  setTab('dashboard');
}

init();
