import { describe, expect, it } from 'vitest';

import { buildSurveyDiffPayload } from '@/lib/survey-builder/diff-payload';
import { emptyChangeset, type QuestionChangeset } from '@/lib/survey-builder/changeset';
import type { Survey } from '@/types/survey';

/**
 * SurveyDiffPayload 조립 의미론 고정 — use-survey-sync 인라인 조립(구 L74-106)에서
 * 이관된 규칙들: 메타데이터 조건부 필드 생략, contactEmail null 폴백,
 * dirtyIds = added∪updated 현재 질문 필터, reordered 시 전체 id 순서.
 */

function makeChangeset(partial: Partial<QuestionChangeset> = {}): QuestionChangeset {
  return { ...emptyChangeset(), ...partial };
}

function makeSurvey(partial: Record<string, unknown> = {}): Survey {
  return {
    id: 'sv-1',
    title: '테스트 설문',
    settings: { thankYouMessage: '감사합니다' },
    questions: [
      { id: 'q1', type: 'text', title: 'Q1', required: false, order: 0 },
      { id: 'q2', type: 'text', title: 'Q2', required: false, order: 1 },
      { id: 'q3', type: 'text', title: 'Q3', required: false, order: 2 },
    ],
    ...partial,
  } as unknown as Survey;
}

function snapshot(qc: QuestionChangeset, isMetadataDirty = false) {
  return { questionChanges: qc, isMetadataDirty };
}

describe('buildSurveyDiffPayload', () => {
  it('변경이 전혀 없으면 null', () => {
    expect(buildSurveyDiffPayload(makeSurvey(), snapshot(makeChangeset()))).toBeNull();
  });

  it('메타데이터만 변경: metadata 포함, questionChanges 없음', () => {
    const payload = buildSurveyDiffPayload(makeSurvey(), snapshot(makeChangeset(), true));
    expect(payload).toMatchObject({
      surveyId: 'sv-1',
      metadata: {
        title: '테스트 설문',
        contactEmail: null,
        thankYouMessage: '감사합니다',
      },
    });
    expect(payload?.questionChanges).toBeUndefined();
  });

  it('메타데이터 optional 필드: undefined 면 키 자체를 생략', () => {
    const payload = buildSurveyDiffPayload(makeSurvey(), snapshot(makeChangeset(), true));
    expect(payload?.metadata).not.toHaveProperty('description');
    expect(payload?.metadata).not.toHaveProperty('slug');
    expect(payload?.metadata).not.toHaveProperty('privateToken');
    expect(payload).not.toHaveProperty('groups');
  });

  it('메타데이터 optional 필드: 정의돼 있으면 포함 (groups 포함)', () => {
    const groups = [{ id: 'g1', name: '그룹' }];
    const payload = buildSurveyDiffPayload(
      makeSurvey({ description: '설명', slug: 'slug-1', privateToken: 'tok', groups }),
      snapshot(makeChangeset(), true),
    );
    expect(payload?.metadata).toMatchObject({
      description: '설명',
      slug: 'slug-1',
      privateToken: 'tok',
    });
    expect(payload?.groups).toBe(groups);
  });

  it('contactEmail: undefined → null 폴백, 값 있으면 그대로', () => {
    const without = buildSurveyDiffPayload(makeSurvey(), snapshot(makeChangeset(), true));
    expect(without?.metadata?.contactEmail).toBeNull();

    const withEmail = buildSurveyDiffPayload(
      makeSurvey({ contactEmail: 'a@b.c' }),
      snapshot(makeChangeset(), true),
    );
    expect(withEmail?.metadata?.contactEmail).toBe('a@b.c');
  });

  it('질문 변경: added∪updated 합집합으로 현재 질문을 필터해 upserted 구성', () => {
    const payload = buildSurveyDiffPayload(
      makeSurvey(),
      snapshot(makeChangeset({ added: { q1: true }, updated: { q3: true } })),
    );
    expect(payload?.metadata).toBeUndefined();
    expect(payload?.questionChanges?.upserted.map((q) => q.id)).toEqual(['q1', 'q3']);
    expect(payload?.questionChanges?.deleted).toEqual([]);
  });

  it('dirty id 가 현재 질문 목록에 없으면 upserted 에서 자연 탈락', () => {
    const payload = buildSurveyDiffPayload(
      makeSurvey(),
      snapshot(makeChangeset({ updated: { q2: true, ghost: true } })),
    );
    expect(payload?.questionChanges?.upserted.map((q) => q.id)).toEqual(['q2']);
  });

  it('deleted: 키 목록 그대로 전송 (질문 목록 실재 여부 무관)', () => {
    const payload = buildSurveyDiffPayload(
      makeSurvey(),
      snapshot(makeChangeset({ deleted: { gone1: true, gone2: true } })),
    );
    expect(payload?.questionChanges?.deleted).toEqual(['gone1', 'gone2']);
    expect(payload?.questionChanges?.upserted).toEqual([]);
  });

  it('reordered: true 면 현재 질문 전체 id 순서를 전송, false 면 키 자체 생략', () => {
    const reordered = buildSurveyDiffPayload(
      makeSurvey(),
      snapshot(makeChangeset({ reordered: true })),
    );
    expect(reordered?.questionChanges?.reorderedIds).toEqual(['q1', 'q2', 'q3']);

    const notReordered = buildSurveyDiffPayload(
      makeSurvey(),
      snapshot(makeChangeset({ added: { q1: true } })),
    );
    expect(notReordered?.questionChanges).not.toHaveProperty('reorderedIds');
  });

  it('메타데이터 + 질문 동시 변경: 두 섹션 모두 포함', () => {
    const payload = buildSurveyDiffPayload(
      makeSurvey(),
      snapshot(makeChangeset({ added: { q2: true } }), true),
    );
    expect(payload?.metadata).toBeDefined();
    expect(payload?.questionChanges?.upserted.map((q) => q.id)).toEqual(['q2']);
  });

  it('입력을 변형하지 않는다 (순수 함수)', () => {
    const survey = makeSurvey();
    const qc = makeChangeset({ added: { q1: true }, reordered: true });
    const questionsBefore = survey.questions.map((q) => q.id);

    buildSurveyDiffPayload(survey, snapshot(qc, true));

    expect(survey.questions.map((q) => q.id)).toEqual(questionsBefore);
    expect(qc).toEqual(makeChangeset({ added: { q1: true }, reordered: true }));
  });
});
