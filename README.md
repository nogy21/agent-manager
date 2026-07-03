# agent-manager (agman)

**여러 AI 코딩 에이전트의 지시문(AGENTS.md · CLAUDE.md · GEMINI.md …)과 스킬을 전역·프로젝트 스코프에 걸쳐 한 곳에서 관리하는 CLI.**

_One CLI to manage the instruction docs and skills of many AI coding agents — across global and project scopes._

## 무엇이 달라졌나 (v0.2)

- **단일 도구 → 여섯 도구.** Claude Code뿐 아니라 OpenAI Codex · Cursor · GitHub Copilot · Gemini CLI · Windsurf까지 하나의 CLI로 다룹니다.
- **허브 & 스포크 문서 모델.** `AGENTS.md`를 허브로 두고 `CLAUDE.md` · `GEMINI.md`를 `docs sync` · `docs link` · `docs refresh`로 맞춥니다.
- **위치 기반 스킬 가시성**과 **로컬 웹 대시보드(`agman ui`)**, 그리고 설치된 AI CLI로 문서를 갱신하는 **`docs refresh`**가 새로 들어왔습니다.

## 왜 agman인가

에이전트마다 "지시문을 어느 파일에 쓰는지"와 "스킬을 어느 디렉터리에서 읽는지"가 제각각입니다. 어떤 도구는 크로스툴 표준인 `AGENTS.md`를 그대로 읽고, 어떤 도구는 자기 전용 파일이 필요합니다. 심링크로 한 정본을 공유해도 되는 도구가 있는가 하면, 심링크에 버그가 있어 반드시 복사해야 하는 도구도 있습니다. `agman`은 이 규칙들을 데이터로 알고 있어서, 무엇이 어디에 있어야 하는지 대신 추적해 줍니다.

| 도구 | 기본 지시문 파일 | 프로젝트 스킬 경로 | `AGENTS.md` 지원 |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` | `.claude/skills/` | 심링크 **공식 권장** (또는 복사) |
| OpenAI Codex | `AGENTS.md` | `.agents/skills/` | **네이티브** |
| Cursor | `AGENTS.md` | `.cursor/skills/` | **네이티브** (루트+중첩) |
| GitHub Copilot | `AGENTS.md` (+선택 `.github/copilot-instructions.md`) | `.github/skills/` | **네이티브** |
| Gemini CLI | `GEMINI.md` | `.gemini/skills/` | **복사** (심링크 미읽힘 버그 [#11547](https://github.com/google-gemini/gemini-cli/issues/11547)) |
| Windsurf | `AGENTS.md` | `.windsurf/skills/` | **네이티브** (루트+하위) |

즉 Codex · Cursor · Copilot · Windsurf는 `AGENTS.md`를 그대로 읽고, Claude Code는 `CLAUDE.md`(심링크가 공식 권장), Gemini는 `GEMINI.md`(심링크 버그 때문에 복사)를 씁니다. `agman`은 이 차이를 각 명령이 알아서 지켜 줍니다 — 예를 들어 `docs link`는 Claude만 허용하고 Gemini·Copilot에는 이유와 함께 대안을 안내합니다.

## 설치

요구 사항: **Node ≥ 18.17**.

```bash
git clone https://github.com/nogy21/agent-manager.git
cd agent-manager
npm install
npm run build
npm link      # 이후 어디서나 `agman` 사용
```

> 아직 npm에 배포되지 않았습니다. 위와 같이 소스에서 빌드해 사용하세요.

## 핵심 개념

### 허브 & 스포크 (문서)

`AGENTS.md`가 **허브**(크로스툴 표준, Codex·Cursor·Copilot·Windsurf가 직접 읽음)이고, `CLAUDE.md`·`GEMINI.md`가 **스포크**입니다. 스포크는 허브에서 복사되거나(스냅숏) 허브를 가리키는 심링크(단일 정본)로 유지됩니다.

```
                    AGENTS.md          ← 허브 (크로스툴 표준)
                   /         \
        docs sync /           \ docs link  (심링크, Claude 공식 권장)
                 v             v
            CLAUDE.md       GEMINI.md      ← 스포크 (허브에서 복사 또는 허브를 가리킴)
