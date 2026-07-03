# agent-manager (agman)

**Claude Code의 스킬과 메모리 문서(CLAUDE.md · AGENTS.md)를 전역·프로젝트 스코프에 걸쳐 한 곳에서 관리하는 CLI.**

_A single CLI to manage Claude Code skills and memory docs across global and project scopes._

## 무엇을 해결하나요?

Claude Code의 설정은 두 곳에 흩어져 있습니다. 개인 기본값은 전역(`~/.claude`)에, 저장소별 규칙은 프로젝트 루트에 놓이고, 여기에 스킬 디렉터리와 여러 개의 메모리 문서(`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`)가 더해집니다. 어떤 스킬이 어느 스코프에 있는지, 로컬 스킬이 전역 스킬을 가리는지(섀도잉), `CLAUDE.md`와 크로스 도구 표준인 `AGENTS.md`가 서로 어긋났는지를 손으로 추적하기는 번거롭습니다. `agman`은 이 모든 대상을 한 번에 나열하고 생성·편집·비교·동기화할 수 있게 해 줍니다.

| 파일 | 스코프 | 용도 |
| --- | --- | --- |
| `CLAUDE.md` | global · local | Claude Code 지침. 전역은 머신 전체 기본값, 로컬은 저장소 지침 |
| `CLAUDE.local.md` | local | 커밋하지 않는 개인·머신 로컬 메모 |
| `AGENTS.md` | local | 크로스 도구 에이전트 표준 문서 |
| `skills/` | global · local | SKILL.md를 담은 스킬 디렉터리 |

## 설치

요구 사항: **Node ≥ 18.17**.

```bash
git clone https://github.com/nogy21/agent-manager.git
cd agent-manager
npm install
npm run build
npm link
```

`npm link` 이후 `agman` 명령을 전역에서 사용할 수 있습니다.

> 아직 npm에 배포되지 않았습니다. 위와 같이 소스에서 빌드해 사용하세요.

## 빠른 시작

아래는 데모 프로젝트 `/home/user/demo/web-app`에서 실제로 실행한 출력입니다. (예시에서는 전역 스코프로 데모용 `/home/user/demo/.claude`를 사용했습니다. 기본값은 `~/.claude`입니다.)

빈 프로젝트의 현재 상태를 봅니다.

```console
$ agman status
project  /home/user/demo/web-app
global   /home/user/demo/.claude

Skills  local 0 · global 0
  no skills — create one with: agman skills create <name>

Docs
  CLAUDE.md        global  missing
  CLAUDE.md        local   missing
  CLAUDE.local.md  local   missing
  AGENTS.md        local   missing

tip: agman docs init claude
tip: agman docs init agents
```

스킬을 만듭니다. 전역과 로컬에 같은 이름(`pdf-tools`)을 만들면 로컬이 전역을 가립니다(섀도잉).

```console
$ agman skills create pdf-tools --global -d "Extract text and tables from PDF files"
created /home/user/demo/.claude/skills/pdf-tools/SKILL.md
edit it with: agman skills edit pdf-tools --global

$ agman skills create pdf-tools -d "Project PDF extraction with our schema"
created /home/user/demo/web-app/.claude/skills/pdf-tools/SKILL.md
edit it with: agman skills edit pdf-tools

$ agman skills create commit-helper -d "Write conventional commit messages from a diff"
created /home/user/demo/web-app/.claude/skills/commit-helper/SKILL.md
edit it with: agman skills edit commit-helper

$ agman skills list
NAME                  SCOPE   DESCRIPTION
--------------------  ------  ----------------------------------------------
commit-helper         local   Write conventional commit messages from a diff
pdf-tools             local   Project PDF extraction with our schema
pdf-tools (shadowed)  global  Extract text and tables from PDF files
```

`pdf-tools (shadowed)`는 같은 이름의 로컬 스킬이 존재하는 전역 스킬입니다 — Claude Code는 로컬 쪽을 사용합니다.

메모리 문서를 템플릿에서 생성합니다.

```console
$ agman docs init claude
created /home/user/demo/web-app/CLAUDE.md

$ agman docs init agents
created /home/user/demo/web-app/AGENTS.md
```

두 문서는 템플릿이 다르므로 `docs diff`가 차이를 보여 줍니다. (`git`이 있으면 컬러 diff, 없으면 간단한 라인 diff로 대체됩니다.)

