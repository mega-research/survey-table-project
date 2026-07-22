import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// WS-2 IDOR 봉인: contacts service 의 update/delete 가 surveyId/contactTargetId
// 스코프를 WHERE 에 반영해, 다른 설문 소속 행을 건드리지 못하도록 막는지 검증한다.
//
// 핵심 시나리오:
//   - 다른 surveyId 로 update/delete -> 영향 0행 -> NOT_FOUND throw
//   - 정상 surveyId -> 1행 영향 -> 성공
//   - attempts: contactTargetId 불일치 -> 소속 검증 실패 -> 거부
//
// db 는 drizzle fluent chain 흉내. update/delete 의 .returning() 결과를 큐로 제어하고,
// select(소속 사전 검증) 결과도 큐로 제어한다. PII upsert(upsertPiiValue) 가 소속
// 검증 통과 이후에만 호출되는지도 호출 카운트로 확인한다.

const {
  updateReturningQueue,
  deleteReturningQueue,
  selectResultQueue,
  capturedWheres,
} = vi.hoisted(() => ({
  updateReturningQueue: [] as unknown[][],
  deleteReturningQueue: [] as unknown[][],
  selectResultQueue: [] as unknown[][],
  capturedWheres: [] as unknown[],
}));

const upsertPiiValueMock = vi.fn(async () => undefined);

vi.mock('@/lib/contacts/scheme-helpers', () => ({
  sanitizeAttrsAgainstPii: vi.fn(async (_surveyId: string, attrs: Record<string, string>) => attrs),
}));

vi.mock('@/lib/crypto/contact-pii-repo', () => ({
  upsertPiiValue: (...args: unknown[]) => upsertPiiValueMock(...(args as [])),
}));

vi.mock('@/db', () => {
  function shiftSelect(): unknown[] {
    return selectResultQueue.shift() ?? [];
  }

  // select 체인: .from -> .where -> (.limit | 직접 await)
  function makeSelectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['from'] = vi.fn(() => chain);
    chain['where'] = vi.fn((arg: unknown) => {
      capturedWheres.push(arg);
      const whereResult: Record<string, unknown> = {
        limit: vi.fn(() => Promise.resolve(shiftSelect())),
        for: vi.fn(() => Promise.resolve(shiftSelect())),
        then: (resolve: (v: unknown) => unknown) => resolve(shiftSelect()),
      };
      return whereResult;
    });
    return chain;
  }

  function makeUpdateChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['set'] = vi.fn(() => chain);
    chain['where'] = vi.fn((arg: unknown) => {
      capturedWheres.push(arg);
      return chain;
    });
    chain['returning'] = vi.fn(() => Promise.resolve(updateReturningQueue.shift() ?? []));
    (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) => resolve(undefined);
    return chain;
  }

  function makeDeleteChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['where'] = vi.fn((arg: unknown) => {
      capturedWheres.push(arg);
      return chain;
    });
    chain['returning'] = vi.fn(() => Promise.resolve(deleteReturningQueue.shift() ?? []));
    (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) => resolve(undefined);
    return chain;
  }

  const tx = {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeUpdateChain()),
    delete: vi.fn(() => makeDeleteChain()),
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => makeUpdateChain()),
      delete: vi.fn(() => makeDeleteChain()),
      transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

import { deleteContactTarget, updateContactTarget } from '@/features/contacts/server/services/contact-targets.service';
import { deleteAttempt, updateAttempt } from '@/features/contacts/server/services/contact-attempts.service';

beforeEach(() => {
  updateReturningQueue.length = 0;
  deleteReturningQueue.length = 0;
  selectResultQueue.length = 0;
  capturedWheres.length = 0;
  upsertPiiValueMock.mockClear();
});

