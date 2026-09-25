import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptAnswerValue } from '@/lib/crypto/response-pii';
import { loadCompletedQuotaSubjects } from './completed-answers';

// 쿼터 모수 helper 는 db.select(...).from(surveyResponses).where(...) 체인 하나만 쓴다.
// 실 PG 없는 vitest 환경이라 where 절을 캡처해 SQL 조건을 검증한다 (quota.service.test.ts 선례).
const { mockWhere } = vi.hoisted(() => ({ mockWhere: vi.fn() }));

vi.mock('@/db', () => ({
  db: { select: () => ({ from: () => ({ where: mockWhere }) }) },
}));

// data-scope.server 가 끌고 오는 세션 판정은 이 helper 와 무관 — 모듈 로드만 막는다.
vi.mock('@/lib/auth/external-viewer', () => ({ isExternalViewer: vi.fn() }));

const dialect = new PgDialect();

function whereSql() {
  const arg = mockWhere.mock.calls[0]?.[0];
  return dialect.sqlToQuery(arg as never);
}

describe('loadCompletedQuotaSubjects', () => {
  beforeEach(() => {
    mockWhere.mockReset();
    mockWhere.mockResolvedValue([]);
  });

  it('real 스코프: 설문·완료·비삭제·is_test=false 조건을 where 에 싣는다', async () => {
    await loadCompletedQuotaSubjects('s1', 'real', { withAttrs: false });

    expect(mockWhere).toHaveBeenCalledTimes(1);
    const query = whereSql();
    expect(query.sql).toContain('"survey_id" = ');
    expect(query.sql).toContain('"status" = ');
    expect(query.sql).toContain('"deleted_at" is null');
    expect(query.sql).toContain('"is_test" = ');
    expect(query.params).toEqual(['s1', 'completed', false]);
  });

  it('test 스코프: is_test=true 로만 바뀌고 나머지 조건은 같다', async () => {
    await loadCompletedQuotaSubjects('s1', 'test', { withAttrs: false });

    const query = whereSql();
    expect(query.sql).toContain('"deleted_at" is null');
    expect(query.params).toEqual(['s1', 'completed', true]);
  });

  it('암호문 답변은 평문으로 돌려주고 questionResponses 가 null 이면 빈 객체로 본다', async () => {
    mockWhere.mockResolvedValue([
      { questionResponses: { q1: encryptAnswerValue('김철수'), q2: 'female' } },
      { questionResponses: null },
    ]);

    await expect(loadCompletedQuotaSubjects('s1', 'real', { withAttrs: false })).resolves.toEqual([
      { answers: { q1: '김철수', q2: 'female' }, attrs: null },
      { answers: {}, attrs: null },
    ]);
  });

  it('withAttrs: 연결된 조사 대상의 attrs 를 싣고 익명 응답은 null 로 둔다', async () => {
    mockWhere
      .mockResolvedValueOnce([
        { questionResponses: { q1: 'a' }, contactTargetId: 'c1' },
        { questionResponses: { q1: 'b' }, contactTargetId: null },
        { questionResponses: { q1: 'c' }, contactTargetId: 'gone' },
      ])
      .mockResolvedValueOnce([{ id: 'c1', attrs: { '산업 분야': '바이오 및 의료기기' } }]);

    await expect(loadCompletedQuotaSubjects('s1', 'real', { withAttrs: true })).resolves.toEqual([
      { answers: { q1: 'a' }, attrs: { '산업 분야': '바이오 및 의료기기' } },
      { answers: { q1: 'b' }, attrs: null },
      { answers: { q1: 'c' }, attrs: null },
    ]);
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  it('withAttrs 가 꺼져 있으면 조사 대상을 읽지 않는다', async () => {
    mockWhere.mockResolvedValueOnce([{ questionResponses: {}, contactTargetId: 'c1' }]);

    await expect(loadCompletedQuotaSubjects('s1', 'real', { withAttrs: false })).resolves.toEqual([
      { answers: {}, attrs: null },
    ]);
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });
});
