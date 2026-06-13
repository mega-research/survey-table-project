// RLS 하드닝 게이트 — supabase/migrations 의 SQL 을 정적 분석해 RLS 위생 불변식을 강제한다.
//
// 운영 DB 라이브 쿼리는 verify CI 잡에 prod 자격증명이 없어 불가능하므로(메모:
// feedback_drizzle_migrate_journal — 0020+ 는 MCP 수동 적용), 마이그레이션 SQL 자체를
// 정적 검사하는 결정적 게이트로 대체한다. 두 가지 불변식을 검사한다:
//
//   (A) public 스키마에 CREATE TABLE 하는 마이그레이션은 같은 마이그레이션 집합 안에서
//       해당 테이블에 ENABLE ROW LEVEL SECURITY 가 있어야 한다. 신규 테이블이 RLS 없이
//       추가되는 footgun(feedback_drizzle_supabase_rls_footgun)을 차단한다.
//   (B) PII 테이블(contact_targets / contact_pii)에 anon 또는 authenticated 로의 GRANT 를
//       재도입하는 마이그레이션이 없어야 한다(0036 의 REVOKE 회귀 방지). per-table GRANT 는
//       스키마 한정(public.contact_pii)·TABLE 키워드 유무와 무관하게 정규화 비교하고,
//       블랭킷 GRANT(ALL TABLES IN SCHEMA public)도 PII 를 덮으므로 위반으로 잡는다.
//   (C) PII 테이블에 anon/authenticated permissive 정책(CREATE POLICY ... TO ...)을 재도입하면
//       0036 의 deny-all(RLS-on + 정책 0개) 전제가 깨지므로 위반이다. 단 같은 정책이 이후
//       DROP POLICY 로 제거되면(0019 CREATE → 0036 DROP) net-out 되어 위반이 아니다.
//
// audit-gate.ts 와 동일하게 순수 평가 함수 + main() CLI 로 분리한다. 종료 코드는 main() 만 정한다.

/** CREATE TABLE 이 RLS 누락인 위반 항목. */
export interface MissingRlsViolation {
  table: string;
  file: string;
}

/** PII 테이블에 anon/authenticated GRANT 를 재도입한 위반 항목. */
export interface PiiGrantViolation {
  table: string;
  role: string;
  file: string;
}

/** PII 테이블에 anon/authenticated permissive 정책을 재도입한 위반 항목. */
export interface PiiPolicyViolation {
  table: string;
  role: string;
  policy: string;
  file: string;
}

/** RLS 게이트 평가 결과. */
export type RlsGateResult =
  | { kind: 'ok' }
  | {
      kind: 'violations';
      missingRls: MissingRlsViolation[];
      piiGrants: PiiGrantViolation[];
      piiPolicies: PiiPolicyViolation[];
    };

/** 블랭킷 GRANT(ALL TABLES IN SCHEMA public)의 table 필드 표기값. */
const BLANKET_TABLE_LABEL = 'ALL TABLES IN SCHEMA public';

/** 게이트가 보호하는 PII 테이블. */
export const PII_TABLES = ['contact_targets', 'contact_pii'] as const;

/** 데이터 API 롤(이 앱이 직접 접근하지 않아야 하는). */
const DATA_API_ROLES = ['anon', 'authenticated'] as const;

/** 한 마이그레이션 파일의 식별자 + SQL 본문. */
export interface MigrationFile {
  name: string;
  sql: string;
}

