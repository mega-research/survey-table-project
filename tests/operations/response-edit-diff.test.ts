import { describe, expect, it } from 'vitest';

import {
  buildChangedQuestions,
  diffQuestionResponses,
  mergeChangeLabels,
} from '@/lib/operations/response-edit-diff';
import type { SurveyVersionSnapshot } from '@/db/schema/schema-types';

describe('diffQuestionResponses', () => {
  it('값이 바뀐 questionId 를 찾는다', () => {
    expect(diffQuestionResponses({ q1: 'a', q2: 'x' }, { q1: 'b', q2: 'x' })).toEqual(['q1']);
  });

  it('추가/삭제된 questionId 를 찾는다', () => {
    expect(
      diffQuestionResponses({ q1: 'a' }, { q1: 'a', q2: 'new' }).sort(),
    ).toEqual(['q2']);
    expect(diffQuestionResponses({ q1: 'a', q2: 'old' }, { q1: 'a' })).toEqual(['q2']);
  });

  it('키 순서만 다른 객체 값은 변경으로 보지 않는다', () => {
    expect(
      diffQuestionResponses({ q1: { a: 1, b: 2 } }, { q1: { b: 2, a: 1 } }),
    ).toEqual([]);
  });

  it('중첩 배열/객체의 실제 변경을 감지한다', () => {
    expect(
      diffQuestionResponses({ q1: { rows: [1, 2] } }, { q1: { rows: [1, 3] } }),
    ).toEqual(['q1']);
  });
});

describe('buildChangedQuestions', () => {
  const snapshot = {
    questions: [
      { id: 'q1', title: '성별', questionCode: 'Q1' },
      { id: 'q2', title: '나이' },
    ],
  } as unknown as SurveyVersionSnapshot;

  it('스냅샷에서 code/title 을 매핑한다', () => {
    expect(buildChangedQuestions(['q1'], snapshot)).toEqual([
      { questionId: 'q1', code: 'Q1', title: '성별' },
    ]);
  });

  it('questionCode 없으면 code=null', () => {
    expect(buildChangedQuestions(['q2'], snapshot)).toEqual([
      { questionId: 'q2', code: null, title: '나이' },
    ]);
  });

  it('스냅샷에 없는 id 는 title 을 questionId 로 폴백', () => {
    expect(buildChangedQuestions(['zzz'], snapshot)).toEqual([
      { questionId: 'zzz', code: null, title: 'zzz' },
    ]);
    expect(buildChangedQuestions(['q1'], null)).toEqual([
      { questionId: 'q1', code: null, title: 'q1' },
    ]);
  });
});

describe('mergeChangeLabels', () => {
  it('labelMap 에 있으면 live code/title 로 덮어쓴다 (questionId 폴백 복구)', () => {
    const changes = [{ questionId: 'q1', code: null, title: 'q1' }];
    const map = new Map([['q1', { code: 'Q1', title: '회사 기본사항' }]]);
    expect(mergeChangeLabels(changes, map)).toEqual([
      { questionId: 'q1', code: 'Q1', title: '회사 기본사항' },
    ]);
  });

  it('labelMap 에 없으면 (삭제된 질문) 저장된 스냅샷 값을 유지한다', () => {
    const changes = [{ questionId: 'deleted', code: 'OLD', title: '삭제된 질문' }];
    const map = new Map<string, { code: string | null; title: string }>();
    expect(mergeChangeLabels(changes, map)).toEqual([
      { questionId: 'deleted', code: 'OLD', title: '삭제된 질문' },
    ]);
  });

  it('여러 항목을 각각 매핑한다', () => {
    const changes = [
      { questionId: 'q1', code: null, title: 'q1' },
      { questionId: 'q5', code: null, title: 'q5' },
    ];
    const map = new Map([
      ['q1', { code: 'Q1', title: '회사' }],
      ['q5', { code: 'Q5', title: '성과' }],
    ]);
    expect(mergeChangeLabels(changes, map)).toEqual([
      { questionId: 'q1', code: 'Q1', title: '회사' },
      { questionId: 'q5', code: 'Q5', title: '성과' },
    ]);
  });

  it('__optTexts__ 사이드카는 질문 조회 없이 고정 라벨로 교정한다', () => {
    // 과거 title='__optTexts__' 폴백으로 저장된 행 (프로덕션 500 회귀 방지)
    const changes = [{ questionId: '__optTexts__', code: null, title: '__optTexts__' }];
    expect(mergeChangeLabels(changes, new Map())).toEqual([
      { questionId: '__optTexts__', code: null, title: '기타 상세 기재' },
    ]);
  });
});
