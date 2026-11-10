/**
 * 0166 의 이름 유일 인덱스 교체 순서 (설문 그룹 중첩 티켓 10).
 *
 * 「팀 안에서 유일」 인덱스 하나를 「최상위끼리」·「같은 부모 안에서」 둘로 바꾼다. **새 둘을 먼저 만들고
 * 옛 것을 지워야 한다** — 거꾸로면 그 사이에 이름 유일을 막는 인덱스가 하나도 없는 구간이 생긴다.
 * 파일은 한 트랜잭션으로 감싸 있지만, 문장을 하나씩 적용하는 도구(콘솔에 나눠 붙여 넣기)에서는 그
 * 구간이 실제로 열리고, 새 인덱스 생성이 실패하면(이미 겹치는 이름이 있다) 옛 인덱스만 사라진 채 남는다.
 *
 * 재생이 되는지는 격리 DB(`pnpm db:isolated`)가 본다 — 여기는 글자 순서만 못 박는다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/0166_survey_groups_nesting.sql'),
  'utf8',
)
  // 주석 속의 인덱스 이름이 순서 판정에 끼지 않게 한다.
  .replace(/--.*$/gm, '');

function positionOf(statement: RegExp): number {
  const found = sql.search(statement);
  expect(found, `${statement} 문장이 0166 에 있어야 한다`).toBeGreaterThanOrEqual(0);
  return found;
}

describe('0166 — 이름 유일 인덱스 교체', () => {
  it('새 인덱스 둘을 만든 뒤에 옛 인덱스를 지운다', () => {
    const dropOld = positionOf(/DROP INDEX IF EXISTS survey_groups_team_name_uq/);
    const createRoot = positionOf(/CREATE UNIQUE INDEX IF NOT EXISTS survey_groups_root_name_uq/);
    const createParent = positionOf(
      /CREATE UNIQUE INDEX IF NOT EXISTS survey_groups_parent_name_uq/,
    );

    expect(createRoot).toBeLessThan(dropOld);
    expect(createParent).toBeLessThan(dropOld);
  });
});
