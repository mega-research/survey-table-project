import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { personalTagColorValues } from '@/shared/contracts/workspace';

import { personalSurveyTags } from './workspace';

/**
 * 내 태그 색 어휘 세 사본 대조 (설문 즐겨찾기·태그 티켓 07).
 *
 * Drizzle 의 `$type<>` 은 CHECK 를 만들지 않는다 — 실제 제약은 마이그레이션 0150 이 손으로 쓴
 * 목록이고, 스키마의 `check()` 블록이 또 하나의 사본이다. 어휘 배열만 고쳐 배포하면 tsc 는
 * 통과하는데 새 색을 담은 INSERT 가 CHECK 에서 깨진다(루트 AGENTS.md 주의사항 1).
 */

/** `color IN ('a', 'b')` 꼴에서 따옴표 안 값만 꺼낸다. */
function quotedValuesIn(text: string): string[] {
  const match = /color"?\s+IN\s*\(([^)]*)\)/i.exec(text);
  if (!match) throw new Error(`color IN (...) 을 찾지 못했다: ${text.slice(0, 200)}`);
  return [...match[1]!.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
}

describe('내 태그 색 어휘 — 배열 · 스키마 CHECK · 마이그레이션 CHECK', () => {
  it('마이그레이션 0150 의 CHECK 가 어휘 배열과 같다', () => {
    const sqlText = readFileSync(
      join(process.cwd(), 'supabase/migrations/0150_personal_survey_tags.sql'),
      'utf8',
    );
    expect(quotedValuesIn(sqlText)).toEqual([...personalTagColorValues]);
  });

  it('스키마의 check() 가 어휘 배열과 같다', () => {
    const check = getTableConfig(personalSurveyTags).checks.find(
      (c) => c.name === 'personal_survey_tags_color_check',
    );
    expect(check, 'personal_survey_tags_color_check 가 스키마에 없다').toBeDefined();
    const rendered = new PgDialect().sqlToQuery(check!.value).sql;
    expect(quotedValuesIn(rendered)).toEqual([...personalTagColorValues]);
  });
});
