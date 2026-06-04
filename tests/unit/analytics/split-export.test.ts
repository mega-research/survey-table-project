import { describe, it, expect } from 'vitest';

import { valueMatchSet, bucketQuestions, optionTokensForBasis, planSplit, detectSplitCandidates, assignSplitSheetNames, SPLIT_RESERVED_SHEET_NAMES, splitPlanExceedsExcelLimit, SPLIT_EXCEL_LIMIT } from '@/lib/analytics/split-export';
import { buildSplitWorkbook } from '@/lib/excel-transformer';
import type { RawExportResponseRow } from '@/lib/excel-transformer';
import type { Question, QuestionConditionGroup } from '@/types/survey';

const vm = (sourceQuestionId: string, requiredValues: string[]): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    { id: 'c1', sourceQuestionId, conditionType: 'value-match', requiredValues, logicType: 'AND' },
  ],
});

describe('valueMatchSet', () => {
  it('value-match 조건의 requiredValues를 Set으로 모은다', () => {
    const set = valueMatchSet(vm('Q2', ['opt1', 'opt3']), 'Q2');
    expect(set).not.toBeNull();
    expect([...set!].sort()).toEqual(['opt1', 'opt3']);
  });

  it('다른 sourceQuestionId는 무시한다', () => {
    expect(valueMatchSet(vm('Q9', ['opt1']), 'Q2')).toBeNull();
  });

  it('value-match가 아닌 conditionType은 무시한다', () => {
    const dc: QuestionConditionGroup = {
      logicType: 'AND',
      conditions: [
        { id: 'c1', sourceQuestionId: 'Q2', conditionType: 'table-cell-check', logicType: 'AND' },
      ],
    };
    expect(valueMatchSet(dc, 'Q2')).toBeNull();
  });

  it('조건이 없으면 null', () => {
    expect(valueMatchSet(undefined, 'Q2')).toBeNull();
  });
});

const q = (over: Partial<Question>): Question => ({
  id: 'x', surveyId: 's', type: 'text', title: 't', required: false, order: 0,
  questionCode: over.id ?? 'x',
  ...over,
} as unknown as Question);

describe('bucketQuestions', () => {
  // basis Q2 + 공통질문 A + opt1전용 B + 테이블 T(공통행 r0 / opt1행 r1 / opt2행 r2)
  const basis = q({ id: 'Q2', type: 'checkbox', questionCode: 'Q2' });
  const A = q({ id: 'A', type: 'text' });
  const B = q({ id: 'B', type: 'radio', displayCondition: vm('Q2', ['opt1']) });
  const T = q({
    id: 'T', type: 'table',
    tableRowsData: [
      { id: 'r0', label: '', cells: [] },
      { id: 'r1', label: '', cells: [], displayCondition: vm('Q2', ['opt1']) },
      { id: 'r2', label: '', cells: [], displayCondition: vm('Q2', ['opt2']) },
    ],
  } as Partial<Question>);
  const all = [basis, A, B, T];

  it('common: 조건 없는 질문 + basis 조건 없는 테이블 행만', () => {
    const out = bucketQuestions(all, 'Q2', 'common');
    expect(out.map((x) => x.id).sort()).toEqual(['A', 'Q2', 'T']);
    const t = out.find((x) => x.id === 'T')!;
    expect(t.tableRowsData!.map((r) => r.id)).toEqual(['r0']);
  });

  it('opt1: opt1 전용 질문 + opt1 행만', () => {
    const out = bucketQuestions(all, 'Q2', 'opt1');
    expect(out.map((x) => x.id).sort()).toEqual(['B', 'T']);
    const t = out.find((x) => x.id === 'T')!;
    expect(t.tableRowsData!.map((r) => r.id)).toEqual(['r1']);
  });

  it('opt2: 전용 질문 없고 opt2 행만', () => {
    const out = bucketQuestions(all, 'Q2', 'opt2');
    expect(out.map((x) => x.id)).toEqual(['T']);
    expect(out[0].tableRowsData!.map((r) => r.id)).toEqual(['r2']);
  });

  it('멀티토큰 비테이블 질문은 각 버킷에 모두 복사된다', () => {
    // M의 displayCondition이 opt1·opt2 두 값을 모두 requiredValues로 가짐
    const M = q({ id: 'M', type: 'text', displayCondition: vm('Q2', ['opt1', 'opt2']) });
    const questions = [basis, A, M];
    const inOpt1 = bucketQuestions(questions, 'Q2', 'opt1');
    const inOpt2 = bucketQuestions(questions, 'Q2', 'opt2');
    expect(inOpt1.map((x) => x.id)).toContain('M');
    expect(inOpt2.map((x) => x.id)).toContain('M');
  });
});

