import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/crypto/contact-pii-repo', async (importOriginal) => ({
  // 저장할 평문 규칙(piiPlainToStore)은 실제 것을 쓴다.
  ...(await importOriginal<typeof import('@/lib/crypto/contact-pii-repo')>()),
  upsertPiiValue: vi.fn(async () => undefined),
  // 개인정보 열 변경 판정 재료 — 이 파일은 저장 페이로드만 본다(기록은 realdb 가 본다).
  readStoredPiiPlain: vi.fn(async () => new Map()),
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
    // 「대상 정보 수정 현황」 기록 INSERT — 이 파일은 저장 페이로드만 본다.
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
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
import { FIELDWORK_SHARE_ALL } from '@/server/fieldwork-share-scope';

// 잠금 아래에서 읽는 대상 행 — 대상 정보의 지금 값(스키마상 attrs 는 늘 객체다).
const lockedTarget = { id: 'ct-1', attrs: {}, memo: null, contactMethod: null };

// 그룹 값(group_value)은 명단 업로드가 채우는 값이다. 조사 대상을 한 명씩 고치는 저장이 이 값을 다시 쓰면
// 저장할 때마다 다른 열 값으로 덮인다 — 2026-11-23 국내전시회 설문에서 314명의 그룹이 전시회ID 숫자로 바뀌어
// 그 그룹으로 거른 발송 회차에 해외 대상 4명이 들어갔다. 저장은 그룹 값을 건드리지 않는다.
describe('updateContactTarget — 그룹 값을 건드리지 않는다', () => {
  beforeEach(() => {
    capturedSets.length = 0;
    selectResultQueue.length = 0;
    selectResultQueue.push([{ enabled: false }], [lockedTarget]);
    vi.clearAllMocks();
  });

  it('명단 값·메모를 고쳐도 group_value 는 set 하지 않는다', async () => {
    await updateContactTarget(
      {
        id: 'ct-1',
        surveyId: 'sv-1',
        attrs: { 전시회ID: '21', 조사대상: '참가업체(해외)', 회사명: '아크미' },
        memo: '메모만 수정',
      },
      false,
      { id: 'editor-1', email: 'editor@local' }, FIELDWORK_SHARE_ALL,
    );

    expect(capturedSets).toHaveLength(1);
    const payload = capturedSets[0];
    expect(payload).not.toHaveProperty('groupValue');
    expect(payload).toMatchObject({ memo: '메모만 수정' });
  });

  it('옛 화면(배포 전에 열어 둔 탭)이 그룹 열 이름을 실어 보내도 group_value 는 set 하지 않는다', async () => {
    await updateContactTarget(
      {
        id: 'ct-2',
        surveyId: 'sv-1',
        attrs: { 전시회ID: '21', 조사대상: '참가업체(해외)' },
        // 옛 클라이언트가 보내던 칸 — 지금 입력 타입에는 없다.
        systemFieldKeys: { group: '전시회ID' },
      } as Parameters<typeof updateContactTarget>[0],
      false,
      { id: 'editor-1', email: 'editor@local' }, FIELDWORK_SHARE_ALL,
    );

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]).not.toHaveProperty('groupValue');
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
    selectResultQueue.push([{ enabled: false }], [lockedTarget]);
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
        { id: 'editor-1', email: 'editor@local' }, FIELDWORK_SHARE_ALL,
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
      { id: 'editor-1', email: 'editor@local' }, FIELDWORK_SHARE_ALL,
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
      { id: 'editor-1', email: 'editor@local' }, FIELDWORK_SHARE_ALL,
    );

    expect(upsertPiiValue).toHaveBeenCalledTimes(1);
  });
});
