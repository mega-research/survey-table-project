import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { questions } from '@/db/schema/surveys';
import {
  MOBILE_PIECE_COLUMNS_PER_VIEW_MAX,
  MOBILE_PIECE_COLUMNS_PER_VIEW_MIN,
} from '@/types/mobile-table-display';

/**
 * 조각 한 화면 칸 수(`questions.mobile_drilldown_columns_per_view`) — 범위 세 벌의 대조.
 *
 * 범위(3~6)가 세 곳에 따로 적힌다 — 어휘 상수(`@/types/mobile-table-display`, zod 두 곳이 이 상수를 쓴다) ·
 * 스키마의 `check()` · 마이그레이션의 CHECK. 상수만 고치면 tsc 와 zod 는 통과하는데 새 값을 담은 저장이
 * DB 에서 깨진다(루트 AGENTS.md 주의사항 1). 이 테스트가 셋을 한 자리에서 맞춘다. 범위를 바꿀 때는 새
 * 마이그레이션으로 제약을 갈아끼운다 — 아래는 등재 순서에서 그 제약을 마지막으로 거는 파일을 본다.
 */

const CONSTRAINT = 'questions_mobile_drilldown_columns_per_view_check';
const COLUMN = 'mobile_drilldown_columns_per_view';
const REVERSE_COLUMN = 'mobile_drilldown_reverse_columns';
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function registeredMigrations(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'manual-migrations.json'), 'utf8'),
  ) as { migrations: string[] };
  return manifest.migrations;
}

/** 주석 줄을 뺀 SQL 본문 — 머리 주석의 설명 글자가 제약 문장으로 읽히지 않게 */
function sqlBody(tag: string): string {
  return readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/** 등재 순서에서 그 제약을 마지막으로 거는 마이그레이션의 CHECK 본문 */
function latestMigrationCheck(): { tag: string; check: string } | null {
  let found: { tag: string; check: string } | null = null;
  for (const tag of registeredMigrations()) {
    const match = new RegExp(
      `ADD\\s+CONSTRAINT\\s+"?${CONSTRAINT}"?\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`,
      'i',
    ).exec(sqlBody(tag));
    if (match) found = { tag, check: match[1] ?? '' };
  }
  return found;
}

/** `>= 3` · `<= 6` 에서 하한·상한을 꺼낸다 */
function bounds(sqlText: string): { min: number | null; max: number | null } {
  const min = />=\s*(\d+)/.exec(sqlText);
  const max = /<=\s*(\d+)/.exec(sqlText);
  return { min: min ? Number(min[1]) : null, max: max ? Number(max[1]) : null };
}

const EXPECTED = {
  min: MOBILE_PIECE_COLUMNS_PER_VIEW_MIN,
  max: MOBILE_PIECE_COLUMNS_PER_VIEW_MAX,
};

describe('조각 한 화면 칸 수 컬럼 — 범위 세 벌', () => {
  it('스키마의 check() 가 어휘 상수와 같은 범위를 받고 NULL 을 받는다', () => {
    const check = getTableConfig(questions).checks.find((c) => c.name === CONSTRAINT);
    expect(check, `${CONSTRAINT} 가 스키마에 없다`).toBeDefined();

    const rendered = new PgDialect().sqlToQuery(check!.value).sql;
    expect(bounds(rendered)).toEqual(EXPECTED);
    expect(rendered).toMatch(new RegExp(`"${COLUMN}" is null`, 'i'));
  });

  it('마이그레이션의 CHECK 가 어휘 상수와 같은 범위를 받고 NULL 을 받는다', () => {
    const migration = latestMigrationCheck();
    expect(migration, `${CONSTRAINT} 를 거는 마이그레이션이 등재돼 있지 않다`).not.toBeNull();

    expect(bounds(migration!.check)).toEqual(EXPECTED);
    expect(migration!.check).toMatch(new RegExp(`${COLUMN}"?\\s+IS\\s+NULL`, 'i'));
  });

  it('칸 수는 기본값 없는 nullable integer 다 — 값이 없으면 꺼진 것이다', () => {
    const column = getTableConfig(questions).columns.find((c) => c.name === COLUMN);
    expect(column).toBeDefined();
    expect(column!.getSQLType()).toBe('integer');
    expect(column!.notNull).toBe(false);
    expect(column!.hasDefault).toBe(false);
  });

  it('반전은 DB 기본값 false 인 NOT NULL boolean 이다 — 옛 앱의 INSERT 가 깨지지 않는다', () => {
    const column = getTableConfig(questions).columns.find((c) => c.name === REVERSE_COLUMN);
    expect(column).toBeDefined();
    expect(column!.getSQLType()).toBe('boolean');
    expect(column!.notNull).toBe(true);
    expect(column!.hasDefault).toBe(true);
  });

  it('두 컬럼을 만드는 마이그레이션은 빈 DB 에서도, 이미 적용된 DB 에서도 다시 돌 수 있다', () => {
    const tag = registeredMigrations().find((t) => /mobile_piece_arrangement/.test(t));
    expect(tag, '조각 표현 설정 마이그레이션이 등재돼 있지 않다').toBeDefined();

    const body = sqlBody(tag!);
    expect(body).toMatch(
      new RegExp(
        `ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+"?${REVERSE_COLUMN}"?\\s+boolean\\s+NOT\\s+NULL\\s+DEFAULT\\s+false`,
        'i',
      ),
    );
    expect(body).toMatch(
      new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+"?${COLUMN}"?\\s+integer`, 'i'),
    );
    expect(body).toMatch(new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+"?${CONSTRAINT}"?`, 'i'));
    // 기존 행을 전제하거나 고쳐 쓰는 문장이 없다
    expect(body).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
  });
});
