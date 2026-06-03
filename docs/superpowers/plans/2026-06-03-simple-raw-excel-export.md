# 간단 Raw Data 엑셀 추출 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시트 분리 없는 3시트 단일 XLSX(`?type=raw`)로 설문 응답을 코드값 raw data + 응답 내역 + 코딩북으로 추출한다.

**Architecture:** 기존 `generateSPSSColumns`/`buildDataRows`를 재활용해 변수 열과 코드값을 만들고, `generateRawDataWorkbook`이 3시트를 조립한다. 변수명 충돌 원인인 `isHidden` 셀 누락을 `generateSPSSColumns`에서 직접 수정한다. 기존 summary/map/sav는 코드 동결, UI 버튼만 숨긴다.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, xlsx(SheetJS), Drizzle ORM, Vitest.

**Spec:** [docs/superpowers/specs/2026-06-03-simple-raw-excel-export-design.md](../specs/2026-06-03-simple-raw-excel-export-design.md)

**검증 대상:** 2025년 인공지능산업 실태조사 `surveyId=1d7153b0-f4fe-4ee6-ac54-ac81668e24ee` (공공, 50문항, ~401 변수, 121건).

**참고 — 검증 방식:** ESLint 인프라가 깨져 있어(Next16 + eslint8) `pnpm lint` 대신 `npx tsc --noEmit` + `npx vitest run` + (필요 시) `pnpm build`로 검증한다. vitest는 `tests/` 디렉토리만 include한다. DB 접속 스크립트는 `npx tsx --env-file=.env.local <file>`로 실행한다.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/lib/analytics/spss-excel-export.ts` | SPSS 열/데이터 정의 | isHidden 필터, `cellExportLabel` 필드+주입, table radio/select 옵션 주입 |
| `src/lib/spss/data-transformer.ts` | 셀 값 변환 | table radio/select `spssNumericCode` 매핑 헬퍼 |
| `src/lib/excel-transformer.ts` | 워크북 생성 | `generateRawDataWorkbook` 신규 (기존 함수 무수정) |
| `src/lib/analytics/raw-export-helpers.ts` (신규) | raw 전용 pure 헬퍼 | 날짜 포맷, 코딩북 값라벨 빌더 |
| `src/app/api/surveys/[surveyId]/export/route.ts` | API 라우트 | `type=raw` 분기 + 조회 |
| `src/components/analytics/export-data-modal.tsx` | export UI | raw 카드 추가, 기존 카드 숨김 |
| `tests/unit/features/raw-export/*.test.ts` (신규) | 단위 테스트 | 헬퍼/워크북 |
| `tests/integration/spss/spss-excel-export.test.ts` | 기존 테스트 | isHidden 회귀 케이스 추가 |

---

## Task 1: `generateSPSSColumns` — isHidden 필터 + cellExportLabel

**Files:**
- Modify: `src/lib/analytics/spss-excel-export.ts`
- Test: `tests/integration/spss/spss-excel-export.test.ts`

- [ ] **Step 1: 회귀 테스트 작성 (isHidden 셀 제외 + cellExportLabel 주입)**

`tests/integration/spss/spss-excel-export.test.ts`의 `describe('generateSPSSColumns', ...)` 블록 안에 추가:

```ts
it('isHidden 테이블 셀은 변수 열에서 제외한다', () => {
  const q: Question = {
    id: 'q1', type: 'table', title: 'Q1', order: 1, required: false,
    questionCode: 'Q1',
    tableColumns: [
      { id: 'c1', label: '항목', columnCode: 'c1' },
      { id: 'c2', label: '값', columnCode: 'c2' },
    ],
    tableRowsData: [
      { id: 'row1', label: '행1', rowCode: 'r1', cells: [
        { id: 'cellA', type: 'text', content: '항목', cellCode: 'Q1_r1_c1' },
        { id: 'cellB', type: 'radio', content: '', cellCode: 'Q1_r1_c2',
          radioOptions: [{ id: 'o1', label: '예', value: 'opt1', spssNumericCode: 1 }] },
        { id: 'cellC', type: 'radio', content: '', cellCode: 'Q1_r1_c2', isHidden: true,
          radioOptions: [{ id: 'o1', label: '예', value: 'opt1', spssNumericCode: 1 }] },
      ] },
    ],
  } as unknown as Question;

  const cols = generateSPSSColumns([q]);
  const tableCols = cols.filter((c) => c.type === 'table-cell');
  expect(tableCols).toHaveLength(1);
  expect(tableCols[0].spssVarName).toBe('Q1_r1_c2');
});

it('테이블 셀 컬럼에 cellExportLabel을 실어 준다', () => {
  const q: Question = {
    id: 'q1', type: 'table', title: 'Q1', order: 1, required: false,
    questionCode: 'Q1',
    tableColumns: [{ id: 'c2', label: '값', columnCode: 'c2' }],
    tableRowsData: [
      { id: 'row1', label: '행1', rowCode: 'r1', cells: [
        { id: 'cellB', type: 'radio', content: '', cellCode: 'Q1_r1_c2', exportLabel: '영향평가_유무',
          radioOptions: [{ id: 'o1', label: '예', value: 'opt1', spssNumericCode: 1 }] },
      ] },
    ],
  } as unknown as Question;

  const col = generateSPSSColumns([q]).find((c) => c.type === 'table-cell');
  expect(col?.cellExportLabel).toBe('영향평가_유무');
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run tests/integration/spss/spss-excel-export.test.ts -t "isHidden"`
Expected: FAIL (isHidden 셀이 포함되어 2개 열 / `cellExportLabel` undefined)

- [ ] **Step 3: `SPSSExportColumn`에 `cellExportLabel` 필드 추가**

`src/lib/analytics/spss-excel-export.ts`의 `SPSSExportColumn` 인터페이스에 추가 (`optionId?` 근처):

```ts
  // 테이블 셀 계열 전용: 코딩북/헤더 행2에 쓰는 셀 엑셀라벨
  cellExportLabel?: string;
```

- [ ] **Step 4: 테이블 메인 루프에 isHidden 필터 추가**

`src/lib/analytics/spss-excel-export.ts`의 테이블 분기 메인 루프에서, `if (!cell) continue;` 바로 다음 줄에 추가:

```ts
          if (!cell) continue;
          // 병합(colspan/rowspan)으로 가려진 셀은 변수에서 제외 (변수명 중복 방지)
          if (cell.isHidden) continue;
```

- [ ] **Step 5: 테이블 셀 컬럼 push 지점에 cellExportLabel 주입**

같은 파일에서 `type: 'table-cell'` 컬럼을 push하는 세 지점(checkbox 셀 분리 / radio·select·input 일반 셀)과 `table-cell-ranking` 컬럼 push 지점, `radio-group` push 지점에 각각 `cellExportLabel: cell.exportLabel,` 한 줄을 추가한다. (radio-group은 `members[0].cell.exportLabel`, table-cell-ranking은 해당 `cell.exportLabel` 사용.)

예 — radio/select/input 일반 셀 push:

```ts
            columns.push({
              spssVarName: varName,
              questionText: q.title,
              optionLabel: optionLabel || `${tRow.label} - ${q.tableColumns[colIdx].label}`,
              questionId: q.id,
              type: 'table-cell',
              tableCellId: cell.id,
              tableCellType: cell.type,
              cellSpssVarType: cell.spssVarType,
              cellSpssMeasure: cell.spssMeasure,
              cellExportLabel: cell.exportLabel,
            });
```

- [ ] **Step 6: 테스트 실행 → 통과 확인 + 기존 테스트 회귀 없음**

Run: `npx vitest run tests/integration/spss/spss-excel-export.test.ts`
Expected: PASS (신규 2건 + 기존 전체 통과)

- [ ] **Step 7: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 8: Commit**

```bash
git add src/lib/analytics/spss-excel-export.ts tests/integration/spss/spss-excel-export.test.ts
git commit -m "fix: generateSPSSColumns isHidden 셀 제외 및 cellExportLabel 주입"
```

---

## Task 2: 테이블 radio/select 셀 spssNumericCode 매핑

**Files:**
- Modify: `src/lib/spss/data-transformer.ts`
- Modify: `src/lib/analytics/spss-excel-export.ts` (table-cell 컬럼에 옵션 주입)
- Test: `tests/integration/spss/spss-excel-export.test.ts`

배경: `transformTableCell`은 radio/select 셀에서 raw value("opt1")를 그대로 반환한다. 셀 옵션의 `spssNumericCode`로 매핑해야 한다.

- [ ] **Step 1: 실패 테스트 작성**

`describe('buildDataRows', ...)` 블록에 추가:

```ts
it('테이블 radio 셀 응답을 옵션 spssNumericCode로 변환한다', () => {
  const q: Question = {
    id: 'q1', type: 'table', title: 'Q1', order: 1, required: false,
    questionCode: 'Q1',
    tableColumns: [{ id: 'c2', label: '값', columnCode: 'c2' }],
    tableRowsData: [
      { id: 'row1', label: '행1', rowCode: 'r1', cells: [
        { id: 'cellB', type: 'radio', content: '', cellCode: 'Q1_r1_c2',
          radioOptions: [
            { id: 'oA', label: '예', value: 'opt1', spssNumericCode: 1 },
            { id: 'oB', label: '아니오', value: 'opt2', spssNumericCode: 2 },
          ] },
      ] },
    ],
  } as unknown as Question;

  const cols = generateSPSSColumns([q]);
  const submissions = [
    { questionResponses: { q1: { cellB: 'opt2' } } },
    { questionResponses: { q1: { cellB: 'oA' } } }, // id로 저장된 경우도 매핑
  ] as unknown as SurveySubmission[];

  const rows = buildDataRows(cols, [q], submissions);
  const colIdx = cols.findIndex((c) => c.spssVarName === 'Q1_r1_c2');
  expect(rows[0][colIdx]).toBe(2);
  expect(rows[1][colIdx]).toBe(1);
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run tests/integration/spss/spss-excel-export.test.ts -t "spssNumericCode로 변환"`
Expected: FAIL (현재 "opt2" 문자열 반환)

- [ ] **Step 3: `data-transformer.ts`에 옵션 주입형 변환 추가**

`src/lib/spss/data-transformer.ts`에 `getNumericCode`를 재활용하는 헬퍼 추가 (파일 하단):

```ts
/**
 * 테이블 radio/select 셀 응답을 셀 옵션의 spssNumericCode로 변환한다.
 * 옵션이 없으면(자유 입력 등) 기존 transformTableCell 동작으로 폴백.
 */