```console
$ agman docs diff
diff --git a/home/user/demo/web-app/CLAUDE.md b/home/user/demo/web-app/AGENTS.md
index bbb340a..d631e98 100644
--- a/home/user/demo/web-app/CLAUDE.md
+++ b/home/user/demo/web-app/AGENTS.md
@@ -1,6 +1,6 @@
-# CLAUDE.md
+# AGENTS.md

-Guidance for Claude Code when working in this repository.
+<!-- Cross-tool agent instructions (the AGENTS.md standard), shared by Claude Code and other coding agents. -->

 ## Project overview

@@ -10,14 +10,6 @@ Describe what this project does in a sentence or two.

 List the build, test, lint, and run commands.

-## Architecture
-
-Outline the main modules and how they fit together.
-
 ## Conventions

 Note coding standards, naming, and patterns to follow.
-
-## Gotchas
-
-Call out non-obvious pitfalls and things to avoid.
```

`CLAUDE.md`를 정본으로 삼아 `AGENTS.md`에 내용을 복사(스냅숏)합니다. 이후 두 문서는 동일합니다.

```console
$ agman docs sync --source claude
synced CLAUDE.md → AGENTS.md

$ agman docs diff
CLAUDE.md and AGENTS.md are identical
```

이제 종합 상태를 다시 보면 스킬 요약과 섀도잉 개수, 문서 상태가 한눈에 들어옵니다.

```console
$ agman status
project  /home/user/demo/web-app
global   /home/user/demo/.claude

Skills  local 2 · global 1, 1 shadowed
  commit-helper         local   Write conventional commit messages from a diff
  pdf-tools             local   Project PDF extraction with our schema
  pdf-tools (shadowed)  global  Extract text and tables from PDF files

Docs
  CLAUDE.md        global  missing
  CLAUDE.md        local   ok       413 B  24  2026-07-03 14:49
  CLAUDE.local.md  local   missing
  AGENTS.md        local   ok       413 B  24  2026-07-03 14:49
```

스냅숏 복사 대신 하나의 정본만 유지하고 싶다면 `docs link`로 심링크를 겁니다. `AGENTS.md`가 `CLAUDE.md`를 가리키는 심링크가 되어 항상 같은 내용을 공유합니다.

```console
$ agman docs link --source claude --force
linked AGENTS.md → CLAUDE.md

$ agman docs list
FILE             SCOPE   STATUS               SIZE   LINES  MODIFIED
---------------  ------  -------------------  -----  -----  ----------------
CLAUDE.md        global  missing
CLAUDE.md        local   ok                   413 B  24     2026-07-03 14:49
CLAUDE.local.md  local   missing
AGENTS.md        local   symlink → CLAUDE.md  413 B  24     2026-07-03 14:49
```

## 명령어

전역 옵션: `-C, --cwd <dir>` — `agman`이 `<dir>`에서 시작한 것처럼 실행합니다.

### `agman skills`

| 명령 | 설명 | 주요 옵션 |
| --- | --- | --- |
| `skills list` | 전역·프로젝트 스킬 목록 | `--global`, `--local`, `--json` |
| `skills show <name>` | 스킬의 SKILL.md 출력 | `--global`, `--local` |
| `skills create <name>` | 템플릿으로 스킬 생성 | `--global`, `-d, --description <text>` |
| `skills edit <name>` | SKILL.md를 `$EDITOR`로 열기 | `--global`, `--local` |
| `skills rm <name>` | 스킬 디렉터리 삭제 | `--global`, `--local`, `-f, --force` |
| `skills copy <name>` | 스코프 간 스킬 복사 | `--to <global\|local>` (필수), `-f, --force` |

### `agman docs`

`<target>`은 `claude` · `agents` · `local`(= CLAUDE.local.md) 중 하나입니다.

| 명령 | 설명 | 주요 옵션 |
| --- | --- | --- |
| `docs list` | 스코프 전체의 문서 목록 | `--json` |
| `docs show <target>` | 문서 라벨·경로·내용 출력 | `--global` |
| `docs init <target>` | 템플릿으로 문서 생성 | `--global`, `-f, --force` |
| `docs edit <target>` | 문서를 `$EDITOR`로 열기 | `--global` |
| `docs diff` | 프로젝트 CLAUDE.md와 AGENTS.md 비교 | — |
| `docs link` | 한 문서를 다른 문서로 심링크 | `--source <claude\|agents>` (기본 `claude`), `-f, --force` |
| `docs sync` | 한 문서 내용을 다른 문서로 복사 | `--source <claude\|agents>` (필수) |