```

- `docs sync` — 허브 내용을 스포크로 **복사**(스냅숏). 이후 각자 독립적으로 바뀝니다.
- `docs link` — 스포크를 허브로 **심링크**(단일 정본). 절대 어긋나지 않습니다. Claude만 공식 지원하며, Gemini는 상단의 버그 때문에 거부하고 복사를 권합니다.
- `docs refresh` — 설치된 AI CLI에게 허브를 **다시 쓰게** 합니다(아래 참고).

### 스킬 위치 = 가시성

스킬은 "어느 디렉터리에 있느냐"가 곧 "어느 도구에 보이느냐"입니다. 같은 이름이 여러 곳에 있으면 로컬이 전역을 가립니다(섀도잉).

| 위치 (로컬) | 전역 | 보이는 도구 |
| --- | --- | --- |
| `.agents/skills/` | `~/.agents/skills/` | Codex · Cursor · Copilot · Gemini · Windsurf (크로스툴) |
| `.claude/skills/` | `<globalRoot>/skills/` | Claude Code · Copilot · Windsurf |
| `.cursor/skills/` | `~/.cursor/skills/` | Cursor |
| `.github/skills/` | `~/.copilot/skills/` | Copilot |
| `.gemini/skills/` | `~/.gemini/skills/` | Gemini CLI |
| `.windsurf/skills/` | `~/.codeium/windsurf/skills/` | Windsurf |

## 빠른 시작

아래는 데모 프로젝트 `/home/you/web-app`에서 **실제로 빌드된 CLI를 실행한 출력**입니다(임시 경로는 `/home/you`로 치환). `.claude` · `.agents` · `.cursor`가 있어 Claude Code · Codex · Cursor가 감지됩니다.

빈 프로젝트의 종합 상태를 봅니다 — 여섯 에이전트 매트릭스가 한눈에 들어옵니다.

```console
$ agman status
project  /home/you/web-app
global   /home/you/.claude

Agents
  AGENT           DETECTED  INSTRUCTIONS        SKILLS
  --------------  --------  ------------------  ------
  Claude Code     yes       AGENTS.md missing   0
  OpenAI Codex    yes       AGENTS.md (native)  0
  Cursor          yes       AGENTS.md (native)  0
  GitHub Copilot  no        AGENTS.md (native)  0
  Gemini CLI      no        AGENTS.md missing   0
  Windsurf        no        AGENTS.md (native)  0

Docs
  FILE                             SCOPE   STATUS   SYNC  SIZE  LINES  MODIFIED
  -------------------------------  ------  -------  ----  ----  -----  --------
  AGENTS.md                        local   missing  hub
  CLAUDE.md                        local   missing  -
  GEMINI.md                        local   missing  -
  .github/copilot-instructions.md  local   missing  -
  CLAUDE.local.md                  local   missing  -
  CLAUDE.md (global)               global  missing  -
  AGENTS.md (codex global)         global  missing  -

Skills  enabled 0 · disabled 0
  run: agman skills list

tip: agman docs init agents
no skills visible to: Claude Code, OpenAI Codex, Cursor
```

스킬을 만듭니다. 위치(`--loc`)가 곧 가시성입니다 — 생성 직후 `visible to`로 확인해 줍니다.

```console
$ agman skills create pdf-tools --loc agents -d "Extract text and tables from PDF files"
created /home/you/web-app/.agents/skills/pdf-tools/SKILL.md
visible to: codex, cursor, copilot, gemini-cli, windsurf
tip: agman skills copy pdf-tools --to claude

$ agman skills create commit-helper --loc claude -d "Write conventional commit messages from a diff"
created /home/you/web-app/.claude/skills/commit-helper/SKILL.md
visible to: claude-code, copilot, windsurf
tip: agman skills copy commit-helper --to agents

