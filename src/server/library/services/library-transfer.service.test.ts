import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Array<{ via: 'db' | 'tx'; table: string; values: unknown }> = [];
let categoryInsertFails = false;

function insertRecorder(via: 'db' | 'tx') {
  return (table: Record<PropertyKey, unknown>) => ({
    values: async (values: unknown) => {
      const name = String(table[Symbol.for('drizzle:Name')]);
      if (name === 'question_categories' && categoryInsertFails) {
        throw new Error('카테고리 INSERT 실패');
      }
      inserts.push({ via, table: name, values });
    },
  });
}

vi.mock('@/db', () => ({
  db: {
    insert: insertRecorder('db'),
    transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({ insert: insertRecorder('tx') }),
  },
}));

vi.mock('@/server/read-models/library-taxonomy', () => ({
  getAllCategories: vi.fn(async () => [{ id: 'cat-existing' }]),
}));

vi.mock('@/lib/survey/survey-image-promote', () => ({
  promoteSurveyImages: vi.fn(async (questions: unknown[]) => questions),
}));

vi.mock('@/lib/survey/notice-attachment-promote', () => ({
  promoteNoticeAttachments: vi.fn(async (questions: unknown[]) => questions),
}));

import { importLibrary } from './library-transfer.service';

const PAYLOAD = JSON.stringify({
  savedQuestions: [{ name: '질문1', question: { id: 'q1', type: 'text', title: '이름' } }],
  categories: [{ id: 'cat-existing', name: '기존' }, { id: 'cat-new', name: '신규' }],
});

describe('importLibrary', () => {
  beforeEach(() => {
    inserts.length = 0;
    categoryInsertFails = false;
  });

  it('질문과 카테고리를 같은 트랜잭션 안에서 INSERT 한다', async () => {
    await importLibrary(PAYLOAD);

    expect(inserts.map((i) => [i.via, i.table])).toEqual([
      ['tx', 'saved_questions'],
      ['tx', 'question_categories'],
    ]);
  });

  it('이미 있는 카테고리는 제외하고 신규만 넣는다', async () => {
    await importLibrary(PAYLOAD);

    const categories = inserts.find((i) => i.table === 'question_categories')?.values;
    expect(categories).toEqual([{ id: 'cat-new', name: '신규' }]);
  });

  it('카테고리 INSERT 가 깨지면 통째로 실패한다 — 질문만 남는 반쪽 import 가 없다', async () => {
    categoryInsertFails = true;

    await expect(importLibrary(PAYLOAD)).rejects.toThrow('카테고리 INSERT 실패');
    // 질문 INSERT 는 트랜잭션 안에서 일어났으므로 롤백 대상이다 — db 직접 경로로는 새지 않는다.
    expect(inserts.every((i) => i.via === 'tx')).toBe(true);
  });

  it('넣을 것이 없으면 트랜잭션을 열지 않는다', async () => {
    await importLibrary(JSON.stringify({}));

    expect(inserts).toEqual([]);
  });
});