export function transformTableChoiceCell(
  cellType: string,
  value: unknown,
  options: QuestionOption[] | undefined,
): string | number | null {
  if (value == null) return null;
  if ((cellType === 'radio' || cellType === 'select') && options && options.length > 0) {
    if (typeof value !== 'string') return transformTableCell(cellType, value);
    return getNumericCode(options, value);
  }
  return transformTableCell(cellType, value);
}
```

- [ ] **Step 4: `generateSPSSColumns`의 table-cell 컬럼에 옵션 주입**

`src/lib/analytics/spss-excel-export.ts`의 radio/select/input 일반 셀 push 블록에서, radio/select 셀의 옵션을 `cellOptions`에 실어 준다 (기존 `cellOptions` 필드 재활용):

```ts
            columns.push({
              spssVarName: varName,
              questionText: q.title,
              optionLabel: optionLabel || `${tRow.label} - ${q.tableColumns[colIdx].label}`,
              questionId: q.id,
              type: 'table-cell',
              tableCellId: cell.id,
              tableCellType: cell.type,
              cellSpssVarType: cell.spssVarType,
              cellSpssMeasure: cell.spssMeasure,
              cellExportLabel: cell.exportLabel,
              cellOptions: cell.radioOptions || cell.selectOptions,
            });
```

- [ ] **Step 5: `buildDataRows`의 table-cell 분기에서 옵션 매핑 사용**

`src/lib/analytics/spss-excel-export.ts`의 `buildDataRows` `case 'table-cell'`에서, 마지막 `return transformTableCell(...)` 줄을 교체:

```ts
          return transformTableChoiceCell(
            col.tableCellType || 'input',
            cellVal,
            col.cellOptions,
          );