$ agman skills create house-style --global --loc claude -d "Our naming and formatting rules"
created /home/you/.claude/skills/house-style/SKILL.md
visible to: claude-code, copilot, windsurf
tip: agman skills copy house-style --to agents
```

`skills list`는 위치·가시성·설명을 한 표로 보여 줍니다.

```console
$ agman skills list
NAME           WHERE          VISIBLE TO                                    DESCRIPTION
-------------  -------------  --------------------------------------------  ----------------------------------------------
commit-helper  claude:local   claude-code, copilot, windsurf                Write conventional commit messages from a diff
house-style    claude:global  claude-code, copilot, windsurf                Our naming and formatting rules
pdf-tools      agents:local   codex, cursor, copilot, gemini-cli, windsurf  Extract text and tables from PDF files
```

스킬을 잠시 꺼 두면(디스크에는 남지만 어떤 도구에도 보이지 않음) `(disabled)`로 표시됩니다.

```console
$ agman skills disable house-style --global
disabled /home/you/.claude/skills.disabled/house-style

$ agman skills list
NAME           WHERE                     VISIBLE TO                                    DESCRIPTION
-------------  ------------------------  --------------------------------------------  ----------------------------------------------
commit-helper  claude:local              claude-code, copilot, windsurf                Write conventional commit messages from a diff
house-style    claude:global (disabled)  -                                             Our naming and formatting rules
pdf-tools      agents:local              codex, cursor, copilot, gemini-cli, windsurf  Extract text and tables from PDF files
```

이제 문서를 허브부터 세웁니다. `docs init agents`로 `AGENTS.md`를 만들고, `docs sync`로 감지된 스포크에 내려보냅니다.

```console
$ agman docs init agents
created /home/you/web-app/AGENTS.md

$ agman docs sync
synced /home/you/web-app/CLAUDE.md
```

`docs list`의 `SYNC` 컬럼이 허브·스포크 관계를 요약합니다(`hub` · `in sync` · `diverged` · `linked` · `-`).

```console
$ agman docs list
FILE                             SCOPE   STATUS   SYNC     SIZE   LINES  MODIFIED
-------------------------------  ------  -------  -------  -----  -----  ----------------
AGENTS.md                        local   ok       hub      572 B  26     2026-07-03 17:05
CLAUDE.md                        local   ok       in sync  572 B  26     2026-07-03 17:05
GEMINI.md                        local   missing  -
.github/copilot-instructions.md  local   missing  -
CLAUDE.local.md                  local   missing  -
CLAUDE.md (global)               global  missing  -
AGENTS.md (codex global)         global  missing  -
```

스냅숏 대신 단일 정본을 원하면 `docs link`로 `CLAUDE.md`를 허브 심링크로 승격합니다. 이후 두 파일은 절대 어긋나지 않습니다.

```console
$ agman docs link claude --force
linked CLAUDE.md → AGENTS.md

$ agman docs diff
hub /home/you/web-app/AGENTS.md  vs  spoke /home/you/web-app/CLAUDE.md
CLAUDE.md matches AGENTS.md
```

다시 종합 상태를 보면 스킬 수와 각 에이전트의 지시문 상태(네이티브 · 심링크 · 미설정)가 채워져 있습니다.

```console
$ agman status
project  /home/you/web-app
global   /home/you/.claude

Agents
  AGENT           DETECTED  INSTRUCTIONS           SKILLS
  --------------  --------  ---------------------  ------
  Claude Code     yes       CLAUDE.md → AGENTS.md  1
  OpenAI Codex    yes       AGENTS.md (native)     1
  Cursor          yes       AGENTS.md (native)     1
  GitHub Copilot  no        AGENTS.md (native)     2
  Gemini CLI      no        GEMINI.md missing      1
  Windsurf        no        AGENTS.md (native)     2

Docs
  FILE                             SCOPE   STATUS               SYNC    SIZE   LINES  MODIFIED
  -------------------------------  ------  -------------------  ------  -----  -----  ----------------
  AGENTS.md                        local   ok                   hub     572 B  26     2026-07-03 17:05
  CLAUDE.md                        local   symlink → AGENTS.md  linked  572 B  26     2026-07-03 17:05
  GEMINI.md                        local   missing              -
  .github/copilot-instructions.md  local   missing              -
  CLAUDE.local.md                  local   missing              -
  CLAUDE.md (global)               global  missing              -
  AGENTS.md (codex global)         global  missing              -

Skills  enabled 2 · disabled 1
  run: agman skills list
