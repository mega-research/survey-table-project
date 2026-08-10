# Task 9 완료 보고서: 업로드 이력 — 모드 배지·제외 카운트

## 상태
**✓ DONE** — 모든 스텝 완료, tsc/lint 검증 통과, 커밋 성공

## 변경 내역

### 1. 쿼리·타입 확장 (contacts.server.ts)
- `ContactUploadMode` 임포트 추가
- `ContactUploadRow` 인터페이스에 `mode: ContactUploadMode`와 `skippedRows: number` 필드 추가
- `listContactUploads` select에 `mode`와 `skippedRows` 컬럼 추가

### 2. 테이블 확장 (upload-history-table.tsx)
- 모듈 스코프에 `MODE_LABEL`, `MODE_TONE` 상수 선언
  - replace: 교체 (bg-red-50 text-red-700)
  - merge: 병합 (bg-blue-50 text-blue-700)
  - append: 추가 (bg-emerald-50 text-emerald-700)
- 테이블 헤더 수정
  - "방식" 열 추가 (파일명 다음)
  - "머지" → "갱신" 변경
  - "제외" 열 추가 (갱신 다음)
- 테이블 바디에 모드 배지 및 제외 카운트 렌더링

## 검증 결과
```
✓ npx tsc --noEmit → 0 에러
✓ pnpm lint → 수정된 파일 내 경고/에러 0
✓ git status → 2파일만 커밋, 불필요 파일 제외
```

## 커밋 정보
- **SHA**: 4195397c
- **메시지**: `feat: 업로드 이력에 모드 배지와 제외 카운트 표시`
- **파일 수**: 2개
  - `src/lib/operations/contacts.server.ts`
  - `src/components/operations/contacts/upload-history-table.tsx`

## 비고
- 브리프 요구사항 100% 충족
- UI 텍스트 한국어, 이모지 미사용
- MODE_LABEL/MODE_TONE 상수는 컴포넌트 외 모듈 스코프에 선언
