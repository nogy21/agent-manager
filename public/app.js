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

function closeModal() {
  document.getElementById('modal-root').replaceChildren();
}

function cancelBtn() {
  return el('button', { class: 'btn', type: 'button', text: '취소', onclick: closeModal });
}

function openModal({ title, body, footer }) {
  closeModal();
  const overlay = el('div', { class: 'modal-overlay' });
  const modal = el(
    'div',
    { class: 'modal' },
    el(
      'div',
      { class: 'modal-head' },
      el('h3', { text: title }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', text: '×', onclick: closeModal }),
    ),
    el('div', { class: 'modal-body' }, body),
    footer ? el('div', { class: 'modal-foot' }, ...footer) : null,
  );
  overlay.append(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.getElementById('modal-root').append(overlay);
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
      el('td', {}, a.detected ? badge('감지됨', 'green') : badge('미감지', 'gray')),
      el('td', {}, instructionBadge(a.instruction.state)),
      el('td', { class: 'num', text: String(a.skillCount) }),
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
  const tipsSection = el(
    'section',
    { class: 'section' },
    el('h2', { text: '팁' }),
    tipItems.length > 0
      ? el('ul', { class: 'tips' }, ...tipItems)
      : el('div', { class: 'muted', text: '특별한 문제가 없습니다.' }),
  );

  main.replaceChildren(agentsSection, summarySection, tipsSection);
}

// ---- skills view ----

function skillRow(s) {
  const nameCell = el(
    'td',
    {},
    s.name,
    s.shadowed ? el('span', { class: 'badge badge-amber inline-tag', text: '가려짐' }) : null,
  );
  const locCell = el('td', { class: 'mono', title: s.path, text: `${s.locationKey}:${s.scope}` });
  const visible = s.enabled && s.visibleTo.length > 0 ? s.visibleTo.join(', ') : null;
  const visCell = el('td', {}, visible !== null ? visible : emDash());
  const isPlaceholder = !s.hasSkillMd || !s.description;
  const descCell = el('td', {
    class: isPlaceholder ? 'wrap muted' : 'wrap',
    text: s.hasSkillMd ? s.description || '(설명 없음)' : '(SKILL.md 없음)',
  });
  const statusCell = el('td', {}, s.enabled ? badge('활성', 'green') : badge('비활성', 'red'));

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

  return el('tr', {}, nameCell, locCell, visCell, descCell, statusCell, actions);
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
  const textarea = el('textarea', { spellcheck: 'false' });
  textarea.value = data.content;
  const save = el('button', {
    class: 'btn primary',
    type: 'button',
    text: '저장',
    onclick: async () => {
      try {
        await api('PUT', '/api/skills/content', {
          name: s.name,
          locationKey: s.locationKey,
          scope: s.scope,
          content: textarea.value,
        });
        toast(`저장됨: ${s.name}`);
        closeModal();
        render();
      } catch (err) {
        toast(err.message, 'err');
      }
    },
  });
  openModal({
    title: `편집 · ${s.name} (${s.locationKey}:${s.scope})`,
    body: textarea,
    footer: [cancelBtn(), save],
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

async function deleteSkill(s) {
  if (!confirm(`스킬 "${s.name}" (${s.locationKey}:${s.scope}) 을(를) 삭제할까요?`)) return;
  try {
    await api('POST', '/api/skills/delete', {
      name: s.name,
      locationKey: s.locationKey,
      scope: s.scope,
    });
    toast(`삭제됨: ${s.name}`);
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
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

  const listSection = el(
    'section',
    { class: 'section' },
    el('h2', { text: '스킬 목록' }),
    skills.length > 0
      ? tableWrap(
          ['이름', '위치', '보이는 에이전트', '설명', '상태', { text: '작업', cls: 'col-actions' }],
          skills.map(skillRow),
        )
      : el('div', { class: 'empty', text: '스킬이 없습니다.' }),
  );

  main.replaceChildren(createSection, listSection);
}

// ---- docs view ----

function docStatusBadge(d) {
  if (d.isSymlink) return d.exists ? badge('심링크', 'cyan') : badge('깨진 링크', 'amber');
  return d.exists ? badge('있음', 'green') : badge('없음', 'gray');
}

function docSyncBadge(d) {
  if (d.sync === 'n/a') return emDash();
  const map = {
    hub: ['hub', 'blue'],
    'in-sync': ['동기화됨', 'green'],
    diverged: ['불일치', 'amber'],
    linked: ['심링크', 'cyan'],
    missing: ['없음', 'gray'],
  };
  const [text, cls] = map[d.sync] || [d.sync, 'gray'];
  return badge(text, cls);
}

function docRow(d, status) {
  const fileCell = el(
    'td',
    {},
    el('div', { class: 'doc-file', text: d.label }),
    el('div', { class: 'doc-path', title: d.path, text: shortenPath(d.path, status) }),
  );
  const scopeCell = el(
    'td',
    {},
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
    scopeCell,
    el('td', {}, docStatusBadge(d)),
    el('td', {}, docSyncBadge(d)),
    el(
      'td',
      { class: 'num' },
      d.size !== undefined && d.size !== null ? humanSize(d.size) : emDash(),
    ),
    el('td', { class: 'num mono' }, d.mtime ? formatMtime(d.mtime) : emDash()),
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
  const textarea = el('textarea', { spellcheck: 'false' });
  textarea.value = data.content;
  const save = el('button', {
    class: 'btn primary',
    type: 'button',
    text: '저장',
    onclick: async () => {
      try {
        await api('PUT', '/api/docs/content', { key: d.key, content: textarea.value });
        toast(`저장됨: ${d.label}`);
        closeModal();
        render();
      } catch (err) {
        toast(err.message, 'err');
      }
    },
  });
  openModal({ title: `편집 · ${d.label}`, body: textarea, footer: [cancelBtn(), save] });
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
  const col = (title, content) =>
    el('div', { class: 'diff-col' }, el('h4', { text: title }), el('pre', { text: content }));
  const body = el(
    'div',
    {},
    el('div', {
      class: 'muted mb-10',
      text: data.same ? '허브와 동일합니다.' : '허브와 다릅니다.',
    }),
    el(
      'div',
      { class: 'diff-grid' },
      col(`${data.hub.label} (허브)`, data.hub.content),
      col(`${data.spoke.label} (스포크)`, data.spoke.content),
    ),
  );
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
        '스코프',
        '상태',
        'SYNC',
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

async function render() {
  const main = document.getElementById('main');
  try {
    await views[current](main);
  } catch (err) {
    toast(err.message, 'err');
    main.replaceChildren(el('div', { class: 'empty', text: `불러오기 실패: ${err.message}` }));
  }
}

function setTab(name) {
  current = name;
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  render();
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
