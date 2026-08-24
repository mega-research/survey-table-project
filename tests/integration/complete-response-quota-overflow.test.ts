import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Param } from 'drizzle-orm';

// ========================
// 모듈 모킹
// ========================
// completeResponse 의 soft quota 초과 감지(detectQuotaOverflow)를 검증한다.
//
// 정책(2026-08-11): 게이트 통과~완료 사이 race 로 셀이 먼저 찬 완료는 거부하지 않고
// 정상 완료로 수용하되 metadata.quotaOverflow 플래그만 남긴다 (운영/데이터 처리 식별용).
//
// db 모킹은 complete-response-membership-guard.test.ts 하네스를 축소 복제했다.
// contactTargetId=null / versionId=null 로 prefill·스냅샷 select 를 생략해
// select 종단 큐 순서를 최소화한다.

const { selectTerminalQueue, capturedUpdateSets, updateReturningMock, surveysRowHolder } =
  vi.hoisted(() => ({
    selectTerminalQueue: [] as unknown[][],
    capturedUpdateSets: [] as Record<string, unknown>[],
    updateReturningMock: vi.fn(),
    // db.query.surveys.findFirst 반환값 — 가용성 게이트와 quotaConfig 조회가 공유한다.
    surveysRowHolder: { row: {} as Record<string, unknown> },
  }));

vi.mock('@/db', () => {
  function nextSelectTerminal(): unknown[] {
    return selectTerminalQueue.shift() ?? [];
  }

  function makeSelectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['from'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => {
      const whereResult: Record<string, unknown> = {
        limit: vi.fn(() => Promise.resolve(nextSelectTerminal())),
        then: (resolve: (v: unknown) => unknown) => resolve(nextSelectTerminal()),
      };
      return whereResult;
    });
    return chain;
  }

  function makeUpdateChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['set'] = vi.fn((arg: Record<string, unknown>) => {
      capturedUpdateSets.push(arg);
      return chain;
    });
    chain['where'] = vi.fn(() => chain);
    chain['returning'] = vi.fn(() => updateReturningMock());
    (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) =>
      resolve(undefined);
    return chain;
  }

  const db: Record<string, unknown> = {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeUpdateChain()),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: vi.fn(() => makeSelectChain()),
        update: vi.fn(() => makeUpdateChain()),
        insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) })),
      };
      return cb(tx);
    }),
    query: {
      surveyResponses: {
        findFirst: vi.fn(async () => ({
          surveyId: SURVEY_ID,
          versionId: null,
          contactTargetId: null,
          isTest: false,
        })),
      },
      surveys: {
        findFirst: vi.fn(async () => surveysRowHolder.row),
      },
    },
  };
  return { db };
});