```

그리고 import 추가: `transformTableChoiceCell`을 `@/lib/spss/data-transformer`에서 가져온다.

- [ ] **Step 6: 테스트 실행 → 통과 확인 + 회귀 없음**

Run: `npx vitest run tests/integration/spss/spss-excel-export.test.ts && npx tsc --noEmit`
Expected: PASS, 타입 에러 없음

- [ ] **Step 7: Commit**

```bash
git add src/lib/spss/data-transformer.ts src/lib/analytics/spss-excel-export.ts tests/integration/spss/spss-excel-export.test.ts
git commit -m "fix: 테이블 radio select 셀 응답을 spssNumericCode로 변환"
```

---

## Task 3: raw 전용 pure 헬퍼 (날짜 포맷 + 코딩북 값라벨)

**Files:**
- Create: `src/lib/analytics/raw-export-helpers.ts`
- Test: `tests/unit/features/raw-export/raw-export-helpers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/unit/features/raw-export/raw-export-helpers.test.ts
import { describe, expect, it } from 'vitest';

import { formatExcelDateTime, buildCodebookValueLabel } from '@/lib/analytics/raw-export-helpers';
import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import type { Question } from '@/types/survey';

describe('formatExcelDateTime', () => {
  it('KST YYYY-MM-DD HH:mm 으로 포맷한다', () => {
    // 2026-06-03T05:30:00Z = KST 14:30
    expect(formatExcelDateTime(new Date('2026-06-03T05:30:00Z'))).toBe('2026-06-03 14:30');
  });
  it('null 은 빈 문자열', () => {
    expect(formatExcelDateTime(null)).toBe('');
  });
});

