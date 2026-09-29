import { createRouterClient, ORPCError } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-attempts', () => ({
  addAttempt: vi.fn(),
  updateAttempt: vi.fn(),
  deleteAttempt: vi.fn(),
}));

vi.mock('@/server/rpc-survey-access', () => ({ assertScopedSurveyCapabilityRpc: vi.fn() }));

/**
 * 링크 세션 해석만 대역으로 둔다 — 이 파일이 묻는 것은 **주체가 어떻게 귀속으로 바뀌는가**이지
 * 「쿠키가 유효한가」가 아니다(그 축은 `fieldwork-link.realdb` 가 실 DB 로 진다).
 */
vi.mock('@/server/fieldwork-link', () => ({
  // 쿠키를 들고 온 요청만 통과시킨다 — 세션이 없으면 「접속하라」(UNAUTHORIZED)가 그대로
  // 서야 하고, 그 단언이 아래 무인증 테스트다.
  resolveLinkActorForSurvey: vi.fn(
    async (sessions: readonly { claim: { linkId: string } }[] | undefined, surveyId: string) =>
      sessions?.length
        ? { kind: 'ok' as const, actor: { kind: 'link' as const, linkId: LINK_ID, surveyId } }
        : { kind: 'no_session' as const },
  ),
}));

import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import { linkActorContext } from '@tests/helpers/rpc-context';

import * as svc from '../services/contact-attempts';
import { attempts } from './attempts';

const LINK_ID = 'c1000000-0000-4000-8000-00000000b001';
const SURVEY_ID = 'c1000000-0000-4000-8000-0000000f0001';
const LINK_TOKEN = 'fieldworkLinkToken08';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

describe('attempts procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('add는 입력을 service.addAttempt에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.addAttempt).mockResolvedValue({ id: 'att-1', attemptNo: 1 } as never);
    const context = authedContext();
    const client = createRouterClient({ contacts: { attempts } }, { context });
    const input = { contactTargetId: 'ct-1', surveyId: 's-1', resultCode: '1.조사완료', note: '메모' };
    const res = await client.contacts.attempts.add(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      's-1',
      'contacts.writeAttempts',
    );
    // 작성자는 procedure 가 인증된 컨텍스트에서 넘긴다 — 서비스가 auth 를 다시 읽지 않는다.
    // 계정 주체는 계정 칸만 채우고 링크 칸은 빈다(0127 의 배타 CHECK).
    expect(svc.addAttempt).toHaveBeenCalledWith(input, false, {
      accountUserId: 'admin-1',
      fieldworkLinkId: null,
    });
    expect(res).toEqual({ id: 'att-1', attemptNo: 1 });
  });

  it('update는 입력을 service.updateAttempt에 위임하고 ok를 반환한다', async () => {
    vi.mocked(svc.updateAttempt).mockResolvedValue(undefined as never);
    const context = authedContext();
    const client = createRouterClient({ contacts: { attempts } }, { context });
    const input = { id: 'att-1', contactTargetId: 'ct-1', surveyId: 's-1', resultCode: '6.거절' };
    const res = await client.contacts.attempts.update(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      's-1',
      'contacts.writeAttempts',
    );
    expect(svc.updateAttempt).toHaveBeenCalledWith(input, false);
    expect(res).toEqual({ ok: true });
  });

  it('remove는 입력을 service.deleteAttempt에 위임하고 ok를 반환한다', async () => {
    vi.mocked(svc.deleteAttempt).mockResolvedValue(undefined as never);
    const context = authedContext();
    const client = createRouterClient({ contacts: { attempts } }, { context });
    const input = { surveyId: 's-1', contactTargetId: 'ct-1', id: 'att-1' };
    const res = await client.contacts.attempts.remove(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      's-1',
      'contacts.writeAttempts',
    );
    expect(svc.deleteAttempt).toHaveBeenCalledWith(input, false);
    expect(res).toEqual({ ok: true });
  });

  it('타 팀 설문 id 로 add 하면 NOT_FOUND — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertScopedSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ contacts: { attempts } }, { context: authedContext() });
    await expect(
      client.contacts.attempts.add({
        contactTargetId: 'ct-1',
        surveyId: 's-1',
        resultCode: '1.조사완료',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(svc.addAttempt).not.toHaveBeenCalled();
  });

  it('인증 없으면 add가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { contacts: { attempts } },
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.contacts.attempts.add({
        contactTargetId: 'ct-1',
        surveyId: 's-1',
        resultCode: '1.조사완료',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  // 관문(mock)이 통과시킨 뒤에도 서비스로 넘어가는 **파티션 플래그**는 계정 유형에서 나온다
  // (티켓 21 — 예전에는 env grant 목록을 다시 읽었다). 실제 게스트 계정은 이 표면의
  // capability(contacts.writeAttempts)를 갖지 못해 관문에서 막힌다.
  it.each([
    ['게스트', 'guest'],
    // 실사도 real 고정이다(티켓 26) — 게스트만 보면 테스트 모드가 켜진 설문에서
    // 실사원이 test 파티션에 결과코드를 쓴다.
    ['실사', 'fieldwork'],
  ] as const)('%s 계정이면 실데이터 파티션 플래그가 서비스로 전달된다', async (_label, userType) => {
    vi.mocked(svc.addAttempt).mockResolvedValue({ id: 'att-1', attemptNo: 1 } as never);
    const client = createRouterClient(
      { contacts: { attempts } },
      {
        context: {
          db: {} as never,
          user: {
            id: 'external-1',
            email: 'g@b.com',
            name: '외부',
            status: 'active',
            isSuperadmin: false,
            userType,
          },
        },
      },
    );
    const input = {
      contactTargetId: 'ct-1',
      surveyId: 's-1',
      resultCode: '1.조사완료',
    };
    const res = await client.contacts.attempts.add(input);
    expect(svc.addAttempt).toHaveBeenCalledWith(input, true, {
      accountUserId: 'external-1',
      fieldworkLinkId: null,
    });
    expect(res).toEqual({ id: 'att-1', attemptNo: 1 });
  });

  /**
   * 외주 실사 링크가 남긴 회차 — **계정 칸이 비고 링크 칸이 찬다** (0127, 티켓 08).
   *
   * 여기서 계정 칸에 무엇이든 실리면 남의 이름으로 기록이 남고, 둘 다 실리면 DB 의 배타
   * CHECK 에서야 터진다. 주체에서 파생시키는 `attributionOf` 가 그 조합을 못 만들게 한다.
   */
  it('링크 주체가 넣은 회차는 링크 칸에 귀속되고 계정 칸은 빈다', async () => {
    vi.mocked(svc.addAttempt).mockResolvedValue({ id: 'att-1', attemptNo: 1 } as never);
    const client = createRouterClient(
      { contacts: { attempts } },
      {
        context: linkActorContext({
          linkId: LINK_ID,
          surveyId: SURVEY_ID,
          token: LINK_TOKEN,
        }),
      },
    );
    const input = {
      contactTargetId: 'ct-1',
      surveyId: SURVEY_ID,
      resultCode: '1.조사완료',
    };
    await client.contacts.attempts.add(input);
    // 링크는 언제나 실 파티션이다(스펙 §11-3) — 두 번째 인자 true.
    expect(svc.addAttempt).toHaveBeenCalledWith(input, true, {
      accountUserId: null,
      fieldworkLinkId: LINK_ID,
    });
  });
});
