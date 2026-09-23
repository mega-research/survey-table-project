import { Param } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveAdminEdit } from './response-edit';

// 관리자 응답 수정의 이탈→완료 전환은 쿼터 「진행 중 마감」 하드 차단을 타지 않는다(ADR 0025 —
// 운영자의 결정을 뒤집지 않는다). 대신 찬 셀이면 기존 초과 표식(metadata.quotaOverflow)만 남긴다.

vi.mock('./response-answers', () => ({
  replaceResponseAnswers: vi.fn(async () => undefined),
}));

const h = vi.hoisted(() => ({
  overflow: false,
  responses: [] as Array<Record<string, unknown>>,
  lastSetPayload: null as Record<string, unknown> | null,
  detectQuotaOverflow: vi.fn(async () => h.overflow),
}));

vi.mock('./submitted-answers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./submitted-answers')>()),
  loadPiiTargets: vi.fn(async () => ({ questionIds: new Set<string>(), cellIds: new Map() })),
  detectQuotaOverflow: h.detectQuotaOverflow,
}));

vi.mock('./response-progress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./response-progress')>()),
  getProgressSnapshot: vi.fn(async () => ({ positionMap: new Map(), totalQuestions: 0 })),
}));

function extractParams(node: unknown, out: Record<string, unknown> = {}, seen = new Set<unknown>()) {
  if (node == null || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (node instanceof Param) {
    const name = (node as unknown as { encoder?: { name?: string } }).encoder?.name;
    if (typeof name === 'string') out[name] = (node as unknown as { value: unknown }).value;
    return out;
  }
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) for (const c of chunks) extractParams(c, out, seen);
  return out;
}

function collectStrings(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (node instanceof Param) {
    const value = (node as unknown as { value: unknown }).value;
    if (typeof value === 'string') out.push(value);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out, seen);
    return out;
  }
  const chunkValue = (node as { value?: unknown }).value;
  if (Array.isArray(chunkValue)) for (const v of chunkValue) collectStrings(v, out, seen);
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) for (const c of chunks) collectStrings(c, out, seen);
  return out;
}

vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: {
        findFirst: vi.fn(async () => ({
          id: SURVEY_ID,
          testModeEnabled: false,
          currentVersionId: null,
        })),
      },
      surveyResponses: {
        findFirst: vi.fn(async ({ where }: { where: unknown }) => {
          const p = extractParams(where);
          return h.responses.find((r) => r['id'] === p['id']);
        }),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn((payload: Record<string, unknown>) => {
            h.lastSetPayload = payload;
            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => {
                  const row = h.responses[0];
                  if (!row) return [];
                  Object.assign(row, payload);
                  return [{ id: row['id'] }];
                }),
              })),
            };
          }),
        })),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      };
      return cb(tx);
    }),
  },
}));

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const RESPONSE_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';
const EDITOR = { id: 'admin-1', email: 'a@b.com' };

function pushResponse(status: string) {
  h.responses.push({
    id: RESPONSE_ID,
    surveyId: SURVEY_ID,
    isTest: false,
    deletedAt: null,
    status,
    versionId: null,
    contactTargetId: CONTACT_ID,
    questionResponses: {},
    metadata: null,
    completedAt: null,
  });
}

async function edit() {
  return saveAdminEdit(
    { surveyId: SURVEY_ID, responseId: RESPONSE_ID, questionResponses: { q1: '남' }, versionId: null },
    EDITOR,
    false,
  );
}

describe('saveAdminEdit — 이탈→완료 전환의 쿼터 면제', () => {
  beforeEach(() => {
    h.responses.length = 0;
    h.lastSetPayload = null;
    h.overflow = false;
  });

  it('셀이 이미 찼어도 완료로 전환하고 초과 표식을 남긴다', async () => {
    h.overflow = true;
    pushResponse('drop');

    await expect(edit()).resolves.toEqual({ ok: true });

    expect(h.responses[0]!['status']).toBe('completed');
    expect(h.responses[0]!['isCompleted']).toBe(true);
    const metadataText = collectStrings(h.lastSetPayload?.['metadata']).join('');
    expect(metadataText).toContain('COALESCE(');
    expect(metadataText).toContain('"quotaOverflow":true');
  });

  it('셀에 여유가 있으면 표식 없이 완료로 전환한다', async () => {
    pushResponse('drop');

    await edit();

    expect(h.responses[0]!['status']).toBe('completed');
    expect(h.lastSetPayload?.['metadata']).toBeUndefined();
  });

  it('완료 응답의 일반 수정은 쿼터를 보지 않는다', async () => {
    h.overflow = true;
    pushResponse('completed');

    await edit();

    // 판정이 돌았다면 overflow=true 라 표식이 남았을 것이다.
    expect(h.lastSetPayload?.['metadata']).toBeUndefined();
  });
});
