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

/** 파일명 접두가 겹치는 마이그레이션 묶음. */
export interface DuplicatePrefix {
  prefix: string;
  files: string[];
}

/**
 * 이미 공존하는 접두 — push 시대의 산물이라 되돌릴 수 없어 유예한다.
 * 이 목록은 늘어나지 않는다. 늘리려면 왜 네 번째가 필요한지부터 답해야 한다.
 */
const GRANDFATHERED_PREFIXES = new Set(['0003', '0009', '0019']);

/**
 * 순수 평가: 유예 목록 밖에서 새로 생긴 접두 중복을 계산한다.
 *
 * 접두 중복 자체는 도구가 견딘다 — 재생 순서는 파일명이 아니라 manual-migrations.json
 * 배열이 쥐고 있고 tag 는 확장자를 뺀 전체 파일명이라 키가 겹치지도 않는다.
 * 견디지 못하는 건 사람이다. `ls | tail` 이 최신 번호를 거짓말하고, 실제 순서는
 * 배열에만 있어 눈으로 확인이 안 된다. 여러 브랜치가 같은 DB 를 만지는 동안
 * 각자 다음 번호를 집으면 이 상태가 계속 재생산되므로 여기서 막는다.
 */
export function findNewDuplicatePrefixes(args: { sqlFiles: string[] }): DuplicatePrefix[] {
  const byPrefix = new Map<string, string[]>();
  for (const file of args.sqlFiles) {
    const prefix = /^(\d+)_/.exec(file)?.[1];
    if (!prefix) continue;
    const bucket = byPrefix.get(prefix);
    if (bucket) bucket.push(file);
    else byPrefix.set(prefix, [file]);
  }
  return [...byPrefix.entries()]
    .filter(([prefix, files]) => files.length > 1 && !GRANDFATHERED_PREFIXES.has(prefix))
    .map(([prefix, files]) => ({ prefix, files: files.slice().sort() }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
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
  const sqlFiles = readSqlFiles(migrationsDir);
  const result = findMigrationDrift({
    sqlFiles,
    journalTags: readJournalTags(migrationsDir),
    manualTags: readManualTags(migrationsDir),
  });
  const duplicates = findNewDuplicatePrefixes({ sqlFiles });

  let failed = false;
  if (duplicates.length > 0) {
    failed = true;
    console.error(
      `[migration-journal-gate] 접두가 겹치는 마이그레이션 ${duplicates.length}건 — ` +
        '다음 빈 번호로 재배치할 것:',
    );
    for (const d of duplicates) console.error(`  - ${d.prefix}: ${d.files.join(', ')}`);
    console.error(
      '  재생 순서는 파일명이 아니라 manual-migrations.json 배열이 결정하므로 동작은 깨지지 않는다. ' +
        '다만 번호로 최신을 읽을 수 없게 되고 순서를 눈으로 확인할 수 없다.',
    );
  }
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
  console.log(
    '[migration-journal-gate] OK — 모든 마이그레이션이 추적되고 접두 중복이 없음',
  );
}

// CLI 로 직접 실행될 때만 main() 을 호출한다(테스트 import 시에는 실행하지 않음).
const invokedPath = process.argv[1] ?? '';
if (
  invokedPath.endsWith('migration-journal-gate.ts') ||
  invokedPath.endsWith('migration-journal-gate.mts')
) {
  main();
}
