import { describe, expect, it } from 'vitest';
import { sql as sqlTag } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { buildContactsFilterSql } from '@/lib/operations/contacts-filter-sql';
import type { FilterClause } from '@/server/shared/contacts-filters.server';

const dialect = new PgDialect();

function textClause(key: string, value: string, op: FilterClause['op']): FilterClause {
  return {
    op,
    condition: { source: `attrs.${key}`, mode: 'text', value },
  };
}

/** depth 0 에서 외부 괄호 밖에 토큰이 노출되는지 — 노출되면 최상위 그룹화가 깨진 것. */
function hasTokenOutsideOuterParens(sqlText: string): boolean {
  const trimmed = sqlText.trim();
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    // 마지막 문자(닫는 괄호) 이전인데 depth 가 0 으로 떨어지면 외부 괄호 밖에 내용이 있는 것.
    if (depth === 0 && i < trimmed.length - 1) return true;
  }
  return false;
}

describe('buildContactsFilterSql', () => {
  it('빈 배열 → TRUE', () => {
    const query = dialect.sqlToQuery(buildContactsFilterSql([]));
    expect(query.sql.trim()).toBe('TRUE');
  });

  it('단일 절은 (...) 괄호로 감싸 외부 AND 결합에 안전하다', () => {
    const query = dialect.sqlToQuery(buildContactsFilterSql([textClause('지역', '서울', null)]));
    const trimmed = query.sql.trim();
    expect(trimmed).toContain('"contact_targets".attrs');
    expect(trimmed.startsWith('(')).toBe(true);
    expect(trimmed.endsWith(')')).toBe(true);
    expect(hasTokenOutsideOuterParens(trimmed)).toBe(false);
  });

  it('혼합 AND/OR 는 누적마다 괄호로 그룹화해 좌→우 평가를 강제한다', () => {
    // A OR B AND C — 평탄 연결 시 PG AND>OR 우선순위로 A OR (B AND C) 가 되어
    // 의도한 (A OR B) AND C 와 어긋난다. 누적 그룹화로 ((A OR B) AND C) 가 되어야 한다.
    const clauses: FilterClause[] = [
      textClause('a', '1', null),
      textClause('b', '2', 'OR'),
      textClause('c', '3', 'AND'),
    ];
    const query = dialect.sqlToQuery(buildContactsFilterSql(clauses));
    const sqlText = query.sql;

    const orIdx = sqlText.indexOf(' OR ');
    const andIdx = sqlText.indexOf(' AND ');
    expect(orIdx).toBeGreaterThan(-1);
    expect(andIdx).toBeGreaterThan(-1);
    // OR 가 AND 보다 먼저 나타나고(좌→우), 그 사이에 닫는 괄호가 있어
    // (A OR B) 가 하나의 그룹으로 닫힌 뒤 AND C 와 결합됨을 검증한다.
    expect(orIdx).toBeLessThan(andIdx);
    expect(sqlText.slice(orIdx, andIdx)).toContain(')');
    // 전체가 외부 괄호 하나로 묶여 호출자 and() 결합 시 가지 탈출이 없어야 한다.
    expect(hasTokenOutsideOuterParens(sqlText)).toBe(false);
  });

  it('순수 OR 체인 전체를 외부 괄호로 감싼다 — 호출자 and() 결합 시 OR 가지 탈출 방지', () => {
    const clauses: FilterClause[] = [
      textClause('a', '1', null),
      textClause('b', '2', 'OR'),
      textClause('c', '3', 'OR'),
    ];
    const query = dialect.sqlToQuery(buildContactsFilterSql(clauses));
    const trimmed = query.sql.trim();
    expect(trimmed.startsWith('(')).toBe(true);
    expect(trimmed.endsWith(')')).toBe(true);
    // 최상위 OR 가 외부 괄호 밖으로 노출되면 surveyId 제약을 탈출한다 — 노출 0 이어야 한다.
    expect(hasTokenOutsideOuterParens(trimmed)).toBe(false);
  });
});

