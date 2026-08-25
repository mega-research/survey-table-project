import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));

import { prepareContactInsertScope } from './contact-insert-scope';

/**
 * lockWriteScope 의 잠금 조회와 대상자 count 를 한 select stub 으로 받는다.
 * 잠금 쪽만 `.for('update')` 를 붙이므로 호출 순서에 기대지 않고 갈린다.
 */
function makeTx(surveyRow: Record<string, unknown>, targetCount: number) {
  const deleteCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const lockModes: unknown[] = [];
  const tx = {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: () => ({
          // 잠금 조회 — lockWriteScope 가 .for('update') 로 소비한다.
          for: async (mode: unknown) => {
            lockModes.push(mode);
            return [surveyRow];
          },
          // 대상자 count — await 로 바로 소비된다.
          then: <R,>(resolve: (rows: Array<{ total: number }>) => R) =>
            Promise.resolve([{ total: targetCount }]).then(resolve),
        }),
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
  return { tx, deleteCalls, updateCalls, lockModes };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

/** lockWriteScope 투영 — enabled(전역 테스트 모드 플래그) + 요청 컬럼. */
const TEST_MODE_ON_ROW = {
  enabled: true,
  contactColumns: null,
  testContactColumns: null,
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

  it('설문 행을 FOR UPDATE 로 잠근 뒤 준비한다', async () => {
    const { tx, lockModes } = makeTx(TEST_MODE_ON_ROW, 0);

    await prepareContactInsertScope(tx as never, {
      surveyId: SURVEY_ID,
      requestedCount: 1,
      requireEmptyTestScope: false,
      isGuest: false,
    });

    expect(lockModes).toEqual(['update']);
  });
});