describe('optionTokensForBasis', () => {
  it('basis.options 순서로 정렬하고, 옵션에 없는 토큰(other)은 뒤에 붙인다', () => {
    const basis = q({
      id: 'Q2', type: 'checkbox', questionCode: 'Q2',
      options: [
        { id: 'o1', value: 'opt1', label: '제재목' },
        { id: 'o2', value: 'opt2', label: '합판' },
      ],
    } as Partial<Question>);
    const B = q({ id: 'B', displayCondition: vm('Q2', ['opt2']) });
    const C = q({ id: 'C', displayCondition: vm('Q2', ['opt1', 'other']) });
    const tokens = optionTokensForBasis([basis, B, C], basis);
    expect(tokens).toEqual(['opt1', 'opt2', 'other']);
  });
});

describe('planSplit', () => {
  const basis = q({
    id: 'Q2', type: 'radio', questionCode: 'Q2', title: '품목',
    options: [
      { id: 'o1', value: 'opt1', label: '제재목' },
      { id: 'o2', value: 'opt2', label: '합판' },
    ],
  } as Partial<Question>);
  const common = q({ id: 'A', type: 'text', title: '공통질문' });
  const only1 = q({ id: 'B', type: 'text', title: 'opt1전용', displayCondition: vm('Q2', ['opt1']) });
  const all = [basis, common, only1];

  it('공통/옵션 시트 변수 수와 메타를 계산한다', () => {
    const plan = planSplit(all, 'Q2', { opt1: 12, opt2: 5 });
    expect(plan.basisCode).toBe('Q2');
    expect(plan.basisLabel).toBe('품목');
    // 공통: basis(radio=1열) + 공통 text(1열) = 2
    expect(plan.common).toBe(2);
    // opt1 시트: only1 text 1열, opt2 시트: 변수 0 → 시트 제외
    const opt1 = plan.sheets.find((s) => s.token === 'opt1')!;
    expect(opt1.vars).toBe(1);
    expect(opt1.name).toBe('제재목');
    expect(opt1.resp).toBe(12);
    expect(plan.sheets.find((s) => s.token === 'opt2')).toBeUndefined(); // 빈 버킷 제외
    expect(plan.maxVars).toBe(2); // 공통이 최대
    expect(plan.exceedsSoftLimit).toBe(false);
  });
});

describe('detectSplitCandidates', () => {
  it('value-match 참조 문항을 후보로, maxVars 오름차순 정렬·권장 표시한다', () => {
    const basis = q({
      id: 'Q2', type: 'radio', questionCode: 'Q2', title: '품목',
      options: [
        { id: 'o1', value: 'opt1', label: '제재목' },
        { id: 'o2', value: 'opt2', label: '합판' },
      ],
    } as Partial<Question>);
    const b1 = q({ id: 'B1', type: 'text', displayCondition: vm('Q2', ['opt1']) });
    const b2 = q({ id: 'B2', type: 'text', displayCondition: vm('Q2', ['opt2']) });
    const cands = detectSplitCandidates([basis, b1, b2]);
    expect(cands).toHaveLength(1);
    expect(cands[0].questionId).toBe('Q2');
    expect(cands[0].refCount).toBe(2);
    expect(cands[0].buckets).toBe(2);
    expect(cands[0].recommended).toBe(true);
    expect(cands[0].note).not.toBe('');
  });

  it('시트가 2개 미만이면 후보에서 제외한다', () => {
    const basis = q({
      id: 'Q2', type: 'radio', questionCode: 'Q2',
      options: [{ id: 'o1', value: 'opt1', label: 'A' }],
    } as Partial<Question>);
    const b1 = q({ id: 'B1', type: 'text', displayCondition: vm('Q2', ['opt1']) });
    expect(detectSplitCandidates([basis, b1])).toHaveLength(0);
  });
});

