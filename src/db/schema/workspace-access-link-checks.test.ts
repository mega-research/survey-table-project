import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { surveyAccessLinks } from './workspace';

/**
 * 외주 링크 칸의 CHECK 두 사본 대조 (fieldwork-multi-company 티켓 12).
 *
 * 실제 제약은 마이그레이션이 손으로 쓴 CHECK 이고 스키마의 `check()` 블록이 또 하나의 사본이다(루트 AGENTS.md
 * 주의사항 1). 스키마에 사본이 없으면 칸 규칙(이름표는 외주 전용 1~40자, 나눈 적 있음과 마지막 조건은 함께 선다)을
 * 코드에서 찾을 자리가 없고, 한쪽만 고쳐도 아무것도 빨개지지 않는다.
 */

/** `ADD CONSTRAINT <name> CHECK ( … )` 의 괄호 안 — 괄호 짝을 세어 꺼낸다. */
function migrationCheck(file: string, name: string): string {
  const text = readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8');
  const at = text.indexOf(`ADD CONSTRAINT ${name}`);
  if (at < 0) throw new Error(`${file} 에 ${name} 이 없다`);
  const open = text.indexOf('(', text.indexOf('CHECK', at));
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`${name} 의 괄호가 닫히지 않았다`);
}

function schemaCheck(name: string): string {
  const check = getTableConfig(surveyAccessLinks).checks.find((c) => c.name === name);
  if (!check) throw new Error(`${name} 가 스키마에 없다`);
  return new PgDialect().sqlToQuery(check.value).sql;
}

/** 표 이름·따옴표·공백·바깥 괄호를 걷어 문장만 비교한다. */
function normalize(sqlText: string): string {
  return sqlText
    .replaceAll('"survey_access_links".', '')
    .replaceAll('"', '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/^\((.*)\)$/, '$1');
}

describe('survey_access_links 의 CHECK — 스키마 check() 와 마이그레이션이 같다', () => {
  it.each([
    ['0159_fieldwork_links_multi_and_label.sql', 'survey_access_links_label_check'],
    ['0160_fieldwork_link_shares.sql', 'survey_access_links_share_check'],
  ])('%s 의 %s', (file, name) => {
    expect(normalize(schemaCheck(name))).toBe(normalize(migrationCheck(file, name)));
  });
});