describe('updateContactTarget 설문 스코프', () => {
  it('현재 테스트 모드와 다른 실제 대상자는 수정하지 않고 NOT_FOUND로 처리한다', async () => {
    // 첫 읽기는 현재 설문 모드, 두 번째 읽기는 잠글 대상 행이다.
    selectResultQueue.push([{ enabled: true }], []);
    updateReturningQueue.push([{ id: 'ct-1' }]);

    await expect(
      updateContactTarget({
        id: 'ct-1',
        surveyId: 'sv-1',
        attrs: { name: '홍길동' },
      }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('다른 설문 소속이면(영향 0행) NOT_FOUND throw 하고 PII upsert 도 일어나지 않는다', async () => {
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]);
    updateReturningQueue.push([]); // 0행 영향
    await expect(
      updateContactTarget({
        id: 'ct-1',
        surveyId: 'other-survey',
        attrs: { name: '홍길동' },
        piiUpdates: [{ columnKey: 'phone', fieldType: 'phone', plain: '01000000000' }],
      }),
    ).rejects.toThrow('NOT_FOUND');
    // 소속 확정 전이므로 PII 재암호화는 호출되지 않아야 한다.
    expect(upsertPiiValueMock).not.toHaveBeenCalled();
  });

  it('정상 설문이면(1행 영향) 성공하고 PII upsert 가 소속 확정 후 호출된다', async () => {
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]);
    updateReturningQueue.push([{ id: 'ct-1' }]); // 1행 영향
    await updateContactTarget({
      id: 'ct-1',
      surveyId: 'sv-1',
      attrs: { name: '홍길동' },
      piiUpdates: [{ columnKey: 'phone', fieldType: 'phone', plain: '01000000000' }],
    });
    expect(upsertPiiValueMock).toHaveBeenCalledTimes(1);
  });
});

describe('deleteContactTarget 설문 스코프', () => {
  it('다른 설문 소속이면(영향 0행) NOT_FOUND throw', async () => {
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]);
    deleteReturningQueue.push([]); // 0행 영향
    await expect(
      deleteContactTarget({ id: 'ct-1', surveyId: 'other-survey' }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('정상 설문이면(1행 영향) 성공한다', async () => {
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]);
    deleteReturningQueue.push([{ id: 'ct-1' }]); // 1행 영향
    await expect(
      deleteContactTarget({ id: 'ct-1', surveyId: 'sv-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('updateAttempt 소속 스코프', () => {
  it('현재 테스트 모드와 다른 실제 대상자의 회차는 수정하지 않고 NOT_FOUND로 처리한다', async () => {
    selectResultQueue.push([{ enabled: true }], []);
    updateReturningQueue.push([{ id: 'att-1' }]);

    await expect(
      updateAttempt({
        id: 'att-1',
        contactTargetId: 'ct-1',
        surveyId: 'sv-1',
        resultCode: '6.거절',
      }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('contactTarget 이 설문에 없으면 NOT_FOUND throw', async () => {
    selectResultQueue.push([{ enabled: false }], []); // current scope 대상자 0행
    await expect(
      updateAttempt({
        id: 'att-1',
        contactTargetId: 'ct-1',
        surveyId: 'other-survey',
        resultCode: '6.거절',
      }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('contactTarget 은 설문 소속이나 attempt 가 그 target 소속이 아니면(영향 0행) NOT_FOUND throw', async () => {
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]); // current scope 대상자
    updateReturningQueue.push([]); // attempt 영향 0행 (contactTargetId 불일치)
    await expect(
      updateAttempt({
        id: 'att-1',
        contactTargetId: 'ct-1',
        surveyId: 'sv-1',
        resultCode: '6.거절',
      }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('정상 소속이면 성공한다', async () => {
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]); // current scope 대상자
    updateReturningQueue.push([{ id: 'att-1' }]); // attempt 1행 영향
    await expect(
      updateAttempt({
        id: 'att-1',
        contactTargetId: 'ct-1',
        surveyId: 'sv-1',
        resultCode: '6.거절',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('deleteAttempt 소속 스코프', () => {
  it('contactTarget 이 설문에 없으면 NOT_FOUND throw', async () => {
    selectResultQueue.push([{ enabled: false }], []); // current scope 대상자 0행
    await expect(
      deleteAttempt({ id: 'att-1', contactTargetId: 'ct-1', surveyId: 'other-survey' }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('attempt 가 contactTargetId 소속이 아니면(영향 0행) NOT_FOUND throw', async () => {
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]);
    deleteReturningQueue.push([]); // attempt 영향 0행
    await expect(
      deleteAttempt({ id: 'att-1', contactTargetId: 'ct-1', surveyId: 'sv-1' }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('정상 소속이면 성공한다', async () => {
    selectResultQueue.push([{ enabled: false }], [{ id: 'ct-1' }]);
    deleteReturningQueue.push([{ id: 'att-1' }]);
    await expect(
      deleteAttempt({ id: 'att-1', contactTargetId: 'ct-1', surveyId: 'sv-1' }),
    ).resolves.toBeUndefined();
  });
});