describe('buildSplitWorkbook ↔ planSplit 일관성', () => {
  const basis = q({
    id: 'Q2', type: 'radio', questionCode: 'Q2', title: '품목', order: 0,
    options: [
      { id: 'o1', value: 'opt1', label: '제재목' },
      { id: 'o2', value: 'opt2', label: '합판' },
    ],
  } as Partial<Question>);
  const commonQ = q({ id: 'A', type: 'text', title: '공통', order: 1 });
  const only1 = q({ id: 'B', type: 'text', title: 'opt1전용', order: 2, displayCondition: vm('Q2', ['opt1']) });
  const only2 = q({ id: 'C', type: 'text', title: 'opt2전용', order: 3, displayCondition: vm('Q2', ['opt2']) });
  const questions = [basis, commonQ, only1, only2];

  const rows: RawExportResponseRow[] = [
    { id: 'r1', questionResponses: { Q2: 'opt1', A: 'x', B: 'y' }, groupValue: null, resid: null,
      platform: null, browser: null, status: 'completed', startedAt: new Date('2026-06-04T01:00:00Z'),
      completedAt: new Date('2026-06-04T01:05:00Z'), totalSeconds: 300 },
  ];

  it('시트 구성과 각 시트 변수 수가 planSplit과 일치한다', () => {
    const plan = planSplit(questions, 'Q2');
    const wb = buildSplitWorkbook(questions, rows, 'Q2', 'sequence');
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe('응답 내역');
    expect(names[1]).toBe('공통');
    expect(names[names.length - 1]).toBe('코딩북');
    // 옵션 시트는 plan.sheets 순서대로 그 사이에 위치
    expect(names.slice(2, names.length - 1)).toEqual(plan.sheets.map((s) => s.name));

    // 공통 시트 변수 수(헤더 1행 셀 수 - 식별자 1) == plan.common
    const commonWs = wb.getWorksheet('공통')!;
    expect(commonWs.getRow(1).cellCount - 1).toBe(plan.common);

    // 각 옵션 시트 변수 수 == plan.sheets[].vars
    for (const s of plan.sheets) {
      const ws = wb.getWorksheet(s.name)!;
      expect(ws.getRow(1).cellCount - 1).toBe(s.vars);
    }
  });
});

describe('assignSplitSheetNames', () => {
  it('금지 문자([]:*?/\\)를 공백으로 치환한다', () => {
    const result = assignSplitSheetNames(['제재목/원목']);
    expect(result).toEqual(['제재목 원목']);
  });

  it('31자를 초과하는 이름은 31자로 자른다', () => {
    const longName = 'A'.repeat(40);
    const result = assignSplitSheetNames([longName]);
    expect(result[0].length).toBeLessThanOrEqual(31);
  });

  it('중복 이름에 ~N 접미사를 붙여 유일화한다', () => {
    const result = assignSplitSheetNames(['합판', '합판', '합판']);
    expect(result).toEqual(['합판', '합판~2', '합판~3']);
    expect(new Set(result).size).toBe(3);
  });

  it('기본 이름이 길어도 ~N 접미사 자리를 올바르게 확보한다 (접미사 비잘림)', () => {
    // 정확히 31자인 기본 이름 두 개
    const base = 'B'.repeat(31);
    const result = assignSplitSheetNames([base, base]);
    expect(result[0]).toBe(base);
    expect(result[1].endsWith('~2')).toBe(true);
    expect(result[1].length).toBeLessThanOrEqual(31);
    // 결과가 실제로 서로 다른지 확인
    expect(result[0]).not.toBe(result[1]);
  });

  it('빈 문자열은 시트 로 대체한다', () => {
    const result = assignSplitSheetNames(['']);
    expect(result[0]).toBe('시트');
  });

  it('입력 순서를 보존한다', () => {
    const inputs = ['C', 'A', 'B'];
    const result = assignSplitSheetNames(inputs);
    expect(result).toEqual(['C', 'A', 'B']);
  });
});

