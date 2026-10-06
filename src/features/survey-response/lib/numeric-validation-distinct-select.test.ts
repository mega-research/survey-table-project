import { describe, expect, it } from 'vitest';

import { isRelaxableIssueKind } from '@/features/survey-response/lib/admin-edit-required-relax';
import { collectNumericIssues } from '@/features/survey-response/lib/numeric-validation';
import type { Question, TableCell } from '@/types/survey';

/**
 * 중복 불가 묶음 — 화면에서 회색으로 막는 것과 별개로, 이미 들어온 중복(기능을 켜기 전의 응답·
 * 이월 응답)은 「다음」에서 막는다. 고정 문구이고 클라이언트 전용이다.
 */

const OPTIONS = [
  { id: 'o1', label: '미국', value: 'us' },
  { id: 'o2', label: '일본', value: 'jp' },
];

function select(id: string, group?: string): TableCell {
  return {
    id,
    type: 'select',
    content: '',
    selectOptions: OPTIONS,
    ...(group ? { distinctGroup: group } : {}),
  };
}

const question = {
  id: 'q1',
  type: 'table',
  title: '표',
  required: false,
  order: 0,
  tableColumns: [
    { id: 'c1', label: '2025년' },
    { id: 'c2', label: '2026년' },
  ],
  tableRowsData: [
    { id: 'r1', label: '1', cells: [select('a1', '2025'), select('b1', '2026')] },
    { id: 'r2', label: '2', cells: [select('a2', '2025'), select('b2', '2026')] },
  ],
} as Question;

function distinctIssues(response: Record<string, unknown>) {
  return collectNumericIssues(question, response, undefined).filter(
    (issue) => issue.kind === 'distinct',
  );
}

describe('중복 불가 묶음 — 차단 검증', () => {
  it('같은 묶음에 같은 보기가 둘이면 막고 두 칸을 짚는다', () => {
    const issues = distinctIssues({ a1: 'us', a2: 'us' });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('같은 항목을 두 번 선택할 수 없습니다.');
    expect([...(issues[0]!.cellIds ?? [])].sort()).toEqual(['a1', 'a2']);
  });

  it('묶음이 다르면 같은 보기를 골라도 통과한다', () => {
    expect(distinctIssues({ a1: 'us', b1: 'us', a2: 'jp', b2: 'jp' })).toEqual([]);
  });

  it('관리자 응답 수정에서도 완화하지 않는다', () => {
    expect(isRelaxableIssueKind('distinct')).toBe(false);
  });
});
