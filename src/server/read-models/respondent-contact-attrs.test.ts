import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { encryptPii } from '@/lib/crypto/aes';
import { appendContactPii } from '@/server/read-models/respondent-contact-attrs';

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
  return { executor: { select } as never, captured };
}

const TARGET_ID = '11111111-1111-4111-8111-111111111111';

describe('appendContactPii', () => {
  it('개인정보 열의 복호화 값을 열 이름 키로 합친다 — 사업자번호는 하이픈을 넣는다', async () => {
    const { executor, captured } = makeExecutor([
      { fieldType: 'biz_number', columnKey: '사업자등록번호', cipher: encryptPii('1234567890') },
      { fieldType: 'name', columnKey: '대표자명', cipher: encryptPii('홍길동') },
    ]);
    const out = await appendContactPii({ id: TARGET_ID, attrs: { 기업명: '가나' } }, {}, executor);
    expect(out).toEqual({ 기업명: '가나', 사업자등록번호: '123-45-67890', 대표자명: '홍길동' });
    expect(dialect.sqlToQuery(captured.where as never).params).toEqual([TARGET_ID]);
  });

  it('allowedKeys 를 주면 그 열만 합친다 — 응답자 브라우저로는 설문이 읽는 열만 보낸다', async () => {
    const { executor } = makeExecutor([
      { fieldType: 'biz_number', columnKey: '사업자등록번호', cipher: encryptPii('1234567890') },
      { fieldType: 'mobile', columnKey: '실무자 휴대번호', cipher: encryptPii('01012345678') },
    ]);
    const out = await appendContactPii(
      { id: TARGET_ID, attrs: {} },
      { allowedKeys: async () => new Set(['사업자등록번호']) },
      executor,
    );
    expect(out).toEqual({ 사업자등록번호: '123-45-67890' });
  });

  it('개인정보 행이 없으면 allowedKeys 를 부르지 않고 attrs 를 그대로 돌려준다', async () => {
    const { executor } = makeExecutor([]);
    const allowedKeys = vi.fn(async () => new Set<string>());
    const out = await appendContactPii({ id: TARGET_ID, attrs: { 기업명: '가나' } }, { allowedKeys }, executor);
    expect(out).toEqual({ 기업명: '가나' });
    expect(allowedKeys).not.toHaveBeenCalled();
  });

  it('복호화에 실패한 열은 빼고 나머지를 합친다', async () => {
    const { executor } = makeExecutor([
      { fieldType: 'biz_number', columnKey: '사업자등록번호', cipher: 'broken' },
      { fieldType: 'name', columnKey: '대표자명', cipher: encryptPii('홍길동') },
    ]);
    const out = await appendContactPii({ id: TARGET_ID, attrs: null }, {}, executor);
    expect(out).toEqual({ 대표자명: '홍길동' });
  });
});
