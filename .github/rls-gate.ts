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
//       재도입하는 마이그레이션이 없어야 한다(0036 의 REVOKE 회귀 방지).
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

/** RLS 게이트 평가 결과. */
export type RlsGateResult =
  | { kind: 'ok' }
  | {
      kind: 'violations';
      missingRls: MissingRlsViolation[];
      piiGrants: PiiGrantViolation[];
    };

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

/**
 * 마이그레이션 집합 전체를 평가한다.
 *
 * - 불변식 A: 어떤 파일이든 CREATE TABLE 한 테이블은 집합 어딘가에서 ENABLE ROW LEVEL
 *   SECURITY 가 있어야 한다(다른 파일에서 켜도 OK — 0035 처럼 사후 일괄 활성 허용).
 * - 불변식 B: PII 테이블에 anon/authenticated GRANT 가 있는 파일은 위반.
 */
export function evaluateMigrations(files: readonly MigrationFile[]): RlsGateResult {
  const createdTables = new Map<string, string>(); // table -> 최초 생성 파일
  const rlsEnabled = new Set<string>();
  const piiGrants: PiiGrantViolation[] = [];

  const createRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?("?[\w.]+"?(?:\."?\w+"?)?)/gi;
  const rlsRe =
    /alter\s+table\s+(?:if\s+exists\s+)?("?[\w.]+"?(?:\."?\w+"?)?)\s+enable\s+row\s+level\s+security/gi;

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

    // 불변식 B: PII 테이블 GRANT ... TO anon/authenticated 탐지.
    for (const table of PII_TABLES) {
      for (const role of DATA_API_ROLES) {
        // GRANT ... ON [TABLE] <pii> ... TO ... <role> 형태를 한 문장 단위로 검사.
        const grantStmtRe = new RegExp(
          `grant\\s+[\\s\\S]*?\\bon\\b\\s+(?:table\\s+)?"?${table}"?\\b[\\s\\S]*?\\bto\\b[\\s\\S]*?\\b${role}\\b`,
          'gi',
        );
        if (grantStmtRe.test(sql)) {
          piiGrants.push({ table, role, file: file.name });
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

  if (missingRls.length > 0 || piiGrants.length > 0) {
    return { kind: 'violations', missingRls, piiGrants };
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
  console.error(
    '신규 테이블은 ENABLE ROW LEVEL SECURITY 를 함께 추가하고, PII 테이블에 anon/authenticated GRANT 를 부여하지 마세요.',
  );
  process.exit(1);
}

// CLI 로 직접 실행될 때만 main() 을 호출한다(테스트 import 시에는 실행하지 않음).
const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('rls-gate.ts') || invokedPath.endsWith('rls-gate.mts')) {
  void main();
}
