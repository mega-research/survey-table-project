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

  // 결함 1: 스키마 한정(public.) PII GRANT 도 탐지해야 한다.
  it('스키마 한정 GRANT(public.contact_pii)도 PII 위반으로 잡는다', () => {
    const result = evaluateMigrations([
      {
        name: '0099_schema_qualified.sql',
        sql: 'GRANT SELECT ON public.contact_pii TO anon;',
      },
    ]);
    expect(result.kind).toBe('violations');
    if (result.kind === 'violations') {
      expect(result.piiGrants).toHaveLength(1);
      expect(result.piiGrants[0]?.table).toBe('contact_pii');
      expect(result.piiGrants[0]?.role).toBe('anon');
    }
  });

  it('콤마 리스트 GRANT 에 PII 가 섞여 있어도 잡는다', () => {
    const result = evaluateMigrations([
      {
        name: '0099_comma.sql',
        sql: 'GRANT SELECT ON public.surveys, public.contact_pii TO anon;',
      },
    ]);
    expect(result.kind).toBe('violations');
    if (result.kind === 'violations') {
      expect(result.piiGrants.some((g) => g.table === 'contact_pii')).toBe(true);
    }
  });

  it('스키마 한정 + TABLE 키워드 GRANT(public.contact_targets)도 잡는다', () => {
    const result = evaluateMigrations([
      {
        name: '0099_schema_table.sql',
        sql: 'GRANT ALL ON TABLE public.contact_targets TO authenticated;',
      },
    ]);
    expect(result.kind).toBe('violations');
    if (result.kind === 'violations') {
      expect(result.piiGrants.some((g) => g.table === 'contact_targets')).toBe(true);
    }
  });

  // 결함 2: 블랭킷 GRANT(ALL TABLES IN SCHEMA public)가 PII 를 덮어도 탐지해야 한다.
  it('블랭킷 GRANT(ALL TABLES IN SCHEMA public TO anon)를 위반으로 잡는다', () => {
    const result = evaluateMigrations([
      {
        name: '0099_blanket.sql',
        sql: 'GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;',
      },
    ]);
    expect(result.kind).toBe('violations');
    if (result.kind === 'violations') {
      expect(result.piiGrants.length).toBeGreaterThan(0);
      expect(result.piiGrants.some((g) => g.role === 'anon')).toBe(true);
    }
  });

  it('블랭킷 GRANT 가 anon, authenticated 둘 다면 둘 다 잡는다', () => {
    const result = evaluateMigrations([
      {
        name: '0099_blanket2.sql',
        sql: 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;',
      },
    ]);
    expect(result.kind).toBe('violations');
    if (result.kind === 'violations') {
      const roles = result.piiGrants.map((g) => g.role).sort();
      expect(roles).toEqual(['anon', 'authenticated']);
    }
  });

  it('블랭킷 GRANT 가 service_role 만 대상이면 위반이 아니다', () => {
    const result = evaluateMigrations([
      {
        name: '0001.sql',
        sql: 'GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;',
      },
    ]);
    expect(result.kind).toBe('ok');
  });

  it('0037 의 ALTER DEFAULT PRIVILEGES REVOKE 는 블랭킷 위반이 아니다', () => {
    const result = evaluateMigrations([
      {
        name: '0037.sql',
        sql:
          'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\n' +
          '  REVOKE ALL ON TABLES FROM anon, authenticated;',
      },
    ]);
    expect(result.kind).toBe('ok');
  });

  // 결함 3: CREATE POLICY ... TO anon/authenticated 재도입을 탐지해야 한다.
  it('PII 테이블에 anon permissive 정책 재도입을 위반으로 잡는다', () => {
    const result = evaluateMigrations([
      {
        name: '0099_policy.sql',
        sql: 'CREATE POLICY p ON contact_pii FOR SELECT TO anon USING (true);',
      },
    ]);
    expect(result.kind).toBe('violations');
    if (result.kind === 'violations') {
      expect(result.piiPolicies).toHaveLength(1);
      expect(result.piiPolicies[0]?.table).toBe('contact_pii');
      expect(result.piiPolicies[0]?.role).toBe('anon');
      expect(result.piiPolicies[0]?.policy).toBe('p');
    }
  });

  it('스키마 한정 테이블의 authenticated 정책 재도입도 잡는다', () => {
    const result = evaluateMigrations([
      {
        name: '0099_policy2.sql',
        sql:
          'CREATE POLICY "ct_read" ON public.contact_targets\n' +
          '  FOR ALL TO authenticated USING (true);',
      },
    ]);
    expect(result.kind).toBe('violations');
    if (result.kind === 'violations') {
      expect(result.piiPolicies.some((p) => p.table === 'contact_targets')).toBe(true);
    }
  });

  it('CREATE POLICY 후 같은 정책을 DROP 하면 net-out 되어 위반이 아니다', () => {
    const result = evaluateMigrations([
      {
        name: '0019_create.sql',
        sql:
          'CREATE POLICY "contact_pii_owner_all" ON "contact_pii"\n' +
          '  FOR ALL TO authenticated USING (true);',
      },
      {
        name: '0036_drop.sql',
        sql: 'DROP POLICY IF EXISTS "contact_pii_owner_all" ON "contact_pii";',
      },
    ]);
    expect(result.kind).toBe('ok');
  });

  it('DROP 후 재 CREATE 하면 다시 net-created 로 위반이다', () => {
    const result = evaluateMigrations([
      {
        name: '0036_drop.sql',
        sql: 'DROP POLICY IF EXISTS "p" ON "contact_pii";',
      },
      {
        name: '0040_recreate.sql',
        sql: 'CREATE POLICY "p" ON "contact_pii" FOR SELECT TO anon USING (true);',
      },
    ]);
    expect(result.kind).toBe('violations');
    if (result.kind === 'violations') {
      expect(result.piiPolicies.some((p) => p.policy === 'p')).toBe(true);
    }
  });

  it('service_role 대상 정책은 위반이 아니다', () => {
    const result = evaluateMigrations([
      {
        name: '0001.sql',
        sql: 'CREATE POLICY p ON contact_pii FOR SELECT TO service_role USING (true);',
      },
    ]);
    expect(result.kind).toBe('ok');
  });

  it('PII 가 아닌 테이블의 anon 정책은 검사 범위 밖이다', () => {
    const result = evaluateMigrations([
      {
        name: '0001.sql',
        sql: 'CREATE POLICY p ON surveys FOR SELECT TO anon USING (true);',
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
