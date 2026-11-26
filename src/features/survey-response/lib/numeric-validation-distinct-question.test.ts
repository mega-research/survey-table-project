import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { collectNumericIssues } from './numeric-validation';

// 청암대 교직원 문3-10(만족스러운 휴가제도)·문3-11(불만족스러운 휴가제도) 모양 — 보기가 같은 단일 선택 한 쌍.
const LEAVE_OPTIONS = [
  { id: 'o1', label: '1. 특별휴가', value: '1' },
  { id: 'o2', label: '2. 병가', value: '2' },
  { id: 'o3', label: '3. 공가', value: '3' },
  { id: 'o4', label: '4. 연가', value: '4' },
];
const single = (id: string, extra: Partial<Question> = {}): Question =>
  ({
    id,
    type: 'radio',
    title: id,
    required: true,
    order: 0,
    options: LEAVE_OPTIONS,
    distinctGroup: 'leave',
    ...extra,
  }) as Question;

const q310 = single('q310');
const q311 = single('q311');

function distinctIssues(
  target: Question,
  responses: Record<string, unknown>,
  questions: Question[] = [q310, q311],
) {
  return collectNumericIssues(target, responses[target.id], {
    allResponses: responses,
    allQuestions: questions,
  }).filter((issue) => issue.kind === 'distinct');
}

describe('collectNumericIssues — 문항 사이의 중복 불가 묶음', () => {
  it('같은 묶음의 두 문항이 같은 보기를 고르면 두 문항 모두 막는다', () => {
    const responses = { q310: '2', q311: '2' };
    const first = distinctIssues(q310, responses);
    expect(first).toHaveLength(1);
    expect(first[0]?.message).toBe('다른 문항과 답이 같습니다. 서로 다른 보기를 골라 주세요.');
    expect(first[0]?.cellIds).toBeUndefined();
    expect(distinctIssues(q311, responses)).toHaveLength(1);
  });

  it('다른 보기를 골랐거나 한쪽이 아직 답하지 않았으면 통과한다', () => {
    expect(distinctIssues(q311, { q310: '2', q311: '3' })).toEqual([]);
    expect(distinctIssues(q310, { q310: '2' })).toEqual([]);
    expect(distinctIssues(q311, { q310: '2' })).toEqual([]);
    expect(distinctIssues(q311, { q310: '', q311: '' })).toEqual([]);
    expect(distinctIssues(q311, { q310: null, q311: null })).toEqual([]);
  });

  it('묶음 이름이 다르거나 없거나 공백뿐이면 같은 보기를 골라도 통과한다', () => {
    const responses = { q310: '2', q311: '2' };
    const other = single('q311', { distinctGroup: 'welfare' });
    expect(distinctIssues(other, responses, [q310, other])).toEqual([]);
    const { distinctGroup: _group, ...rest } = q311;
    const none = rest as Question;
    expect(distinctIssues(none, responses, [q310, none])).toEqual([]);
    expect(distinctIssues(q310, responses, [q310, none])).toEqual([]);
    const blankA = single('q310', { distinctGroup: '  ' });
    const blankB = single('q311', { distinctGroup: '  ' });
    expect(distinctIssues(blankB, responses, [blankA, blankB])).toEqual([]);
  });

  it('묶음 이름은 앞뒤 공백을 떼고 비교한다', () => {
    const padded = single('q311', { distinctGroup: ' leave ' });
    expect(distinctIssues(padded, { q310: '2', q311: '2' }, [q310, padded])).toHaveLength(1);
  });

  it('드롭다운 단일 선택 문항도 같은 규칙이고, 라디오와 드롭다운이 섞여도 묶인다', () => {
    const select = single('q311', { type: 'select' });
    const responses = { q310: '4', q311: '4' };
    expect(distinctIssues(select, responses, [q310, select])).toHaveLength(1);
    expect(distinctIssues(q310, responses, [q310, select])).toHaveLength(1);
  });

  it('옛 「기타」 보기를 고른 객체 모양 답도 고른 보기 값으로 비교한다', () => {
    const other = { selectedValue: '4', otherValue: '안식년', hasOther: true };
    // 객체 ↔ 객체, 글자 ↔ 객체 어느 조합이든 겹치면 막는다
    expect(distinctIssues(q311, { q310: other, q311: { ...other, otherValue: '' } })).toHaveLength(1);
    expect(distinctIssues(q311, { q310: '4', q311: other })).toHaveLength(1);
    expect(distinctIssues(q310, { q310: '4', q311: other })).toHaveLength(1);
    expect(distinctIssues(q311, { q310: '3', q311: other })).toEqual([]);
  });

  it('세 문항 묶음에서는 겹친 문항만 막는다', () => {
    const q312 = single('q312');
    const all = [q310, q311, q312];
    const responses = { q310: '1', q311: '3', q312: '1' };
    expect(distinctIssues(q310, responses, all)).toHaveLength(1);
    expect(distinctIssues(q311, responses, all)).toEqual([]);
    expect(distinctIssues(q312, responses, all)).toHaveLength(1);
  });

  it('복수 선택·순위·표 문항은 묶음 이름이 있어도 동작하지 않고, 단일 선택 문항의 상대도 되지 않는다', () => {
    const checkbox = single('q311', { type: 'checkbox' });
    expect(distinctIssues(checkbox, { q310: '2', q311: ['2'] }, [q310, checkbox])).toEqual([]);
    // 상대가 대상 유형이 아니면 응답 글자가 같아도 비교하지 않는다
    const text = single('q311', { type: 'text' });
    expect(distinctIssues(q310, { q310: '2', q311: '2' }, [q310, text])).toEqual([]);
  });

  it('숨어서 답이 지워진 문항은 응답에 없으므로 비교하지 않는다', () => {
    expect(distinctIssues(q311, { q311: '2' })).toEqual([]);
  });

  it('분기로 건너뛴 쪽에 남은 답과는 비교하지 않는다 — 경로 위 문항만 상대다', () => {
    const responses = { q310: '2', q311: '2' };
    const issuesOn = (traversed: string[]) =>
      collectNumericIssues(q311, '2', {
        allResponses: responses,
        allQuestions: [q310, q311],
        traversedQuestionIds: new Set(traversed),
      }).filter((issue) => issue.kind === 'distinct');
    expect(issuesOn(['q311'])).toEqual([]);
    expect(issuesOn(['q310', 'q311'])).toHaveLength(1);
  });

  it('문구는 현재 언어를 따른다', () => {
    const responses = { q310: '2', q311: '2' };
    const ctx = { allResponses: responses, allQuestions: [q310, q311] };
    const messageIn = (locale: 'zh' | 'en') =>
      collectNumericIssues(q311, '2', ctx, locale).find((issue) => issue.kind === 'distinct')
        ?.message;
    expect(messageIn('zh')).toBe('与其他题目的答案相同。请选择不同的选项。');
    expect(messageIn('en')).toBe('This answer is the same as in another question. Please choose a different option.');
  });

  it('검증 컨텍스트가 없으면 다른 문항을 알 수 없어 검사하지 않는다', () => {
    expect(collectNumericIssues(q311, '2').filter((issue) => issue.kind === 'distinct')).toEqual(
      [],
    );
  });
});
