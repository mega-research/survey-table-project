import { beforeEach, describe, expect, it, vi } from 'vitest';

// I-3: pub 경로(bySlug/byPrivateToken)는 surveys full row 를 반환하면 안 된다.
// 익명 응답자에게 testToken/testModeEnabled/isPaused/pausedMessage/privateToken 같은
// 라이브 제어·비밀 컬럼이 유출되므로, 호출자(응답 로더)가 실제 쓰는 id 만 투영해야 한다.

const findFirstMock = vi.fn();

vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: { findFirst: (...a: unknown[]) => findFirstMock(...a) },
    },
  },
}));

import * as surveySvc from './survey-read.service';

// 응답자에게 절대 노출돼서는 안 되는 민감/라이브 컬럼.
const SENSITIVE_FIELDS = [
  'testToken',
  'testModeEnabled',
  'isPaused',
  'pausedMessage',
  'privateToken',
] as const;

describe('publicRead 프로젝션 유출 차단 (I-3)', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    // drizzle findFirst 는 columns 프로젝션대로 반환한다고 가정 — id 만.
    findFirstMock.mockResolvedValue({ id: 's1' });
  });

  it('getSurveyBySlug 는 id 만 투영하고 라이브 제어 컬럼을 노출하지 않는다', async () => {
    const res = await surveySvc.getSurveyBySlug({ slug: 'my-slug' });

    // 반환 객체에 민감 키 없음.
    expect(res).toEqual({ id: 's1' });
    for (const k of SENSITIVE_FIELDS) {
      expect(res).not.toHaveProperty(k);
    }

    // findFirst 에 전달된 columns 프로젝션이 id 만 포함하고 민감 컬럼을 요청하지 않음.
    const opts = findFirstMock.mock.calls[0]?.[0] as
      | { columns?: Record<string, boolean> }
      | undefined;
    expect(opts?.columns).toBeDefined();
    expect(opts?.columns?.['id']).toBe(true);
    for (const k of SENSITIVE_FIELDS) {
      expect(opts?.columns).not.toHaveProperty(k);
    }
  });

  it('getSurveyByPrivateToken 은 id 만 투영하고 privateToken 등을 노출하지 않는다', async () => {
    const res = await surveySvc.getSurveyByPrivateToken({
      token: '11111111-2222-4333-8444-555555555555',
    });

    expect(res).toEqual({ id: 's1' });
    for (const k of SENSITIVE_FIELDS) {
      expect(res).not.toHaveProperty(k);
    }

    const opts = findFirstMock.mock.calls[0]?.[0] as
      | { columns?: Record<string, boolean> }
      | undefined;
    expect(opts?.columns).toBeDefined();
    expect(opts?.columns?.['id']).toBe(true);
    for (const k of SENSITIVE_FIELDS) {
      expect(opts?.columns).not.toHaveProperty(k);
    }
  });

  // privateToken 컬럼은 uuid 타입 — 비-UUID 값으로 쿼리하면 PG 가
  // 22P02(invalid input syntax for type uuid) 를 던져 RSC 가 500 으로 크래시하고
  // Sentry 에도 잡힌다(공개 무인증 라우트라 스팸 유발). DB 까지 가지 않고 흡수해야 한다.
  it('getSurveyByPrivateToken 은 비-UUID 토큰을 DB 조회 없이 undefined 로 흡수한다', async () => {
    const res = await surveySvc.getSurveyByPrivateToken({ token: '11111111-2222-4333-8444-5555' });

    expect(res).toBeUndefined();
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});
