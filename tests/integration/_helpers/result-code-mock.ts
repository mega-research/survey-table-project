/**
 * Integration test 공통 헬퍼 — result-code-statuses.server mock + drizzle SQL 직조용.
 *
 * 다음 5 integration test 가 동일 구현을 각자 들고 있어 통합:
 *   - blank-response-fallback.test.ts
 *   - invite-token-excluded.test.ts
 *   - preflight-exclusion.test.ts
 *   - profiles-exclusion.test.ts
 *   - report-progress-exclusion.test.ts
 *
 * `_helpers/` underscore prefix + .ts 확장자 (`.test.ts` 아님) 라서 vitest include 패턴
 * `tests/[glob]/[name].test.ts` 에 매칭되지 않는다 = 자동으로 discovery 제외.
 *
 * vi.mock 자체는 각 test 가 호이스트 컨텍스트에서 직접 호출해야 하므로 (factory 가
 * helper 안에 있으면 hoisting 충돌) 여기서는 `buildNegativeCodeExists` 의 mirror 구현
 * 과 SQL → raw 텍스트 추출 유틸만 export 한다.
 */

import { sql, type SQL } from 'drizzle-orm';

/**
 * `@/lib/operations/result-code-statuses.server` 의 `buildNegativeCodeExists` mirror.
 *
 * 실 헬퍼는 server-only import 가 묶여 있어 `vi.importActual` 로 가져올 수 없다
 * (B1 commit 16096ca 참조). 따라서 mock factory 마다 동일 EXISTS subquery 를 다시
 * 작성하던 중복을 이 헬퍼로 흡수한다.
 *
 * 시뮬레이터 (executeMock 등) 는 raw SQL 텍스트 안에서 "contact_attempts" + "result_code"
 * 키워드를 보고 negative 매칭 분기로 들어가므로 EXISTS 표현이 보존되어야 한다.
 */
export function mockBuildNegativeCodeExists(
  negativeCodes: string[],
  contactTargetIdExpr: SQL,
): SQL {
  if (negativeCodes.length === 0) return sql`FALSE`;
  // 실 헬퍼와 동일 — IN + sql.join 패턴 mirror (ANY array scalar unwrap 회피).
  const codeList = sql.join(
    negativeCodes.map((c) => sql`${c}`),
    sql`, `,
  );
  return sql`EXISTS (
    SELECT 1 FROM contact_attempts ca
    WHERE ca.contact_target_id = ${contactTargetIdExpr}
      AND ca.result_code IN (${codeList})
  )`;
}

/**
 * drizzle SQL 객체 트리 → raw 텍스트 평탄화.
 *
 * 본 헬퍼는 in-memory mock 시뮬레이터에서 sql template literal 의 키워드/UUID 를
 * 식별해 분기하기 위함이다. drizzle 4.x 의 SQL 객체 internal shape (queryChunks,
 * value, encoder + value wrapper) 에 의존하므로, drizzle 업그레이드 시 5 test
 * 한꺼번에 깨질 수 있다는 점은 동일 (오히려 1곳만 고치면 되어 유지보수 부담↓).
 *
 * 4 test (invite-token, preflight, profiles, report-progress) 의 구현 중 가장
 * superset 인 버전 (encoder + value 분기 포함) 을 표준으로 채택.
 */
export function extractRawSql(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map(extractRawSql).join(' ');
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj['value'])) return obj['value'].map(extractRawSql).join(' ');
  if (typeof obj['value'] === 'string') return obj['value'];
  if (Array.isArray(obj['queryChunks'])) return obj['queryChunks'].map(extractRawSql).join(' ');
  if ('encoder' in obj && 'value' in obj) {
    return String((obj as { value: unknown }).value);
  }
  return '';
}
