import { describe, expect, it } from 'vitest';

import { createLogger, REDACT_PATHS } from '@/lib/logger';

function captureStream() {
  const lines: string[] = [];
  return {
    lines,
    stream: {
      write(line: string) {
        lines.push(line);
      },
    },
  };
}

function lastLog(lines: string[]): Record<string, unknown> {
  const last = lines[lines.length - 1];
  expect(last).toBeDefined();
  return JSON.parse(last as string) as Record<string, unknown>;
}

describe('logger redact', () => {
  it('JSONB 컨테이너·PII 키를 최상위/1-depth 에서 검열한다', () => {
    const { lines, stream } = captureStream();
    const logger = createLogger(stream);

    logger.info(
      {
        attrs: { 회사명: 'A', 이메일: 'x@y.z' },
        emailSnapshot: 'user@example.com',
        contact: { email: 'user@example.com', phone: '01012345678' },
        surveyId: 'sv-1',
      },
      'test',
    );

    const log = lastLog(lines);
    expect(log['attrs']).toBe('[Redacted]');
    expect(log['emailSnapshot']).toBe('[Redacted]');
    expect((log['contact'] as Record<string, unknown>)['email']).toBe('[Redacted]');
    expect((log['contact'] as Record<string, unknown>)['phone']).toBe('[Redacted]');
    // 식별자는 그대로 남는다
    expect(log['surveyId']).toBe('sv-1');
  });

  it('응답값 컨테이너(questionResponses·answers)를 검열한다', () => {
    const { lines, stream } = captureStream();
    const logger = createLogger(stream);

    logger.error(
      { questionResponses: { q1: '이름' }, answers: { q2: '010' } },
      'boom',
    );

    const log = lastLog(lines);
    expect(log['questionResponses']).toBe('[Redacted]');
    expect(log['answers']).toBe('[Redacted]');
  });

  it('ip 는 의도적으로 검열하지 않는다 (로그 스키마의 "어디서")', () => {
    expect(REDACT_PATHS).not.toContain('ip');
    const { lines, stream } = captureStream();
    const logger = createLogger(stream);
    logger.info({ ip: '203.0.113.7' }, 'who-where');
    expect(lastLog(lines)['ip']).toBe('203.0.113.7');
  });
});

describe('logger err serializer (DrizzleQueryError 대응)', () => {
  it('err 의 query/params 프로퍼티와 message/stack 의 params 보간을 스트립한다', () => {
    const { lines, stream } = captureStream();
    const logger = createLogger(stream);

    // DrizzleQueryError 모사: message 보간 + enumerable own property
    const err = new Error(
      'Failed query: insert into "survey_responses" ...\nparams: ["김철수","01012345678"]',
    ) as Error & { query: string; params: unknown[]; cause?: unknown };
    err.query = 'insert into "survey_responses" ...';
    err.params = ['김철수', '01012345678'];
    err.cause = Object.assign(new Error('inner'), { params: ['민감값'] });

    logger.error({ err }, 'db 실패');

    const log = lastLog(lines);
    const serialized = log['err'] as Record<string, unknown>;
    expect(serialized['query']).toBe('[Stripped]');
    expect(serialized['params']).toBe('[Stripped]');
    expect(serialized['message']).not.toContain('김철수');
    expect(String(serialized['stack'])).not.toContain('01012345678');
    expect(JSON.stringify(serialized)).not.toContain('민감값');
  });
});

describe('logger context binding', () => {
  it('child 바인딩(userId·role·rpc)이 모든 로그 라인에 붙는다', () => {
    const { lines, stream } = captureStream();
    const logger = createLogger(stream).child({
      userId: 'u-1',
      role: 'admin',
      rpc: 'contacts.list',
    });

    logger.info({ durationMs: 42 }, 'rpc ok');

    const log = lastLog(lines);
    expect(log['userId']).toBe('u-1');
    expect(log['role']).toBe('admin');
    expect(log['rpc']).toBe('contacts.list');
    expect(log['durationMs']).toBe(42);
  });

  it('time 은 ISO 문자열이다 (Axiom _time 매핑 전제)', () => {
    const { lines, stream } = captureStream();
    createLogger(stream).info('t');
    const log = lastLog(lines);
    expect(typeof log['time']).toBe('string');
    expect(() => new Date(log['time'] as string).toISOString()).not.toThrow();
  });
});
