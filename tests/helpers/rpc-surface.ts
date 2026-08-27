/**
 * oRPC 표면 인벤토리 — 라우터를 **런타임에 열거해** 표면 목록을 만든다 (역할 모델 v2 티켓 15).
 *
 * 음성 스위트가 손으로 적은 목록만 돈다면 "빠뜨린 표면" 은 영원히 초록이다. 그래서 목록의
 * 출처를 사람이 아니라 `@/server/router` 자체로 둔다 — 새 procedure 가 붙으면 인벤토리가
 * 저절로 늘고, 그것을 다루지 않는 스위트는 그 자리에서 빨개진다.
 *
 * 판별은 두 가지다.
 *  ① **베이스** — procedure 에 쌓인 미들웨어 배열의 **앞부분이 어느 베이스의 것과
 *     같은가**로 정한다. authed·account·scoped 는 길이가 같지만(2) 두 번째 미들웨어가
 *     서로 다른 함수 객체라(orpc.ts 가 의도적으로 별개 객체로 둔다) 정확히 갈린다.
 *     문자열 태그나 파일 경로 추측이 아니라 **동일성 비교**라 이름을 바꿔도 안 깨진다.
 *  ② **입력 키** — zod object 의 shape 키. 비-object 입력(z.custom·z.union)은 키를 못 읽으므로
 *     `hasObjectInput: false` 로 표시하고, 인벤토리가 그런 표면을 따로 다루게 한다.
 *
 * 이 파일은 `.test.ts` 가 아니라 vitest include 에 잡히지 않는다(_helpers 와 같은 관례).
 */
import { account, authed, pub, scoped, superadmin } from '@/server/orpc';
import { router } from '@/server/router';

export type ProcedureBase = 'pub' | 'authed' | 'superadmin' | 'account' | 'scoped';

export interface ProcedureEntry {
  /** 라우터 경로 — `surveyBuilder.read.byId` 처럼 점으로 이은 키. */
  path: string;
  base: ProcedureBase;
  /** zod object 입력의 최상위 키. 비-object 입력이면 빈 배열. */
  inputKeys: readonly string[];
  /** `.input(...)` 자체가 붙어 있는가. 없으면 입력이 없는 표면이라 설문을 지목할 수 없다. */
  hasInputSchema: boolean;
  /** 입력 스키마가 zod object 라서 키를 읽을 수 있었는가. */
  hasObjectInput: boolean;
}

/** 설문 경계를 지목하는 입력 키 — 이 중 하나라도 있으면 설문 스코프 표면이다. */
const SURVEY_INPUT_KEYS = ['surveyId', 'surveyIds'] as const;

interface OrpcMeta {
  middlewares?: unknown[];
  inputSchema?: { shape?: Record<string, unknown> };
}

function metaOf(node: unknown): OrpcMeta | null {
  if (typeof node !== 'object' || node === null) return null;
  const meta = (node as Record<string, unknown>)['~orpc'];
  return typeof meta === 'object' && meta !== null ? (meta as OrpcMeta) : null;
}

function middlewaresOf(node: unknown): unknown[] {
  return metaOf(node)?.middlewares ?? [];
}

/**
 * 베이스 후보 — 긴 사슬부터 본다.
 *
 * superadmin 은 authed 파생이라 authed 의 사슬을 접두사로 포함한다. 짧은 것부터 보면
 * superadmin procedure 가 authed 로 오분류된다.
 */
const BASE_CHAINS: ReadonlyArray<readonly [ProcedureBase, unknown[]]> = (
  [
    ['superadmin', middlewaresOf(superadmin)],
    ['authed', middlewaresOf(authed)],
    ['account', middlewaresOf(account)],
    ['scoped', middlewaresOf(scoped)],
    ['pub', middlewaresOf(pub)],
  ] as ReadonlyArray<readonly [ProcedureBase, unknown[]]>
)
  .slice()
  .sort((a, b) => b[1].length - a[1].length);

function baseOf(node: unknown): ProcedureBase {
  const mws = middlewaresOf(node);
  for (const [name, chain] of BASE_CHAINS) {
    if (chain.length > 0 && chain.every((fn, i) => mws[i] === fn)) return name;
  }
  // 어느 베이스와도 안 맞으면 인벤토리가 거짓말을 하게 되므로 조용히 넘기지 않는다.
  throw new Error('알 수 없는 procedure 베이스 — orpc.ts 의 베이스가 늘었는가?');
}

/** 라우터 전체를 훑어 procedure 목록을 만든다. */
export function enumerateProcedures(): ProcedureEntry[] {
  const found: ProcedureEntry[] = [];

  function walk(node: unknown, path: string[]): void {
    if (typeof node !== 'object' || node === null) return;
    const meta = metaOf(node);
    if (meta) {
      const shape = meta.inputSchema?.shape;
      found.push({
        path: path.join('.'),
        base: baseOf(node),
        inputKeys: shape ? Object.keys(shape) : [],
        hasInputSchema: Boolean(meta.inputSchema),
        hasObjectInput: Boolean(shape),
      });
      return;
    }
    for (const [key, value] of Object.entries(node)) walk(value, [...path, key]);
  }

  walk(router, []);
  return found;
}

/** 입력에 설문 지목 키가 있는가. */
export function takesSurveyId(entry: ProcedureEntry): boolean {
  return SURVEY_INPUT_KEYS.some((key) => entry.inputKeys.includes(key));
}

/** 내부 계정만 지나는 베이스 — 설문 관문을 져야 하는 표면의 후보군. */
export function isInternalBase(base: ProcedureBase): boolean {
  return base === 'authed' || base === 'scoped';
}
