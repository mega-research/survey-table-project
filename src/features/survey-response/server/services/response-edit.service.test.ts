import { Param } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./response-answers.service', () => ({
  replaceResponseAnswers: vi.fn(async () => undefined),
}));

vi.mock('./response.service', () => ({
  loadPiiQuestionIds: vi.fn(async () => new Set<string>()),
}));

// db 는 실 PG 없이 drizzle where 절을 그대로 파싱해 파티션 매칭을 재현한다.
// eq()/and() 가 만드는 SQL 트리를 걷어 Param 인스턴스(encoder.name = 컬럼 SQL 명)만
// 추출한다 — where 절에 is_test 조건이 실제로 실렸는지를 (모킹이 아니라) 검증하는
// 유일한 방법이라, 이 select/update 체인은 shallow stub 이 아니라 파라미터 파싱기다.
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
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) extractParams(chunk, out, seen);
  }
  return out;
}

interface FakeSurvey {
  id: string;
  testModeEnabled: boolean;
}

interface FakeResponse {
  id: string;
  surveyId: string;
  isTest: boolean;
  deletedAt: Date | null;
  status: string;
  versionId: string | null;
  contactTargetId: string | null;
  questionResponses: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  surveys: [] as FakeSurvey[],
  responses: [] as FakeResponse[],
}));

vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: {
        findFirst: vi.fn(async ({ where }: { where: unknown }) => {
          const p = extractParams(where);
          return h.surveys.find((s) => s.id === p['id']);
        }),
      },
      surveyResponses: {
        findFirst: vi.fn(async ({ where }: { where: unknown }) => {
          const p = extractParams(where);
          return h.responses.find(
            (r) =>
              r.id === p['id'] &&
              r.surveyId === p['survey_id'] &&
              (p['is_test'] === undefined || r.isTest === p['is_test']),
          );
        }),
      },
    },
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn((payload: Record<string, unknown>) => ({
            where: vi.fn((where: unknown) => ({
              returning: vi.fn(async () => {
                const p = extractParams(where);
                const row = h.responses.find(
                  (r) =>
                    r.id === p['id'] &&
                    r.surveyId === p['survey_id'] &&
                    (p['is_test'] === undefined || r.isTest === p['is_test']) &&
                    r.deletedAt === null,
                );
                if (!row) return [];
                Object.assign(row, payload);
                return [{ id: row.id }];
              }),
            })),
          })),
        })),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      };
      return cb(tx);
    }),
  },
}));

import { saveAdminEdit } from './response-edit.service';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const RESPONSE_ID = '22222222-2222-4222-8222-222222222222';
const EDITOR = { id: 'admin-1', email: 'a@b.com' };

describe('saveAdminEdit 파티션 가드', () => {
  beforeEach(() => {
    h.surveys.length = 0;
    h.responses.length = 0;
    vi.clearAllMocks();
  });

  it('게스트는 테스트 파티션 응답을 수정할 수 없다', async () => {
    // 어드민이 테스트 모드를 켠 상태에서 게스트가 테스트 응답 id 를 알아내 직접 호출한 시나리오.
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: true });
    h.responses.push({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      isTest: true,
      deletedAt: null,
      status: 'completed',
      versionId: null,
      contactTargetId: null,
      questionResponses: {},
    });

    await expect(
      saveAdminEdit(
        { surveyId: SURVEY_ID, responseId: RESPONSE_ID, questionResponses: {} },
        EDITOR,
        true,
      ),
    ).rejects.toThrow('Response not found');

    // 실데이터 파티션 행은 게스트 시도로 인해 조용히 바뀌지 않아야 한다.
    expect(h.responses[0]?.isTest).toBe(true);
  });

  it('게스트는 실데이터 파티션 응답은 수정할 수 있다', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: true });
    h.responses.push({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      isTest: false,
      deletedAt: null,
      status: 'completed',
      versionId: null,
      contactTargetId: null,
      questionResponses: {},
    });

    await expect(
      saveAdminEdit(
        { surveyId: SURVEY_ID, responseId: RESPONSE_ID, questionResponses: {} },
        EDITOR,
        true,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('어드민 경로는 그대로 동작한다(테스트 모드 응답을 수정)', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: true });
    h.responses.push({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      isTest: true,
      deletedAt: null,
      status: 'completed',
      versionId: null,
      contactTargetId: null,
      questionResponses: {},
    });

    await expect(
      saveAdminEdit(
        { surveyId: SURVEY_ID, responseId: RESPONSE_ID, questionResponses: {} },
        EDITOR,
        false,
      ),
    ).resolves.toEqual({ ok: true });
  });
});
