import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));

import { prepareContactInsertScope } from './contact-insert-scope.service';

/** surveys FOR UPDATE 행 1건 + 대상자 count 1건을 순서대로 돌려주는 tx stub. */
function makeTx(surveyRow: Record<string, unknown>, targetCount: number) {
  const deleteCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const tx = {
    execute: vi.fn(async () => [surveyRow]),
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: async () => [{ total: targetCount }],
      };
      return chain;
    }),
    delete: vi.fn((table: unknown) => {
      deleteCalls.push(table);
      return { where: vi.fn(async () => undefined) };
    }),
    update: vi.fn((table: unknown) => {
      updateCalls.push(table);
      return { set: () => ({ where: vi.fn(async () => undefined) }) };
    }),
  };
  return { tx, deleteCalls, updateCalls };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

const TEST_MODE_ON_ROW = {
  id: SURVEY_ID,
  test_mode_enabled: true,
  contact_columns: null,
  test_contact_columns: null,
};

describe('prepareContactInsertScope 게스트 쓰기 파티션', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('게스트는 전역 테스트 모드 ON 이어도 real 파티션으로 준비된다', async () => {
    const { tx, deleteCalls, updateCalls } = makeTx(TEST_MODE_ON_ROW, 0);

    const prepared = await prepareContactInsertScope(tx as never, {
      surveyId: SURVEY_ID,
      requestedCount: 1,
      requireEmptyTestScope: false,
      isGuest: true,
    });

    expect(prepared.isTest).toBe(false);
    expect(prepared.scope).toBe('real');
    // 익명 테스트 응답 전삭제와 testContactColumns 덮어쓰기가 일어나면 안 된다.
    expect(deleteCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it('어드민은 전역 테스트 모드 ON 이면 test 파티션으로 준비된다', async () => {
    const { tx, deleteCalls } = makeTx(TEST_MODE_ON_ROW, 0);

    const prepared = await prepareContactInsertScope(tx as never, {
      surveyId: SURVEY_ID,
      requestedCount: 1,
      requireEmptyTestScope: false,
      isGuest: false,
    });

    expect(prepared.isTest).toBe(true);
    expect(prepared.scope).toBe('test');
    // 어드민 기존 동작 — test 스코프가 비어 있으면 익명 테스트 응답을 정리한다.
    expect(deleteCalls).toHaveLength(1);
  });
});
