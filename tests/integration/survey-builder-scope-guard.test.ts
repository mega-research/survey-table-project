import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// WS-2 IDOR 봉인: questions / question-groups service 의 update/delete/reorder 가
// surveyId 스코프를 WHERE 에 반영해, 다른 설문 소속 행을 건드리지 못하도록 막는지 검증한다.
//
// 핵심 시나리오:
//   - 다른 surveyId 로 update/delete -> 영향 0행 -> 실패 throw
//   - 정상 surveyId -> 1행 영향 -> 성공
//   - reorder: questionIds/groupIds 에 타 설문 id 가 섞이면 거부
//   - 정상 reorder -> 성공
//
// db 는 drizzle fluent chain 흉내. update/delete 의 .returning() 결과와 query.*.find* /
// select 결과를 큐로 제어한다. 이미지/promote 부수효과는 통째로 모킹해 격리한다.

const {
  updateReturningQueue,
  findFirstQueue,
  findManyQueue,
} = vi.hoisted(() => ({
  updateReturningQueue: [] as unknown[][],
  findFirstQueue: [] as unknown[],
  findManyQueue: [] as unknown[][],
}));

// promote 체인 / 이미지 cleanup 은 부수효과라 통째로 우회한다.
vi.mock('@/lib/survey/survey-image-promote', () => ({
  promoteSurveyImages: vi.fn(async (rows: unknown[]) => rows),
}));
vi.mock('@/lib/image-extractor', () => ({
  extractImageUrlsFromQuestion: vi.fn(() => []),
}));
vi.mock('@/lib/image-utils-server', () => ({
  deleteImagesFromR2Server: vi.fn(async () => undefined),
}));
vi.mock('@/data/surveys', () => ({
  getQuestionsBySurvey: vi.fn(async () => []),
  getQuestionGroupsBySurvey: vi.fn(async () => []),
}));

vi.mock('@/db', () => {
  function makeUpdateChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['set'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => chain);
    chain['returning'] = vi.fn(() => Promise.resolve(updateReturningQueue.shift() ?? []));
    (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) => resolve(undefined);
    return chain;
  }

  function makeDeleteChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['where'] = vi.fn(() => chain);
    (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) => resolve(undefined);
    return chain;
  }

  function makeSelectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['from'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => ({
      then: (resolve: (v: unknown) => unknown) => resolve(findManyQueue.shift() ?? []),
    }));
    return chain;
  }

  const queryStub = {
    findFirst: vi.fn(() => Promise.resolve(findFirstQueue.shift() ?? null)),
    findMany: vi.fn(() => Promise.resolve(findManyQueue.shift() ?? [])),
  };

  return {
    db: {
      update: vi.fn(() => makeUpdateChain()),
      delete: vi.fn(() => makeDeleteChain()),
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })),
      })),
      query: {
        questions: queryStub,
        questionGroups: queryStub,
      },
    },
  };
});

import {
  deleteQuestion,
  reorderQuestions,
  updateQuestion,
} from '@/features/survey-builder/server/services/questions.service';
import {
  deleteQuestionGroup,
  reorderGroups,
  updateQuestionGroup,
} from '@/features/survey-builder/server/services/question-groups.service';

const QID = '11111111-1111-4111-8111-111111111111';
const QID_2 = '22222222-2222-4222-8222-222222222222';
const GID = '33333333-3333-4333-8333-333333333333';
const GID_2 = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  updateReturningQueue.length = 0;
  findFirstQueue.length = 0;
  findManyQueue.length = 0;
});

describe('updateQuestion 설문 스코프', () => {
  it('다른 설문 소속이면(영향 0행) 실패 throw', async () => {
    updateReturningQueue.push([]); // 0행 영향
    await expect(
      updateQuestion(QID, 'other-survey', { title: '바뀐 제목' }),
    ).rejects.toThrow('질문 업데이트에 실패했습니다.');
  });

  it('정상 설문이면(1행 영향) 성공한다', async () => {
    updateReturningQueue.push([{ id: QID, surveyId: 'sv-1', title: '바뀐 제목' }]);
    await expect(
      updateQuestion(QID, 'sv-1', { title: '바뀐 제목' }),
    ).resolves.toMatchObject({ id: QID });
  });
});

