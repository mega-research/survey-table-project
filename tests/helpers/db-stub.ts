/**
 * `@/db` 목의 공용 뼈대 — 음성 스위트가 "서비스가 DB 에 닿았다" 를 사고로 만드는 장치.
 *
 * 두 스위트(cross-team-idor-rpc · system-scope-rejection)가 같은 모양을 각자 들고 있었다.
 * 목의 세부가 갈리면 한쪽만 조용히 무력해지므로 여기로 모은다.
 *
 * **`vi.mock('@/db')` 은 반드시 `importOriginal` 스프레드와 함께 쓸 것.** `src/db/index.ts` 는
 * 끝에서 `export * from './schema'` 를 하므로, 팩토리가 `{ db }` 만 돌려주면 **전 테이블
 * export 가 사라진다**. 그러면 테이블을 `@/db` 에서 받는 모듈이 체인에 들어오는 순간
 * `from(undefined)` → 빈 결과가 되어 **모든 표면이 「없는 설문」으로 NOT_FOUND** 가 되고,
 * 스위트는 관문이 있든 없든 초록이 된다(거짓 초록).
 */

/** 어떤 체이닝(where·limit·innerJoin·orderBy·for…)도 받아 결과로 resolve 하는 스텁. */
export function resolvingChain(rows: readonly unknown[]): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onFulfilled: (value: unknown) => unknown) => onFulfilled(rows);
        }
        return () => chain;
      },
    },
  );
  return chain;
}

export interface DbStubOptions {
  /** `db.select().from(table)` 이 돌려줄 행 — 살려 둘 테이블만 채운다. */
  rowsFor: (table: unknown) => readonly unknown[];
  /**
   * `db.query.<table>.findFirst/findMany` 가 돌려줄 행. `undefined` 를 돌려주면 사고다 —
   * 관계형 조회가 필요한 테이블만 열어 둔다는 뜻이다.
   */
  relationalRowFor?: (table: string) => unknown | undefined;
  /** 쓰기·미허용 조회가 닿았을 때 던질 메시지. */
  reachedMessage: string;
}

/**
 * 조회만 살리고 쓰기는 전부 던지는 db 대역.
 *
 * 트랜잭션은 **열어 준다** — 관문이 서비스 트랜잭션 안에 있는 경로(saveWithDetails)를
 * 검증하려면 tx 가 열려야 한다. 쓰기는 tx 안에서도 사고이므로 신호는 살아 있다.
 */
export function createDbStub(options: DbStubOptions): Record<string, unknown> {
  const explode = (): never => {
    throw new Error(options.reachedMessage);
  };

  const select = () => ({
    from: (table: unknown) => resolvingChain(options.rowsFor(table)),
  });

  const relationalQuery = new Proxy(
    {},
    {
      get(_target, table) {
        const row = options.relationalRowFor?.(String(table));
        if (row === undefined) return explode();
        return {
          findFirst: async () => row,
          findMany: async () => [row],
        };
      },
    },
  );

  const executor = {
    select,
    selectDistinct: select,
    insert: explode,
    update: explode,
    delete: explode,
    execute: explode,
    query: relationalQuery,
  };

  return {
    ...executor,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(executor),
  };
}
