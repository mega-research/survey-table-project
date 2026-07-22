import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * L75 회귀: applyMultipleSavedQuestions 입력 ids 순서 보존.
 *
 * 사용자가 라이브러리에서 질문 B, A 순으로 다중 선택하면 selectedQuestions(Set)는
 * 선택 순서대로 [B, A] 를 보존하고 그대로 ids 로 전달된다.
 * 그러나 db.query.findMany({ where: inArray(...) }) 는 PG 저장(PK) 순서로 행을 반환하므로
 * 재정렬이 없으면 결과가 [A, B] 로 뒤집혀 빌더에 엉뚱한 순서로 삽입된다.
 * 서비스는 ids 인덱스를 기준으로 재정렬해 선택 순서를 보존해야 한다.
 */

const findMany = vi.fn();

vi.mock('@/db', () => ({
  db: {
    query: {
      savedQuestions: {
        findMany: (...args: unknown[]) => findMany(...args),
      },
    },
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  },
  savedQuestions: { id: 'id', usageCount: 'usageCount' },
}));

import { applyMultipleSavedQuestions } from '@/features/library/server/services/saved-questions.service';

describe('applyMultipleSavedQuestions 순서 보존 (L75 회귀)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DB 저장 순서와 무관하게 입력 ids 순서대로 반환한다', async () => {
    // findMany 는 PG 저장 순서(A, B)로 반환 — 사용자 선택 순서(B, A)와 반대.
    findMany.mockResolvedValue([
      { id: 'A', question: { id: 'qa', type: 'text', title: '질문A', required: false, order: 0 } },
      { id: 'B', question: { id: 'qb', type: 'text', title: '질문B', required: false, order: 0 } },
    ]);

    const result = await applyMultipleSavedQuestions(['B', 'A']);

    expect(result.map((q) => q.title)).toEqual(['질문B', '질문A']);
  });

  it('존재하지 않는 id 는 건너뛰고 나머지는 순서를 유지한다', async () => {
    findMany.mockResolvedValue([
      { id: 'A', question: { id: 'qa', type: 'text', title: '질문A', required: false, order: 0 } },
      { id: 'C', question: { id: 'qc', type: 'text', title: '질문C', required: false, order: 0 } },
    ]);

    // 'B' 는 DB 에 없음 — 결과에서 제외되고 [C, A] 순서 유지.
    const result = await applyMultipleSavedQuestions(['C', 'B', 'A']);

    expect(result.map((q) => q.title)).toEqual(['질문C', '질문A']);
  });

  it('빈 ids 는 빈 배열을 반환하고 DB 를 조회하지 않는다', async () => {
    const result = await applyMultipleSavedQuestions([]);

    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('삽입되는 질문은 새 id 와 order 0 을 가진다', async () => {
    findMany.mockResolvedValue([
      { id: 'A', question: { id: 'qa', type: 'text', title: '질문A', required: false, order: 5, groupId: 'g1' } },
    ]);

    const result = await applyMultipleSavedQuestions(['A']);

    expect(result).toHaveLength(1);
    expect(result[0]?.order).toBe(0);
    expect(result[0]?.id).not.toBe('qa');
    // groupId 는 제거되어야 한다.
    expect('groupId' in (result[0] as object)).toBe(false);
  });
});
