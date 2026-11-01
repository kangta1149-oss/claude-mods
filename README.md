# claude-mods

Claude Code mod 모음. 저장소 루트가 설치 목록(marketplace) `claude-mods`이다.

## task-progress — 작업 진행률 사이드바 (mod)

위치: `task-progress/`

세션의 작업 체크리스트와 작업 중인 모델을 세로로 길게 보여 준다.

- 진행률: 완료 n/m · 퍼센트, 완료 n개 · 남은 작업 m개
- 표시 방식: 퍼센트 / 막대 / 도넛 중 선택 (Pane 위쪽 버튼, 또는 `/progress 퍼센트|막대|도넛`), 고른 방식은 기억한다
- 모델: 메인 모델과 추론 수준 (예: `Opus 5.5 · high`)
- 서브에이전트: 모델 · 추론 수준별 개수와 실행 중 개수 (예: `Haiku 4.5 · low ×2 · 실행 중 1`)
- 작업 목록: 원래 순서대로, 완료 ●(파란색으로 채움) / 진행 중 ◐ / 대기 ○
- `/progress`: Pane 열기 ↔ 닫기
- 자동 갱신: TaskCreate·TaskUpdate·TaskList(구형 TodoWrite 포함), 서브에이전트 시작·종료, 모델 요청마다

### 어디서 보이나

| 쓰는 곳 | 보이는 방식 |
| --- | --- |
| 내 컴퓨터의 Claude Code (터미널, 데스크톱 앱 Code 탭의 로컬 세션, VS Code) | 오른쪽 Pane, 실시간 |
| 클라우드 세션 (Claude 앱·claude.ai에서 연 세션) | Pane은 그려지지 않는다. 같은 내용이 작업 폴더의 `progress.md`에 갱신된다. Claude 앱은 .md 파일을 열자마자 정리된 화면으로 보여 준다. 막대·도넛·퍼센트와 작업 동그라미는 파일 안에 넣은 파란 그림(SVG)이다 |

`progress.md`를 쓰는 조건은 플러그인 설정 `progressFile`로 바꾼다: `auto`(기본, 클라우드에서만) / `always` / `off`.

### 설치

#### 내 컴퓨터 (각 컴퓨터에서 한 번)

사용자 범위(user)로 설치하면 그 컴퓨터의 모든 세션에서 불러온다. 터미널의 Claude Code 프롬프트에서:

```
/plugin install task-progress --marketplace kangta1149-oss/claude-mods
```

`Add marketplace?`에 `y`, 범위는 맨 위의 **user**를 선택한다.

셸에서:

```
claude plugin install task-progress --marketplace kangta1149-oss/claude-mods
```

데스크톱 앱(`/plugin`이 안 되는 곳): 프롬프트 옆 + → Plugins → Add marketplace에 `kangta1149-oss/claude-mods` → Add plugin.

공개 저장소라 GitHub 로그인은 필요 없지만, 그 컴퓨터에 Git이 설치되어 있어야 한다(Windows: `winget install --id Git.Git -e`). Claude Code는 터미널 2.1.287 이상, 데스크톱 앱 2.1.286 이상이 필요하다.

#### 클라우드 세션 (환경 설정 스크립트에 한 번)

클라우드 세션은 저장소 안의 플러그인 설정을 읽지 않고, 세션마다 새 컨테이너에서 시작한다. 그래서 클라우드 환경의 설정 스크립트에 아래 두 줄을 넣는다. 스크립트는 세션마다 Claude가 시작되기 전에 실행되므로, 그 환경으로 여는 모든 클라우드 세션에서, 어느 저장소에서 작업하든 mod를 불러온다. 결과가 캐시되므로 mod를 고친 뒤에는 스크립트를 한 글자라도 바꿔 저장해야 새 버전이 들어온다.

Claude 앱 오른쪽 패널의 환경 → 환경 이름 옆 톱니바퀴 → 설정 스크립트, 맨 아래 `exit 0` 바로 위에:

```
claude plugin marketplace add kangta1149-oss/claude-mods || true
claude plugin install task-progress@claude-mods --scope user --config progressFile=auto || true
```

클라우드에서는 Pane이 그려지지 않으므로 작업 폴더의 `progress.md`로 본다. 세션에서 "progress.md 열어 줘"라고 하면 된다.

### 새 버전 받기

- 내 컴퓨터: `claude plugin marketplace update claude-mods` 후 `claude plugin update task-progress@claude-mods`, 그리고 Claude Code를 다시 시작하거나 `/reload-plugins`
- 클라우드: 설정 스크립트 결과가 캐시되므로, 스크립트를 한 글자라도 바꿔 저장해야 다음 새 세션에서 새 버전을 받는다 (예: 2번째 줄 버전 표시 수정)

### 설치 확인

1. `claude plugin list` → `task-progress@claude-mods`, `Scope: user`, `Status: enabled`
2. 새 세션에서 `/progress` → 오른쪽에 Pane이 열린다 (항목이 없으면 `완료 0/0 · 0%`)
3. "할 일 3개를 체크리스트로 만들고 하나씩 처리해 줘" → 동그라미·퍼센트·모델 줄이 따라 바뀐다
4. Pane 위쪽 `퍼센트 / 막대 / 도넛` 버튼으로 표시 방식을 바꿔 본다
5. `/progress`를 한 번 더 입력하면 닫힌다
