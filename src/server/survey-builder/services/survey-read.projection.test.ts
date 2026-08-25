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

import * as surveySvc from './survey-read';

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

  it('getSurveyByPreviewToken 은 id 만 투영하고 privateToken 등을 노출하지 않는다', async () => {
    const res = await surveySvc.getSurveyByPreviewToken({
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

  // previewToken 컬럼도 uuid 타입 — getSurveyByPrivateToken 과 동일한 이유로 흡수해야 한다.
  it('getSurveyByPreviewToken 은 비-UUID 토큰을 DB 조회 없이 undefined 로 흡수한다', async () => {
    const res = await surveySvc.getSurveyByPreviewToken({ token: '11111111-2222-4333-8444-5555' });

    expect(res).toBeUndefined();
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});

// previewToken 은 답변 크레덴셜(privateToken)과 완전히 분리된 컬럼이어야 한다 —
// 미리보기 링크 공유가 곧 응답 제출 권한 공유가 되면 안 된다는 핵심 불변식.
// mock db 는 실제 postgres WHERE 평가를 흉내낸다: drizzle eq() 가 만든 SQL 조건에서
// 겨냥한 컬럼명과 비교값을 뽑아, 그 컬럼의 실제 값과 일치할 때만 매칭시킨다.
// 두 함수가 서로 다른 컬럼(private_token / preview_token)만 조회한다는 것을 이 방식으로
// 구조적으로 검증한다 — service 코드가 실수로 같은 컬럼을 참조하면 이 테스트가 깨진다.
describe('previewToken / privateToken 컬럼 분리 — 답변 크레덴셜 겸용 차단', () => {
  const SURVEY_ID = 's1';
  const PRIVATE_TOKEN = '11111111-1111-4111-8111-111111111111';
  const PREVIEW_TOKEN = '22222222-2222-4222-8222-222222222222';

  type SqlLike = { queryChunks?: unknown[] };

  function columnNameOf(where: unknown): string | undefined {
    const chunks = (where as SqlLike | undefined)?.queryChunks ?? [];
    const columnChunk = chunks.find(
      (c): c is { name: string } =>
        typeof c === 'object' &&
        c !== null &&
        'name' in c &&
        typeof (c as { name?: unknown }).name === 'string',
    );
    return columnChunk?.name;
  }

  function paramValueOf(where: unknown): unknown {
    const chunks = (where as SqlLike | undefined)?.queryChunks ?? [];
    const paramChunk = chunks.find(
      (c) => (c as { constructor?: { name?: string } } | null)?.constructor?.name === 'Param',
    ) as { value?: unknown } | undefined;
    return paramChunk?.value;
  }

  beforeEach(() => {
    findFirstMock.mockReset();
    findFirstMock.mockImplementation(async (opts: { where?: unknown }) => {
      const column = columnNameOf(opts?.where);
      const value = paramValueOf(opts?.where);
      if (column === 'private_token' && value === PRIVATE_TOKEN) return { id: SURVEY_ID };
      if (column === 'preview_token' && value === PREVIEW_TOKEN) return { id: SURVEY_ID };
      return undefined;
    });
  });

  it('getSurveyByPreviewToken 은 preview_token 컬럼을 조회해 자신의 토큰으로 resolve 된다', async () => {
    const res = await surveySvc.getSurveyByPreviewToken({ token: PREVIEW_TOKEN });
    expect(res).toEqual({ id: SURVEY_ID });
  });

  it('getSurveyByPrivateToken 은 private_token 컬럼을 조회해 자신의 토큰으로 resolve 된다', async () => {
    const res = await surveySvc.getSurveyByPrivateToken({ token: PRIVATE_TOKEN });
    expect(res).toEqual({ id: SURVEY_ID });
  });

  it('previewToken 값은 privateToken 조회 경로(/survey 응답 경로가 쓰는 getSurveyByPrivateToken)로 resolve 되지 않는다', async () => {
    const res = await surveySvc.getSurveyByPrivateToken({ token: PREVIEW_TOKEN });
    expect(res).toBeUndefined();
  });

  it('privateToken 값은 previewToken 조회 경로(/preview 라우트가 쓰는 getSurveyByPreviewToken)로 resolve 되지 않는다', async () => {
    const res = await surveySvc.getSurveyByPreviewToken({ token: PRIVATE_TOKEN });
    expect(res).toBeUndefined();
  });
});