```

## 웹 대시보드

터미널 대신 브라우저로 훑고 싶다면 `agman ui`를 실행하세요.

```bash
agman ui                 # 127.0.0.1:4400 에 열고 브라우저 자동 실행
agman ui --port 5000     # 포트 지정
agman ui --no-open       # 브라우저 자동 실행 끄기
```

- **로컬 전용.** 오직 `127.0.0.1`(루프백)에만 바인딩합니다. 외부에서 접근할 수 없습니다.
- **토큰 보호.** 실행할 때마다 랜덤 토큰을 만들어 URL 프래그먼트로 전달하고, 모든 API 요청에 `x-agman-token` 헤더를 요구합니다. DNS 리바인딩을 막기 위해 `Host` 헤더도 루프백만 신뢰합니다.
- **탭 구성.** 대시보드(에이전트·문서·스킬 요약) / 스킬 / 문서 탭에서 CLI와 같은 코어를 그대로 사용합니다. 프레임워크 없이 `node:http`로 구현되어 있습니다.

## AI로 문서 갱신

`docs refresh`는 로컬에 설치·로그인된 AI 에이전트 CLI에게 "이 저장소를 보고 허브 문서를 최신으로 다시 써 달라"고 **일회성**으로 시킵니다.

```console
$ agman docs refresh --dry-run
would run: claude -p You are updating AGENTS.md, the agent-instructions hub of the repository at /hom…
```

- 지원 도구와 실행 형태: **Claude Code** `claude -p <프롬프트>` · **OpenAI Codex** `codex exec <프롬프트>` · **Gemini CLI** `gemini -p <프롬프트>`.
- `--tool` 없이 실행하면 `claude-code → codex → gemini-cli` 순으로 **처음 감지된** 도구를 씁니다. `--tool <id>`로 강제할 수 있고, `--doc <key>`로 다른 문서를 대상으로 할 수 있습니다(기본 `agents`).
- 해당 CLI가 **설치·로그인**되어 있어야 합니다. 아무것도 없으면 실행을 거부하고 설치 방법으로 강등 안내합니다.

```console
$ agman docs refresh
error: no supported AI agent CLI found on PATH. Install one:
  - claude-code: npm install -g @anthropic-ai/claude-code (then `claude` once to log in)
  - codex: npm install -g @openai/codex (then `codex` once to log in)
  - gemini-cli: npm install -g @google/gemini-cli (then `gemini` once to log in)
