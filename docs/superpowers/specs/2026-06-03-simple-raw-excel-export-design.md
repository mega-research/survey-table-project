# 간단 Raw Data 엑셀 추출 설계

작성일: 2026-06-03
브랜치: `feat/simple-raw-excel-export`

## 배경 / 목적

기존 엑셀 추출은 실태조사처럼 변수가 4만 개 넘어가면 다차원 매트릭스에 따라 시트를 나누는 로직이 복잡해 유지보수가 어렵다. 이 작업은 **시트 분리 없는 단순 Raw Data 추출**을 새 경로로 추가한다. 기존 추출(summary/map/sav)은 코드를 동결하고 UI 버튼만 숨긴다.

검증 대상: **2025년 인공지능산업 실태조사** (`surveyId=1d7153b0-f4fe-4ee6-ac54-ac81668e24ee`, 공공링크, 50문항, ~421개 SPSS 변수, 응답 122건 중 121건 추출 대상).

## 산출물 개요

`GET /api/surveys/{surveyId}/export?type=raw` 으로 **3개 시트짜리 단일 XLSX** 파일을 내려받는다.

- 시트 1 "응답 내역" — 응답자 메타(응답 내역 페이지 재현)
- 시트 2 "Raw Data" — 응답 × 변수 wide table (SPSS 코드값)
- 시트 3 "코딩북" — 변수 정의 + 값 라벨

파일명: `{surveyTitle}_RawData_{YYYY-MM-DD}.xlsx`

## 핵심 결정 사항 (확정)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 셀 값 인코딩 | SPSS 코드값(숫자). 라벨 텍스트 아님 |
| 2 | 응답 범위 | `deleted_at IS NULL AND status <> 'in_progress'` (= 121건) |
| 3 | 식별자 컬럼 | `require_invite_token=false`→`순번`(ROW_NUMBER), `true`→`systemID`(`contact_targets.resid`) |
| 4 | 기존 코드 | summary/map/sav 코드 동결, UI 버튼만 숨김 |
| 5 | API 경로 | 기존 `/export` route에 `?type=raw` 분기 추가 |
| 6 | 변수명 충돌 | 원인은 `isHidden` 셀 누락. `generateSPSSColumns`에 `isHidden` 필터 직접 추가(옵션 A) |

## 상세 설계

### 1. 엔드포인트

[src/app/api/surveys/[surveyId]/export/route.ts](../../../src/app/api/surveys/[surveyId]/export/route.ts)

- `ALLOWED_EXPORT_TYPES`에 `'raw'` 추가.
- `type=raw` 분기:
  1. 설문 + questions 조회, 기존과 동일하게 hydrate (`generateAllCellCodes`, `generateAllOptionCodes`).
  2. 응답 조회는 기존 `notDeletedResponse` 대신 **raw 전용 필터**(아래 2번) 사용.
  3. 식별자 모드 판단 + (토큰 설문이면) resid 매핑 조회.
  4. `generateRawDataWorkbook(...)` 호출 → XLSX 버퍼 반환.
- `MAX_EXPORT_RESPONSES`(10,000) 가드, `maxDuration=30` 유지.

### 2. 응답 범위 (공통 모수)

```sql
WHERE survey_id = :id
  AND deleted_at IS NULL
  AND status <> 'in_progress'
ORDER BY started_at ASC
```

- 세 시트 모두 동일 모수·동일 정렬·동일 행 순서를 사용한다.
- `started_at ASC` 정렬 결과의 1-based 인덱스가 곧 `순번`(idx).
- 현재 인공지능 실태조사: completed 79 + drop 42 = **121건** (in_progress 1건 제외).
- 향후 `bad`/`screened_out`/`quotaful_out` 상태가 생기면 자동 포함된다(in_progress만 제외 규칙).

### 3. 식별자 컬럼

설문 단위로 `survey.require_invite_token`으로 헤더와 값을 결정한다.