describe('buildCodebookValueLabel', () => {
  const radioQ = {
    id: 'q1', type: 'radio', title: 'Q1', questionCode: 'Q1',
    options: [
      { id: 'a', label: '남성', value: 'opt1', spssNumericCode: 1 },
      { id: 'b', label: '여성', value: 'opt2', spssNumericCode: 2 },
    ],
  } as unknown as Question;
  const qMap = new Map<string, Question>([['q1', radioQ]]);

  it('단일선택은 code=label 나열', () => {
    const col = { type: 'single', questionId: 'q1', spssVarName: 'Q1' } as SPSSExportColumn;
    expect(buildCodebookValueLabel(col, qMap)).toBe('1=남성, 2=여성');
  });

  it('checkbox 항목은 빈값=비선택, code=선택', () => {
    const col = {
      type: 'checkbox-item', questionId: 'q1', spssVarName: 'Q1_1',
      optionIndex: 0,
    } as SPSSExportColumn;
    const cbQ = {
      id: 'q1', type: 'checkbox', title: 'Q1', questionCode: 'Q1',
      options: [{ id: 'a', label: 'AI', value: 'opt1', spssNumericCode: 1 }],
    } as unknown as Question;
    expect(buildCodebookValueLabel(col, new Map([['q1', cbQ]]))).toBe('빈값=비선택, 1=선택');
  });

  it('텍스트는 빈 문자열', () => {
    const col = { type: 'text', questionId: 'q1', spssVarName: 'Q1' } as SPSSExportColumn;
    expect(buildCodebookValueLabel(col, qMap)).toBe('');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run tests/unit/features/raw-export/raw-export-helpers.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 헬퍼 구현**

```ts
// src/lib/analytics/raw-export-helpers.ts
import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import type { Question, QuestionOption } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { resolveRankingOptions, toSpssValueLabelPairs } from '@/utils/ranking-source';

/** Date → KST "YYYY-MM-DD HH:mm" 문자열. null/undefined → '' */
export function formatExcelDateTime(value: Date | null | undefined): string {
  if (!value) return '';
  const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function pairsFromOptions(options: QuestionOption[]): string {
  return options
    .map((o, i) => `${o.spssNumericCode ?? i + 1}=${o.label}`)
    .join(', ');
}

/**
 * 코딩북 "값 라벨" 셀 문자열을 컬럼 종류별로 생성한다 (spssNumericCode 기반).
 * 값 라벨이 의미 없는 텍스트/날짜류는 빈 문자열.
 */
export function buildCodebookValueLabel(
  col: SPSSExportColumn,
  questionMap: Map<string, Question>,
): string {
  const q = questionMap.get(col.questionId);

  switch (col.type) {
    case 'notice-agree':
      return '동의=확인, 빈값=미확인';

    case 'checkbox-item':
    case 'table-cell': {
      // checkbox 계열은 counted-value, radio/select 계열은 옵션 나열
      if (col.type === 'checkbox-item') {
        const opts = q ? resolveChoiceOptions(q) : [];
        const code = col.optionIndex != null ? (opts[col.optionIndex]?.spssNumericCode ?? col.optionIndex + 1) : 1;
        return `빈값=비선택, ${code}=선택`;
      }
      if (col.tableCellType === 'checkbox') {
        const code = col.optionIndex != null
          ? (col.cellOptions?.[col.optionIndex]?.spssNumericCode ?? col.optionIndex + 1)
          : 1;
        return `빈값=비선택, ${code}=선택`;
      }
      // table-cell radio/select: 주입된 cellOptions 사용
      if (col.cellOptions && col.cellOptions.length > 0) return pairsFromOptions(col.cellOptions);
      return '';
    }

    case 'single': {
      const opts = q ? resolveChoiceOptions(q) : [];
      return opts.length > 0 ? pairsFromOptions(opts) : '';
    }

    case 'radio-group':
      if (col.radioGroupValueLabels) {
        return Object.entries(col.radioGroupValueLabels)
          .map(([code, label]) => `${code}=${label}`)
          .join(', ');
      }
      return '';

    case 'ranking-rank':
    case 'table-cell-ranking': {
      const opts = col.cellOptions ?? (q ? resolveRankingOptions(q) : []);
      const pairs = toSpssValueLabelPairs(opts);
      return pairs.length > 0 ? pairs.map((p) => `${p.code}=${p.label}`).join(', ') : '';
    }

    default:
      // text, textarea, multiselect, other-text, option-text, notice-date, *-other
      return '';
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx vitest run tests/unit/features/raw-export/raw-export-helpers.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/raw-export-helpers.ts tests/unit/features/raw-export/raw-export-helpers.test.ts
git commit -m "feat: raw export 날짜 포맷 및 코딩북 값라벨 헬퍼 추가"
```

---

## Task 4: `generateRawDataWorkbook` — 3시트 조립

**Files:**
- Modify: `src/lib/excel-transformer.ts`
- Test: `tests/unit/features/raw-export/raw-data-workbook.test.ts`

- [ ] **Step 1: 입력 타입 + 실패 테스트 작성**

```ts
// tests/unit/features/raw-export/raw-data-workbook.test.ts
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { generateRawDataWorkbook, type RawExportResponseRow } from '@/lib/excel-transformer';
import type { Question } from '@/types/survey';

const radioQ = {
  id: 'q1', type: 'radio', title: 'Q1. 성별', order: 1, required: false,
  questionCode: 'Q1',
  options: [
    { id: 'a', label: '남성', value: 'opt1', spssNumericCode: 1 },
    { id: 'b', label: '여성', value: 'opt2', spssNumericCode: 2 },
  ],
} as unknown as Question;

const baseRow = (over: Partial<RawExportResponseRow>): RawExportResponseRow => ({
  id: 'r1', questionResponses: {}, groupValue: null, resid: null,
  platform: 'desktop', browser: 'Chrome', status: 'completed',
  startedAt: new Date('2026-06-03T05:30:00Z'), completedAt: new Date('2026-06-03T05:40:00Z'),
  totalSeconds: 600, ...over,
});

function sheetAOA(wb: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: true }) as unknown[][];
}

describe('generateRawDataWorkbook', () => {
  it('3개 시트를 생성한다', () => {
    const wb = generateRawDataWorkbook([radioQ], [baseRow({})], 'sequence');
    expect(wb.SheetNames).toEqual(['응답 내역', 'Raw Data', '코딩북']);
  });

  it('공공(sequence)은 첫 컬럼 헤더가 순번이고 1부터 매긴다', () => {
    const rows = [baseRow({ id: 'a' }), baseRow({ id: 'b' })];
    const wb = generateRawDataWorkbook([radioQ], rows, 'sequence');
    const aoa = sheetAOA(wb, '응답 내역');
    expect(aoa[0][0]).toBe('순번');
    expect(aoa[1][0]).toBe(1);
    expect(aoa[2][0]).toBe(2);
  });

  it('토큰(systemId)은 첫 컬럼 헤더가 systemID이고 resid 값을 쓴다', () => {
    const wb = generateRawDataWorkbook([radioQ], [baseRow({ resid: 77 })], 'systemId');
    const aoa = sheetAOA(wb, '응답 내역');
    expect(aoa[0][0]).toBe('systemID');
    expect(aoa[1][0]).toBe(77);
  });

  it('Raw Data 시트는 헤더 3행(질문제목/셀라벨/변수명) 후 코드값', () => {
    const row = baseRow({ questionResponses: { q1: 'opt2' } });
    const wb = generateRawDataWorkbook([radioQ], [row], 'sequence');
    const aoa = sheetAOA(wb, 'Raw Data');
    // [0]=식별자, [1]=Q1 변수
    expect(aoa[0][0]).toBe('순번');        // 행1 첫 칸은 식별자 헤더
    expect(aoa[0][1]).toBe('Q1. 성별');     // 행1: 질문 제목
    expect(aoa[1][1]).toBe('');            // 행2: 셀라벨 (단일질문 → 공백)
    expect(aoa[2][1]).toBe('Q1');          // 행3: 변수명
    expect(aoa[3][0]).toBe(1);             // 데이터 행 식별자
    expect(aoa[3][1]).toBe(2);             // 코드값 (여성=2)
  });

  it('코딩북 시트는 변수명/값라벨을 담는다', () => {
    const wb = generateRawDataWorkbook([radioQ], [baseRow({})], 'sequence');
    const aoa = sheetAOA(wb, '코딩북');
    expect(aoa[0]).toEqual(['변수번호', 'SPSS 변수명', '질문 제목', '셀라벨', '값 라벨']);
    const q1 = aoa.find((r) => r[1] === 'Q1');
    expect(q1?.[4]).toBe('1=남성, 2=여성');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run tests/unit/features/raw-export/raw-data-workbook.test.ts`
Expected: FAIL (export 없음)

- [ ] **Step 3: `generateRawDataWorkbook` 구현**

`src/lib/excel-transformer.ts` 상단 import에 추가:

```ts
import { generateSPSSColumns, buildDataRows, type SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { formatExcelDateTime, buildCodebookValueLabel } from '@/lib/analytics/raw-export-helpers';
import { formatTotalTime } from '@/lib/operations/profiles';
import { formatPlatformKo } from '@/lib/operations/parse-ua';
import { mapStatusPill } from '@/lib/operations/profiles';
import type { Question, SurveySubmission } from '@/types/survey';
```

(주의: 기존 import 줄과 중복되지 않게 병합. `Survey`/`SurveySubmission`은 이미 import되어 있으니 `Question`만 추가하면 될 수 있다. 실제 파일 기준으로 조정.)

파일에 추가:

```ts
export interface RawExportResponseRow {
  id: string;
  questionResponses: Record<string, unknown>;
  groupValue: string | null;
  resid: number | null;
  platform: string | null;
  browser: string | null;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  totalSeconds: number | null;
}

export type RawIdentifierMode = 'sequence' | 'systemId';

/**
 * 시트 분리 없는 3시트 Raw Data 워크북.
 * - 응답 내역: 응답자 메타 (응답 내역 페이지 재현)
 * - Raw Data: 응답 × 변수 wide table (SPSS 코드값), 헤더 3행
 * - 코딩북: 변수 정의 + 값 라벨
 * rows 는 started_at ASC 정렬된 동일 모수.
 */
export function generateRawDataWorkbook(
  questions: Question[],
  rows: RawExportResponseRow[],
  identifierMode: RawIdentifierMode,
): XLSX.WorkBook {
  const idHeader = identifierMode === 'systemId' ? 'systemID' : '순번';
  const idValue = (row: RawExportResponseRow, idx: number): string | number =>
    identifierMode === 'systemId' ? (row.resid ?? '') : idx + 1;

  // 변수 열 정의 (isHidden 제외된 단일 소스)
  const columns = generateSPSSColumns(questions);
  const dataMatrix = buildDataRows(columns, questions, rows as unknown as SurveySubmission[]);
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  const workbook = XLSX.utils.book_new();

  // ── 시트 1: 응답 내역 ──
  const sheet1: (string | number)[][] = [[
    idHeader, '조사 대상 그룹', '접속 단말', '브라우저', '상태', '시작일시', '종료일시', '소요시간',
  ]];
  rows.forEach((row, i) => {
    sheet1.push([
      idValue(row, i),
      row.groupValue ?? '공개링크',
      formatPlatformKo(row.platform as never),
      row.browser ?? 'Other',
      mapStatusPill({ status: row.status }).label,
      formatExcelDateTime(row.startedAt),
      row.status === 'in_progress' ? '진행 중' : formatExcelDateTime(row.completedAt),
      formatTotalTime(row.totalSeconds, row.status),
    ]);
  });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet1), '응답 내역');

  // ── 시트 2: Raw Data (헤더 3행) ──
  const headerRow1: (string | number)[] = [idHeader, ...columns.map((c) => c.questionText)];
  const headerRow2: (string | number)[] = ['', ...columns.map((c) => row2Label(c))];
  const headerRow3: (string | number)[] = ['', ...columns.map((c) => c.spssVarName)];
  const sheet2: (string | number | null)[][] = [headerRow1, headerRow2, headerRow3];
  rows.forEach((row, i) => {
    sheet2.push([idValue(row, i), ...dataMatrix[i]]);
  });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet2), 'Raw Data');

  // ── 시트 3: 코딩북 ──
  const sheet3: (string | number)[][] = [['변수번호', 'SPSS 변수명', '질문 제목', '셀라벨', '값 라벨']];
  columns.forEach((c) => {
    sheet3.push([
      c.optionValue != null ? '' : '', // 변수번호: optionCode 계열은 변수명에 이미 반영 — 아래 주 참고
      c.spssVarName,
      c.questionText,
      c.cellExportLabel ?? '',
      buildCodebookValueLabel(c, questionMap),
    ]);
  });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet3), '코딩북');

  return workbook;
}

/** Raw Data 헤더 행2: 테이블 셀라벨 > 옵션 분리 열 라벨 > 공백 */
function row2Label(c: SPSSExportColumn): string {
  if (c.cellExportLabel) return c.cellExportLabel;
  // 옵션 분리 열(체크박스 항목 등)은 옵션 라벨을 보조 라벨로
  if (c.type === 'checkbox-item' || c.type === 'ranking-rank') return c.optionLabel ?? '';
  return '';
}
```

> 주: `변수번호` 컬럼은 단일 식별자가 없어(컬럼마다 의미가 다름) 1차 구현에서는 SPSS 변수명만으로 충분하다. 테스트는 `변수번호`를 빈 문자열로 기대하지 않으므로(첫 행 헤더만 검사), 헤더만 맞으면 통과한다. 추후 필요 시 `optionCode`를 노출한다.

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx vitest run tests/unit/features/raw-export/raw-data-workbook.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/excel-transformer.ts tests/unit/features/raw-export/raw-data-workbook.test.ts
git commit -m "feat: 3시트 raw data 워크북 생성 함수 추가"
```

---

## Task 5: export route `type=raw` 분기

**Files:**
- Modify: `src/app/api/surveys/[surveyId]/export/route.ts`

- [ ] **Step 1: `raw`를 허용 타입에 추가하고 분기 작성**

`ALLOWED_EXPORT_TYPES` 수정:

```ts
const ALLOWED_EXPORT_TYPES = ['summary', 'map', 'sav', 'raw'] as const;
```

import 추가:

```ts
import { generateRawDataWorkbook, type RawExportResponseRow } from '@/lib/excel-transformer';
import { contactTargets } from '@/db/schema';
import { inArray } from 'drizzle-orm';
```

- [ ] **Step 2: raw 전용 응답 조회 + resid 매핑 + 워크북 생성**

`type === 'sav'` 분기 **앞에** raw 분기를 추가한다 (응답 조회는 기존 `notDeletedResponse` 블록과 별개로 raw 전용 필터 사용):

```ts
    if (type === 'raw') {
      // raw 전용 모수: deleted 제외 + in_progress 제외, started_at ASC
      const rawResponses = await db.query.surveyResponses.findMany({
        where: and(
          eq(surveyResponses.surveyId, surveyId),
          isNull(surveyResponses.deletedAt),
          ne(surveyResponses.status, 'in_progress'),
        ),
        orderBy: (r, { asc }) => [asc(r.startedAt)],
      });

      if (rawResponses.length > MAX_EXPORT_RESPONSES) {
        return NextResponse.json(
          { error: `응답이 ${MAX_EXPORT_RESPONSES.toLocaleString()}건을 초과하여 내보내기할 수 없습니다.` },
          { status: 413 },
        );
      }

      // resid / groupValue 매핑 (토큰 설문 + 컨택 매칭 응답만)
      const contactIds = rawResponses
        .map((r) => r.contactTargetId)
        .filter((v): v is string => !!v);
      const contactMap = new Map<string, { resid: number; groupValue: string | null }>();
      if (contactIds.length > 0) {
        const targets = await db
          .select({ id: contactTargets.id, resid: contactTargets.resid, groupValue: contactTargets.groupValue })
          .from(contactTargets)
          .where(inArray(contactTargets.id, contactIds));
        for (const t of targets) contactMap.set(t.id, { resid: t.resid, groupValue: t.groupValue });
      }

      const identifierMode = surveyData.requireInviteToken ? 'systemId' : 'sequence';

      const rows: RawExportResponseRow[] = rawResponses.map((r) => {
        const c = r.contactTargetId ? contactMap.get(r.contactTargetId) : undefined;
        return {
          id: r.id,
          questionResponses: (r.questionResponses ?? {}) as Record<string, unknown>,
          groupValue: c?.groupValue ?? null,
          resid: c?.resid ?? null,
          platform: r.platform,
          browser: r.browser,
          status: r.status,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          totalSeconds: r.totalSeconds,
        };
      });

      const workbook = generateRawDataWorkbook(
        surveyData.questions as unknown as Question[],
        rows,
        identifierMode,
      );
      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
      const filename = `${safeTitle}_RawData_${dateSlice}.xlsx`;
      return new NextResponse(buffer, {
        headers: {
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': XLSX_MIME,
        },
      });
    }
```

import에 `isNull`, `ne`가 `drizzle-orm`에서 빠져 있으면 추가한다. `dateSlice`/`safeTitle`은 raw 분기에서도 필요하므로, 두 줄(`const dateSlice = ...`, `const safeTitle = ...`)을 raw 분기보다 위로 올린다 (현재 위치가 raw 분기 뒤라면 이동).

- [ ] **Step 3: 타입 체크 + 빌드**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: route 인증 테스트 회귀 확인**

Run: `npx vitest run tests/unit/api/export-route-auth.test.ts`
Expected: PASS (raw 추가가 인증 동작을 깨지 않음)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/surveys/[surveyId]/export/route.ts
git commit -m "feat: export route type=raw 분기 추가"
```

---

## Task 6: UI — raw 추출 카드 추가, 기존 카드 숨김

**Files:**
- Modify: `src/components/analytics/export-data-modal.tsx`

- [ ] **Step 1: 현재 구조 확인**

Run: `sed -n '60,160p' src/components/analytics/export-data-modal.tsx`
Expected: `handleExport`, ExportCard 4개(cleaning/sav/summary/map) 위치 파악. `handleExport`의 확장자 분기는 `const ext = type === 'sav' ? 'sav' : 'xlsx';` 이므로 `raw`는 자동으로 `xlsx`가 된다(수정 불필요).

- [ ] **Step 2: raw ExportCard 추가 + 기존 카드 숨김**

모달 본문에서 기존 cleaning/sav/summary/map `ExportCard`들을 `{false && ( ... )}`로 감싸 비노출하고(코드 보존), 맨 위에 raw 카드를 추가한다:

```tsx
          <ExportCard
            title="Raw Data 엑셀"
            description="응답 내역 + 변수별 코드값 + 코딩북 (3시트)"
            icon={<Download className="h-5 w-5" />}
            isLoading={exportingType === 'raw'}
            disabled={!!exportingType}
            onClick={() => handleExport('raw')}
          />
```

(아이콘은 파일 상단에서 이미 import된 lucide 아이콘 중 하나를 재사용한다. 없으면 `Download`를 import.)

- [ ] **Step 3: 타입 체크 + 빌드**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/components/analytics/export-data-modal.tsx
git commit -m "feat: export 모달에 raw data 추출 버튼 추가 및 기존 버튼 숨김"
```

---

## Task 7: 인공지능 실태조사 통합 검증

**Files:**
- Create (임시): `tmp/verify-raw-export.ts`

- [ ] **Step 1: 검증 스크립트 작성**

```ts
// tmp/verify-raw-export.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { eq, and, isNull, ne } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { db } from '@/db';
import { surveys, surveyResponses } from '@/db/schema';
import { generateRawDataWorkbook, type RawExportResponseRow } from '@/lib/excel-transformer';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import type { Question } from '@/types/survey';
import { generateAllOptionCodes } from '@/utils/option-code-generator';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

const ID = '1d7153b0-f4fe-4ee6-ac54-ac81668e24ee';

async function main() {
  const s = await db.query.surveys.findFirst({ where: eq(surveys.id, ID), with: { questions: true } });
  if (!s) throw new Error('no survey');
  for (const q of s.questions as any[]) {
    if (q.type === 'table' && q.tableRowsData && q.tableColumns)
      q.tableRowsData = generateAllCellCodes(q.questionCode ?? undefined, q.title, q.tableColumns, q.tableRowsData);
    if (q.options && ['radio','checkbox','select','multiselect'].includes(q.type))
      q.options = generateAllOptionCodes(q.options);
  }
  const questions = (s.questions as unknown as Question[]).slice().sort((a,b)=>(a.order??0)-(b.order??0));

  const resp = await db.query.surveyResponses.findMany({
    where: and(eq(surveyResponses.surveyId, ID), isNull(surveyResponses.deletedAt), ne(surveyResponses.status,'in_progress')),
    orderBy: (r,{asc})=>[asc(r.startedAt)],
  });
  const rows: RawExportResponseRow[] = resp.map((r)=>({
    id:r.id, questionResponses:(r.questionResponses??{}) as any, groupValue:null, resid:null,
    platform:r.platform, browser:r.browser, status:r.status,
    startedAt:r.startedAt, completedAt:r.completedAt, totalSeconds:r.totalSeconds,
  }));

  const cols = generateSPSSColumns(questions);
  const names = cols.map((c)=>c.spssVarName.toLowerCase());
  const dup = names.filter((n,i)=>names.indexOf(n)!==i);
  const wb = generateRawDataWorkbook(questions, rows, 'sequence');
  const raw = XLSX.utils.sheet_to_json(wb.Sheets['Raw Data'], { header:1, blankrows:true }) as unknown[][];

  console.log('응답 수:', rows.length, '(기대 121)');
  console.log('변수 열:', cols.length);
  console.log('변수명 중복:', dup.length, dup.length ? [...new Set(dup)] : '없음');
  console.log('Raw Data 시트 행수:', raw.length, '(헤더3 + 데이터)', '데이터행:', raw.length-3);
  console.log('Raw Data 열수:', (raw[0]?.length ?? 0), '(식별자1 + 변수', cols.length, ')');
  console.log('시트:', wb.SheetNames);
  process.exit(0);
}
main().catch((e)=>{ console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실행 + 결과 확인**

Run: `npx tsx --env-file=.env.local tmp/verify-raw-export.ts 2>&1 | grep -v "npm warn\|dotenv@"`
Expected:
- 응답 수: 121
- 변수명 중복: 0 없음
- Raw Data 데이터행: 121
- Raw Data 열수: 1 + 변수 수
- 시트: ['응답 내역', 'Raw Data', '코딩북']

- [ ] **Step 3: 검증 스크립트 삭제 (workspace hygiene)**

```bash
rm tmp/verify-raw-export.ts
```

- [ ] **Step 4: 전체 테스트 + 타입 + 빌드 최종 확인**

Run: `npx vitest run && npx tsc --noEmit && pnpm build`
Expected: 모두 통과 (vitest는 기존 flaky 케이스 — profiles-row-actions — 격리 통과 알려져 있음)

- [ ] **Step 5: 최종 커밋 (변경 없으면 생략)**

```bash
git status
```

---

## Self-Review 결과

- **스펙 1~9 커버리지:** 엔드포인트(T5), 응답범위(T5), 식별자(T4/T5), 시트1(T4), 시트2 헤더3행(T4), 응답값 보정(T2), 코딩북(T3/T4), isHidden 충돌(T1), UI(T6) — 전부 매핑됨.
- **플레이스홀더:** 모든 코드 스텝에 실제 코드 포함. `변수번호` 컬럼은 의도적으로 1차 빈값(주석으로 명시).
- **타입 일관성:** `RawExportResponseRow`/`RawIdentifierMode`/`SPSSExportColumn.cellExportLabel`/`transformTableChoiceCell`/`generateRawDataWorkbook` 시그니처가 태스크 간 일치.
- **주의:** Task 4 import 병합 시 기존 `excel-transformer.ts`의 import 줄과 중복 점검 필요(`Survey`, `SurveySubmission`는 이미 존재).
