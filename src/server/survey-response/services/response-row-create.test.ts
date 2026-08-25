/**
 * insertResponseWithContactReuse 직접 단위 테스트.
 *
 * 응답 행 생성·재사용은 결과가 가장 무거운 경로인데(잘못 물려받으면 남의 응답에 쓰고,
 * 잘못 차단하면 정상 응답자를 막는다) 이 모듈을 직접 겨눈 테스트가 없었다(2026-08-25 리뷰).
 *
 * 특히 catch 절을 고정한다 — 종전에는 모든 예외를 잡아, 컨택에 활성 행이 있기만 하면
 * NOT NULL 위반이나 커넥션 오류까지 삼키고 기존 행을 물려받았다. 응답자에게는 성공으로
 * 보이지만 원인은 어디에도 남지 않는다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** select().from().where().limit() 이 돌려줄 결과 큐 — 호출 순서대로 소비한다. */
const selectQueue: unknown[][] = [];
/** insert 가 무엇을 할지: 행 반환 · 충돌로 빈 배열 · 지정한 에러 throw */
let insertBehavior: { kind: 'rows'; rows: unknown[] } | { kind: 'throw'; error: unknown } = {
  kind: 'rows',
  rows: [],
};
const updateReturning = vi.fn<() => Promise<unknown[]>>();

function selectChain() {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(selectQueue.shift() ?? []),
    then: (res: (v: unknown[]) => unknown) => Promise.resolve(selectQueue.shift() ?? []).then(res),
  };
  return chain;
}

vi.mock('@/db', () => ({
  db: {
    select: () => selectChain(),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () =>
            insertBehavior.kind === 'throw'
              ? Promise.reject(insertBehavior.error)
              : Promise.resolve(insertBehavior.rows),
        }),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => updateReturning() }) }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
}));

import { insertResponseWithContactReuse } from './response-row-create';

const SURVEY_ID = 'survey-1';
const SESSION_ID = 'session-1';
const CONTACT_ID = 'contact-1';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'r-existing',
    contactTargetId: CONTACT_ID,
    metadata: null,
    status: 'in_progress',
    versionId: 'v1',
    ...over,
  };
}

function call(over: Record<string, unknown> = {}) {
  return insertResponseWithContactReuse({
    surveyId: SURVEY_ID,
    sessionId: SESSION_ID,
    contactTargetId: CONTACT_ID,
    newResponse: {} as never,
    ...over,
  });
}

/** postgres-js 가 UNIQUE 위반에 싣는 모양 */
const uniqueViolation = Object.assign(new Error('duplicate key value'), { code: '23505' });

beforeEach(() => {
  selectQueue.length = 0;
  insertBehavior = { kind: 'rows', rows: [] };
  updateReturning.mockReset().mockResolvedValue([{ id: 'r-existing' }]);
});

describe('insertResponseWithContactReuse — 컨택 재사용', () => {
  it('활성 행이 있으면 INSERT 없이 물려받는다', async () => {
    selectQueue.push([row()]);
    const onReuse = vi.fn(async () => {});
    const res = await call({ onReuse });

    expect(res).toEqual({ kind: 'ready', row: row() });
    expect(onReuse).toHaveBeenCalledWith('r-existing');
  });

  it('종결된 행은 물려받지 않고 차단한다 — onReuse 도 부르지 않는다', async () => {
    selectQueue.push([row({ status: 'completed' })]);
    const onReuse = vi.fn(async () => {});
    const res = await call({ onReuse });

    // 차단 대상 행에 첫 답변을 머지하면 쓰기 가드에서 0행이 되어 500 이 난다.
    expect(res).toEqual({ kind: 'blocked', reason: 'token_already_used' });
    expect(onReuse).not.toHaveBeenCalled();
  });

  it('drop 행은 되살려 물려받는다', async () => {
    selectQueue.push([row({ status: 'drop' })]);
    const res = await call();

    expect(updateReturning).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ kind: 'ready', row: { status: 'in_progress' } });
  });

  it('되살리기가 경합에 지면 차단한다', async () => {
    selectQueue.push([row({ status: 'drop' })]);
    updateReturning.mockResolvedValue([]);
    const res = await call();

    expect(res).toEqual({ kind: 'blocked', reason: 'token_already_used' });
  });
});

describe('insertResponseWithContactReuse — INSERT 경합', () => {
  it('UNIQUE 위반이면 활성 행을 다시 찾아 물려받는다', async () => {
    selectQueue.push([]); // 최초 조회: 활성 행 없음
    selectQueue.push([row()]); // 경합 후 재조회: 다른 요청이 방금 만든 행
    insertBehavior = { kind: 'throw', error: uniqueViolation };

    const res = await call();
    expect(res).toEqual({ kind: 'ready', row: row() });
  });

  it('UNIQUE 가 아닌 에러는 삼키지 않고 그대로 던진다', async () => {
    selectQueue.push([]); // 최초 조회: 활성 행 없음
    selectQueue.push([row()]); // 있더라도 물려받으면 안 된다
    const boom = Object.assign(new Error('null value in column violates not-null constraint'), {
      code: '23502',
    });
    insertBehavior = { kind: 'throw', error: boom };

    // 종전에는 여기서 물려받아 성공을 반환했고 원인은 Sentry 에도 남지 않았다.
    await expect(call()).rejects.toBe(boom);
  });

  it('컨택이 없으면 UNIQUE 위반이라도 재조회하지 않고 던진다', async () => {
    insertBehavior = { kind: 'throw', error: uniqueViolation };
    await expect(call({ contactTargetId: null })).rejects.toBe(uniqueViolation);
  });
});

describe('insertResponseWithContactReuse — sessionId 충돌', () => {
  it('INSERT 가 충돌로 빈 결과면 같은 세션의 기존 행을 물려받는다', async () => {
    selectQueue.push([]); // 컨택 활성 행 없음
    selectQueue.push([row({ id: 'r-session' })]); // sessionId 로 찾은 기존 행
    insertBehavior = { kind: 'rows', rows: [] };

    const res = await call();
    expect(res).toMatchObject({ kind: 'ready', row: { id: 'r-session' } });
  });

  it('충돌했는데 기존 행도 없으면 원인을 담아 던진다', async () => {
    selectQueue.push([]); // 컨택 활성 행 없음
    selectQueue.push([]); // sessionId 조회도 빈 결과
    insertBehavior = { kind: 'rows', rows: [] };

    await expect(call()).rejects.toThrow(/충돌 후 기존 행 조회 실패/);
  });

  it('INSERT 가 성공하면 그 행을 그대로 돌려준다', async () => {
    selectQueue.push([]); // 컨택 활성 행 없음
    insertBehavior = { kind: 'rows', rows: [row({ id: 'r-new' })] };

    const res = await call();
    expect(res).toEqual({ kind: 'ready', row: row({ id: 'r-new' }) });
  });
});
