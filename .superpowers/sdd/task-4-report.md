# Task 4 Report: matchPreview RPC — domain 스키마 + service + procedure + hook

## Status: DONE

## 변경 파일 (5개, 브리프와 정확히 일치)

- `src/features/contacts/domain/contact-upload.ts` — `MatchContactUploadInput`(zod)/`MatchContactUploadResultSchema`/`MatchContactUploadResult` 추가
- `src/features/contacts/server/services/contact-uploads.service.ts` — `matchContactUpload` + module-private 헬퍼 3개(`resolveEffectiveRouting`/`validateMergeKeys`/`loadExistingContacts`) 추가, import 확장(`contactPii`, `classifyRows`/`countEmptyOverwrites`, `getSchemeRouting`/`SchemeRouting`)
- `src/features/contacts/server/procedures/uploads.ts` — `matchPreview` procedure 추가 + `uploads` 라우터 등록
- `src/features/contacts/server/procedures/uploads.test.ts` — vi.mock 팩토리에 `matchContactUpload: vi.fn()` 추가, `matchPreview` 위임 테스트 추가
- `src/hooks/queries/use-contacts.ts` — `useMatchContacts()` 훅 추가

기존 함수(`parseExcelPreview`, `ingestContactUpload`, `autoGenerateColumnScheme`)는 수정하지 않음(추가만).

## TDD Evidence

1. **RED** — 테스트 추가 직후 (구현 전):
   ```
   ❯ src/features/contacts/server/procedures/uploads.test.ts (5 tests | 1 failed)
     × matchPreview는 File + mapping을 service.matchContactUpload에 위임한다
     TypeError: client.uploads.matchPreview is not a function
   Tests  1 failed | 4 passed (5)
   ```

2. **GREEN** — service/procedure/hook 구현 후:
   ```
   pnpm vitest run src/features/contacts/server/procedures/uploads.test.ts
   Test Files  1 passed (1)
   Tests  5 passed (5)
   ```
   기존 4개 테스트(parsePreview/ingest/existingCount 위임 + 인증 미들웨어) 모두 그대로 통과 — 회귀 없음.

3. **전체 contacts feature 스위트**:
   ```
   pnpm vitest run src/features/contacts
   Test Files  10 passed (10)
   Tests  37 passed (37)
   ```

4. **tsc**:
   ```
   npx tsc --noEmit
   → 0 에러 (출력 없음, npm 워닝만)
   ```

5. **lint**:
   ```
   pnpm lint
   ✖ 163 problems (0 errors, 163 warnings)
   ```
   163개 워닝은 전부 이번 태스크와 무관한 기존 파일들(any 타입, useCallback deps 등). 이번 변경 5개 파일 관련 워닝/에러 0건(grep 확인).

## Self-Review 체크리스트

- **resolveEffectiveRouting 3분기**: 헤더 키마다 (1) 기존 스킴에 `piiByKey[key]` 있으면 스킴 pii 채택 → (2) 없지만 `knownAttrKeys`에 있으면(기존 attrs 컬럼) 위저드 pii 무시하고 스킵 → (3) 둘 다 아니면(신규 키) 위저드 `piiMapping[key]` 채택. 브리프 그대로 구현.
- **validateMergeKeys**: `mergeKeys.length === 0` throw, 헤더에 없는 키 throw, `piiKeySet.has(key)` PII 키 throw — 3가지 모두 구현.
- **샘플 50건 절단 + excelRow 계산**: `toSamples`가 `indices.slice(0, SAMPLE_LIMIT)`으로 절단(카운트는 `classified.*.length` 전체 기준 별도 유지), `excelRow: mapping.headerRow + 1 + rowIndex` — 브리프 수식 그대로.
- **기존 uploads.test.ts 통과**: parsePreview/ingest/existingCount 위임 테스트 + 인증 미들웨어 테스트 4건 모두 GREEN 유지 확인.

## Commit

- `5346d632` `feat: 컨택 업로드 매칭 미리보기 RPC 추가`
- 스코프: 브리프 명시 5개 파일만 `git add` (untracked `prototypes/`, `tmp/`는 staged/커밋 대상에서 제외 확인).

## Notes for Task 5 (재사용 대상)

`resolveEffectiveRouting`/`validateMergeKeys`/`loadExistingContacts`는 `contact-uploads.service.ts` 내 module-private(export 없음) 함수로 구현됨. Task 5(ingest merge 모드)가 같은 파일 내에서 재사용 가능 — 파일 간 이동/export 승격이 필요하면 별도 처리 필요.
