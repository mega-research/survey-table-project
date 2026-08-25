import { ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';

import { isUnexpectedRpcError, toWireError } from './rpc-error-policy';

// oRPC 는 ORPCError 가 아닌 모든 예외를 "Internal server error" 로 갈아끼우고 원본은
// cause 에만 남긴다(직렬화 안 됨). 운영에서는 그 마스킹이 맞지만 dev 에서는 디버깅이 불가능하다.
describe('toWireError', () => {
  it('운영에서는 원본을 그대로 돌려준다 (마스킹 유지)', () => {
    const err = new Error('DB 컬럼 없음');
    expect(toWireError(err, { dev: false })).toBe(err);
  });

  it('dev 에서는 원문 메시지를 실은 ORPCError 로 바꾼다', () => {
    class SurveyNotAcceptingResponsesError extends Error {
      constructor(reason: string) {
        super(`응답을 받을 수 없는 설문입니다. (${reason})`);
        this.name = 'SurveyNotAcceptingResponsesError';
      }
    }
    const err = new SurveyNotAcceptingResponsesError('status_not_published');

    const wire = toWireError(err, { dev: true });

    expect(wire).toBeInstanceOf(ORPCError);
    const orpc = wire as ORPCError<string, unknown>;
    expect(orpc.code).toBe('INTERNAL_SERVER_ERROR');
    expect(orpc.message).toContain('SurveyNotAcceptingResponsesError');
    expect(orpc.message).toContain('status_not_published');
    expect(orpc.cause).toBe(err);
  });

  it('dev 에서는 스택을 data 에 실어 클라이언트까지 보낸다', () => {
    const err = new Error('boom');
    const orpc = toWireError(err, { dev: true }) as ORPCError<string, { stack?: string }>;
    expect(orpc.data?.stack).toContain('boom');
  });

  it('이미 ORPCError 면 dev 에서도 건드리지 않는다', () => {
    // oRPC 가 의도적으로 실어보낸 메시지·code·data 를 덮어쓰면 안 된다.
    const err = new ORPCError('FORBIDDEN', { message: '권한 없음' });
    expect(toWireError(err, { dev: true })).toBe(err);
  });

  it('Error 가 아닌 값도 dev 에서 문자열로 실어 보낸다', () => {
    const orpc = toWireError('문자열 throw', { dev: true }) as ORPCError<string, unknown>;
    expect(orpc.message).toContain('문자열 throw');
  });
});

describe('isUnexpectedRpcError', () => {
  it('typed domain error(defined)는 예기치 못한 에러가 아니다', () => {
    // 클라이언트가 isDefinedError 로 처리하는 경로라 Sentry 캡처 대상이 아니다.
    expect(isUnexpectedRpcError(new ORPCError('CONFLICT', { defined: true }))).toBe(false);
  });

  it('일반 Error 와 defined 아닌 ORPCError 는 예기치 못한 에러다', () => {
    expect(isUnexpectedRpcError(new Error('boom'))).toBe(true);
    expect(isUnexpectedRpcError(new ORPCError('INTERNAL_SERVER_ERROR'))).toBe(true);
  });
});
