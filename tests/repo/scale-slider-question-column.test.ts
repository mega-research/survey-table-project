import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { questions } from '@/db/schema/surveys';
import { SCALE_SLIDER_DIRECTIONS } from '@/types/scale-slider';

/**
 * 문항의 슬라이더 방향(`questions.scale_slider`) — 값 목록 세 벌의 대조.
 *
 * Drizzle 의 `text(..., { enum })` 은 타입 전용이라 SQL CHECK 를 만들지 않는다(루트 AGENTS.md 주의사항 1).
 * 그래서 같은 값 목록이 세 곳에 따로 적힌다 — 어휘 배열(`@/types/scale-slider`) · 스키마의 `check()` ·
 * 마이그레이션의 CHECK. 배열만 늘리면 tsc 는 통과하는데 새 값을 담은 저장이 DB 에서 깨진다.
 * 이 테스트가 셋을 한 자리에서 맞춘다. 어휘를 늘릴 때는 새 마이그레이션으로 제약을 갈아끼운다 —
 * 아래는 등재 순서(= 빈 DB 재생 순서)에서 그 제약을 마지막으로 거는 파일을 본다.
 */

const CONSTRAINT = 'questions_scale_slider_check';
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function quotedValues(sqlText: string): string[] {
  return [...sqlText.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
}

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
    const body = sqlBody(tag);
    const match = new RegExp(
      `ADD\\s+CONSTRAINT\\s+"?${CONSTRAINT}"?\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`,
      'i',
    ).exec(body);
    if (match) found = { tag, check: match[1] ?? '' };
  }
  return found;
}

describe('문항의 슬라이더 방향 컬럼 — 값 목록 세 벌', () => {
  it('스키마의 check() 가 어휘 배열과 같은 값을 받고 NULL 을 받는다', () => {
    const check = getTableConfig(questions).checks.find((c) => c.name === CONSTRAINT);
    expect(check, `${CONSTRAINT} 가 스키마에 없다`).toBeDefined();

    const rendered = new PgDialect().sqlToQuery(check!.value).sql;
    expect(quotedValues(rendered).sort()).toEqual([...SCALE_SLIDER_DIRECTIONS].sort());
    expect(rendered).toMatch(/"scale_slider" is null/i);
  });

  it('마이그레이션의 CHECK 가 어휘 배열과 같은 값을 받고 NULL 을 받는다', () => {
    const migration = latestMigrationCheck();
    expect(migration, `${CONSTRAINT} 를 거는 마이그레이션이 등재돼 있지 않다`).not.toBeNull();

    expect(quotedValues(migration!.check).sort()).toEqual([...SCALE_SLIDER_DIRECTIONS].sort());
    expect(migration!.check).toMatch(/scale_slider"?\s+IS\s+NULL/i);
  });

  it('컬럼은 기본값 없는 nullable text 다 — 값이 없으면 꺼진 것이다', () => {
    const column = getTableConfig(questions).columns.find((c) => c.name === 'scale_slider');
    expect(column).toBeDefined();
    expect(column!.getSQLType()).toBe('text');
    expect(column!.notNull).toBe(false);
    expect(column!.hasDefault).toBe(false);
  });

  it('컬럼을 만드는 마이그레이션은 빈 DB 에서도, 이미 적용된 DB 에서도 다시 돌 수 있다', () => {
    const tag = registeredMigrations().find((t) => /scale_slider/.test(t));
    expect(tag, '슬라이더 방향 컬럼 마이그레이션이 등재돼 있지 않다').toBeDefined();

    const body = sqlBody(tag!);
    expect(body).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?scale_slider"?\s+text/i);
    expect(body).toMatch(new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+"?${CONSTRAINT}"?`, 'i'));
    // 기존 행을 전제하거나 고쳐 쓰는 문장이 없다 — nullable 추가만 한다
    expect(body).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|NOT\s+NULL|DEFAULT)\b/i);
  });
});
