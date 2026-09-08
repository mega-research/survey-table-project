import { describe, expect, it } from 'vitest';

import type { Question, TableCell, TableRow } from '@/types/survey';

import { collectNumericIssues } from './numeric-validation';

function textQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'text',
    title: '연락처',
    required: false,
    order: 0,
    ...overrides,
  } as Question;
}

describe('collectNumericIssues — 입력 형식', () => {
  it('형식이 맞으면 이슈가 없다', () => {
    const q = textQuestion({ inputType: 'mobile' });
    expect(collectNumericIssues(q, '010-1234-5678')).toEqual([]);
    expect(collectNumericIssues(q, '01012345678')).toEqual([]);
  });

  it('형식이 틀리면 kind format 이슈가 나오고 사유별 문구가 실린다', () => {
    const issues = collectNumericIssues(textQuestion({ inputType: 'mobile' }), '02-1234-5678');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('format');
    expect(issues[0]?.message).toBe('휴대전화 번호가 아닙니다');

    const bizIssues = collectNumericIssues(
      textQuestion({ inputType: 'biz_number' }),
      '111-11-11111',
    );
    expect(bizIssues[0]?.message).toBe('사업자번호 확인번호가 맞지 않습니다. 다시 확인해 주세요');
  });

  it('빈 값은 형식 검사 대상이 아니다 — 미입력 차단은 필수 판정 소관', () => {
    const q = textQuestion({ inputType: 'email', required: true });
    expect(collectNumericIssues(q, '')).toEqual([]);
    expect(collectNumericIssues(q, '   ')).toEqual([]);
    expect(collectNumericIssues(q, undefined)).toEqual([]);
  });

  it('형식을 지정하지 않은 단답형은 어떤 값도 막지 않는다', () => {
    expect(collectNumericIssues(textQuestion(), '아무 말')).toEqual([]);
    expect(collectNumericIssues(textQuestion({ inputType: 'text' }), '010-1')).toEqual([]);
  });

  it('숫자 모드는 형식 검사를 타지 않는다 — 범위 검증 그대로', () => {
    const q = textQuestion({ inputType: 'number', numberFormat: { min: 10 } });
    expect(collectNumericIssues(q, '5')[0]?.kind).toBe('range');
    expect(collectNumericIssues(q, '50')).toEqual([]);
  });
});

function tableQuestion(cells: Array<Partial<TableCell> & { id: string }>): Question {
  const rows: TableRow[] = [
    {
      id: 'r1',
      cells: cells.map((c) => ({ type: 'input', content: '', ...c })),
    },
  ] as TableRow[];
  return {
    id: 'qt',
    type: 'table',
    title: '표',
    required: false,
    order: 0,
    tableRowsData: rows,
  } as Question;
}

describe('collectNumericIssues — 표 input 셀 형식', () => {
  const q = tableQuestion([
    { id: 'c1', inputType: 'mobile' },
    { id: 'c2', inputType: 'email' },
    { id: 'c3' },
  ]);

  it('형식이 맞으면 이슈가 없다', () => {
    expect(collectNumericIssues(q, { c1: '010-1234-5678', c2: 'a@b.com', c3: '아무 말' })).toEqual(
      [],
    );
  });

  it('형식이 틀린 셀을 짚어낸다', () => {
    const issues = collectNumericIssues(q, { c1: '02-1234-5678', c2: 'a@b.com' });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('format');
    expect(issues[0]?.cellIds).toEqual(['c1']);
  });

  it('여러 셀이 틀리면 한 이슈에 모아 짚는다', () => {
    const issues = collectNumericIssues(q, { c1: '02-1234-5678', c2: '이메일아님' });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.cellIds).toEqual(['c1', 'c2']);
  });

  it('빈 셀과 형식 미지정 셀은 검사하지 않는다', () => {
    expect(collectNumericIssues(q, { c1: '', c2: '   ', c3: '010-1' })).toEqual([]);
  });

  it('숨은 셀·미선택 동적 행의 잔존값은 막지 않는다', () => {
    const hidden = tableQuestion([{ id: 'c1', inputType: 'mobile', isHidden: true }]);
    expect(collectNumericIssues(hidden, { c1: '틀린값' })).toEqual([]);
  });
});