/** SQL 주석(-- 라인, /* *​/ 블록)을 제거해 주석 안 예시 SQL 이 오탐되지 않게 한다. */
function stripSqlComments(sql: string): string {
  // 블록 주석 먼저 제거 후 라인 주석 제거.
  const withoutBlock = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return withoutBlock
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/** 식별자에서 큰따옴표를 벗기고 public. 스키마 접두를 제거해 테이블명만 남긴다. */
function normalizeTable(raw: string): string {
  const unquoted = raw.replace(/"/g, '');
  const lastDot = unquoted.lastIndexOf('.');
  return lastDot === -1 ? unquoted : unquoted.slice(lastDot + 1);
}

/** 식별자에서 큰따옴표만 벗긴다(정책명·스키마명 비교용). */
function unquote(raw: string): string {
  return raw.replace(/"/g, '').trim();
}

/**
 * 주석 제거된 SQL 을 세미콜론 단위 문장으로 쪼갠다. GRANT / CREATE POLICY / DROP POLICY 는
 * 함수 본문($$ ... $$)에 들어가지 않는 마이그레이션 도메인이라 단순 split 으로 충분하다.
 * 크로스-문장 정규식([\s\S]*?)이 REVOKE 와 GRANT 를 섞어 매칭하던 비대칭/오탐을 없앤다.
 */
function splitStatements(sql: string): string[] {
  return stripSqlComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** anon/authenticated 중 주어진 텍스트(TO 절)에 단어경계로 등장하는 롤을 반환한다. */
function matchedDataApiRoles(toClause: string): string[] {
  return DATA_API_ROLES.filter((role) =>
    new RegExp(`\\b${role}\\b`, 'i').test(toClause),
  );
}

/**
 * 한 GRANT 문장에서 PII 노출 위반을 수집한다(불변식 B).
 *
 * - per-table: `GRANT ... ON [TABLE] <list> TO <roles>` 의 ON~TO 구간 테이블 리스트를
 *   normalizeTable 로 정규화해 PII_TABLES 와 비교(스키마 한정·TABLE 키워드 무관, 결함 1).
 * - 블랭킷: `GRANT ... ON ALL TABLES IN SCHEMA public TO <roles>` 는 PII 를 포함하므로
 *   table='ALL TABLES IN SCHEMA public' 로 위반(결함 2).
 */
function collectGrantViolations(stmt: string, file: string): PiiGrantViolation[] {
  // 문장이 GRANT 로 시작하는 경우만 — REVOKE / ALTER DEFAULT PRIVILEGES 는 제외.
  if (!/^grant\b/i.test(stmt)) return [];

  // GRANT <privs> ON <objects> TO <roles> 구조에서 ON~TO 구간과 TO 절을 분리.
  const onToMatch = stmt.match(/\bon\b([\s\S]*?)\bto\b([\s\S]*)$/i);
  if (!onToMatch) return [];
  const onClause = onToMatch[1] ?? '';
  const toClause = onToMatch[2] ?? '';

  const roles = matchedDataApiRoles(toClause);
  if (roles.length === 0) return [];

  const violations: PiiGrantViolation[] = [];

  // 블랭킷 GRANT: ON ALL TABLES IN SCHEMA <schema>.
  const blanketMatch = onClause.match(
    /^\s*all\s+tables\s+in\s+schema\s+("?[\w]+"?)/i,
  );
  if (blanketMatch) {
    if (unquote(blanketMatch[1] ?? '') === 'public') {
      for (const role of roles) {
        violations.push({ table: BLANKET_TABLE_LABEL, role, file });
      }
    }
    return violations;
  }

  // per-table GRANT: ON [TABLE] <comma-separated table list>.
  const tableList = onClause.replace(/^\s*table\s+/i, '');
  const grantedTables = new Set(
    tableList
      .split(',')
      .map((tok) => normalizeTable(tok.trim().split(/\s/)[0] ?? ''))
      .filter((t) => t.length > 0),
  );
  for (const table of PII_TABLES) {
    if (!grantedTables.has(table)) continue;
    for (const role of roles) {
      violations.push({ table, role, file });
    }
  }
  return violations;
}

/** 정책 식별 키(정규화 테이블 + 정책명)와 적용 순서상의 최종 상태. */
interface PolicyState {
  table: string;
  policy: string;
  role: string;
  file: string;
  status: 'created' | 'dropped';
}

/**
 * 마이그레이션 집합 전체를 평가한다.
 *
 * - 불변식 A: 어떤 파일이든 CREATE TABLE 한 테이블은 집합 어딘가에서 ENABLE ROW LEVEL
 *   SECURITY 가 있어야 한다(다른 파일에서 켜도 OK — 0035 처럼 사후 일괄 활성 허용).
 * - 불변식 B: PII 테이블에 anon/authenticated GRANT(스키마 한정·블랭킷 포함)가 있는 파일은 위반.
 * - 불변식 C: PII 테이블에 anon/authenticated permissive 정책이 net-created 상태로 남으면 위반
 *   (CREATE 후 DROP 으로 net-out 되면 통과 — 0019 CREATE → 0036 DROP).
 */
export function evaluateMigrations(files: readonly MigrationFile[]): RlsGateResult {
  const createdTables = new Map<string, string>(); // table -> 최초 생성 파일
  const rlsEnabled = new Set<string>();
  const piiGrants: PiiGrantViolation[] = [];
  // (정규화테이블 + 정책명) -> 적용 순서상 최종 상태. files 는 정렬되어 순서대로 처리된다.
  const policyStates = new Map<string, PolicyState>();

  const createRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?("?[\w.]+"?(?:\."?\w+"?)?)/gi;
  const rlsRe =
    /alter\s+table\s+(?:if\s+exists\s+)?("?[\w.]+"?(?:\."?\w+"?)?)\s+enable\s+row\s+level\s+security/gi;
  const createPolicyRe =
    /^create\s+policy\s+("?[\w]+"?)\s+on\s+("?[\w.]+"?)([\s\S]*)$/i;
  const dropPolicyRe =
    /^drop\s+policy\s+(?:if\s+exists\s+)?("?[\w]+"?)\s+on\s+("?[\w.]+"?)/i;

  for (const file of files) {
    const sql = stripSqlComments(file.sql);

    for (const m of sql.matchAll(createRe)) {
      const table = normalizeTable(m[1] ?? '');
      if (table && !createdTables.has(table)) {
        createdTables.set(table, file.name);
      }
    }
    for (const m of sql.matchAll(rlsRe)) {
      rlsEnabled.add(normalizeTable(m[1] ?? ''));
    }

    for (const stmt of splitStatements(file.sql)) {
      // 불변식 B: GRANT 문장(스키마 한정·블랭킷 포함) 탐지.
      piiGrants.push(...collectGrantViolations(stmt, file.name));

      // 불변식 C: PII 테이블 CREATE/DROP POLICY 를 적용 순서대로 net-out 추적.
      const createPolicy = stmt.match(createPolicyRe);
      if (createPolicy) {
        const table = normalizeTable(createPolicy[2] ?? '');
        if ((PII_TABLES as readonly string[]).includes(table)) {
          const roles = matchedDataApiRoles(createPolicy[3] ?? '');
          if (roles.length > 0) {
            const policy = unquote(createPolicy[1] ?? '');
            policyStates.set(`${table} ${policy}`, {
              table,
              policy,
              role: roles[0] ?? '',
              file: file.name,
              status: 'created',
            });
          }
        }
        continue;
      }
      const dropPolicy = stmt.match(dropPolicyRe);
      if (dropPolicy) {
        const table = normalizeTable(dropPolicy[2] ?? '');
        const policy = unquote(dropPolicy[1] ?? '');
        const key = `${table} ${policy}`;
        const prev = policyStates.get(key);
        if (prev) {
          policyStates.set(key, { ...prev, status: 'dropped', file: file.name });
        }
      }
    }
  }

  const missingRls: MissingRlsViolation[] = [];
  for (const [table, file] of createdTables) {
    if (!rlsEnabled.has(table)) {
      missingRls.push({ table, file });
    }
  }

  const piiPolicies: PiiPolicyViolation[] = [];
  for (const state of policyStates.values()) {
    if (state.status === 'created') {
      piiPolicies.push({
        table: state.table,
        role: state.role,
        policy: state.policy,
        file: state.file,
      });
    }
  }

  if (missingRls.length > 0 || piiGrants.length > 0 || piiPolicies.length > 0) {
    return { kind: 'violations', missingRls, piiGrants, piiPolicies };
  }
  return { kind: 'ok' };
}

/** 디렉토리의 *.sql 마이그레이션 파일을 읽어 MigrationFile 배열로 만든다. */
export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/** CI 진입점: argv[2] 의 마이그레이션 디렉토리를 평가하고 종료 코드를 정한다. */
async function main(): Promise<void> {
  const dir = process.argv[2] ?? 'supabase/migrations';
  const files = await loadMigrations(dir);
  const result = evaluateMigrations(files);

  if (result.kind === 'ok') {
    console.log(`RLS 게이트 통과: ${files.length}개 마이그레이션에서 위반 없음.`);
    return;
  }

  console.error('RLS 하드닝 게이트 실패:');
  for (const v of result.missingRls) {
    console.error(
      `  RLS 누락: ${v.file} 가 ${v.table} 를 생성하나 ENABLE ROW LEVEL SECURITY 가 없습니다.`,
    );
  }
  for (const v of result.piiGrants) {
    console.error(
      `  PII GRANT 재도입: ${v.file} 가 ${v.table} 에 ${v.role} GRANT 를 부여합니다(0036 REVOKE 회귀).`,
    );
  }
  for (const v of result.piiPolicies) {
    console.error(
      `  PII 정책 재도입: ${v.file} 가 ${v.table} 에 ${v.role} 대상 정책 "${v.policy}" 을 만듭니다(0036 deny-all 회귀).`,
    );
  }
  console.error(
    '신규 테이블은 ENABLE ROW LEVEL SECURITY 를 함께 추가하고, PII 테이블에 anon/authenticated GRANT·정책을 부여하지 마세요.',
  );
  process.exit(1);
}

// CLI 로 직접 실행될 때만 main() 을 호출한다(테스트 import 시에는 실행하지 않음).
const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('rls-gate.ts') || invokedPath.endsWith('rls-gate.mts')) {
  void main();
}