| 설문 유형 | 판단 | 헤더 | 값 |
|---|---|---|---|
| 공공 / 비공개 일반 링크 | `require_invite_token=false` | `순번` | ROW_NUMBER (1,2,3…) |
| 토큰 설문 (비공개 토큰 포함) | `require_invite_token=true` | `systemID` | `contact_targets.resid` |

- 토큰 설문인데 익명 응답(`contactTargetId IS NULL`)이면 systemID 칸은 공백.
- 시트1·시트2의 식별자 값은 **동일한 응답에 대해 같은 값**이어야 한다(행 매칭).
- resid 조회: 추출 대상 응답들의 `contact_target_id`를 모아 `contact_targets`에서 `id → resid` 맵을 한 번에 조회.

### 4. 시트 1 — "응답 내역"

[src/components/operations/profiles/profiles-table.tsx](../../../src/components/operations/profiles/profiles-table.tsx)의 컬럼 구성을 재현한다(헤더 1행).

| 식별자 | 조사 대상 그룹 | 접속 단말 | 브라우저 | 상태 | 시작일시 | 종료일시 | 소요시간 |
|---|---|---|---|---|---|---|---|

- 조사 대상 그룹 = `contact_targets.group_value` (공공이면 공백)
- 접속 단말 = `platform` → Desktop/Mobile/Tablet (`parsePlatform` 재사용)
- 상태 = status 라벨 텍스트
- 소요시간 = `formatTotalTime(totalSeconds)` 재사용
- 시작/종료일시 = 기존 LocalDateTime 포맷 문자열과 동일

profiles의 메타 조회는 `listResponsesForProfiles`(페이지네이션/필터 결합) 대신 **export 전용 단순 조회**를 새로 작성한다. 필요한 컬럼(idx/group_value/platform/browser/status/started_at/completed_at/total_seconds + contact resid)만 한 번에 가져온다.

### 5. 시트 2 — "Raw Data" (헤더 3행)

- 컬럼 = 첫 열 식별자(시트1과 동일 값) + `generateSPSSColumns(questions)` 변수 열들.
- 헤더 3행 구조:
  - 행1 = 질문 제목 (`column.questionText`)
  - 행2 = 셀 엑셀라벨 (아래 규칙)
  - 행3 = SPSS 변수명 (`column.spssVarName`)
- 행4~ = 응답별 SPSS 코드값 (`buildDataRows` 재활용). 미선택/미응답 = 빈칸.
- `XLSX.utils.aoa_to_sheet`로 2차원 배열 직접 구성(헤더 3행 + 데이터).

예시(테이블 셀):

```
행1: Q15. 귀사에서는 ... 활동을 수행하고 있습니까?
행2: 고영향 인공지능 기본권 영향평가_유무
행3: Q15_r01_c3
행4: 2
```

**헤더 행2(부가 라벨) 규칙**:
- 테이블 셀 계열(table-cell / table-cell-ranking / radio-group) → `cell.exportLabel` (없으면 공백)
- 옵션 분리 열(checkbox-item, ranking-rank 등) → 옵션 라벨 (예: "체크박스 문항 2")
- 단일 질문 1열(single radio/select, text) → 공백
- 구현: `SPSSExportColumn`에 `cellExportLabel?: string` 필드를 추가하고 `generateSPSSColumns`의 테이블 분기에서 `cell.exportLabel`을 실어 보낸다. 워크북 빌더는 `cellExportLabel ?? (옵션 분리 열이면 optionLabel) ?? ''`로 행2를 채운다.

**체크박스**: 옵션 수만큼 열 분리(`Q_1, Q_2, …`). 선택된 옵션 열에만 그 옵션의 `spssNumericCode`(응답값), 나머지 빈칸. (기존 `buildDataRows`의 `checkbox-item` 로직이 이미 `spssNumericCode ?? optionIndex+1`을 반환하므로 그대로 사용.)

### 6. "응답값" 매핑 보정 — 테이블 radio/select 셀

현재 [src/lib/spss/data-transformer.ts](../../../src/lib/spss/data-transformer.ts)의 `transformTableCell`은 radio/select 셀에서 raw value를 그대로 반환한다:

