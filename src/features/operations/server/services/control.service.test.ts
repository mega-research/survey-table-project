import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.update().set().where().returning() 체인의 set 페이로드와 where 조건을 캡처하도록 stub.
const capturedSets: Array<Record<string, unknown>> = [];
const capturedWheres: unknown[] = [];
let returningRows: Array<Record<string, unknown>> = [];

vi.mock('@/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        capturedSets.push(payload);
        return {
          where: vi.fn((cond: unknown) => {
            capturedWheres.push(cond);
            return { returning: vi.fn(async () => returningRows) };
          }),
        };
      }),
    })),
  },
}));

import { deleteTestResponses, setPaused } from './control.service';

const dialect = new PgDialect();
const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  capturedSets.length = 0;
  capturedWheres.length = 0;
  returningRows = [];
  vi.clearAllMocks();
});

describe('setPaused pausedMessage 3분기', () => {
  it('문자열 전달 시 pausedMessage 를 갱신한다', async () => {
    returningRows = [{ isPaused: true, pausedMessage: '점검 중' }];

    const res = await setPaused({
      surveyId: SURVEY_ID,
      isPaused: true,
      pausedMessage: '점검 중',
    });

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]!).toMatchObject({ isPaused: true, pausedMessage: '점검 중' });
    expect(res).toEqual({ isPaused: true, pausedMessage: '점검 중' });
  });

  it('미전달(undefined) 시 set 페이로드에 pausedMessage 키 자체가 없어 기존 문구를 보존한다', async () => {
    returningRows = [{ isPaused: false, pausedMessage: '이전 문구' }];

    const res = await setPaused({ surveyId: SURVEY_ID, isPaused: false });

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]!).toMatchObject({ isPaused: false });
    // 키 부재 검증 — toMatchObject 는 부재를 판별하지 못하므로 in 연산자로 직접 확인.
    expect('pausedMessage' in capturedSets[0]!).toBe(false);
    expect(res).toEqual({ isPaused: false, pausedMessage: '이전 문구' });
  });

  it('null 전달 시 pausedMessage 를 null 로 갱신한다', async () => {
    returningRows = [{ isPaused: true, pausedMessage: null }];

    const res = await setPaused({ surveyId: SURVEY_ID, isPaused: true, pausedMessage: null });

    expect(capturedSets).toHaveLength(1);
    expect('pausedMessage' in capturedSets[0]!).toBe(true);
    expect(capturedSets[0]!['pausedMessage']).toBeNull();
    expect(res).toEqual({ isPaused: true, pausedMessage: null });
  });
});

describe('deleteTestResponses', () => {
  it('where 에 is_test=true 와 deleted_at IS NULL 조건이 반영되고 삭제 건수를 반환한다', async () => {
    returningRows = [{ id: 'r1' }, { id: 'r2' }];

    const res = await deleteTestResponses(SURVEY_ID);

    expect(res).toEqual({ deletedCount: 2 });
    expect(capturedWheres).toHaveLength(1);
    // 캡처한 drizzle 조건을 실제 SQL 로 직조해 검증 (tests/unit/contacts-filter-sql.test.ts 패턴).
    const query = dialect.sqlToQuery(capturedWheres[0] as SQL);
    expect(query.sql).toContain('"is_test"');
    expect(query.sql).toMatch(/"deleted_at" is null/i);
    expect(query.params).toContain(true);
    expect(query.params).toContain(SURVEY_ID);
  });

  it('soft delete 페이로드는 deletedAt 만 갱신한다', async () => {
    returningRows = [];

    const res = await deleteTestResponses(SURVEY_ID);

    expect(res).toEqual({ deletedCount: 0 });
    expect(capturedSets).toHaveLength(1);
    expect(Object.keys(capturedSets[0]!)).toEqual(['deletedAt']);
    expect(capturedSets[0]!['deletedAt']).toBeInstanceOf(Date);
  });
});
