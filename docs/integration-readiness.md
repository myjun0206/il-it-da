# Integration Readiness Check

이 도구는 팀원 PR 병합 전후에 저장소의 충돌 흔적, 필수 파일과 스크립트, 마이그레이션 이름, RAG 임계값 및 명백한 비밀정보 노출 위험을 읽기 전용으로 점검합니다.

```bash
npm run check:integration
npm run test:integration
```

종료 코드는 다음과 같습니다.

- `0`: 필수 검사를 통과했습니다. warning은 있을 수 있습니다.
- `1`: 병합 또는 배포 전에 해결해야 할 error가 있습니다.
- `2`: CLI 인자나 점검 실행 자체에 문제가 있습니다.

`error`는 통합 차단 문제이며, `warning`은 확인이 필요하지만 검사 실패로 처리하지 않는 항목입니다. `info`는 현재 저장소 상태를 안내합니다. 도구는 어떤 파일도 자동 수정하지 않습니다.

이 검사는 실제 DB 스키마, Supabase/OpenAI 연결 또는 API 동작을 검증하지 않습니다. 환경 파일의 값은 읽거나 출력하지 않고, Git이 추적하는 환경 파일의 이름만 확인합니다. 팀원 작업 범위인 007, 008, 009 마이그레이션은 현재 필수 파일이나 필수 번호로 검사하지 않습니다.

팀원 PR을 병합한 뒤에는 다음 순서를 권장합니다.

1. `npm run check:integration`
2. `npm run test:integration`
3. `npm run test:rag`
4. `npm run test:rag-eval`
5. `npm run lint`
6. `npm run typecheck`
7. `npm run build`

`npm run typecheck`는 `next typegen`을 먼저 실행해 라우트/레이아웃 전역 타입(`LayoutProps` 등)을 생성한 뒤 `tsc --noEmit`을 실행합니다. `.next`가 없는 clean clone에서 `next typegen` 없이 바로 `npx tsc --noEmit`만 실행하면 `Cannot find name 'LayoutProps'` 오류가 발생하므로, 항상 `npx tsc --noEmit` 대신 `npm run typecheck`를 사용하세요.

## PoC 통합 검증 한 번에 실행하기 (`npm run verify:poc`)

위 7단계를 개발자가 매번 순서대로 직접 입력하지 않도록, `scripts/verify-poc.mjs`가 동일한 순서를
자동으로 실행합니다.

```bash
npm run verify:poc
```

- 단계는 반드시 `check:integration → test:integration → test:rag → test:rag-eval → lint → typecheck(npm run typecheck) → build` 순서로 하나씩 실행되며, 이전 단계가 성공해야 다음 단계가 실행됩니다. `typecheck` 단계는 `next typegen`과 `tsc --noEmit`을 함께 포함하므로 clean clone에서도 별도 준비 없이 통과합니다.
- 어떤 단계든 실패하면 그 즉시 중단하고 실패한 단계 이름과 종료 코드만 표준 에러에 출력합니다. 이후 단계는 실행되지 않고, 실패한 단계의 종료 코드가 그대로 프로세스 종료 코드로 보존됩니다.
- 모든 단계가 성공하면 통과한 단계 수와 `PASS`만 표준 출력에 남습니다.
- 이 러너는 각 단계의 명령 전체 문자열, 환경변수 값, 파일 내용, 질문·답변 원문, UUID, API 키, 토큰을 별도로 출력하지 않습니다. 각 자식 프로세스(예: 테스트, 빌드)의 정상 출력은 그대로 콘솔에 표시됩니다.
- Windows PowerShell, macOS, Linux, GitHub Actions에서 동일하게 동작하도록 Node.js `child_process`만 사용하며 셸 전용 문법에 의존하지 않습니다.
- 이 명령은 실제 Supabase/OpenAI 호출을 추가하지 않으며, 기존 `check:integration`/`test:integration`/`test:rag`/`test:rag-eval`/`lint`/`build`가 하던 동작만 순서대로 실행합니다.

## 프론트엔드 품질 게이트 (`npm run check:frontend`)

프론트엔드 작업자(예: UI/페이지/컴포넌트 변경)가 PR을 올리기 전에 로컬에서 미리 실행하는 명령입니다.
`scripts/check-frontend.mjs`는 `scripts/verify-poc.mjs`의 단계 실행기(fail-fast, 실패 단계 종료 코드
보존, `Passed steps: N/N` + `PASS` 출력 계약)를 그대로 재사용합니다.

```bash
npm run check:frontend
```

단계는 반드시 다음 순서로 하나씩 실행되며, 이전 단계가 성공해야 다음 단계가 실행됩니다.

1. `lint`
2. `typecheck` (`npm run typecheck`: `next typegen` → `tsc --noEmit`)
3. `build` (`next build`)
4. `git diff --check` (현재 작업트리의 trailing whitespace/충돌 마커 검사)
5. `test:frontend` (라우트 엔트리 파일 존재, `/hq`·`/boss`·`/staff` 레이아웃의 `requireServerRole`+
   `force-dynamic` 유지, client component가 server-only 역할 가드를 import하지 않는지, 저장소에
   Git 충돌 마커가 없는지 확인하는 정적 구조 테스트)

`git diff --check` 단계는 커밋 전 작업트리 상태만 검사합니다. 이미 커밋된 내용에 남아있는 공백
문제는 잡지 못하므로, 커밋하기 직전에 로컬에서 실행하는 것이 가장 효과적입니다. GitHub Actions는
PR과 develop push 시 동일한 `npm run check:frontend`를 실행해 로컬과 같은 방식으로 검증합니다.

### 프론트엔드 작업 절차

1. 항상 최신 `develop`에서 새 작업 브랜치를 만듭니다. `develop`에 직접 push하지 않습니다.
2. UI 변경과 DB/RAG migration 변경을 같은 PR에 섞지 않습니다.
3. PR을 올리기 전에 `npm run check:frontend`를 실행해 통과를 확인합니다.
4. GitHub Actions의 Quality Gate가 성공한 뒤에만 `develop`에 병합합니다.

## PR 템플릿 사용하기

GitHub에서 develop을 대상으로 PR을 생성하면 `.github/pull_request_template.md`가 자동으로
채워집니다. PR 설명에서 `npm run verify:poc` 통과 여부를 대표 검증으로 기록하고, 개별 명령은
`verify:poc`가 실패했거나 특정 단계만 다시 확인해야 할 때만 추가로 기록하세요. 마이그레이션·환경변수·
보안 점검 항목은 해당 사항이 없어도 지우지 말고 "N/A"로 표시합니다.