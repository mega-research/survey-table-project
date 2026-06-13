import { describe, expect, it } from 'vitest';

import { evaluateMigrations, loadMigrations } from '../../../.github/rls-gate';

describe('evaluateMigrations', () => {
  it('CREATE TABLE 에 ENABLE RLS 가 있으면 ok 를 반환한다', () => {
    const result = evaluateMigrations([
      {
        name: '0001_t.sql',
        sql: 'CREATE TABLE "foo" (id uuid);\nALTER TABLE "foo" ENABLE ROW LEVEL SECURITY;',
      },
    ]);
    expect(result.kind).toBe('ok');
  });

  it('다른 파일에서 RLS 를 켜도 ok 를 반환한다(사후 일괄 활성 허용)', () => {
    const result = evaluateMigrations([
      { name: '0001_create.sql', sql: 'CREATE TABLE foo (id uuid);' },
      {
        name: '0002_enable.sql',
        sql: 'ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;',
      },
    ]);
    expect(result.kind).toBe('ok');
  });

  it('RLS 없이 CREATE TABLE 만 있으면 violations 를 반환한다', () => {
    const result = evaluateMigrations([
      { name: '0001_bad.sql', sql: 'CREATE TABLE "bar" (id uuid);' },
    ]);
    expect(result.kind).toBe('violations');
    if (result.kind === 'violations') {
      expect(result.missingRls).toHaveLength(1);
      expect(result.missingRls[0]?.table).toBe('bar');
      expect(result.missingRls[0]?.file).toBe('0001_bad.sql');
    }
  });

  it('CREATE TABLE IF NOT EXISTS 도 RLS 누락을 잡는다', () => {
    const result = evaluateMigrations([
      { name: '0001.sql', sql: 'CREATE TABLE IF NOT EXISTS baz (id uuid);' },
    ]);
    expect(result.kind).toBe('violations');
  });

  it('주석 안의 CREATE TABLE 예시는 오탐하지 않는다', () => {
    const result = evaluateMigrations([
      {
        name: '0001.sql',
        sql: '-- CREATE TABLE example (id uuid);\n/* CREATE TABLE blk (id uuid); */\nSELECT 1;',
      },
    ]);
    expect(result.kind).toBe('ok');
  });

  it('PII 테이블에 authenticated GRANT 재도입이 있으면 violations 를 반환한다', () => {
    const result = evaluateMigrations([
      {
        name: '0099_regress.sql',
        sql: 'GRANT ALL ON TABLE "contact_pii" TO anon, authenticated;',
      },
    ]);
    expect(result.kind).toBe('violations');
    if (result.kind === 'violations') {
      const roles = result.piiGrants.map((g) => g.role).sort();
      expect(roles).toEqual(['anon', 'authenticated']);
      expect(result.piiGrants.every((g) => g.table === 'contact_pii')).toBe(true);
    }
  });

  it('주석 안의 GRANT(롤백 메모)는 PII GRANT 오탐하지 않는다', () => {
    const result = evaluateMigrations([
      {
        name: '0036.sql',
        sql:
          'REVOKE ALL ON TABLE "contact_pii" FROM anon, authenticated;\n' +
          '-- Rollback: GRANT ALL ON TABLE "contact_pii" TO anon, authenticated;',
      },
    ]);
    expect(result.kind).toBe('ok');
  });

  it('service_role 로의 GRANT 는 PII 위반이 아니다', () => {
    const result = evaluateMigrations([
      {
        name: '0001.sql',
        sql: 'GRANT SELECT ON TABLE "contact_targets" TO service_role;',
      },
    ]);
    expect(result.kind).toBe('ok');
  });
});

// 회귀 방지: 실제 supabase/migrations 디렉토리가 게이트를 통과해야 한다.
// 0036 의 REVOKE / 0035 의 ENABLE RLS / 0019 의 contact_pii CREATE+ENABLE 가 모두 정합인지
// 정적 검사로 확인한다.
describe('실제 마이그레이션 디렉토리', () => {
  it('supabase/migrations 전체가 RLS 게이트를 통과한다', async () => {
    const files = await loadMigrations('supabase/migrations');
    expect(files.length).toBeGreaterThan(0);
    const result = evaluateMigrations(files);
    if (result.kind === 'violations') {
      // 실패 시 위반 목록을 메시지에 담아 디버깅을 돕는다.
      throw new Error(
        `RLS 게이트 위반: ${JSON.stringify(result.missingRls)} / ${JSON.stringify(result.piiGrants)}`,
      );
    }
    expect(result.kind).toBe('ok');
  });
});
