import { Param } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./response-answers.service', () => ({
  replaceResponseAnswers: vi.fn(async () => undefined),
}));

vi.mock('./response.service', () => ({
  loadPiiQuestionIds: vi.fn(async () => new Set<string>()),
  loadPiiTargets: vi.fn(async () => ({ questionIds: new Set<string>(), cellIds: new Map() })),
}));

// in_progress 경로의 progress 재계산이 실 snapshot 조회로 가지 않도록 고정한다.
vi.mock('@/lib/operations/response-progress.server', () => ({
  getProgressSnapshot: vi.fn(async () => ({ positionMap: new Map(), totalQuestions: 0 })),
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
  currentVersionId: string | null;
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
  // 이탈→완료 전환 검증용 — UPDATE payload 의 Object.assign 으로 채워진다.
  isCompleted?: boolean;
  completedAt?: Date | null;
  progressPct?: number | null;
}

const h = vi.hoisted(() => ({
  surveys: [] as FakeSurvey[],
  responses: [] as FakeResponse[],
  // 트랜잭션 안 UPDATE .set() 에 실제로 넘어간 payload 캡처 — versionId 이관/메타데이터
  // sql 조각 검증에 사용한다 (Object.assign 이후엔 원본 payload 형태를 잃으므로 별도 보관).
  lastSetPayload: null as Record<string, unknown> | null,
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
    // 새 버전 가드/이관 테스트는 questionResponses 를 실제로 바꿔 diff 를 발생시키므로
    // versionSnapshot 조회(surveyVersions.snapshot select) 경로를 탄다 — 스냅샷 자체는
    // 이 서비스 테스트의 관심사가 아니므로(재계산은 별도 테스트 영역) 항상 빈 결과를
    // 반환해 재계산 블록을 조용히 skip 시킨다.
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn((payload: Record<string, unknown>) => {
            h.lastSetPayload = payload;
            return {
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
            };
          }),
        })),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      };
      return cb(tx);
    }),
  },
}));

import { db } from '@/db';
import { saveAdminEdit } from './response-edit.service';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const RESPONSE_ID = '22222222-2222-4222-8222-222222222222';
const EDITOR = { id: 'admin-1', email: 'a@b.com' };

// metadata sql 조각(jsonb_set(...) 중첩 템플릿) 안에 박힌 리터럴 텍스트를 전부 모아
// 이어붙인다 — 실 SQL 을 실행하지 않고도 '{adminEditRollback}' 같은 키 리터럴과
// JSON.stringify 로 넣은 백업 payload 문자열의 존재 여부를 문자열 포함 검사로 확인한다.
function collectStrings(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (seen.has(node)) return out;
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
  // drizzle sql`` 템플릿의 리터럴 텍스트 조각은 StringChunk.value(문자열 배열)에 담긴다
  // (queryChunks 를 갖지 않음) — Param 과 별도로 처리해야 '{adminEditRollback}' 같은
  // 템플릿 리터럴 텍스트를 놓치지 않는다.
  const chunkValue = (node as { value?: unknown }).value;
  if (Array.isArray(chunkValue)) {
    for (const v of chunkValue) collectStrings(v, out, seen);
  }
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) collectStrings(chunk, out, seen);
  }
  return out;
}

describe('saveAdminEdit 파티션 가드', () => {
  beforeEach(() => {
    h.surveys.length = 0;
    h.responses.length = 0;
    vi.clearAllMocks();
  });

  it('게스트는 테스트 파티션 응답을 수정할 수 없다', async () => {
    // 어드민이 테스트 모드를 켠 상태에서 게스트가 테스트 응답 id 를 알아내 직접 호출한 시나리오.
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: true, currentVersionId: null });
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
        { surveyId: SURVEY_ID, responseId: RESPONSE_ID, questionResponses: {}, versionId: null },
        EDITOR,
        true,
      ),
    ).rejects.toThrow('Response not found');

    // 실데이터 파티션 행은 게스트 시도로 인해 조용히 바뀌지 않아야 한다.
    expect(h.responses[0]?.isTest).toBe(true);
  });

  it('게스트는 실데이터 파티션 응답은 수정할 수 있다', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: true, currentVersionId: null });
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
        { surveyId: SURVEY_ID, responseId: RESPONSE_ID, questionResponses: {}, versionId: null },
        EDITOR,
        true,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('어드민 경로는 그대로 동작한다(테스트 모드 응답을 수정)', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: true, currentVersionId: null });
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
        { surveyId: SURVEY_ID, responseId: RESPONSE_ID, questionResponses: {}, versionId: null },
        EDITOR,
        false,
      ),
    ).resolves.toEqual({ ok: true });
  });
});