describe('buildContactsFilterSql — in 모드 (헤더 체크박스 필터)', () => {
  function inClause(source: string, values: string[]): FilterClause {
    return {
      op: null,
      condition: { source, mode: 'in', value: '', values },
    };
  }

  it('attrs.* in — 값 목록이 parameter binding 된 IN 절을 만든다', () => {
    const query = dialect.sqlToQuery(
      buildContactsFilterSql([inClause('attrs.기업유형', ['상장', '코스닥'])]),
    );
    expect(query.sql).toContain('"contact_targets".attrs');
    expect(query.sql).toContain(' IN ');
    // 인라인 문자열 금지 — 값은 반드시 파라미터로 진입 (ANY 언랩 함정 회피 포함).
    expect(query.sql).not.toContain('상장');
    expect(query.params).toContain('상장');
    expect(query.params).toContain('코스닥');
    expect(query.params).toContain('기업유형');
  });

  it('attrs.* in — 빈 값 목록은 FALSE', () => {
    const query = dialect.sqlToQuery(buildContactsFilterSql([inClause('attrs.기업유형', [])]));
    expect(query.sql).toContain('FALSE');
  });

  it('system.contact_result in — 최신 회차 result_code IN 절', () => {
    const query = dialect.sqlToQuery(
      buildContactsFilterSql([inClause('system.contact_result', ['완료', '거절'])]),
    );
    expect(query.sql).toContain('result_code');
    expect(query.sql).toContain(' IN ');
    expect(query.params).toContain('완료');
    expect(query.params).toContain('거절');
  });

  it('system.web in — 레거시 true 는 responded_at IS NOT NULL 유지 (구 URL 호환)', () => {
    const query = dialect.sqlToQuery(buildContactsFilterSql([inClause('system.web', ['true'])]));
    expect(query.sql).toContain('responded_at IS NOT NULL');
  });

  it('system.web in — 레거시 false 는 responded_at IS NULL 유지 (구 URL 호환)', () => {
    const query = dialect.sqlToQuery(buildContactsFilterSql([inClause('system.web', ['false'])]));
    expect(query.sql).toContain('responded_at IS NULL');
    expect(query.sql).not.toContain('IS NOT NULL');
  });

  it('system.web in — 상태 값(completed/drop)은 매칭 응답 status 조건 OR 전개', () => {
    const query = dialect.sqlToQuery(
      buildContactsFilterSql([inClause('system.web', ['completed', 'drop'])]),
    );
    // 표시/정렬과 같은 매칭(역참조) 기준
    expect(query.sql).toContain('contact_target_id = "contact_targets"."id"');
    expect(query.sql).toContain(' OR ');
    expect(query.params).toContain('completed');
    expect(query.params).toContain('drop');
  });

  it('system.web in — none 은 매칭 응답 없음 (status IS NULL)', () => {
    const query = dialect.sqlToQuery(buildContactsFilterSql([inClause('system.web', ['none'])]));
    expect(query.sql).toContain('contact_target_id = "contact_targets"."id"');
    expect(query.sql).toContain('IS NULL');
  });

  it('system.email_count in — 최신 수신 상태 조건 OR 전개, none 은 발송 이력 없음', () => {
    const query = dialect.sqlToQuery(
      buildContactsFilterSql([inClause('system.email_count', ['bounced', 'none'])]),
    );
    expect(query.sql).toContain('mail_recipients');
    expect(query.sql).toContain(' OR ');
    expect(query.sql).toContain('IS NULL');
    expect(query.params).toContain('bounced');
  });

  it('mailStatusRankExpr — 열람이 전달 완료보다 앞, 발송 이력 없음은 NULL(축 밖)', async () => {
    const { mailStatusRankExpr } = await import('@/lib/operations/contacts-filter-sql');
    const query = dialect.sqlToQuery(mailStatusRankExpr);
    const pos = (s: string) => query.sql.indexOf(s);
    expect(pos("'opened'")).toBeGreaterThan(-1);
    expect(pos("'opened'")).toBeLessThan(pos("'delivered'"));
    expect(pos("'delivered'")).toBeLessThan(pos("'bounced'"));
    // 없음은 순위 폴백 없이 NULL — orderExpr 의 NULLS LAST 가 맨 뒤 고정 (web 과 동일 규칙)
    expect(query.sql).toContain('ELSE NULL');
  });

  it('in 모드 미지원 source (pii.*) 는 FALSE', () => {
    const query = dialect.sqlToQuery(buildContactsFilterSql([inClause('pii.전화번호', ['x'])]));
    expect(query.sql).toContain('FALSE');
  });
});

