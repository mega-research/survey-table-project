import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { collectNumericIssues } from './numeric-validation';

const b3 = {
  id: 'b3',
  type: 'checkbox',
  title: 'B3',
  required: true,
  order: 2,
  options: [
    { id: 'o1', label: '1', value: '1' },
    { id: 'o2', label: '2', value: '2' },
    { id: 'o3', label: '3', value: '3' },
    { id: 'o9', label: '없음', value: '9', exclusiveChoice: true },
  ],
  maxSelectionsSource: { questionId: 'b2', unlimitedFrom: 5 },
} as Question;

const issuesFor = (answer: unknown, b2: string | undefined, question: Question = b3) =>
  collectNumericIssues(question, answer, {
    allResponses: { ...(b2 !== undefined ? { b2 } : {}), b3: answer },
    allQuestions: [question],
  }).filter((issue) => issue.kind === 'selection-max');

describe('collectNumericIssues — 최대 선택 개수가 다른 문항 응답을 따라갈 때', () => {
  it('참조값보다 많이 고른 상태면 차단한다 — 참조 문항을 나중에 줄인 경우', () => {
    const issues = issuesFor(['1', '2', '3'], '1');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe('최대 1개까지 선택할 수 있습니다. (현재 3개 선택)');
  });

  it('상한 안이면 통과한다', () => {
    expect(issuesFor(['1', '2'], '2')).toEqual([]);
    expect(issuesFor(['1'], '3')).toEqual([]);
  });

  it('제한 없음 구간과 참조값 미응답은 통과한다', () => {
    expect(issuesFor(['1', '2', '3'], '5')).toEqual([]);
    expect(issuesFor(['1', '2', '3'], undefined)).toEqual([]);
  });

  it('단독 선택 보기는 개수에 세지 않는다', () => {
    expect(issuesFor(['9'], '1')).toEqual([]);
  });

  it('출처가 없는 고정 상한 문항은 검사하지 않는다 — 종전 동작 유지', () => {
    const { maxSelectionsSource: _source, ...rest } = b3;
    const fixed = { ...rest, maxSelections: 1 } as Question;
    expect(issuesFor(['1', '2', '3'], '1', fixed)).toEqual([]);
  });
});