### `agman status`

| 명령 | 설명 | 주요 옵션 |
| --- | --- | --- |
| `status` | 스킬·메모리 문서 종합 요약 | `--json` |

## 경로 규칙

| 대상 | global | local (프로젝트 루트) |
| --- | --- | --- |
| Skills | `<globalRoot>/skills/<name>/` | `<projectRoot>/.claude/skills/<name>/` |
| CLAUDE.md | `<globalRoot>/CLAUDE.md` | `<projectRoot>/CLAUDE.md` |
| CLAUDE.local.md | (없음) | `<projectRoot>/CLAUDE.local.md` |
| AGENTS.md | (없음) | `<projectRoot>/AGENTS.md` |

- **globalRoot**: 기본값은 `~/.claude`. 환경 변수 `CLAUDE_CONFIG_DIR`가 설정되어 있으면 그 값으로 오버라이드합니다. 상대 경로를 주면 프로세스 cwd 기준으로 절대 경로로 변환됩니다.
- **projectRoot**: cwd에서 위로 올라가며 `.git` 또는 `.claude`를 가진 가장 가까운 디렉터리를 찾습니다. 없으면 cwd 자체를 사용합니다.
- **`-C, --cwd <dir>`**: 시작 디렉터리를 바꿉니다. 저장소 밖에서도 특정 프로젝트를 대상으로 실행할 때 유용합니다.

## 개념: 스코프와 섀도잉

**로컬 우선 원칙.** 전역 스킬과 프로젝트 스킬의 이름이 겹치면 Claude Code는 프로젝트(로컬) 쪽을 사용합니다. `agman`은 이때 가려진 전역 스킬에 `(shadowed)` 마커를 붙여, 무엇이 실제로 활성인지 헷갈리지 않게 합니다.

**AGENTS.md는 크로스 도구 표준.** `AGENTS.md`는 Claude Code뿐 아니라 다른 코딩 에이전트도 읽는 공용 지침 파일입니다. 많은 프로젝트가 같은 내용을 `CLAUDE.md`와 `AGENTS.md`에 함께 두려고 하며, `agman`은 두 방식을 지원합니다.

- **`docs link` — 단일 정본(심링크).** 한 파일을 다른 파일로 심링크합니다. 두 경로가 같은 내용을 가리키므로 한쪽을 고치면 자동으로 반영되고, 절대 어긋나지 않습니다.
- **`docs sync` — 스냅숏 복사.** 정본의 현재 내용을 다른 파일로 복사합니다. 복사 시점에는 같지만 이후에는 각자 독립적으로 바뀌므로, 다시 맞추려면 `sync`를 또 실행해야 합니다. 두 파일을 물리적으로 분리해 두고 싶을 때(예: 서로 다른 툴에 맞춰 미세하게 다르게) 쓰기 좋습니다.

## 개발

```bash
npm test        # vitest 스위트 실행
npm run typecheck  # tsc --noEmit 타입 검사
npm run build   # src/ → dist/ 컴파일
```

코어 함수는 `Context`(전역 루트·프로젝트 루트·cwd)를 인자로 받는 순수 함수라, 임시 디렉터리 픽스처(`mkdtemp` + `realpathSync`)만으로 단위 테스트할 수 있습니다. `process.cwd()`를 직접 만지지 않습니다. 각 기능은 파일시스템·도메인 로직을 담은 `core.ts`와 commander 배선·출력 포매팅을 담은 `commands.ts`로 분리되어 있고(`src/skills/`, `src/docs/`), 명령 계층은 `getCtx()`로 컨텍스트를 지연 생성합니다. `frontmatter` · `table` · `colors` · `run` · `editor` 유틸을 공유합니다.

## 로드맵

- 대화형 TUI로 스킬·문서를 탐색하고 편집
- 스킬 프런트매터(SKILL.md) lint — 이름·설명 규칙 검증
- 스킬 공유/가져오기 — 레지스트리나 git에서 스킬을 설치
- 문서 시작 템플릿 커스터마이즈

## License

MIT — 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