describe('buildContactsFilterSql — attrs idlist (NO 범위 검색)', () => {
  function attrsIdlist(key: string, ranges: Array<{ from: number; to: number }>): FilterClause {
    return {
      op: null,
      condition: { source: `attrs.${key}`, mode: 'idlist', value: '', ranges },
    };
  }

  it('범위+단일 혼합 — CASE 숫자 가드 후 BETWEEN/= 비교', () => {
    const query = dialect.sqlToQuery(
      buildContactsFilterSql([
        attrsIdlist('NO', [
          { from: 10, to: 13 },
          { from: 15, to: 15 },
        ]),
      ]),
    );
    // 숫자 가드는 CASE 로 강제 — AND 평가 순서에 기대면 planner 재배열 시 cast 에러.
    expect(query.sql).toContain('CASE WHEN');
    expect(query.sql).toContain('::numeric');
    expect(query.sql).toContain('BETWEEN');
    expect(query.params).toContain(10);
    expect(query.params).toContain(13);
    expect(query.params).toContain(15);
    expect(query.params).toContain('NO');
  });

  it('빈 ranges → FALSE', () => {
    const query = dialect.sqlToQuery(buildContactsFilterSql([attrsIdlist('NO', [])]));
    expect(query.sql).toContain('FALSE');
  });
});

describe('buildContactsFilterSql — any 모드 (전체 컬럼 검색)', () => {
  it('subConditions 를 OR 로 묶어 괄호 안에 조립한다', () => {
    const clause: FilterClause = {
      op: null,
      condition: {
        source: 'system.all',
        mode: 'any',
        value: '핵심',
        subConditions: [
          { source: 'attrs.전시회명', mode: 'text', value: '핵심' },
          { source: 'attrs.지역', mode: 'text', value: '핵심' },
        ],
      },
    };
    const query = dialect.sqlToQuery(buildContactsFilterSql([clause]));
    expect(query.sql).toContain(' OR ');
    expect(query.sql).toContain('ILIKE');
    expect(query.params).toContain('전시회명');
    expect(query.params).toContain('지역');
    expect(hasTokenOutsideOuterParens(query.sql.trim())).toBe(false);
  });

  it('빈 subConditions → FALSE', () => {
    const clause: FilterClause = {
      op: null,
      condition: { source: 'system.all', mode: 'any', value: 'x', subConditions: [] },
    };
    const query = dialect.sqlToQuery(buildContactsFilterSql([clause]));
    expect(query.sql).toContain('FALSE');
  });
});

describe('matchedResponseSubquery — web 컬럼 매칭 응답 서브쿼리 (표시·정렬·필터 공유)', () => {
  it('매칭은 contact_target_id 역참조 — response_id(완료 시점에만 기록)만 보면 진행중·이탈이 응답없음 취급된다', async () => {
    const { matchedResponseSubquery } = await import('@/lib/operations/contacts-filter-sql');
    const query = dialect.sqlToQuery(matchedResponseSubquery(sqlTag`status`));
    expect(query.sql).toContain('survey_responses');
    expect(query.sql).toContain('contact_target_id = "contact_targets"."id"');
    // 확정 링크가 있으면 그 행 우선, 없으면 최신 활동 행
    expect(query.sql).toContain('(id = "contact_targets"."response_id") DESC NULLS LAST');
    expect(query.sql).toContain('last_activity_at DESC NULLS LAST');
  });
});

describe('attrsNaturalSortExprs — attrs 자연 정렬 표현식', () => {
  it('숫자 CASE 캐스트 표현식 + 텍스트 표현식 순서쌍을 반환한다', async () => {
    const { attrsNaturalSortExprs } = await import('@/lib/operations/contacts-filter-sql');
    const [numeric, text] = attrsNaturalSortExprs('NO');
    const numQ = dialect.sqlToQuery(numeric);
    expect(numQ.sql).toContain('CASE WHEN');
    expect(numQ.sql).toContain('::numeric');
    expect(numQ.params).toContain('NO');
    const textQ = dialect.sqlToQuery(text);
    expect(textQ.sql).toContain('"contact_targets".attrs');
    expect(textQ.sql).not.toContain('::numeric');
  });
});
