import { createRouterClient, ORPCError } from '@orpc/server';
import * as z from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from './context';

// pino 실인스턴스 대신 스파이 — 미들웨어가 넘기는 바인딩 객체만 검증한다.
const logged = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  tags: [] as Array<Record<string, string>>,
  contexts: [] as Array<Record<string, unknown>>,
  transactionNames: [] as string[],
}));
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (scope: unknown) => void) => {
    const tags: Record<string, string> = {};
    const scope = {
      setTag: (k: string, v: string) => {
        tags[k] = v;
      },
      setTransactionName: (name: string) => sentry.transactionNames.push(name),
      setContext: (k: string, v: unknown) => sentry.contexts.push({ [k]: v }),
    };
    fn(scope);
    sentry.tags.push(tags);
  },
  captureException: sentry.captureException,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: logged.info, error: logged.error },
  scheduleLogFlush: vi.fn(),
  flushLogs: vi.fn(),
  withContext: vi.fn(),
  createLogger: vi.fn(),
  REDACT_PATHS: [],
}));

import { bindRequestLog } from '@/lib/logger/request-log-scope';

import { authed, base, pub } from './orpc';
import { isSentryCaptured } from './rpc-error-policy';

// 입력에서 꺼내 적는 id 는 UUID 모양만 통과한다 — 픽스처도 실값 모양으로 둔다.
const SVY_1 = '11111111-1111-4111-8111-111111111111';
const SVY_9 = '99999999-1111-4111-8111-111111111111';
const RESP_1 = '11111111-2222-4222-8222-222222222222';
const RESP_9 = '99999999-2222-4222-8222-222222222222';
const RESP_A = 'aaaaaaaa-2222-4222-8222-222222222222';
const RESP_B = 'bbbbbbbb-2222-4222-8222-222222222222';

beforeEach(() => {
  logged.info.mockReset();
  logged.error.mockReset();
  sentry.captureException.mockReset();
  sentry.tags.length = 0;
  sentry.contexts.length = 0;
  sentry.transactionNames.length = 0;
});

afterEach(() => vi.unstubAllEnvs());

function ctx(userId: string | null, headers?: Headers): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: userId ? ({ id: userId, email: 'x@y.z' } as never) : null,
    ...(headers ? { headers } : {}),
  };
}

const testRouter = {
  ping: pub.handler(() => 'ok'),
  contacts: {
    list: pub
      .input(z.object({ surveyId: z.string(), attrs: z.record(z.string(), z.string()).optional() }))
      .handler(() => []),
  },
  boom: pub.handler(() => {
    throw new Error('db down');
  }),
  // 응답 저장 표면의 모양 — 입력에는 responseId 만 있고 설문 id 는 서비스가 행을 읽어야 안다.
  saveDraft: pub
    .input(z.object({ responseId: z.string(), answers: z.record(z.string(), z.unknown()) }))
    .handler(async ({ input }) => {
      // 서비스가 응답 행을 읽은 뒤 그 행의 설문 id 를 요청 로그에 싣는 자리
      await Promise.resolve();
      bindRequestLog({ surveyId: `svy-of-${input.responseId.slice(0, 8)}` });
      return { ok: true };
    }),
  bindThenBoom: pub.handler(() => {
    bindRequestLog({ surveyId: SVY_9, responseId: RESP_9 });
    throw new Error('db down');
  }),
  adminOnly: authed.handler(() => 'ok'),
  adminSave: authed
    .input(z.object({ surveyId: z.string(), responseId: z.string() }))
    .handler(() => 'ok'),
  boomWithDetail: pub.handler(() => {
    throw Object.assign(new Error('해당 설문에 존재하지 않는 질문입니다.'), {
      sentryContext: { versionId: 'v1', missingQuestionIds: ['q1'] },
    });
  }),
};