```

도구가 문서를 고친 뒤에는 `agman docs diff`로 확인하고 `agman docs sync`로 스포크에 전파하세요. (도구가 자체 출력을 스트리밍하므로 화면은 그 도구의 UI를 그대로 보여 줍니다.)

## 명령어 레퍼런스

전역 옵션: `-C, --cwd <dir>` — `agman`이 `<dir>`에서 시작한 것처럼 실행합니다.

### `agman skills` (9)

| 명령 | 설명 | 주요 옵션 |
| --- | --- | --- |
| `skills list` | 모든 위치의 스킬 목록 | `--global`, `--local`, `--agent <id>`, `--enabled-only`, `--json` |
| `skills show <name>` | 스킬의 SKILL.md 출력 | `--global`, `--local`, `--loc <key>` |
| `skills create <name>` | 템플릿으로 스킬 생성 | `--global`, `-d <text>`, `--loc <key>` (기본 `agents`) |
| `skills edit <name>` | SKILL.md를 `$EDITOR`로 열기 | `--global`, `--local`, `--loc <key>` |
| `skills rm <name>` | 스킬 디렉터리 삭제 | `--global`, `--local`, `--loc`, `-f` (필수) |
| `skills copy <name>` | 스킬을 다른 위치로 복사 | `--to <key>`, `--global`, `-f` |
| `skills install <path>` | 파일시스템의 스킬을 위치에 설치 | `--to <key>`, `--global`, `-f` |
| `skills enable <name>` | 비활성 스킬 활성화 | `--global`, `--local`, `--loc` |
| `skills disable <name>` | 스킬 비활성화(모두에게 숨김) | `--global`, `--local`, `--loc` |

### `agman docs` (9)

문서 키: `agents` · `claude` · `gemini` · `copilot` · `claude-local`(별칭 `local`) · `claude-global` · `codex-global` · `gemini-global` · `windsurf-global`.

| 명령 | 설명 | 주요 옵션 |
| --- | --- | --- |
| `docs list` | 에이전트·스코프별 문서 목록 | `--all`, `--json` |
| `docs show <key>` | 문서 라벨·경로·내용 출력 | — |
| `docs init <key>` | 템플릿으로 문서 생성 | `-f` |
| `docs edit <key>` | 문서를 `$EDITOR`로 열기 | — |
| `docs sync` | 허브를 스포크로 복사 | `--from <key>` (기본 `agents`), `--to <key...>` |
| `docs link <key>` | 스포크를 허브로 심링크 (Claude만) | `-f` |
| `docs unlink <key>` | 심링크 스포크를 실제 복사본으로 되돌림 | — |
| `docs diff [key]` | 스포크를 허브와 비교 (기본 `claude`) | — |
| `docs refresh` | 설치된 AI CLI로 허브 문서 갱신 | `--tool <id>`, `--doc <key>`, `--dry-run` |

### `agman status` · `agman ui`

| 명령 | 설명 | 주요 옵션 |
| --- | --- | --- |
| `status` | 에이전트·문서·스킬 종합 요약 | `--json` |
| `ui` | 로컬 웹 대시보드 실행 | `--port <n>` (기본 4400), `--no-open` |

## 경로 규칙

| 대상 | 로컬 (프로젝트 루트) | 전역 |
| --- | --- | --- |
| `AGENTS.md` (허브) | `AGENTS.md` | `~/.codex/AGENTS.md` (Codex) |
| `CLAUDE.md` | `CLAUDE.md` | `<globalRoot>/CLAUDE.md` |
| `GEMINI.md` | `GEMINI.md` | `~/.gemini/GEMINI.md` |
| Copilot 지시문 | `.github/copilot-instructions.md` | — |
| Windsurf 전역 규칙 | — | `~/.codeium/windsurf/memories/global_rules.md` |
| 크로스툴 스킬 | `.agents/skills/` | `~/.agents/skills/` |
| Claude 스킬 | `.claude/skills/` | `<globalRoot>/skills/` |

- **globalRoot**: 기본값 `~/.claude`. 환경 변수 `CLAUDE_CONFIG_DIR`로 오버라이드하며, 상대 경로를 주면 프로세스 cwd 기준으로 절대 경로화됩니다.
- **projectRoot**: cwd에서 위로 올라가며 `.git` 또는 `.claude`를 가진 가장 가까운 디렉터리를 찾습니다. 없으면 cwd를 씁니다.
- **`-C, --cwd <dir>`**: 시작 디렉터리를 바꿔 저장소 밖에서도 특정 프로젝트를 대상으로 실행합니다.

## 개발

```bash
npm test           # vitest 스위트 (190+ 테스트)
npm run typecheck  # tsc --noEmit 타입 검사
npm run build      # src/ → dist/ 컴파일
```

코어 함수는 `Context`(`globalRoot`·`projectRoot`·`cwd`·`home`)를 인자로 받는 순수 함수라, 임시 디렉터리 픽스처(`mkdtemp` + `realpathSync`)만으로 단위 테스트할 수 있고 `process.cwd()`를 직접 만지지 않습니다. 지원 도구·스킬 위치·문서 역할·심링크 안전성은 모두 `src/agents/registry.ts`의 데이터 테이블에서 파생되므로, 새 도구는 호출부가 아니라 그 테이블만 고쳐 추가합니다. 각 기능은 파일시스템·도메인 로직의 `core.ts`와 commander 배선·출력의 `commands.ts`로 분리되어 있고(`src/skills/`, `src/docs/`), 웹 대시보드(`src/ui/`)는 프레임워크 없이 `node:http`로 같은 코어를 재사용합니다.

## 로드맵

- 스킬을 git 저장소·레지스트리에서 설치(`skills install` 확장)
- `.cursor/rules` · `.windsurf/rules` 규칙 파일 관리
- Electron/Tauri 데스크톱 셸
- `watch` 모드 — 파일 변경 시 허브·스포크 자동 동기화

## License

MIT — 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
