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

// A link-styled button that switches to another tab (used by dashboard tips).
function tabLink(text, tab) {
  return el('button', { class: 'link', type: 'button', text, onclick: () => setTab(tab) });
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

function stat(label, value, tone) {
  return el(
    'div',
    { class: 'stat' },
    el('div', { class: 'label', text: label }),
    el('div', { class: tone ? `value ${tone}` : 'value', text: value }),
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

// ---- dashboard view ----

function instructionBadge(state) {
  const map = {
    native: ['AGENTS.md ✓', 'green'],
    'in-sync': ['동기화됨', 'green'],
    linked: ['심링크 → AGENTS.md', 'cyan'],
    diverged: ['불일치', 'amber'],
    missing: ['파일 없음', 'gray'],
    'no-hub': ['허브 없음', 'gray'],
  };
  const [text, cls] = map[state] || [state, 'gray'];
  return badge(text, cls);
}

async function renderDashboard(main) {
  const status = await api('GET', '/api/status');
  setProjectPath(status.projectRoot);

  const agentRows = status.agents.map((a) =>
    el(
      'tr',
      {},
      el('td', { text: a.name }),
      el('td', { 'data-label': '감지' }, a.detected ? badge('감지됨', 'green') : badge('미감지', 'gray')),
      el('td', { 'data-label': '지시문' }, instructionBadge(a.instruction.state)),
      el('td', { class: 'num', 'data-label': '스킬', text: String(a.skillCount) }),
    ),
  );
  const agentsSection = el(
    'section',
    { class: 'section' },
    el('h2', { text: '에이전트' }),
    tableWrap(['에이전트', '감지', '지시문 상태', { text: '스킬 수', cls: 'num' }], agentRows),
  );

  const divergedDocs = status.docs.filter((d) => d.sync === 'diverged').length;
  const enabledSkills = status.skills.filter((s) => s.enabled).length;
  const summarySection = el(
    'section',
    { class: 'section' },
    el('h2', { text: '요약' }),
    el(
      'div',
      { class: 'summary-grid' },
      stat('허브(AGENTS.md)', status.hubExists ? '정상' : '없음', status.hubExists ? 'ok' : 'bad'),
      stat('불일치 문서', String(divergedDocs), divergedDocs > 0 ? 'warn' : null),
      stat('활성 스킬', String(enabledSkills)),
      stat('비활성 스킬', String(status.disabledCount)),
    ),
  );

  const tipItems = [];
  if (!status.hubExists) {
    tipItems.push(
      el('li', {}, 'AGENTS.md 허브가 없습니다. ', tabLink('문서 탭에서 허브 만들기', 'docs')),
    );
  }
  if (divergedDocs > 0) {
    tipItems.push(
      el(
        'li',
        {},
        `${divergedDocs}개 문서가 허브와 불일치합니다. `,
        tabLink('문서 탭에서 동기화', 'docs'),
      ),
    );
  }
  const starved = status.agents.filter((a) => a.detected && a.skillCount === 0).map((a) => a.name);
  if (starved.length > 0) {
    tipItems.push(
      el(
        'li',
        {},
        '스킬이 없는 감지된 에이전트: ' + starved.join(', ') + '. ',
        tabLink('스킬 탭 열기', 'skills'),
      ),
    );
  }
  if (status.shadowedCount > 0) {
    tipItems.push(
      el(
        'li',
        {},
        `${status.shadowedCount}개 전역 스킬이 로컬 스킬에 가려져 있습니다. `,
        tabLink('스킬 탭 열기', 'skills'),
      ),
    );
  }
  // First-run onboarding: a pristine project (no hub, no skills) gets a guided
  // hero at the very top and skips the tips section — the hero already guides the
  // user, so repeating "허브 없음" tips is redundant.
  const pristine = !status.hubExists && status.skills.length === 0;
  const sections = [agentsSection, summarySection];
  if (pristine) {
    sections.unshift(onboardingHero());
  } else {
    const tipsSection = el(
      'section',
      { class: 'section' },
      el('h2', { text: '팁' }),
      tipItems.length > 0
        ? el('ul', { class: 'tips' }, ...tipItems)
        : el('div', { class: 'muted', text: '특별한 문제가 없습니다.' }),
    );
    sections.push(tipsSection);
  }

  main.replaceChildren(...sections);
}

// Guided first-run card: three numbered steps, each with a jump to the tab that
// gets it done.
function onboardingHero() {
  const step = (n, title, action) =>
    el(
      'li',
      { class: 'onboard-step' },
      el('span', { class: 'onboard-num', 'aria-hidden': 'true', text: String(n) }),
      el(
        'div',
        { class: 'onboard-body' },
        el('div', { class: 'onboard-step-title', text: title }),
        action,
      ),
    );
  return el(
    'section',
    { class: 'section onboard' },
    el('h2', { text: 'agman 시작하기' }),
    el('p', {
      class: 'muted onboard-lead',
      text: '세 단계로 문서 허브와 첫 스킬을 준비하세요.',
    }),
    el(
      'ol',
      { class: 'onboard-steps' },
      step(1, 'AGENTS.md 허브 만들기', tabLink('문서 탭 열기', 'docs')),
      step(2, '첫 스킬 만들기', tabLink('스킬 탭 열기', 'skills')),
      step(3, '스포크 문서 동기화', tabLink('문서 탭 열기', 'docs')),
    ),
  );
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
  // 이름: bold name (+ inline 가려짐 tag) over a mono locationKey:scope subtitle
  // (reuses the docs 파일-cell pattern via the shared .cell-sub style).
  const nameCell = el(
    'td',
    {},
    el(
      'div',
      { class: 'cell-title' },
      s.name,
      s.shadowed ? el('span', { class: 'badge badge-amber inline-tag', text: '가려짐' }) : null,
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
      el('button', { class: 'btn btn-sm', type: 'button', text: '편집', onclick: () => editSkill(s) }),
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: '복사',
        onclick: () => copySkillModal(s),
      }),
      el('button', {
        class: 'btn btn-sm danger',
        type: 'button',
        text: '삭제',
        onclick: () => deleteSkill(s),
      }),
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
  const actions = el('div', { class: 'row-actions' });
  if (d.exists) {
    actions.append(
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: '보기·편집',
        onclick: () => editDoc(d),
      }),
    );
  } else {
    actions.append(
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: '만들기',
        onclick: () => initDoc(d.key),
      }),
    );
  }
  if (d.role === 'spoke') {
    actions.append(
      el('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: '차이 보기',
        onclick: () => diffDoc(d),
      }),
    );
    if (d.isSymlink) {
      actions.append(
        el('button', {
          class: 'btn btn-sm',
          type: 'button',
          text: '링크 해제',
          onclick: () => unlinkDocAction(d),
        }),
      );
    } else {
      actions.append(
        el('button', {
          class: 'btn btn-sm',
          type: 'button',
          text: '링크',
          onclick: () => linkDocAction(d),
        }),
      );
    }
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
  setProjectPath(status.projectRoot);
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

function setProjectPath(p) {
  const node = document.getElementById('project-path');
  node.textContent = p || '';
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
  setTab('dashboard');
}

init();