describe('rpcLoggingMiddleware', () => {
  it('성공 시 rpc 경로·role·durationMs 를 info 1줄로 남긴다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient(testRouter, { context: ctx('admin-1') });
    await expect(client.ping()).resolves.toBe('ok');

    expect(logged.info).toHaveBeenCalledTimes(1);
    const [fields, msg] = logged.info.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toBe('[rpc] 완료');
    expect(fields).toMatchObject({ rpc: 'ping', userId: 'admin-1', role: 'admin' });
    expect(fields['durationMs']).toBeTypeOf('number');
    expect(logged.error).not.toHaveBeenCalled();
  });

  it('중첩 라우터는 점 구분 경로(contacts.list)로 기록하고 surveyId 만 추출한다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient(testRouter, { context: ctx('admin-1') });
    await client.contacts.list({ surveyId: SVY_1, attrs: { secret: 'pii' } });

    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ rpc: 'contacts.list', surveyId: SVY_1 });
    // allowlist 관례 — input 본문(attrs 등)은 어떤 키로도 로그에 실리지 않는다
    expect(fields).not.toHaveProperty('attrs');
    expect(fields).not.toHaveProperty('input');
  });

  it('비인증은 role=anonymous, 신뢰 헤더가 있으면 ip 를 바인딩한다', async () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.7' });
    const client = createRouterClient(testRouter, { context: ctx(null, headers) });
    await client.ping();

    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ role: 'anonymous', ip: '203.0.113.7' });
    expect(fields['userId']).toBeUndefined();
  });

  it('게스트 grant 보유자는 role=guest 로 기록한다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:svy-1');
    const client = createRouterClient(testRouter, { context: ctx('guest-1') });
    await client.ping();

    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ userId: 'guest-1', role: 'guest' });
  });

  it('세션은 있으나 allowlist 밖 + grant 없음은 role=user 로 기록한다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient(testRouter, { context: ctx('nobody') });
    await client.ping();

    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ userId: 'nobody', role: 'user' });
  });

  it('인증 미들웨어 거부(UNAUTHORIZED)도 code 와 함께 error 로 기록한다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(logged.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = logged.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toBe('[rpc] 실패');
    expect(fields).toMatchObject({ rpc: 'adminOnly', role: 'anonymous', code: 'UNAUTHORIZED' });
    expect(fields['err']).toBeInstanceOf(ORPCError);
    expect(logged.info).not.toHaveBeenCalled();
  });

  it('비-ORPCError 는 wire 마스킹과 같은 INTERNAL_SERVER_ERROR code 로 기록한다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await expect(client.boom()).rejects.toBeDefined();

    const [fields] = logged.error.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ rpc: 'boom', code: 'INTERNAL_SERVER_ERROR' });
    expect(fields['durationMs']).toBeTypeOf('number');
    expect(fields['err']).toBeInstanceOf(Error);
  });

  it('예기치 못한 에러는 rpc·code·role(·surveyId) 태그와 함께 Sentry 로 보내고 캡처 표식을 남긴다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    let thrown: unknown;
    await client.boom().catch((e: unknown) => {
      thrown = e;
    });

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.tags[0]).toMatchObject({ rpc: 'boom', code: 'INTERNAL_SERVER_ERROR', role: 'anonymous' });
    expect(sentry.transactionNames[0]).toBe('rpc boom');
    expect(isSentryCaptured(thrown)).toBe(true);
  });

  it('에러가 들고 온 sentryContext 는 이벤트 context(detail)로 붙는다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await client.boomWithDetail().catch(() => undefined);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.contexts).toEqual([{ detail: { versionId: 'v1', missingQuestionIds: ['q1'] } }]);
  });

  it('sentryContext 가 없으면 context 를 붙이지 않는다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await client.boom().catch(() => undefined);
    expect(sentry.contexts).toEqual([]);
  });

  it('코드 있는 거부(UNAUTHORIZED 등)는 예상된 경로라 Sentry 로 보내지 않는다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('base 파생이므로 미들웨어를 다시 붙이지 않은 procedure 도 커버된다', async () => {
    // base 를 직접 쓰는 procedure (health 등) 회귀 방어
    const direct = { health: base.handler(() => 'up') };
    const client = createRouterClient(direct, { context: ctx(null) });
    await client.health();
    expect(logged.info).toHaveBeenCalledTimes(1);
    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ rpc: 'health' });
  });

  it('입력의 responseId 를 꺼내 기록한다 — 답(answers)은 싣지 않는다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await client.saveDraft({ responseId: RESP_1, answers: { q1: '홍길동' } });

    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ rpc: 'saveDraft', responseId: RESP_1 });
    expect(fields).not.toHaveProperty('answers');
    expect(JSON.stringify(fields)).not.toContain('홍길동');
  });

  it('검증 전 입력이라 UUID 모양이 아닌 값은 id 로 적지 않는다 — 이메일·전화번호·긴 문자열', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    for (const planted of ['person@example.com', '010-1234-5678', 'x'.repeat(129), '']) {
      await client.saveDraft({ responseId: planted, answers: {} });
      await client.contacts.list({ surveyId: planted });
    }

    const lines = logged.info.mock.calls.map(([fields]) => fields as Record<string, unknown>);
    expect(lines).toHaveLength(8);
    for (const fields of lines) {
      expect(fields['responseId']).toBeUndefined();
      // saveDraft 줄의 surveyId 는 핸들러가 실은 값이다 — 입력에서 꺼낸 값만 본다
      if (fields['rpc'] === 'contacts.list') expect(fields['surveyId']).toBeUndefined();
    }
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain('person@example.com');
    expect(serialized).not.toContain('010-1234-5678');
  });

  it('거부된 요청(인증 실패)의 실패 로그에도 UUID 모양이 아닌 입력값은 남지 않는다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await client
      .adminSave({ surveyId: 'person@example.com', responseId: '010-1234-5678' })
      .catch(() => undefined);

    expect(logged.error).toHaveBeenCalledTimes(1);
    const [fields] = logged.error.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ rpc: 'adminSave', code: 'UNAUTHORIZED' });
    expect(fields['surveyId']).toBeUndefined();
    expect(fields['responseId']).toBeUndefined();
  });

  it('서비스가 요청 로그에 실은 식별자(설문 id)가 완료 로그 한 줄에 합쳐진다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await client.saveDraft({ responseId: RESP_1, answers: {} });

    expect(logged.info).toHaveBeenCalledTimes(1);
    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ responseId: RESP_1, surveyId: `svy-of-${RESP_1.slice(0, 8)}` });
  });

  it('동시에 도는 요청끼리 실은 식별자가 섞이지 않는다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await Promise.all([
      client.saveDraft({ responseId: RESP_A, answers: {} }),
      client.saveDraft({ responseId: RESP_B, answers: {} }),
    ]);

    const pairs = logged.info.mock.calls.map(([fields]) => {
      const f = fields as Record<string, unknown>;
      return `${String(f['responseId'])}:${String(f['surveyId'])}`;
    });
    expect(pairs.sort()).toEqual([`${RESP_A}:svy-of-aaaaaaaa`, `${RESP_B}:svy-of-bbbbbbbb`]);
  });

  it('실패해도 그때까지 실은 식별자가 실패 로그와 Sentry 태그에 남는다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await client.bindThenBoom().catch(() => undefined);

    const [fields] = logged.error.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ rpc: 'bindThenBoom', surveyId: SVY_9, responseId: RESP_9 });
    expect(sentry.tags[0]).toMatchObject({ surveyId: SVY_9 });
  });

  it('요청 크기(Content-Length)를 reqBytes 로 기록하고, 숫자가 아니면 뺀다', async () => {
    const sized = createRouterClient(testRouter, {
      context: ctx(null, new Headers({ 'content-length': '2048' })),
    });
    await sized.ping();
    const broken = createRouterClient(testRouter, {
      context: ctx(null, new Headers({ 'content-length': 'abc' })),
    });
    await broken.ping();

    const [first] = logged.info.mock.calls[0] as [Record<string, unknown>];
    const [second] = logged.info.mock.calls[1] as [Record<string, unknown>];
    expect(first['reqBytes']).toBe(2048);
    expect(second['reqBytes']).toBeUndefined();
  });
});
