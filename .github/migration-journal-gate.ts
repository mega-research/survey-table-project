// 마이그레이션 추적 드리프트 게이트 — supabase/migrations 의 모든 .sql 파일이 어딘가에
// 추적되는지 정적 검증한다.
//
// 이 repo 는 두 추적 시스템을 혼용한다(feedback_drizzle_migrate_journal):
//   (1) drizzle _journal.json  — `db:migrate` 가 따라가는 entries. drizzle generate 산출물.
//   (2) manual-migrations.json — MCP apply_migration / 직접 SQL 로 prod 에 적용한 수동 목록.
//
// 어느 쪽에도 없는 .sql 파일은 "파일은 있으나 추적/적용되지 않는" silent drift 이며,
// 재해복구(docs/runbooks/disaster-recovery.md) 시 누락되거나 신규 환경에서 적용 안 되는
// 위험을 만든다. 그런 파일이 있으면 fail-closed(exit 1) 한다.
//
// audit-gate.ts / rls-gate.ts 와 동일하게 순수 평가 함수 + main() CLI 로 분리한다.
// 종료 코드 결정은 main() 만 담당한다. 운영 DB 라이브 쿼리는 CI 자격증명이 없어 불가하므로
// 파일 기반 정적 검사로 대체한다.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MigrationDriftResult {
  /** .sql 파일인데 _journal.json·manual-migrations.json 어디에도 없음 (silent drift). */
  untracked: string[];
  /** manifest 에 등재됐으나 대응 .sql 파일이 없음 (삭제/오타). */
  orphanManifest: string[];
}

/**
 * 순수 평가: 마이그레이션 추적 드리프트를 계산한다.
 * tag 는 파일명에서 `.sql` 을 제외한 값(예: `0035_enable_rls_public_tables`).
 */
export function findMigrationDrift(args: {
  sqlFiles: string[];
  journalTags: string[];
  manualTags: string[];
}): MigrationDriftResult {
  const tracked = new Set([...args.journalTags, ...args.manualTags]);
  const fileSet = new Set(args.sqlFiles);
  const untracked = args.sqlFiles.filter((f) => !tracked.has(f)).sort();
  const orphanManifest = args.manualTags.filter((t) => !fileSet.has(t)).sort();
  return { untracked, orphanManifest };
}

function readJournalTags(migrationsDir: string): string[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries?: Array<{ tag?: string }> };
  return (journal.entries ?? []).map((e) => e.tag ?? '').filter(Boolean);
}

function readManualTags(migrationsDir: string): string[] {
  const manifest = JSON.parse(
    readFileSync(join(migrationsDir, 'manual-migrations.json'), 'utf8'),
  ) as { migrations?: string[] };
  return manifest.migrations ?? [];
}

function readSqlFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''));
}

function main(): void {
  const migrationsDir = process.argv[2] ?? 'supabase/migrations';
  const result = findMigrationDrift({
    sqlFiles: readSqlFiles(migrationsDir),
    journalTags: readJournalTags(migrationsDir),
    manualTags: readManualTags(migrationsDir),
  });

  let failed = false;
  if (result.untracked.length > 0) {
    failed = true;
    console.error(
      `[migration-journal-gate] 추적되지 않은 마이그레이션 ${result.untracked.length}건 — ` +
        `_journal.json(db:migrate) 또는 manual-migrations.json(MCP 적용)에 등재 필요:`,
    );
    for (const f of result.untracked) console.error(`  - ${f}`);
  }
  if (result.orphanManifest.length > 0) {
    failed = true;
    console.error(
      `[migration-journal-gate] manifest 에 있으나 .sql 파일이 없는 항목 ${result.orphanManifest.length}건:`,
    );
    for (const t of result.orphanManifest) console.error(`  - ${t}`);
  }

  if (failed) {
    process.exit(1);
  }
  console.log('[migration-journal-gate] OK — 모든 마이그레이션이 journal 또는 manifest 로 추적됨');
}

// CLI 로 직접 실행될 때만 main() 을 호출한다(테스트 import 시에는 실행하지 않음).
const invokedPath = process.argv[1] ?? '';
if (
  invokedPath.endsWith('migration-journal-gate.ts') ||
  invokedPath.endsWith('migration-journal-gate.mts')
) {
  main();
}