describe('buildSplitWorkbook ↔ planSplit 일관성 (금지문자/장이름/중복 엣지케이스)', () => {
  // 옵션 라벨: 금지 문자 포함, 28자 초과, 중복 두 개
  const basisEdge = q({
    id: 'QE', type: 'radio', questionCode: 'QE', title: '품목엣지', order: 0,
    options: [
      { id: 'e1', value: 'tok1', label: '제재목/원목' },           // 금지 문자 포함
      { id: 'e2', value: 'tok2', label: 'A'.repeat(35) },          // 35자 (31자 초과)
      { id: 'e3', value: 'tok3', label: '중복라벨' },
      { id: 'e4', value: 'tok4', label: '중복라벨' },              // tok3과 동일 라벨
    ],
  } as Partial<Question>);

  // tok1 전용 질문
  const eOnly1 = q({ id: 'E1', type: 'text', title: 'tok1전용', order: 1, questionCode: 'E1',
    displayCondition: vm('QE', ['tok1']) });
  // tok2 전용 질문
  const eOnly2 = q({ id: 'E2', type: 'text', title: 'tok2전용', order: 2, questionCode: 'E2',
    displayCondition: vm('QE', ['tok2']) });
  // tok3/tok4 전용 질문 (각각)
  const eOnly3 = q({ id: 'E3', type: 'text', title: 'tok3전용', order: 3, questionCode: 'E3',
    displayCondition: vm('QE', ['tok3']) });
  const eOnly4 = q({ id: 'E4', type: 'text', title: 'tok4전용', order: 4, questionCode: 'E4',
    displayCondition: vm('QE', ['tok4']) });

  // 테이블 질문 — 행마다 displayCondition으로 tok1/tok2에 분기
  const tableQ = q({
    id: 'TQ', type: 'table', title: '테이블', order: 5, questionCode: 'TQ',
    tableColumns: [{ id: 'col1', label: '열1' }],
    tableRowsData: [
      { id: 'row1', label: '행1', cells: [{ id: 'c1', type: 'input', exportLabel: 'TQ_열1_행1' }],
        displayCondition: vm('QE', ['tok1']) },
      { id: 'row2', label: '행2', cells: [{ id: 'c2', type: 'input', exportLabel: 'TQ_열1_행2' }],
        displayCondition: vm('QE', ['tok2']) },
    ],
  } as Partial<Question>);

  const edgeQuestions = [basisEdge, eOnly1, eOnly2, eOnly3, eOnly4, tableQ];
  const edgeRows: RawExportResponseRow[] = [
    { id: 'r1', questionResponses: { QE: 'tok1', E1: 'v' }, groupValue: null, resid: null,
      platform: null, browser: null, status: 'completed', startedAt: new Date('2026-06-04T02:00:00Z'),
      completedAt: new Date('2026-06-04T02:05:00Z'), totalSeconds: 300 },
  ];

  it('금지문자/장이름/중복 라벨에서도 planSplit 시트명과 워크북 시트명이 일치한다', () => {
    const plan = planSplit(edgeQuestions, 'QE');
    const wb = buildSplitWorkbook(edgeQuestions, edgeRows, 'QE', 'sequence');

    const allNames = wb.worksheets.map((w) => w.name);
    expect(allNames[0]).toBe('응답 내역');
    expect(allNames[1]).toBe('공통');
    expect(allNames[allNames.length - 1]).toBe('코딩북');

    // 옵션 시트 이름이 plan.sheets[].name과 순서·내용 모두 일치
    const optionNames = allNames.slice(2, allNames.length - 1);
    expect(optionNames).toEqual(plan.sheets.map((s) => s.name));

    // plan.sheets[].name으로 wb.getWorksheet 조회 가능
    for (const s of plan.sheets) {
      const ws = wb.getWorksheet(s.name);
      expect(ws).toBeDefined();
      // 변수 수 일치 (헤더 1행 셀 수 - 식별자 1)
      expect(ws!.getRow(1).cellCount - 1).toBe(s.vars);
    }

    // 시트명이 31자 이하임을 보장
    for (const nm of allNames) {
      expect(nm.length).toBeLessThanOrEqual(31);
    }

    // 중복 없음
    expect(new Set(allNames).size).toBe(allNames.length);

    // 금지 문자가 시트명에 없음
    for (const nm of allNames) {
      expect(nm).not.toMatch(/[[\]:*?/\\]/);
    }
  });
});

