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
6. `npx tsc --noEmit`
7. `npm run build`