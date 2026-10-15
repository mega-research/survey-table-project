import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { encryptPii } from '@/lib/crypto/aes';
import { appendRespondentVisiblePii } from '@/server/read-models/respondent-contact-attrs';
import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';

// 주입된 executor 만 쓴다 — 전역 db 는 로드만 막는다.
vi.mock('@/db', () => ({ db: {} }));

const dialect = new PgDialect();

/** select(...).from(contactPii).where(...) 체인 stub — where 인자를 캡처한다. */
function makeExecutor(rows: Array<{ fieldType: string; columnKey: string; cipher: string }>) {
  const captured: { where: unknown } = { where: null };
  const select = vi.fn(() => ({
    from: () => ({
      where: async (where: unknown) => {
        captured.where = where;
        return rows;
      },
    }),
  }));
  return { executor: { select } as never, select, captured };
}

const col = (key: string, over: Partial<ContactColumnDef> = {}): ContactColumnDef => ({
  key,
  label: key,
  source: `pii.${key}`,
  order: 1,
  piiType: 'biz_number',
  ...over,
});
const scheme = (columns: ContactColumnDef[]): ContactColumnScheme => ({
  version: 1,
  headerRow: 1,
  columns,
});

const TARGET = { id: '11111111-1111-4111-8111-111111111111', isTest: false };

describe('appendRespondentVisiblePii', () => {
  it('노출 열이 없으면 contact_pii 를 읽지 않고 attrs 를 그대로 돌려준다', async () => {
    const { executor, select } = makeExecutor([]);
    const out = await appendRespondentVisiblePii(
      { ...TARGET, attrs: { 기업명: '가나' } },
      { real: scheme([col('사업자등록번호')]), test: null },
      executor,
    );
    expect(out).toEqual({ 기업명: '가나' });
    expect(select).not.toHaveBeenCalled();
  });

  it('노출 열만 조회해 복호화 값을 열 이름 키로 합친다 — 사업자번호는 하이픈을 넣는다', async () => {
    const { executor, captured } = makeExecutor([
      { fieldType: 'biz_number', columnKey: '사업자등록번호', cipher: encryptPii('1234567890') },
    ]);
    const out = await appendRespondentVisiblePii(
      { ...TARGET, attrs: { 기업명: '가나' } },
      {
        real: scheme([
          col('사업자등록번호', { respondentVisible: true }),
          col('대표자 e-mail', { piiType: 'email' }),
        ]),
        test: null,
      },
      executor,
    );
    expect(out).toEqual({ 기업명: '가나', 사업자등록번호: '123-45-67890' });
    const where = dialect.sqlToQuery(captured.where as never);
    expect(where.params).toEqual([TARGET.id, '사업자등록번호']);
  });

  it('테스트 파티션 대상은 테스트 스킴의 노출 설정을 따른다', async () => {
    const { executor, select } = makeExecutor([]);
    await appendRespondentVisiblePii(
      { ...TARGET, isTest: true, attrs: {} },
      { real: scheme([col('사업자등록번호', { respondentVisible: true })]), test: null },
      executor,
    );
    expect(select).not.toHaveBeenCalled();
  });

  it('복호화에 실패한 열은 빼고 나머지를 합친다', async () => {
    const { executor } = makeExecutor([
      { fieldType: 'biz_number', columnKey: '사업자등록번호', cipher: 'broken' },
      { fieldType: 'name', columnKey: '대표자', cipher: encryptPii('홍길동') },
    ]);
    const out = await appendRespondentVisiblePii(
      { ...TARGET, attrs: null },
      {
        real: scheme([
          col('사업자등록번호', { respondentVisible: true }),
          col('대표자', { piiType: 'name', respondentVisible: true }),
        ]),
        test: null,
      },
      executor,
    );
    expect(out).toEqual({ 대표자: '홍길동' });
  });
});