describe('assignSplitSheetNames reserved 시드', () => {
  it('reserved 목록에 있는 이름은 사전 점유로 처리되어 출력에 포함되지 않고, 충돌 시 접미사를 붙인다', () => {
    const result = assignSplitSheetNames(['공통', '코딩북', '합판'], ['공통', '코딩북']);
    expect(result).toEqual(['공통~2', '코딩북~2', '합판']);
  });
});

describe('buildSplitWorkbook 예약 시트명 충돌 방지', () => {
  // 옵션 라벨이 예약 시트명('공통', '코딩북')과 동일한 경우
  const basisCollide = q({
    id: 'QC', type: 'radio', questionCode: 'QC', title: '충돌테스트', order: 0,
    options: [
      { id: 'c1', value: 'val1', label: '공통' },
      { id: 'c2', value: 'val2', label: '코딩북' },
      { id: 'c3', value: 'val3', label: '정상옵션' },
    ],
  } as Partial<Question>);
  const cOnly1 = q({ id: 'C1', type: 'text', title: 'val1전용', order: 1, questionCode: 'C1',
    displayCondition: vm('QC', ['val1']) });
  const cOnly2 = q({ id: 'C2', type: 'text', title: 'val2전용', order: 2, questionCode: 'C2',
    displayCondition: vm('QC', ['val2']) });
  const cOnly3 = q({ id: 'C3', type: 'text', title: 'val3전용', order: 3, questionCode: 'C3',
    displayCondition: vm('QC', ['val3']) });
  const collideQuestions = [basisCollide, cOnly1, cOnly2, cOnly3];
  const collideRows: RawExportResponseRow[] = [
    { id: 'r1', questionResponses: { QC: 'val1', C1: 'v' }, groupValue: null, resid: null,
      platform: null, browser: null, status: 'completed', startedAt: new Date('2026-06-04T03:00:00Z'),
      completedAt: new Date('2026-06-04T03:05:00Z'), totalSeconds: 300 },
  ];

  it('예약 시트명과 충돌하는 옵션 라벨이 있어도 워크북 생성이 throw하지 않고, 시트명 중복이 없다', () => {
    const plan = planSplit(collideQuestions, 'QC');
    let wb: ReturnType<typeof buildSplitWorkbook>;
    expect(() => {
      wb = buildSplitWorkbook(collideQuestions, collideRows, 'QC', 'sequence');
    }).not.toThrow();

    const names = wb!.worksheets.map((w) => w.name);

    // 중복 없음
    expect(new Set(names).size).toBe(names.length);

    // 옵션 시트명이 plan.sheets 순서·내용과 일치
    const optionNames = names.slice(2, names.length - 1);
    expect(optionNames).toEqual(plan.sheets.map((s) => s.name));

    // plan.sheets[].name으로 각 워크시트 조회 가능
    for (const s of plan.sheets) {
      expect(wb!.getWorksheet(s.name)).toBeDefined();
    }

    // 예약 시트 3개가 모두 존재
    for (const reserved of SPLIT_RESERVED_SHEET_NAMES) {
      expect(wb!.getWorksheet(reserved)).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────
// FIX 1: enabled:false / NOT logicType 가드
// ─────────────────────────────────────────────────────────────

/** enabled·logicType 커스텀 헬퍼 */
const vmCustom = (
  sourceQuestionId: string,
  requiredValues: string[],
  opts: { enabled?: boolean; conditionLogicType?: 'AND' | 'OR' | 'NOT'; groupLogicType?: 'AND' | 'OR' | 'NOT' } = {},
): QuestionConditionGroup => ({
  logicType: opts.groupLogicType ?? 'AND',
  conditions: [
    {
      id: 'cx',
      sourceQuestionId,
      conditionType: 'value-match',
      requiredValues,
      logicType: opts.conditionLogicType ?? 'AND',
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
    },
  ],
});

describe('valueMatchSet — enabled/NOT 가드 (FIX 1)', () => {
  it('enabled:false 인 조건은 무시 → null 반환', () => {
    const dc = vmCustom('Q2', ['opt1'], { enabled: false });
    expect(valueMatchSet(dc, 'Q2')).toBeNull();
  });

  it('per-condition logicType:"NOT" 은 무시 → null 반환', () => {
    const dc = vmCustom('Q2', ['opt1'], { conditionLogicType: 'NOT' });
    expect(valueMatchSet(dc, 'Q2')).toBeNull();
  });

  it('그룹 logicType:"NOT" 이면 내부 조건이 positive value-match라도 null 반환', () => {
    const dc = vmCustom('Q2', ['opt1'], { groupLogicType: 'NOT' });
    expect(valueMatchSet(dc, 'Q2')).toBeNull();
  });

  it('enabled 필드가 없으면(undefined) 활성으로 간주 → Set 반환 (하위 호환)', () => {
    const dc = vmCustom('Q2', ['opt1']); // enabled 없음
    const s = valueMatchSet(dc, 'Q2');
    expect(s).not.toBeNull();
    expect([...s!]).toEqual(['opt1']);
  });

  it('enabled:true 이면 활성 → Set 반환', () => {
    const dc = vmCustom('Q2', ['opt2'], { enabled: true });
    const s = valueMatchSet(dc, 'Q2');
    expect(s).not.toBeNull();
    expect([...s!]).toEqual(['opt2']);
  });
});

describe('bucketQuestions — enabled:false 가드 (FIX 1)', () => {
  it('displayCondition이 enabled:false value-match 인 비테이블 질문은 common 버킷에 남는다', () => {
    const basis = q({ id: 'Q2', type: 'radio', questionCode: 'Q2' });
    // 이 질문은 Q2 opt1 value-match 이지만 disabled → common 취급
    const disabledQ = q({
      id: 'D',
      type: 'text',
      displayCondition: vmCustom('Q2', ['opt1'], { enabled: false }),
    });
    const questions = [basis, disabledQ];

    const common = bucketQuestions(questions, 'Q2', 'common');
    expect(common.map((x) => x.id)).toContain('D');

    const opt1 = bucketQuestions(questions, 'Q2', 'opt1');
    expect(opt1.map((x) => x.id)).not.toContain('D');
  });
});

// ─────────────────────────────────────────────────────────────
// FIX 2: splitPlanExceedsExcelLimit 경계 테스트
// ─────────────────────────────────────────────────────────────

describe('splitPlanExceedsExcelLimit (FIX 2)', () => {
  it('maxVars = SPLIT_EXCEL_LIMIT - 1 이면 false (식별자 열 포함해도 한계 이내)', () => {
    expect(splitPlanExceedsExcelLimit(SPLIT_EXCEL_LIMIT - 1)).toBe(false);
  });

  it('maxVars = SPLIT_EXCEL_LIMIT 이면 true (식별자 열 1개 추가 시 16385 > 16384)', () => {
    expect(splitPlanExceedsExcelLimit(SPLIT_EXCEL_LIMIT)).toBe(true);
  });
});