```js
case 'radio': case 'select':
  return typeof value === 'number' ? value : typeof value === 'string' ? value : null;
```

옵션 `value`가 "옵션1", "옵션2"처럼 플레이스홀더로 코딩된 설문에서는 이 문자열이 그대로 엑셀에 새어 나온다. 일반 라디오/체크박스는 `getNumericCode`로 `spssNumericCode`를 잘 쓰지만 **테이블 radio/select 셀만 누락**.

수정: 테이블 radio/select 셀도 셀 옵션(`cell.radioOptions`/`cell.selectOptions`)에서 `getNumericCode`로 `spssNumericCode`를 찾아 코드값으로 매핑한다.

- 구현 위치: `buildDataRows`의 `table-cell` 케이스에서, radio/select 셀이고 셀 옵션이 있으면 옵션 주입형 변환을 사용. `generateSPSSColumns`의 table-cell 컬럼에 `cellOptions`(radio/select 옵션)를 실어 보내거나, `questionMap`으로 셀을 역참조해 옵션을 찾는다.
- 빈값이면 비선택(빈칸) 유지.
- **이 변경은 sav export에도 공유되는 `buildDataRows`/`transformTableCell` 경로에 영향을 준다.** 이는 sav의 동일 버그도 함께 고치는 것이라 바람직하지만, 기존 sav/transformTableCell 테스트가 raw value 반환을 기대하고 있을 수 있으므로 구현 시 영향 범위를 점검한다.

### 7. 시트 3 — "코딩북"

- 변수 목록의 **단일 소스 = `generateSPSSColumns(questions)` 결과** → 시트2 헤더 행3과 1:1 일치.
- 컬럼 구성: `변수번호`(`optionCode`) / `SPSS 변수명` / `질문 제목` / `셀라벨`(`exportLabel`) / `값 라벨`
- **값 라벨을 `spssNumericCode`(응답값) 기반으로 생성** (기존 `Value: 옵션1` 플레이스홀더 제거):
  - radio/select/단일: `{spssNumericCode}={label}` 나열
  - checkbox 옵션 열: `빈값=비선택, {spssNumericCode}=선택`
  - 테이블 radio/select 셀: 셀 옵션 `spssNumericCode` 기반 나열
  - ranking: 기존 `resolveRankingOptions` + `spssNumericCode` 기반
- 기존 `generateVariableMap`(코딩북 함수)은 `generateSPSSColumns`와 변수 나열 방식이 달라 수치가 어긋난다. 새 코딩북은 `generateSPSSColumns` 기반으로 작성해 raw 시트와 정합성을 보장한다(기존 `generateVariableMap`은 동결).

### 8. 변수명 충돌 해결 — `isHidden` 셀 제외

**진단 결과(인공지능 실태조사 실데이터):**
- 전체 421열 중 변수명 충돌 12그룹 / 20열.
- 충돌에 연루된 셀 32개 중 **20개가 `isHidden=true`**.
- 각 충돌 그룹 = `isHidden=false` 셀 1개 + `isHidden=true`(병합으로 가려진) 셀 N개.
- **`isHidden` 셀 제외 시 → 401열, 충돌 0.**

**근본 원인:** [src/lib/analytics/spss-excel-export.ts](../../../src/lib/analytics/spss-excel-export.ts)의 `generateSPSSColumns` 테이블 메인 셀 루프(라인 217~)가 `cell.isHidden`을 거르지 않는다. 바로 위 `collectAndEmitRadioGroupColumns`는 `if (cell.isHidden) continue`로 거르는데 메인 루프만 누락. 병합(colspan/rowspan)으로 가려진 셀이 변수로 새어 나가 인접 셀과 같은 cellCode를 공유하면서 충돌.

