import type * as SentryModule from '@sentry/nextjs';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { PostgresError } from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * 서버 Sentry 설정 계약 — 실제 SDK 가 DrizzleQueryError 를 송신할 때 바인딩 값은 0건,
 * 원인 파악 재료(SQL·SQLSTATE·원인 메시지·스택)는 남는다.
 *
 * `sentry.server.config.ts` 가 Sentry.init 에 넘기는 옵션을 그대로 가로채, 진짜 SDK 를
 * 모의 전송(transport)으로 띄워 captureException → 실제 송신 envelope 를 검사한다.
 */

vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof SentryModule>();
  return { ...actual, init: vi.fn() };
});

const SQL = 'insert into "survey_responses" ("answers", "contact_id", "started_at") values ($1, $2, $3)';
const PARAMS = ['{"q3":"서울시 강남구 테헤란로 1"}', 'contact-7f3a', 'not-a-date'];
// 검사 대상 조각은 위쪽 상수에만 둔다 — ContextLines 가 스택 프레임 앞뒤 7줄의 소스를 실어 보내므로,
// 프레임 근처에 리터럴로 쓰면 테스트 소스 자체가 "유출"로 잡힌다.
const SECRET_FRAGMENTS = ['서울시 강남구', 'contact-7f3a', 'not-a-date'];
const PG_MESSAGE = 'invalid input syntax for type timestamp with time zone: "garbage"';
const PG_DETAIL = 'Key (contact_id)=(contact-7f3a) already exists.';

async function sendThroughConfiguredSdk(): Promise<string> {
  const mocked = await import('@sentry/nextjs');
  await import('../../sentry.server.config');
  const options = vi.mocked(mocked.init).mock.calls[0]?.[0];
  if (!options) throw new Error('sentry.server.config 가 Sentry.init 을 부르지 않았다');

  const sent: unknown[] = [];
  const real = await vi.importActual<typeof SentryModule>('@sentry/nextjs');
  real.init({
    ...options,
    dsn: 'https://public@o0.ingest.sentry.io/1',
    tracesSampleRate: 0,
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });

  const pg = new PostgresError({
    message: PG_MESSAGE,
    code: '22007',
    severity: 'ERROR',
    routine: 'DateTimeParseError',
    detail: PG_DETAIL,
  } as unknown as string);
  const err = new DrizzleQueryError(SQL, PARAMS, pg);

  real.withScope((scope) => {
    scope.setTag('rpc', 'response.complete');
    scope.setContext('detail', { surveyId: 's-1', params: PARAMS });
    real.addBreadcrumb({ category: 'db', message: err.message, data: { parameters: PARAMS } });
    real.captureException(err);
  });
  await real.flush(2000);

  expect(sent.length).toBeGreaterThan(0);
  return JSON.stringify(sent);
}

describe('sentry.server.config — 송신 페이로드의 DB 바인딩 값 스트립', () => {
  let payload = '';

  afterAll(async () => {
    const real = await vi.importActual<typeof SentryModule>('@sentry/nextjs');
    await real.close(0);
  });

  it('송신 envelope 에 바인딩 값과 PG detail 이 0건이다', async () => {
    payload = await sendThroughConfiguredSdk();
    for (const value of SECRET_FRAGMENTS) expect(payload).not.toContain(value);
  });

  it('SQL 문장·바인딩 개수·SQLSTATE·원인 PG 메시지·스택 프레임은 남는다', () => {
    // JSON 안에서 \n 은 이스케이프된다
    expect(payload).toContain(`Failed query: ${SQL.replaceAll('"', '\\"')}\\nparams: [Stripped 3 values]`);
    expect(payload).toContain('"pg_code":"22007"');
    expect(payload).toContain('"routine":"DateTimeParseError"');
    expect(payload).toContain('"type":"PostgresError"');
    expect(payload).toContain(PG_MESSAGE.replaceAll('"', '\\"'));
    expect(payload).toContain('sendThroughConfiguredSdk');
    expect(payload).toContain('"rpc":"response.complete"');
  });
});
