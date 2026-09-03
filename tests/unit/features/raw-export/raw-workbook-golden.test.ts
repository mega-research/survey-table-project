import { describe, expect, it } from 'vitest';

import { type RawExportContext, type RawExportResponseRow, generateRawDataWorkbook } from '@/lib/analytics/raw-workbook';
import { buildSplitWorkbook } from '@/lib/analytics/split-workbook';
import type { Question, QuestionConditionGroup } from '@/types/survey';

// Raw·분할 워크북의 셀 행렬 골든 스냅샷.
//
// 「조사 대상 중 미응답자 포함」 토글이 꺼진 경로(= 응답 행만)의 출력이 도입 전과 한 글자도
// 다르지 않아야 한다. xlsx 바이트는 ExcelJS 가 docProps 에 생성 시각을 넣어 비교할 수 없으므로
// 시트별 getSheetValues() 와 병합 범위를 스냅샷으로 박는다. 이 스냅샷이 바뀌면 응답 행 출력이
// 바뀐 것이다 — 의도한 변경일 때만 갱신한다.

const vm = (sourceQuestionId: string, requiredValues: string[]): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    { id: 'c1', sourceQuestionId, conditionType: 'value-match', requiredValues, logicType: 'AND' },
  ],
});

const radioQ = {
  id: 'q1',
  type: 'radio',
  title: 'Q1. 성별',
  order: 1,
  required: false,
  questionCode: 'Q1',
  options: [
    { id: 'a', label: '남성', value: 'opt1', spssNumericCode: 1 },
    { id: 'b', label: '여성', value: 'opt2', spssNumericCode: 2 },
  ],
} as unknown as Question;

// 남성 응답자에게만 보이는 복수 선택 — 분할 워크북에서 옵션 시트로 나간다.
const checkboxQ = {
  id: 'q2',
  type: 'checkbox',
  title: 'Q2. 관심분야',
  order: 2,
  required: false,
  questionCode: 'Q2',
  displayCondition: vm('q1', ['opt1']),
  options: [
    { id: 'x', label: 'AI', value: 'optA', spssNumericCode: 1 },
    { id: 'y', label: 'ML', value: 'optB', spssNumericCode: 2 },
  ],
} as unknown as Question;

const tableInputQ = {
  id: 'qt',
  type: 'table',
  title: '문3. 매출액',
  order: 3,
  required: false,
  questionCode: 'Q3',
  tableColumns: [{ id: 'tc', label: '2020년 매출액', columnCode: '2020' }],
  tableRowsData: [
    {
      id: 'tr',
      label: '기업 전체',
      rowCode: 'u00',
      cells: [{ id: 'cellInput', type: 'input', content: '' }],
    },
  ],
} as unknown as Question;

const QUESTIONS = [radioQ, checkboxQ, tableInputQ];

const CTX: RawExportContext = {
  appUrl: 'https://app.example.com',
  stepLabels: new Map([['group:g1', 'Q1']]),
  hasContacts: true,
  questionMeta: new Map([
    ['q1', { order: 1, label: 'Q1' }],
    ['q2', { order: 2, label: 'Q2' }],
    ['qt', { order: 3, label: 'Q3' }],
  ]),
};

const completedRow: RawExportResponseRow = {
  id: 'r-1',
  questionResponses: { q1: 'opt1', q2: ['optA', 'optB'], qt: { tr: { tc: '1200' } } },
  resid: 7,
  inviteCode: 'abc123defg',
  ipHash: '0123456789abcdef0123456789abcdef',
  currentStepId: 'group:g1',
  platform: 'desktop',
  browser: 'Chrome',
  status: 'completed',
  startedAt: new Date('2026-07-01T00:00:00Z'),
  completedAt: new Date('2026-07-01T00:10:00Z'),
  totalSeconds: 600,
};

const inProgressRow: RawExportResponseRow = {
  id: 'r-2',
  questionResponses: { q1: 'opt2' },
  resid: 3,
  inviteCode: 'zzz999yyy8',
  ipHash: 'fedcba9876543210fedcba9876543210',
  currentStepId: 'group:g1',
  platform: 'mobile',
  browser: 'Safari',
  status: 'in_progress',
  startedAt: new Date('2026-07-02T03:30:00Z'),
  completedAt: null,
  totalSeconds: null,
};

const anonymousRow: RawExportResponseRow = {
  id: 'r-3',
  questionResponses: { q1: 'opt1' },
  resid: null,
  inviteCode: null,
  ipHash: null,
  currentStepId: null,
  platform: 'tablet',
  browser: null,
  status: 'drop',
  startedAt: new Date('2026-07-03T12:00:00Z'),
  completedAt: null,
  totalSeconds: 45,
};

const ROWS = [completedRow, inProgressRow, anonymousRow];

function sheetMatrix(wb: { worksheets: Array<{ name: string; getSheetValues: () => unknown[]; model: { merges: unknown } }> }) {
  return wb.worksheets.map((ws) => ({
    name: ws.name,
    values: ws.getSheetValues(),
    merges: ws.model.merges,
  }));
}

describe('Raw 워크북 골든 스냅샷 — 응답 행만 있는 기본 경로', () => {
  it('generateRawDataWorkbook 의 모든 시트 셀 행렬과 병합 범위가 스냅샷과 같다', () => {
    const wb = generateRawDataWorkbook(QUESTIONS, ROWS, CTX);
    expect(sheetMatrix(wb)).toMatchSnapshot();
  });

  it('buildSplitWorkbook 의 모든 시트 셀 행렬과 병합 범위가 스냅샷과 같다', () => {
    const wb = buildSplitWorkbook(QUESTIONS, ROWS, 'q1', CTX);
    expect(sheetMatrix(wb)).toMatchSnapshot();
  });
});
