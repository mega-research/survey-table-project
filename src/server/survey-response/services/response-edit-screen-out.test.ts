import { Param } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Question } from '@/types/survey';

/**
 * 관리자 응답 수정의 자격미달 양방향 재판정.
 *
 * 회귀: 종전 saveAdminEdit 은 status 를 아예 set 하지 않아(drop→completed 예외만),
 * 운영자가 자격미달 조건 문항을 다른 보기로 고쳐도 screened_out 이 그대로 남았다.
 * 응답 초기화(행 물리 삭제) 말고는 되돌릴 길이 없던 상태다.
 */

function extractParams(
  node: unknown,
  out: Record<string, unknown> = {},
  seen = new Set<unknown>(),
): Record<string, unknown> {
  if (node == null || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (node instanceof Param) {
    const name = (node as unknown as { encoder?: { name?: string } }).encoder?.name;
    if (typeof name === 'string') out[name] = (node as unknown as { value: unknown }).value;
    return out;
  }
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) for (const chunk of chunks) extractParams(chunk, out, seen);
  return out;
}

interface FakeResponse {
  id: string;
  surveyId: string;
  isTest: boolean;
  deletedAt: Date | null;
  status: string;
  versionId: string | null;
  contactTargetId: string | null;
  completedAt: Date | null;
  questionResponses: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  response: null as FakeResponse | null,
  setPayload: null as Record<string, unknown> | null,
  // 조회와 UPDATE 사이에 다른 요청이 바꿔 놓은 DB 의 현재 상태(경합 재현용). null 이면 조회 값 그대로.
  concurrentStatus: null as string | null,
  concurrentlyDeleted: false,
}));

vi.mock('./response-answers', () => ({
  replaceResponseAnswers: vi.fn(async () => undefined),
}));

vi.mock('./submitted-answers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./submitted-answers')>()),
  loadPiiTargets: vi.fn(async () => ({ questionIds: new Set<string>(), cellIds: new Map() })),
}));

vi.mock('./response-progress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./response-progress')>()),
  getProgressSnapshot: vi.fn(async () => ({ positionMap: new Map(), totalQuestions: 0 })),
}));

/**
 * 자격미달 조건 문항 하나짜리 스냅샷. 'bad' 보기에만 endOutcome:'screened_out' end 분기가
 * 붙어 있고, 'ok' 보기는 평범한 보기다.
 */
const SCREENING_QUESTION = {
  id: 'q-screen',
  surveyId: 's1',
  type: 'radio',
  title: '자격 확인',
  required: false,
  order: 0,
  options: [
    {
      id: 'opt-bad',
      label: '해당 없음',
      value: 'bad',
      branchRule: { id: 'br-1', value: '', action: 'end', endOutcome: 'screened_out' },
    },
    { id: 'opt-ok', label: '해당됨', value: 'ok' },
  ],
} as unknown as Question;

vi.mock('@/server/read-models/version-snapshot', () => ({
  loadVersionSnapshot: vi.fn(async () => ({
    questions: [SCREENING_QUESTION],
    groups: [],
    lookups: [],
  })),
}));

vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: {
        findFirst: vi.fn(async () => ({
          id: SURVEY_ID,
          testModeEnabled: false,
          currentVersionId: VERSION_ID,
        })),
      },
      surveyResponses: { findFirst: vi.fn(async () => h.response) },
    },
    // 컨택 attrs 조회 — contactTargetId 가 null 이라 타지 않지만 체인은 남겨 둔다.
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn((payload: Record<string, unknown>) => {
            h.setPayload = payload;
            return {
              where: vi.fn((where: unknown) => ({
                returning: vi.fn(async () => {
                  const p = extractParams(where);
                  const row = h.response;
                  if (!row || p['id'] !== row.id || h.concurrentlyDeleted) return [];
                  // 상태 가드 — WHERE 에 status 가 실렸으면 DB 의 현재 상태와 같아야 갱신된다.
                  const dbStatus = h.concurrentStatus ?? row.status;
                  if (p['status'] !== undefined && p['status'] !== dbStatus) return [];
                  return [{ id: row.id }];
                }),
              })),
            };
          }),
        })),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
        // 0행일 때의 원인 판별 재조회
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [{ deletedAt: h.concurrentlyDeleted ? new Date() : null }]),
          })),
        })),
      };
      return cb(tx);
    }),
  },
}));

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const RESPONSE_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const COMPLETED_AT = new Date('2026-09-01T00:00:00.000Z');
const EDITOR = { id: 'admin-1', email: 'a@b.com' };

