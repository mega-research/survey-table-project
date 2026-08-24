import { describe, expect, it, vi } from 'vitest';

import type { DbTransaction } from '@/db';

import { allocateContactResid } from './contact-resid';

/** sql 템플릿을 문자열로 펼쳐 바인딩 값까지 본다. */
function sqlText(node: unknown, seen = new Set<unknown>()): string {
  if (node == null || typeof node !== 'object' || seen.has(node)) return String(node ?? '');
  seen.add(node);
  const record = node as Record<string, unknown>;
  const own = Array.isArray(record['value'])
    ? (record['value'] as unknown[]).map((item) => String(item)).join(' ')
    : '';
  const chunks = Array.isArray(record['queryChunks'])
    ? (record['queryChunks'] as unknown[]).map((chunk) => sqlText(chunk, seen)).join(' ')
    : '';
  return `${own} ${chunks}`;
}

function fakeTx(rows: unknown[]) {
  const execute = vi.fn(async (_query: unknown) => rows);
  return { tx: { execute } as unknown as DbTransaction, execute };
}

describe('allocateContactResid', () => {
  it('설문 id 와 파티션 플래그를 next_contact_resid 에 넘긴다', async () => {
    const { tx, execute } = fakeTx([{ resid: 7 }]);

    await expect(allocateContactResid(tx, 'survey-1', true)).resolves.toBe(7);

    const text = sqlText(execute.mock.calls[0]?.[0]);
    expect(text).toContain('next_contact_resid');
    expect(text).toContain('survey-1');
    expect(text).toContain('true');
  });

  it('드라이버가 문자열로 준 번호도 수로 돌려준다', async () => {
    const { tx } = fakeTx([{ resid: '12' }]);
    await expect(allocateContactResid(tx, 'survey-1', false)).resolves.toBe(12);
  });

  it('행이 없으면 발번 실패로 던진다', async () => {
    const { tx } = fakeTx([]);
    await expect(allocateContactResid(tx, 'survey-1', false)).rejects.toThrow(
      'next_contact_resid 호출 실패',
    );
  });
});
