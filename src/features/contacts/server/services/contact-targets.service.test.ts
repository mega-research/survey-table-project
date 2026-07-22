import { beforeEach, describe, expect, it, vi } from 'vitest';

// sanitizeAttrsAgainstPii 는 surveys 조회(DB)를 타므로 통과 stub.
vi.mock('@/lib/contacts/scheme-helpers', () => ({
  sanitizeAttrsAgainstPii: vi.fn(async (_surveyId: string, attrs: Record<string, string>) => attrs),
}));

vi.mock('@/lib/crypto/contact-pii-repo', () => ({
  upsertPiiValue: vi.fn(async () => undefined),
}));

// db.transaction(cb) 가 update().set().where() 체인의 set 페이로드를 캡처하도록 stub.
const capturedSets: Array<Record<string, unknown>> = [];
const selectResultQueue: Array<Array<Record<string, unknown>>> = [];

vi.mock('@/db', () => {
  const tx = {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: () => ({ for: async () => selectResultQueue.shift() ?? [] }),
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        capturedSets.push(payload);
        // 스코프 가드 구현은 .where(...).returning() 으로 영향 행 수를 판정한다.
        // 기존 테스트는 정상 소속 1행을 가정하므로 비어있지 않은 배열을 돌려준다.
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: 'ct-1' }]),
          })),
        };
      }),
    })),
  };
  return {
    db: {
      transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

import { updateContactTarget } from './contact-targets.service';

describe('updateContactTarget groupValue 보존', () => {
  beforeEach(() => {
    capturedSets.length = 0;
    selectResultQueue.length = 0;
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]);
    vi.clearAllMocks();
  });

  it('systemFieldKeys 가 없으면 group_value 를 set 하지 않아 기존 분류값이 보존된다', async () => {
    await updateContactTarget({
      id: 'ct-1',
      surveyId: 'sv-1',
      attrs: { 회사명: '아크미' },
      memo: '메모만 수정',
    });

    expect(capturedSets).toHaveLength(1);
    const payload = capturedSets[0];
    // 부분 업데이트(분류 기준 미전달) — group_value 키 자체가 빠져야 함.
    expect(payload).not.toHaveProperty('groupValue');
    expect(payload).toMatchObject({ attrs: { 회사명: '아크미' }, memo: '메모만 수정' });
  });

  it('systemFieldKeys.group 이 있으면 attrs 에서 계산한 group_value 를 set 한다', async () => {
    await updateContactTarget({
      id: 'ct-2',
      surveyId: 'sv-1',
      attrs: { 전시회: 'A관', 회사명: '아크미' },
      systemFieldKeys: { group: '전시회' },
    });

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]).toMatchObject({ groupValue: 'A관' });
  });

  it('systemFieldKeys.group 키의 attrs 값이 비면 group_value 를 null 로 set 한다', async () => {
    await updateContactTarget({
      id: 'ct-3',
      surveyId: 'sv-1',
      attrs: { 전시회: '', 회사명: '아크미' },
      systemFieldKeys: { group: '전시회' },
    });

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]).toHaveProperty('groupValue', null);
  });

  it("group 라벨이 falsy 문자열 '0' 이어도 null 로 무너지지 않고 보존한다", async () => {
    await updateContactTarget({
      id: 'ct-4',
      surveyId: 'sv-1',
      attrs: { 전시회: '0', 회사명: '아크미' },
      systemFieldKeys: { group: '전시회' },
    });

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]).toMatchObject({ groupValue: '0' });
  });
});