describe('deleteQuestion 설문 스코프', () => {
  it('다른 설문 소속이면(조회 0행) 행을 삭제하지 않는다', async () => {
    findFirstQueue.push(null); // 스코프 조회 0행
    await expect(
      deleteQuestion(QID, 'other-survey'),
    ).resolves.toEqual({ ok: true });
  });

  it('정상 설문이면 성공한다', async () => {
    findFirstQueue.push({ id: QID, surveyId: 'sv-1' });
    await expect(deleteQuestion(QID, 'sv-1')).resolves.toEqual({ ok: true });
  });
});

describe('reorderQuestions 소속 검증', () => {
  it('questionIds 에 타 설문 질문이 섞이면 거부한다', async () => {
    // 소속 조회: QID 만 sv-1 소속, QID_2 는 누락(타 설문) -> 불일치
    findManyQueue.push([{ id: QID, surveyId: 'sv-1' }]);
    await expect(
      reorderQuestions([QID, QID_2], 'sv-1'),
    ).rejects.toThrow(/소속|reorder|설문/);
  });

  it('모두 같은 설문 소속이면 성공한다', async () => {
    findManyQueue.push([
      { id: QID, surveyId: 'sv-1' },
      { id: QID_2, surveyId: 'sv-1' },
    ]);
    await expect(
      reorderQuestions([QID, QID_2], 'sv-1'),
    ).resolves.toEqual({ ok: true });
  });
});

describe('updateQuestionGroup 설문 스코프', () => {
  it('다른 설문 소속이면(영향 0행) 실패 throw', async () => {
    updateReturningQueue.push([]); // 0행 영향
    await expect(
      updateQuestionGroup(GID, 'other-survey', { name: '바뀐 그룹명' }),
    ).rejects.toThrow('질문 그룹 업데이트에 실패했습니다.');
  });

  it('정상 설문이면(1행 영향) 성공한다', async () => {
    updateReturningQueue.push([{ id: GID, surveyId: 'sv-1', name: '바뀐 그룹명' }]);
    await expect(
      updateQuestionGroup(GID, 'sv-1', { name: '바뀐 그룹명' }),
    ).resolves.toMatchObject({ id: GID });
  });
});

describe('deleteQuestionGroup 설문 스코프', () => {
  it('다른 설문 소속이면(조회 0행) 행을 삭제하지 않는다', async () => {
    findFirstQueue.push(null); // 스코프 조회 0행
    await expect(
      deleteQuestionGroup(GID, 'other-survey'),
    ).resolves.toEqual({ ok: true });
  });

  it('정상 설문이면 자손 수집 후 성공한다', async () => {
    findFirstQueue.push({ id: GID, surveyId: 'sv-1' }); // 타깃 그룹 스코프 조회
    findManyQueue.push([{ id: GID, surveyId: 'sv-1', parentGroupId: null }]); // 동일 설문 그룹 목록
    await expect(deleteQuestionGroup(GID, 'sv-1')).resolves.toEqual({ ok: true });
  });
});

describe('reorderGroups 소속 검증', () => {
  it('groupIds 에 타 설문 그룹이 섞이면 거부한다', async () => {
    // 현재 설문 그룹 목록: GID 만 존재. GID_2 는 타 설문 -> 불일치
    findManyQueue.push([{ id: GID, order: 0 }]);
    await expect(
      reorderGroups('sv-1', [GID, GID_2]),
    ).rejects.toThrow(/소속|reorder|설문/);
  });

  it('모두 같은 설문 소속이면 성공한다', async () => {
    findManyQueue.push([
      { id: GID, order: 0 },
      { id: GID_2, order: 1 },
    ]);
    await expect(
      reorderGroups('sv-1', [GID, GID_2]),
    ).resolves.toEqual({ ok: true });
  });
});