**해결 (옵션 A — 사용자 확정):**
- `generateSPSSColumns` 테이블 메인 루프에 `if (cell.isHidden) continue;`를 추가한다.
- 이로써 raw export뿐 아니라 **기존 sav/map의 동일 버그(가려진 셀이 .sav로 새던 문제)도 함께 수정**된다.
- `cell.cellCode`는 **그대로 신뢰**해서 변수명으로 사용한다. 위치 기반 재생성/dedup 접미사는 도입하지 않는다(사용자의 셀코드 계층 설계를 보존). 행을 대/중/소/세분류로, 열을 변수 의미로 쓰는 코드 체계(`v01w10x03y11_a3b2c2` 등)는 사용자가 직접 설계한 cellCode가 정답이며 export가 갈아엎지 않는다.

**보류:** 셀코드 중복/빈값 경고 기능은 이번 충돌의 원인이 데이터가 아니라 코드 누락이었으므로 이번 범위에서 제외한다. 필요 시 별도 spec으로 후속.

### 9. UI 버튼 처리

[src/components/analytics/export-data-modal.tsx](../../../src/components/analytics/export-data-modal.tsx)가 export 모달이다. 현재 `ExportCard` 4개(cleaning / sav / summary / map)를 노출하며, `handleExport(type)`이 `/api/surveys/{surveyId}/export?type={type}`를 fetch한다(`cleaning`은 `onExportCleaningExcel` prop으로 클라이언트 측 처리 — 이것이 기존 다차원 매트릭스 추출로 추정).

- raw 추출용 `ExportCard`를 추가하고 `handleExport('raw')` 연결.
- 기존 cleaning/sav/summary/map 카드는 **삭제하지 않고 비노출**(조건부 렌더링 또는 주석)로 동결.
- `type=raw`는 `ext='xlsx'` 경로를 타도록 `handleExport`의 확장자 분기 확인.

## 변경 파일 요약

| 파일 | 변경 |
|---|---|
| `src/lib/analytics/spss-excel-export.ts` | (1) 테이블 메인 루프에 `isHidden` 필터 추가 (2) `SPSSExportColumn.cellExportLabel` 추가 + 주입 (3) table radio/select 코드 매핑용 옵션 주입 |
| `src/lib/spss/data-transformer.ts` 또는 `buildDataRows` | 테이블 radio/select 셀 `spssNumericCode` 매핑 |
| `src/lib/excel-transformer.ts` | `generateRawDataWorkbook(...)` 신규 (3시트 AOA). 기존 함수 무수정 |
| `src/app/api/surveys/[surveyId]/export/route.ts` | `type=raw` 분기 + raw 전용 응답/메타/resid 조회 |
| export 버튼 UI 컴포넌트 | summary/map/sav 숨김, raw 버튼 노출 |

## 테스트 (tests/ 디렉토리)

- `generateRawDataWorkbook` 단위 테스트:
  - 식별자 분기(공공 순번 / 토큰 systemID, 익명 응답 공백)
  - 헤더 3행 구성 + 행2 라벨 규칙
  - 체크박스 옵션별 열 분리 + `spssNumericCode`
  - 테이블 radio/select 셀 `spssNumericCode` 매핑(플레이스홀더 value 제거 확인)
  - 미응답 빈칸
  - 코딩북 값 라벨 포맷(`빈값=비선택, n=선택` 등)
- `generateSPSSColumns` 회귀: `isHidden` 셀 제외로 **변수명 중복 0** 보장. 기존 sav/map 테스트 영향 점검.
- 통합 검증: 인공지능 실태조사 실추출 → 121행 × (1+401)열, 변수명 유일, 코딩북·헤더 정합성.

## 알려진 영향 / 주의

- `isHidden` 필터와 테이블 radio/select 매핑 보정은 `generateSPSSColumns`/`buildDataRows` 공유 경로를 수정하므로 **기존 sav 출력이 달라진다**(가려진 셀 제거 + radio/select 코드값화). 이는 의도된 버그픽스이나 기존 테스트 스냅샷 갱신이 필요할 수 있다.
- ESLint 인프라가 깨져 있어(Next 16 + eslint 8 미스매치) `tsc + vitest + build`로 검증한다.
- vitest는 `tests/` 디렉토리만 include하므로 테스트는 거기에 둔다.