function seed(over: Partial<FakeResponse>): void {
  h.response = {
    id: RESPONSE_ID,
    surveyId: SURVEY_ID,
    isTest: false,
    deletedAt: null,
    status: 'screened_out',
    versionId: VERSION_ID,
    contactTargetId: null,
    completedAt: COMPLETED_AT,
    questionResponses: { 'q-screen': 'bad' },
    ...over,
  };
}

async function save(answers: Record<string, unknown>) {
  const { saveAdminEdit } = await import('./response-edit');
  return saveAdminEdit(
    { surveyId: SURVEY_ID, responseId: RESPONSE_ID, versionId: VERSION_ID, questionResponses: answers },
    EDITOR,
    false,
  );
}

beforeEach(() => {
  h.setPayload = null;
  h.concurrentStatus = null;
  h.concurrentlyDeleted = false;
  seed({});
});

describe('saveAdminEdit — 자격미달 양방향 재판정', () => {
  it('자격미달 조건을 풀면 completed 로 올라간다', async () => {
    await expect(save({ 'q-screen': 'ok' })).resolves.toEqual({ ok: true });
    expect(h.setPayload).toMatchObject({ status: 'completed', isCompleted: true });
  });

  it('완료 응답이 자격미달 조건에 걸리면 screened_out 으로 내려간다', async () => {
    seed({ status: 'completed', questionResponses: { 'q-screen': 'ok' } });
    await expect(save({ 'q-screen': 'bad' })).resolves.toEqual({ ok: true });
    expect(h.setPayload).toMatchObject({ status: 'screened_out', isCompleted: false });
  });

  it('기존 completedAt 은 보존한다 (재판정이 완료 시각을 밀지 않는다)', async () => {
    await save({ 'q-screen': 'ok' });
    expect(h.setPayload).not.toHaveProperty('completedAt');
  });

  it('자격미달 응답의 진척률은 100 으로 유지된다', async () => {
    await save({ 'q-screen': 'ok' });
    expect(h.setPayload).toMatchObject({ progressPct: 100 });
  });

  it.each(['in_progress', 'quotaful_out', 'bad'])(
    '%s 은 재판정 대상이 아니라 상태가 보존된다',
    async (status) => {
      seed({ status, questionResponses: { 'q-screen': 'bad' } });
      await save({ 'q-screen': 'ok' });
      expect(h.setPayload).not.toHaveProperty('status');
      expect(h.setPayload).not.toHaveProperty('isCompleted');
    },
  );
});

describe('saveAdminEdit — 종결 상태 쓰기의 동시성 가드', () => {
  // 조회 뒤 재응답 허용이 in_progress 로 되돌렸는데, 뒤늦은 저장이 조회 당시 상태로 정한
  // completed·screened_out 을 다시 덮어쓰던 경합. 재응답 허용이 지운 completedAt·컨택 완료
  // 링크는 돌아오지 않아 상태와 연결이 어긋난다.
  it('조회 뒤 상태가 바뀌었으면 status_conflict 로 거부하고 아무것도 쓰지 않는다', async () => {
    const { replaceResponseAnswers } = await import('./response-answers');
    vi.mocked(replaceResponseAnswers).mockClear();
    seed({ status: 'completed', questionResponses: { 'q-screen': 'ok' } });
    h.concurrentStatus = 'in_progress';

    await expect(save({ 'q-screen': 'bad' })).rejects.toMatchObject({ reason: 'status_conflict' });
    expect(replaceResponseAnswers).not.toHaveBeenCalled();
  });

  it('0행의 원인이 동시 삭제면 종전대로 response_deleted 다', async () => {
    seed({ status: 'completed', questionResponses: { 'q-screen': 'ok' } });
    h.concurrentlyDeleted = true;

    await expect(save({ 'q-screen': 'bad' })).rejects.toMatchObject({ reason: 'response_deleted' });
  });

  it('상태를 쓰지 않는 저장(in_progress)은 가드를 걸지 않는다 — 응답자의 진행과 충돌하지 않는다', async () => {
    seed({ status: 'in_progress', questionResponses: { 'q-screen': 'bad' } });
    h.concurrentStatus = 'completed';

    await expect(save({ 'q-screen': 'ok' })).resolves.toEqual({ ok: true });
  });
});