vi.mock('@/server/survey-response/services/response-answers.service', () => ({
  replaceResponseAnswers: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ========================
// 테스트
// ========================

const RESPONSE_ID = 'resp-1';
const SURVEY_ID = 'survey-1';
const GATE_QID = 'q-gender';

const OPEN_SURVEY_ROW = {
  status: 'published',
  endDate: null,
  maxResponses: null,
  isPublic: true,
  requireInviteToken: false,
};

// 단일 차원(성별 choice) × 단일 셀(target 2) 최소 쿼터 플랜.
const QUOTA_CONFIG = {
  enabled: true,
  dimensions: [
    {
      id: 'dim-gender',
      questionId: GATE_QID,
      kind: 'choice',
      categories: [{ id: 'cat-male', values: ['남'] }],
    },
  ],
  cells: [{ categoryIds: ['cat-male'], target: 2 }],
  closedMessage: '마감되었습니다.',
};

// select 호출 순서(versionId=null, contactTargetId=null, quota enabled):
//   0) 가용성 게이트 완료 카운트 (countCompletedResponses)
//   1) 유효 questionId 집합 (loadValidQuestionIds)
//   2) detectQuotaOverflow 완료 응답 로드 (quota 미설정이면 소비되지 않음)
//   3) loadPiiQuestionIds (큐 소진 → [] 로 처리됨)
function queueSelects(completedAnswersRows: Record<string, unknown>[]) {
  selectTerminalQueue.length = 0;
  selectTerminalQueue.push(
    [{ total: 0 }],
    [{ id: GATE_QID }],
    completedAnswersRows.map((answers) => ({ questionResponses: answers })),
  );
}

function mainSet(): Record<string, unknown> {
  const found = capturedUpdateSets.find((s) => s['questionResponses'] !== undefined);
  if (!found) throw new Error('questionResponses 를 담은 UPDATE set 이 없음');
  return found;
}

// metadata 는 이제 jsonb `||` 병합 raw sql 조각(COALESCE(...) || '{...}'::jsonb) 이라
// set['metadata'] 가 평범한 객체가 아니다. 실 SQL 을 실행하지 않고도 조각 안에 박힌
// 리터럴/파라미터 문자열을 모아 문자열 포함 검사로 확인한다 — response-edit.service.test.ts
// 의 collectStrings 패턴과 동일.
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

describe('completeResponse — soft quota 초과 플래그', () => {
  beforeEach(() => {
    capturedUpdateSets.length = 0;
    selectTerminalQueue.length = 0;
    updateReturningMock.mockReset();
    updateReturningMock.mockResolvedValue([
      { id: RESPONSE_ID, surveyId: SURVEY_ID, contactTargetId: null, pageVisits: null },
    ]);
    surveysRowHolder.row = { ...OPEN_SURVEY_ROW, quotaConfig: QUOTA_CONFIG };
  });

  it('셀이 이미 목표를 채웠으면 완료는 수용하되 metadata.quotaOverflow 를 남긴다', async () => {
    // 완료 2건이 이미 같은 셀(남) — target 2 충족 → 이번 완료는 초과분.
    queueSelects([{ [GATE_QID]: '남' }, { [GATE_QID]: '남' }]);

    const { completeResponse } =
      await import('@/server/survey-response/services/response-completion.service');

    await completeResponse({
      responseId: RESPONSE_ID,
      data: { questionResponses: { [GATE_QID]: '남' } },
    });

    const set = mainSet();
    // 완료 자체는 그대로 수용된다 (strict 거부/전환 아님).
    expect(set['status']).toBe('completed');
    const metadataText = collectStrings(set['metadata']).join('\n');
    expect(metadataText).toContain('"quotaOverflow":true');
  });

  it('metadata 는 통짜 객체 대입이 아니라 기존 값 보존 병합으로 반영한다 (whole-branch 리뷰 I-1)', async () => {
    // in_progress 재진입 완료 시나리오 — 관리자 수정이 남긴 adminEditRollback/
    // migratedFromVersionId, draftSeq 등 기존 metadata 키가 이 UPDATE 에 지워지면 안 된다.
    // 이 테스트는 mock db 라 실제 jsonb 컬럼 병합 결과까지는 검증할 수 없으므로,
    // 대신 UPDATE set 이 plain object 리터럴이 아니라 COALESCE(metadata, ...) || 새키
    // 형태의 raw sql 조각(드리즐 SQL 객체 = queryChunks 보유)인지로 병합 의도를 검증한다 —
    // plain object 대입이었다면 이 조각은 기존 컬럼값을 전혀 참조하지 않아 DB 레벨에서
    // adminEditRollback 등 기존 키가 통째로 사라진다.
    queueSelects([{ [GATE_QID]: '남' }, { [GATE_QID]: '남' }]);

    const { completeResponse } =
      await import('@/server/survey-response/services/response-completion.service');

    await completeResponse({
      responseId: RESPONSE_ID,
      data: { questionResponses: { [GATE_QID]: '남' } },
    });

    const set = mainSet();
    const metadata = set['metadata'];
    // plain object 였다면 queryChunks 가 없다 — raw sql 조각임을 구조적으로 확인.
    expect(metadata).toHaveProperty('queryChunks');
    const metadataText = collectStrings(metadata).join('');
    // COALESCE(기존 metadata, '{}') 를 베이스로 새 키만 || 로 얹는 병합 형태여야 한다.
    expect(metadataText).toContain('COALESCE(');
    expect(metadataText).toContain('{}');
    expect(metadataText).toContain('"quotaOverflow":true');
  });

  it('셀에 여유가 있으면 플래그를 남기지 않는다', async () => {
    queueSelects([{ [GATE_QID]: '남' }]); // 완료 1건 < target 2

    const { completeResponse } =
      await import('@/server/survey-response/services/response-completion.service');

    await completeResponse({
      responseId: RESPONSE_ID,
      data: { questionResponses: { [GATE_QID]: '남' } },
    });

    const set = mainSet();
    expect(set['status']).toBe('completed');
    // exposed 데이터도 없고 초과도 아니므로 metadata 자체를 쓰지 않는다.
    expect(set['metadata']).toBeUndefined();
  });

  it('쿼터 미설정 설문은 판정 없이 정상 완료된다', async () => {
    surveysRowHolder.row = { ...OPEN_SURVEY_ROW };
    // quota 비활성이면 완료 응답 로드 select 가 소비되지 않는다 — 큐는 앞 2개만 필요.
    selectTerminalQueue.length = 0;
    selectTerminalQueue.push([{ total: 0 }], [{ id: GATE_QID }]);

    const { completeResponse } =
      await import('@/server/survey-response/services/response-completion.service');

    await completeResponse({
      responseId: RESPONSE_ID,
      data: { questionResponses: { [GATE_QID]: '남' } },
    });

    const set = mainSet();
    expect(set['status']).toBe('completed');
    expect(set['metadata']).toBeUndefined();
  });
});
