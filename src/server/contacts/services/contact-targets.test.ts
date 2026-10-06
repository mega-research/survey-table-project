import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { updateContactTarget } from './contact-targets';

describe('updateContactTarget groupValue 보존', () => {
  beforeEach(() => {
    capturedSets.length = 0;
    selectResultQueue.length = 0;
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]);
    vi.clearAllMocks();
  });

  it('systemFieldKeys 가 없으면 group_value 를 set 하지 않아 기존 분류값이 보존된다', async () => {
    await updateContactTarget(
      {
        id: 'ct-1',
        surveyId: 'sv-1',
        attrs: { 회사명: '아크미' },
        memo: '메모만 수정',
      },
      false,
    );

    expect(capturedSets).toHaveLength(1);
    const payload = capturedSets[0];
    // 부분 업데이트(분류 기준 미전달) — group_value 키 자체가 빠져야 함.
    expect(payload).not.toHaveProperty('groupValue');
    expect(payload).toMatchObject({ attrs: { 회사명: '아크미' }, memo: '메모만 수정' });
  });

  it('systemFieldKeys.group 이 있으면 attrs 에서 계산한 group_value 를 set 한다', async () => {
    await updateContactTarget(
      {
        id: 'ct-2',
        surveyId: 'sv-1',
        attrs: { 전시회: 'A관', 회사명: '아크미' },
        systemFieldKeys: { group: '전시회' },
      },
      false,
    );

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]).toMatchObject({ groupValue: 'A관' });
  });

  it('systemFieldKeys.group 키의 attrs 값이 비면 group_value 를 null 로 set 한다', async () => {
    await updateContactTarget(
      {
        id: 'ct-3',
        surveyId: 'sv-1',
        attrs: { 전시회: '', 회사명: '아크미' },
        systemFieldKeys: { group: '전시회' },
      },
      false,
    );

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]).toHaveProperty('groupValue', null);
  });

  it("group 라벨이 falsy 문자열 '0' 이어도 null 로 무너지지 않고 보존한다", async () => {
    await updateContactTarget(
      {
        id: 'ct-4',
        surveyId: 'sv-1',
        attrs: { 전시회: '0', 회사명: '아크미' },
        systemFieldKeys: { group: '전시회' },
      },
      false,
    );

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]).toMatchObject({ groupValue: '0' });
  });
});

/**
 * 값이 있는데 형식이 틀린 PII(예: `@` 없는 메일)는 저장 경로에 넘기지 않고 거부한다.
 * 넘기면 「빈 값」으로 취급되어 기존 암호화 행이 지워지고 호출은 성공으로 끝난다 —
 * 화면에는 「저장 완료」가 뜨고 값은 사라진다(2026-10-06 실사고).
 */
describe('updateContactTarget — 형식이 틀린 PII 는 거부한다', () => {
  beforeEach(() => {
    capturedSets.length = 0;
    selectResultQueue.length = 0;
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]);
    vi.clearAllMocks();
  });

  it('@ 없는 메일이면 BAD_REQUEST 로 거부하고 아무것도 쓰지 않는다', async () => {
    const { upsertPiiValue } = await import('@/lib/crypto/contact-pii-repo');

    await expect(
      updateContactTarget(
        {
          id: 'ct-1',
          surveyId: 'sv-1',
          attrs: { 회사명: '아크미' },
          piiUpdates: [{ columnKey: '이메일1', fieldType: 'email', plain: 'dream-elec.co.kr' }],
        },
        false,
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/「이메일1」.*메일 형식/) });

    // 기존 암호화 행을 건드리지 않고(삭제 포함), 같은 요청의 attrs·메모도 쓰지 않는다.
    expect(upsertPiiValue).not.toHaveBeenCalled();
    expect(capturedSets).toHaveLength(0);
  });

  it('칸을 비운 것은 그대로 통과한다 — 지우겠다는 뜻이다', async () => {
    const { upsertPiiValue } = await import('@/lib/crypto/contact-pii-repo');

    await updateContactTarget(
      {
        id: 'ct-1',
        surveyId: 'sv-1',
        attrs: {},
        piiUpdates: [{ columnKey: '이메일1', fieldType: 'email', plain: '' }],
      },
      false,
    );

    expect(upsertPiiValue).toHaveBeenCalledWith(expect.anything(), 'ct-1', '이메일1', 'email', '');
  });

  it('형식이 맞는 값은 그대로 저장한다', async () => {
    const { upsertPiiValue } = await import('@/lib/crypto/contact-pii-repo');

    await updateContactTarget(
      {
        id: 'ct-1',
        surveyId: 'sv-1',
        attrs: {},
        piiUpdates: [{ columnKey: '이메일1', fieldType: 'email', plain: 'info@dream-elec.co.kr' }],
      },
      false,
    );

    expect(upsertPiiValue).toHaveBeenCalledTimes(1);
  });
});
