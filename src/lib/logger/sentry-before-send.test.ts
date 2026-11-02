import type { ErrorEvent, EventHint } from '@sentry/nextjs';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { PostgresError } from 'postgres';
import { describe, expect, it } from 'vitest';

import { scrubSentryEvent } from './sentry-before-send';

/**
 * Sentry beforeSend — DB 쿼리 바인딩 값만 지우고 원인 파악 재료는 남긴다.
 *
 * 이벤트는 SDK 가 DrizzleQueryError(원인 PostgresError) 를 받았을 때 만드는 모양을 따른다 —
 * linkedErrors 가 cause 를 앞에, 원래 예외를 맨 뒤에 둔다.
 */

const SQL = 'update "survey_responses" set "answers" = $1, "completed_at" = $2 where "id" = $3';
const PARAMS = ['{"q1":"김철수 010-1234-5678"}', '2026-13-45', 'resp-secret-id'];
const SECRETS = ['김철수', '010-1234-5678', 'resp-secret-id'];
const PG_MESSAGE = 'invalid input syntax for type timestamp with time zone';

function makeDrizzleError() {
  const pg = new PostgresError({
    message: PG_MESSAGE,
    code: '22007',
    severity: 'ERROR',
    routine: 'DateTimeParseError',
  } as unknown as string);
  return new DrizzleQueryError(SQL, PARAMS, pg);
}

function makeEvent(err: DrizzleQueryError): ErrorEvent {
  return {
    type: undefined,
    exception: {
      values: [
        { type: 'PostgresError', value: PG_MESSAGE, stacktrace: { frames: [{ function: 'parse' }] } },
        { type: 'Error', value: err.message, stacktrace: { frames: [{ function: 'execute' }] } },
      ],
    },
    breadcrumbs: [{ category: 'db', message: err.message, data: { params: PARAMS, parameters: PARAMS } }],
    extra: { failed: { query: SQL, params: PARAMS, message: err.message } },
    contexts: { detail: { surveyId: 's-1', cause: { message: err.message, params: PARAMS } } },
  };
}

function run() {
  const err = makeDrizzleError();
  const hint: EventHint = { originalException: err };
  const out = scrubSentryEvent(makeEvent(err), hint);
  if (!out) throw new Error('이벤트가 버려졌다');
  return out;
}

describe('scrubSentryEvent — DrizzleQueryError 바인딩 값 스트립', () => {
  it('송신 이벤트 어디에도 바인딩 값이 남지 않는다', () => {
    const json = JSON.stringify(run());
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    expect(json).not.toContain('2026-13-45');
  });

  it('실패한 SQL 문장(자리표시 포함)과 바인딩 개수는 남긴다', () => {
    const main = run().exception?.values?.at(-1);
    expect(main?.value).toBe(`Failed query: ${SQL}\nparams: [Stripped 3 values]`);
  });

  it('원인 PG 오류의 메시지·타입·스택과 SQLSTATE 코드가 남는다', () => {
    const out = run();
    const cause = out.exception?.values?.[0];
    expect(cause?.type).toBe('PostgresError');
    expect(cause?.value).toBe(PG_MESSAGE);
    expect(cause?.stacktrace?.frames).toEqual([{ function: 'parse' }]);
    expect(out.tags?.['pg_code']).toBe('22007');
    expect(out.contexts?.['postgres']).toMatchObject({ code: '22007', routine: 'DateTimeParseError' });
  });

  it('breadcrumbs·extra·contexts 의 params 류 키와 보간 구간도 지운다', () => {
    const out = run();
    expect(out.breadcrumbs?.[0]?.data).toEqual({ params: '[Stripped]', parameters: '[Stripped]' });
    expect(out.breadcrumbs?.[0]?.message).toContain('params: [Stripped 3 values]');
    const extra = out.extra?.['failed'] as Record<string, unknown>;
    expect(extra['params']).toBe('[Stripped]');
    const detail = out.contexts?.['detail'] as { surveyId: string; cause: Record<string, unknown> };
    expect(detail.surveyId).toBe('s-1');
    expect(detail.cause['params']).toBe('[Stripped]');
  });

  it('DB 오류가 아닌 이벤트는 그대로 둔다', () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: { values: [{ type: 'TypeError', value: 'x is not a function' }] },
      contexts: { detail: { surveyId: 's-1' } },
    };
    const out = scrubSentryEvent(structuredClone(event), { originalException: new TypeError('x') });
    expect(out).toEqual(event);
  });
});