describe('saveAdminEdit 이탈 응답 완료 전환', () => {
  beforeEach(() => {
    h.surveys.length = 0;
    h.responses.length = 0;
    vi.clearAllMocks();
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: false, currentVersionId: null });
  });

  function pushResponse(status: string) {
    h.responses.push({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      isTest: false,
      deletedAt: null,
      status,
      versionId: null,
      contactTargetId: null,
      questionResponses: {},
    });
  }

  it('drop 응답은 수정 저장 시 completed 로 전환된다', async () => {
    pushResponse('drop');

    await expect(
      saveAdminEdit(
        {
          surveyId: SURVEY_ID,
          responseId: RESPONSE_ID,
          questionResponses: { q1: '답' },
          versionId: null,
        },
        EDITOR,
        false,
      ),
    ).resolves.toEqual({ ok: true });

    const row = h.responses[0]!;
    expect(row.status).toBe('completed');
    expect(row.isCompleted).toBe(true);
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row.progressPct).toBe(100);
  });

  it('completed 응답 수정은 상태를 건드리지 않는다', async () => {
    pushResponse('completed');

    await saveAdminEdit(
      {
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: { q1: '답' },
        versionId: null,
      },
      EDITOR,
      false,
    );

    const row = h.responses[0]!;
    expect(row.status).toBe('completed');
    // 전환 경로가 아니므로 completedAt 을 새로 쓰지 않는다 (기존 값 보존 의미론).
    expect(row.completedAt).toBeUndefined();
  });

  it('in_progress 응답은 완료로 전환하지 않는다 (응답자 세션 보호)', async () => {
    pushResponse('in_progress');

    await saveAdminEdit(
      {
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: { q1: '답' },
        versionId: null,
      },
      EDITOR,
      false,
    );

    const row = h.responses[0]!;
    expect(row.status).toBe('in_progress');
    expect(row.isCompleted).toBeUndefined();
  });
});

describe('버전 가드와 이관', () => {
  beforeEach(() => {
    h.surveys.length = 0;
    h.responses.length = 0;
    h.lastSetPayload = null;
    vi.clearAllMocks();
  });

  function pushResponse(overrides: Partial<FakeResponse> = {}) {
    h.responses.push({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      isTest: false,
      deletedAt: null,
      status: 'completed',
      versionId: null,
      contactTargetId: null,
      questionResponses: {},
      ...overrides,
    });
  }

  it('렌더 버전이 현재 배포 버전과 다르면 Version conflict 로 거부한다', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: false, currentVersionId: 'v85' });
    pushResponse({ versionId: 'v81' });

    await expect(
      saveAdminEdit(
        { surveyId: SURVEY_ID, responseId: RESPONSE_ID, questionResponses: {}, versionId: 'v84' },
        EDITOR,
        false,
      ),
    ).rejects.toThrow('Version conflict');

    // 가드에서 즉시 거부되어 응답 UPDATE(트랜잭션)까지 도달하지 않았는지 확인.
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('구버전 응답 저장 시 versionId 이관 + adminEditRollback 백업을 기록한다', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: false, currentVersionId: 'v84' });
    pushResponse({ versionId: 'v81', questionResponses: { q1: '원본값' } });

    await expect(
      saveAdminEdit(
        {
          surveyId: SURVEY_ID,
          responseId: RESPONSE_ID,
          questionResponses: { q1: '수정값' },
          versionId: 'v84',
        },
        EDITOR,
        false,
      ),
    ).resolves.toEqual({ ok: true });

    const payload = h.lastSetPayload!;
    expect(payload['versionId']).toBe('v84');
    const metadataText = collectStrings(payload['metadata']).join('\n');
    expect(metadataText).toContain('adminEditRollback');
    expect(metadataText).toContain('migratedFromVersionId');
  });

  it('응답 버전이 이미 최신이면 이관·백업 없이 기존 동작 그대로다', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: false, currentVersionId: 'v84' });
    pushResponse({ versionId: 'v84' });

    await expect(
      saveAdminEdit(
        {
          surveyId: SURVEY_ID,
          responseId: RESPONSE_ID,
          questionResponses: { q1: '수정값' },
          versionId: 'v84',
        },
        EDITOR,
        false,
      ),
    ).resolves.toEqual({ ok: true });

    const payload = h.lastSetPayload!;
    expect(payload).not.toHaveProperty('versionId');
    expect(payload).not.toHaveProperty('metadata');
  });

  it('레거시 versionId null 응답도 최신 버전으로 이관한다', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: false, currentVersionId: 'v84' });
    pushResponse({ versionId: null, questionResponses: { q1: '원본값' } });

    await expect(
      saveAdminEdit(
        {
          surveyId: SURVEY_ID,
          responseId: RESPONSE_ID,
          questionResponses: { q1: '수정값' },
          versionId: 'v84',
        },
        EDITOR,
        false,
      ),
    ).resolves.toEqual({ ok: true });

    const payload = h.lastSetPayload!;
    expect(payload['versionId']).toBe('v84');
    const metadataText = collectStrings(payload['metadata']).join('\n');
    expect(metadataText).toContain('adminEditRollback');
    // 백업의 원본 versionId 는 null 로 남고, 출처 버전 기록(migratedFromVersionId)은
    // to_jsonb(null::text) 로 통째 NULL 이 되는 걸 피하려 분기 자체를 뺀다.
    expect(metadataText).toContain('"versionId":null');
    expect(metadataText).not.toContain('migratedFromVersionId');
  });

  it('미배포 설문은 versionId null 입력으로 기존 동작을 유지한다', async () => {
    h.surveys.push({ id: SURVEY_ID, testModeEnabled: false, currentVersionId: null });
    pushResponse({ versionId: null });

    await expect(
      saveAdminEdit(
        { surveyId: SURVEY_ID, responseId: RESPONSE_ID, questionResponses: {}, versionId: null },
        EDITOR,
        false,
      ),
    ).resolves.toEqual({ ok: true });

    const payload = h.lastSetPayload!;
    expect(payload).not.toHaveProperty('versionId');
    expect(payload).not.toHaveProperty('metadata');
  });
});
