import { createRouterClient } from '@orpc/server';
import * as z from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from './context';
import {
  assertSurveyAccess,
  assertSurveyAccessInShare,
  assertSurveyWriteAccess,
  assertSurveyWriteAccessInShare,
  authed,
  scoped,
} from './orpc';

afterEach(() => vi.unstubAllEnvs());

function ctx(userId: string | null): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: userId ? ({ id: userId, email: 'x@y.z' } as never) : null,
  };
}

const echo = scoped
  .input(z.object({ surveyId: z.string() }))
  .handler(({ context, input }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return { ok: true };
  });

describe('scoped 베이스', () => {
  it('미인증은 UNAUTHORIZED', async () => {
    const client = createRouterClient({ echo }, { context: ctx(null) });
    await expect(client.echo({ surveyId: 's1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('allowlist 밖 + grant 없음은 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient({ echo }, { context: ctx('nobody') });
    await expect(client.echo({ surveyId: 's1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('admin 은 어느 설문이든 통과', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient({ echo }, { context: ctx('admin-1') });
    await expect(client.echo({ surveyId: 'any' })).resolves.toEqual({ ok: true });
  });

  it('게스트는 grant 설문만 통과, 다른 설문은 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ echo }, { context: ctx('guest-1') });
    await expect(client.echo({ surveyId: 's1' })).resolves.toEqual({ ok: true });
    await expect(client.echo({ surveyId: 's2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('allowlist 미설정 fail-open + grant 보유 게스트가 타 설문 호출 시 FORBIDDEN', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ echo }, { context: ctx('guest-1') });
    await expect(client.echo({ surveyId: 's1' })).resolves.toEqual({ ok: true });
    await expect(client.echo({ surveyId: 's2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

// 보기만 하는 게스트 grant (guest-grants 의 VIEW_ONLY_GUEST_GRANTS) — guest9 · 2026 AI 공개본
const GUEST9 = 'c79af8a1-186a-4157-be4c-2bebfbde4a8d';
const VIEW_ONLY_SURVEY = '253534a5-913a-4891-a019-f9643ccea0a7';

const write = scoped
  .input(z.object({ surveyId: z.string() }))
  .handler(({ context, input }) => {
    assertSurveyWriteAccess(context.user.id, input.surveyId);
    return { ok: true };
  });

describe('assertSurveyWriteAccess — 설문 쓰기 권한', () => {
  it('보기만 하는 게스트는 자기 grant 설문이어도 쓰기가 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST9}:${VIEW_ONLY_SURVEY}`);
    const client = createRouterClient({ write, echo }, { context: ctx(GUEST9) });
    await expect(client.write({ surveyId: VIEW_ONLY_SURVEY })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // 읽기(assertSurveyAccess)는 그대로 통과
    await expect(client.echo({ surveyId: VIEW_ONLY_SURVEY })).resolves.toEqual({ ok: true });
  });

  it('같은 계정의 보기 전용이 아닌 grant 설문은 쓰기 통과', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST9}:${VIEW_ONLY_SURVEY},${GUEST9}:s-other`);
    const client = createRouterClient({ write }, { context: ctx(GUEST9) });
    await expect(client.write({ surveyId: 's-other' })).resolves.toEqual({ ok: true });
  });

  it('일반 게스트는 grant 설문 쓰기 통과, 다른 설문은 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ write }, { context: ctx('guest-1') });
    await expect(client.write({ surveyId: 's1' })).resolves.toEqual({ ok: true });
    await expect(client.write({ surveyId: 's2' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('admin 은 쓰기 통과', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient({ write }, { context: ctx('admin-1') });
    await expect(client.write({ surveyId: VIEW_ONLY_SURVEY })).resolves.toEqual({ ok: true });
  });
});

const adminOnly = authed.handler(() => ({ ok: true }));

describe('authed 베이스 grant-first', () => {
  it('admin 은 통과', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient({ adminOnly }, { context: ctx('admin-1') });
    await expect(client.adminOnly()).resolves.toEqual({ ok: true });
  });

  it('grant 보유자는 allowlist 설정 여부와 무관하게 admin 전용 표면에서 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ adminOnly }, { context: ctx('guest-1') });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allowlist 미설정 fail-open 이어도 grant 보유자는 admin 전용 표면에서 FORBIDDEN', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ adminOnly }, { context: ctx('guest-1') });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

/**
 * 담당 범위에 묶인 게스트(guest-grants 의 GUEST_TARGET_SHARES)는 기본으로 거부된다 — 설문 접근만 확인하는
 * procedure 는 조사 대상을 범위로 거르지 않으므로 그대로 열면 남의 범위 명단이 샌다. 범위를 거르는 procedure 만
 * `…InShare` 확인으로 그 계정을 받고, 돌려받은 범위를 서비스에 넘긴다.
 */
describe('담당 범위에 묶인 게스트의 설문 접근 확인', () => {
  const FROM2 = 'ddcdc638-3cc2-4a84-acd9-204b66b57e28';
  const PHYSICAL_AI_LINKS = '1b88ae5a-257a-40ad-80a4-a6a698fde05a';

  function stub() {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${FROM2}:${PHYSICAL_AI_LINKS},guest-1:${PHYSICAL_AI_LINKS}`);
  }

  it('assertSurveyAccess·assertSurveyWriteAccess 는 범위 게스트를 FORBIDDEN 으로 막는다', () => {
    stub();
    expect(() => assertSurveyAccess(FROM2, PHYSICAL_AI_LINKS)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => assertSurveyWriteAccess(FROM2, PHYSICAL_AI_LINKS)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('InShare 확인은 범위 게스트를 받고 그 계정의 범위를 돌려준다', () => {
    stub();
    const expected = {
      kind: 'targets',
      surveyId: PHYSICAL_AI_LINKS,
      attrsKey: '실사업체',
      value: '프롬',
    };
    expect(assertSurveyAccessInShare(FROM2, PHYSICAL_AI_LINKS)).toEqual(expected);
    expect(assertSurveyWriteAccessInShare(FROM2, PHYSICAL_AI_LINKS)).toEqual(expected);
  });

  it('관리자와 범위 등재가 없는 게스트는 설문 전체다', () => {
    stub();
    expect(assertSurveyAccessInShare('admin-1', PHYSICAL_AI_LINKS)).toEqual({ kind: 'all' });
    expect(assertSurveyAccessInShare('guest-1', PHYSICAL_AI_LINKS)).toEqual({ kind: 'all' });
    expect(() => assertSurveyAccess('guest-1', PHYSICAL_AI_LINKS)).not.toThrow();
  });

  it('InShare 확인도 grant 밖 설문은 FORBIDDEN 이다', () => {
    stub();
    expect(() => assertSurveyAccessInShare(FROM2, 'other-survey')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => assertSurveyWriteAccessInShare('nobody', PHYSICAL_AI_LINKS)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});
