import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 테스트
// ========================

import { createRouterClient } from '@orpc/server';

import {
  hardResetResponse,
  restoreResponse,
  softDeleteResponse,
} from '@/features/survey-response/server/services/response-manage.service';
import { saveAdminEdit } from '@/features/survey-response/server/services/response-edit.service';
import { manage } from '@/features/survey-response/server/procedures/manage';
import type { ORPCContext } from '@/server/context';
import type { StatusCounts } from '@/lib/operations/aggregate-status';
import * as aggregateStatusServer from '@/lib/operations/aggregate-status.server';
import * as profilesServer from '@/lib/operations/profiles.server';
import type { ListProfilesResult } from '@/lib/operations/profiles.server';

// ========================
// 모듈 모킹
// ========================
//
// response-manage.service / response-edit.service 는 다음에 의존한다:
//   - @/db  : drizzle client (query, update, delete, insert, transaction)
//   - @/db/schema : surveyResponses, contactTargets, surveys, responseAnswers, questions
//   - next/cache : revalidatePath (소비처에서만 호출 — service 는 미사용이나 안전망 mock)
//
// service 는 인증을 더 이상 내부에서 하지 않는다(authed 미들웨어가 담당). 소유권 검증
// (surveys row 존재 → SurveyOwnershipError) 만 service 안에 보존되므로
// db.query.surveys.findFirst 로 검증한다.
//
// vi.mock 는 hoist 되므로 mock 안에서 참조하는 state 는 vi.hoisted 로 끌어올린다.
// in-memory map 으로 CRUD 흐름을 통합 검증한다.
//
// IDOR 케이스: 현 시스템은 단일 어드민 구조(surveys.userId 없음).
// 따라서 'attacker vs victim' 시나리오는 의미 없음.
// 대신 (b) 미인증 차단은 procedure(authed 미들웨어) 레벨에서 검증한다.

type SurveyResponseRow = {
  id: string;
  surveyId: string;
  questionResponses: Record<string, unknown>;
  isCompleted: boolean;
  startedAt: Date;
  completedAt: Date | null;
  lastActivityAt: Date;
  lastEditedAt: Date | null;
  status: string;
  currentStepId: string | null;
  totalSeconds: number | null;
  deletedAt: Date | null;
  contactTargetId: string | null;
};

type QuestionRow = {
  id: string;
  surveyId: string;
  type: string;
};

type ContactTargetRow = {
  id: string;
  surveyId: string;
  responseId: string | null;
  respondedAt: Date | null;
};

type ResponseAnswerRow = {
  id: string;
  responseId: string;
  questionId: string;
};

type SurveyRow = {
  id: string;
  title: string;
};

const h = vi.hoisted(() => {
  const responseStore = new Map<string, SurveyResponseRow>();
  const contactStore = new Map<string, ContactTargetRow>();
  const answerStore = new Map<string, ResponseAnswerRow>();
  const surveyStore = new Map<string, SurveyRow>();
  const questionStore = new Map<string, QuestionRow>();

  return { responseStore, contactStore, answerStore, surveyStore, questionStore };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// manage procedure import 가 @/server/context → @/lib/supabase/server 를 끌어오므로
// 모듈 resolve 안전망으로 stub. service 직접 호출 경로는 인증을 쓰지 않고,
// procedure 인증 가드는 context.user(null) 로만 판정하므로 getUser 응답값은 무의미.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  })),
}));

// drizzle-orm 은 실제 eq/and 를 사용 (not mocked)
// 대신 db mock 안에서 조건 매칭을 직접 처리

vi.mock('@/db/schema', () => ({
  surveyResponses: { __table: 'surveyResponses' },
  contactTargets: { __table: 'contactTargets' },
  surveys: { __table: 'surveys' },
  responseAnswers: { __table: 'responseAnswers' },
  questions: { __table: 'questions' },
}));

vi.mock('@/db', () => {
  // drizzle where 조건 파싱용 — 실제 drizzle-orm eq/and 는 SQL 빌더이므로
  // 여기서는 mock schema 의 __table 식별자로만 라우팅하고,
  // 직접 INSERT 헬퍼 함수로 fixture 를 만드므로 update/delete 는
  // store 전체를 순회해서 매칭한다.
  // 단순화: where 는 항상 함수로 받아서 실제 row 에 대해 평가.

  const dbObj = {
    query: {
      surveys: {
        findFirst: vi.fn(async ({ where }: { where: (row: SurveyRow) => boolean }) => {
          for (const row of h.surveyStore.values()) {
            if (where(row)) return row;
          }
          return undefined;
        }),
      },
      surveyResponses: {
        findFirst: vi.fn(async ({ where }: { where: (row: SurveyResponseRow) => boolean }) => {
          for (const row of h.responseStore.values()) {
            if (where(row)) return row;
          }
          return undefined;
        }),
        findMany: vi.fn(async ({ where }: { where: (row: SurveyResponseRow) => boolean }) => {
          return Array.from(h.responseStore.values()).filter(where);
        }),
      },
      contactTargets: {
        findFirst: vi.fn(async ({ where }: { where: (row: ContactTargetRow) => boolean }) => {
          for (const row of h.contactStore.values()) {
            if (where(row)) return row;
          }
          return undefined;
        }),
      },
      questions: {
        findMany: vi.fn(async ({ where }: { where: (row: QuestionRow) => boolean }) => {
          return Array.from(h.questionStore.values()).filter(where);
        }),
      },
    },
    update: vi.fn((table: { __table: string }) => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn((cond: (row: SurveyResponseRow | ContactTargetRow) => boolean) => {
          // 매칭 행을 추적해 await 와 .returning() 양쪽을 지원한다(saveAdminEdit 가 영향 행수
          // 확인용으로 .returning() 을 사용). 반환값은 thenable + returning 메서드를 가진다.
          const matched: Array<{ id: string }> = [];
          if (table.__table === 'surveyResponses') {
            for (const [id, row] of h.responseStore.entries()) {
              if ((cond as (r: SurveyResponseRow) => boolean)(row)) {
                h.responseStore.set(id, { ...row, ...patch } as SurveyResponseRow);
                matched.push({ id: row.id });
              }
            }
          }
          if (table.__table === 'contactTargets') {
            for (const [id, row] of h.contactStore.entries()) {
              if ((cond as (r: ContactTargetRow) => boolean)(row)) {
                h.contactStore.set(id, { ...row, ...patch } as ContactTargetRow);
                matched.push({ id: row.id });
              }
            }
          }
          const result = Promise.resolve(matched) as Promise<Array<{ id: string }>> & {
            returning: () => Promise<Array<{ id: string }>>;
          };
          result.returning = () => Promise.resolve(matched);
          return result;
        }),
      })),
    })),
    delete: vi.fn((table: { __table: string }) => ({
      where: vi.fn(async (cond: (row: SurveyResponseRow | ResponseAnswerRow) => boolean) => {
        if (table.__table === 'surveyResponses') {
          for (const [id, row] of h.responseStore.entries()) {
            if ((cond as (r: SurveyResponseRow) => boolean)(row)) {
              h.responseStore.delete(id);
              // cascade: response_answers
              for (const [aid, ans] of h.answerStore.entries()) {
                if (ans.responseId === row.id) h.answerStore.delete(aid);
              }
            }
          }
        }
        if (table.__table === 'responseAnswers') {
          for (const [id, row] of h.answerStore.entries()) {
            if ((cond as (r: ResponseAnswerRow) => boolean)(row)) {
              h.answerStore.delete(id);
            }
          }
        }
      }),
    })),
    insert: vi.fn((table: { __table: string }) => ({
      values: vi.fn(async (rows: Array<Record<string, unknown>>) => {
        if (table.__table === 'responseAnswers') {
          for (const row of rows) {
            const aid = `${row['responseId']}-${row['questionId']}-${h.answerStore.size}`;
            h.answerStore.set(aid, {
              id: aid,
              responseId: row['responseId'] as string,
              questionId: row['questionId'] as string,
            });
          }
        }
      }),
    })),
    transaction: vi.fn(async (fn: (tx: typeof dbObj) => Promise<unknown>) => fn(dbObj)),
  };

  return { db: dbObj };
});

// ========================
// drizzle-orm eq/and mock
// eq(col, val) 은 클로저로 row 를 받아 비교하는 predicate 를 반환
// ========================
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (col: { __table?: string; __col?: string }, val: unknown) => {
      // mock schema 에서 col 은 { __table: 'surveyResponses' } 형태
      // 실제로는 column descriptor 이므로 col 의 이름을 col.__col 로 식별
      // 여기서는 closure predicate 방식: row 를 받아 비교
      return (row: Record<string, unknown>) => {
        if (!col || typeof col !== 'object') return false;
        const colName = (col as { __col?: string }).__col;
        if (colName) return row[colName] === val;
        // __table 만 있는 경우 (mock schema): col 참조 이름으로 유추
        // → 이 경우는 schema mock 에서 처리 불가이므로 조건이 false 로 떨어짐
        return false;
      };
    },
    and: (...conds: Array<(row: Record<string, unknown>) => boolean>) => {
      return (row: Record<string, unknown>) => conds.every((c) => c(row));
    },
    isNull: (col: { __col?: string }) => {
      // saveAdminEdit 의 isNull(deletedAt) 가드를 predicate 로 변환
      return (row: Record<string, unknown>) => {
        const colName = col?.__col;
        if (!colName) return false;
        return row[colName] === null || row[colName] === undefined;
      };
    },
  };
});

// ========================
// schema mock 컬럼 식별자 보강
// ========================
// vi.mock('@/db/schema') 는 위에서 { __table } 만 설정했으나
// eq() 가 col.__col 을 필요로 하므로 Proxy 로 컬럼 이름을 자동 노출.
// → 위의 @/db/schema mock 을 Proxy 기반으로 교체한다.

vi.mock('@/db/schema', () => {
  function makeTableProxy(tableName: string) {
    return new Proxy(
      { __table: tableName },
      {
        get(_target, prop: string) {
          if (prop === '__table') return tableName;
          // 컬럼 접근 시 { __table, __col } 반환
          return { __table: tableName, __col: prop };
        },
      },
    );
  }
  return {
    surveyResponses: makeTableProxy('surveyResponses'),
    contactTargets: makeTableProxy('contactTargets'),
    surveys: makeTableProxy('surveys'),
    responseAnswers: makeTableProxy('responseAnswers'),
    questions: makeTableProxy('questions'),
    surveyVersions: makeTableProxy('surveyVersions'),
    responseEditLogs: makeTableProxy('responseEditLogs'),
  };
});

// ========================
// Fixture 헬퍼
// ========================

let idCounter = 0;
function genId(prefix = 'id') {
  return `${prefix}-${++idCounter}`;
}

function createTestSurvey() {
  const surveyId = genId('survey');
  h.surveyStore.set(surveyId, { id: surveyId, title: 'Test Survey' });
  return surveyId;
}

function createTestResponse(
  surveyId: string,
  opts?: {
    withAnswers?: boolean;
    questionResponses?: Record<string, unknown>;
    completedAt?: Date | null;
    startedAt?: Date;
  },
) {
  const responseId = genId('response');
  const startedAt = opts?.startedAt ?? new Date();
  const completedAt = opts?.completedAt === undefined ? new Date() : opts.completedAt;
  h.responseStore.set(responseId, {
    id: responseId,
    surveyId,
    questionResponses: opts?.questionResponses ?? {},
    isCompleted: true,
    startedAt,
    completedAt,
    lastActivityAt: new Date(),
    lastEditedAt: null,
    status: 'completed',
    currentStepId: 'group:root',
    totalSeconds: 60,
    deletedAt: null,
    contactTargetId: null,
  });
  if (opts?.withAnswers) {
    const answerId = genId('answer');
    h.answerStore.set(answerId, {
      id: answerId,
      responseId,
      questionId: genId('q'),
    });
  }
  return responseId;
}

function createTestQuestion(surveyId: string, type = 'text') {
  const qid = genId('q');
  h.questionStore.set(qid, { id: qid, surveyId, type });
  return qid;
}

function linkContactToResponse(surveyId: string, responseId: string) {
  const contactId = genId('contact');
  h.contactStore.set(contactId, {
    id: contactId,
    surveyId,
    responseId,
    respondedAt: new Date(),
  });
  return contactId;
}

describe('profiles-row-actions', () => {
  beforeEach(() => {
    h.responseStore.clear();
    h.contactStore.clear();
    h.answerStore.clear();
    h.surveyStore.clear();
    h.questionStore.clear();
    idCounter = 0;
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────
  // softDeleteResponse
  // ─────────────────────────────────────────────────────────────

  describe('softDeleteResponse', () => {
    it('deletedAt 을 설정하고 응답 행에 반영한다', async () => {
      const surveyId = createTestSurvey();
      const responseId = createTestResponse(surveyId);

      const result = await softDeleteResponse({ surveyId, responseId });

      expect(result).toEqual({ ok: true });

      const row = h.responseStore.get(responseId);
      expect(row?.deletedAt).not.toBeNull();
      expect(row?.deletedAt).toBeInstanceOf(Date);
    });

    it('멱등성 — 두 번 호출해도 에러 없이 같은 상태', async () => {
      const surveyId = createTestSurvey();
      const responseId = createTestResponse(surveyId);

      await softDeleteResponse({ surveyId, responseId });
      await expect(softDeleteResponse({ surveyId, responseId })).resolves.toEqual({ ok: true });

      const row = h.responseStore.get(responseId);
      expect(row?.deletedAt).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // restoreResponse
  // ─────────────────────────────────────────────────────────────

  describe('restoreResponse', () => {
    it('softDelete 후 restore 하면 deletedAt 이 null 로 돌아온다', async () => {
      const surveyId = createTestSurvey();
      const responseId = createTestResponse(surveyId);

      await softDeleteResponse({ surveyId, responseId });
      expect(h.responseStore.get(responseId)?.deletedAt).not.toBeNull();

      const result = await restoreResponse({ surveyId, responseId });
      expect(result).toEqual({ ok: true });

      const row = h.responseStore.get(responseId);
      expect(row?.deletedAt).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // hardResetResponse
  // ─────────────────────────────────────────────────────────────

  describe('hardResetResponse', () => {
    it('응답 행을 삭제하고 response_answers 도 cascade 제거된다', async () => {
      const surveyId = createTestSurvey();
      const responseId = createTestResponse(surveyId, { withAnswers: true });

      // 답변이 1건 있는지 확인
      const answersBefore = Array.from(h.answerStore.values()).filter(
        (a) => a.responseId === responseId,
      );
      expect(answersBefore).toHaveLength(1);

      const result = await hardResetResponse({ surveyId, responseId });
      expect(result).toEqual({ ok: true });

      // 응답 행 삭제 확인
      expect(h.responseStore.get(responseId)).toBeUndefined();

      // cascade 답변 삭제 확인
      const answersAfter = Array.from(h.answerStore.values()).filter(
        (a) => a.responseId === responseId,
      );
      expect(answersAfter).toHaveLength(0);
    });

    it('contact_targets.responseId 와 respondedAt 을 null 로 초기화한다', async () => {
      const surveyId = createTestSurvey();
      const responseId = createTestResponse(surveyId);
      const contactId = linkContactToResponse(surveyId, responseId);

      const contactBefore = h.contactStore.get(contactId);
      expect(contactBefore?.responseId).toBe(responseId);
      expect(contactBefore?.respondedAt).not.toBeNull();

      await hardResetResponse({ surveyId, responseId });

      const contactAfter = h.contactStore.get(contactId);
      expect(contactAfter?.responseId).toBeNull();
      expect(contactAfter?.respondedAt).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // softDelete cross-layer impact
  //
  // aggregateStatus / listResponsesForProfiles 는 db.select() 체인과
  // row_number() subquery 를 사용하므로 현 mock DB 로는 재현이 불가.
  // vi.spyOn 으로 각 어댑터를 in-memory store 위에서 동작하는 stub 으로 교체한다.
  // ─────────────────────────────────────────────────────────────

  describe('softDelete cross-layer impact', () => {
    // spyOn stub: h.responseStore 를 직접 집계
    function stubAggregateStatus(surveyId: string): Promise<StatusCounts> {
      const counts: StatusCounts = {
        total: 0,
        completed: 0,
        screenedOut: 0,
        quotafulOut: 0,
        bad: 0,
        drop: 0,
        inProgress: 0,
      };
      for (const row of h.responseStore.values()) {
        if (row.surveyId !== surveyId) continue;
        if (row.deletedAt !== null) continue; // isNull(deletedAt) 조건
        switch (row.status) {
          case 'completed':
            counts.completed += 1;
            break;
          case 'screened_out':
            counts.screenedOut += 1;
            break;
          case 'quotaful_out':
            counts.quotafulOut += 1;
            break;
          case 'bad':
            counts.bad += 1;
            break;
          case 'drop':
            counts.drop += 1;
            break;
          case 'in_progress':
            counts.inProgress += 1;
            break;
        }
      }
      counts.total =
        counts.completed + counts.screenedOut + counts.quotafulOut + counts.bad + counts.drop;
      return Promise.resolve(counts);
    }

    // spyOn stub: view 분기 + deletedAt 필터만 검증하는 단순 구현
    function stubListResponsesForProfiles(
      args: Parameters<typeof profilesServer.listResponsesForProfiles>[0],
    ): Promise<ListProfilesResult> {
      const { surveyId, view, page = 1 } = args;
      const rows = Array.from(h.responseStore.values()).filter((row) => {
        if (row.surveyId !== surveyId) return false;
        if (view === 'deleted') return row.deletedAt !== null;
        return row.deletedAt === null; // active
      });
      const total = rows.length;
      return Promise.resolve({ rows: [] as ListProfilesResult['rows'], total, page });
    }

    it('softDelete 하면 active view 에서 사라지고 deleted view 에 나타난다', async () => {
      const surveyId = createTestSurvey();
      const responseId = createTestResponse(surveyId);

      vi.spyOn(profilesServer, 'listResponsesForProfiles').mockImplementation(
        stubListResponsesForProfiles,
      );

      const normalizedArgs = {
        surveyId,
        page: 1,
        pageSize: 20,
        status: 'all' as const,
        sort: 'idx' as const,
        dir: 'desc' as const,
        view: 'active' as const,
        condition: null,
        test: 'all' as const,
      };

      const before = await profilesServer.listResponsesForProfiles(normalizedArgs);
      expect(before.total).toBe(1);

      await softDeleteResponse({ surveyId, responseId });

      const afterActive = await profilesServer.listResponsesForProfiles({
        ...normalizedArgs,
        view: 'active',
      });
      const afterDeleted = await profilesServer.listResponsesForProfiles({
        ...normalizedArgs,
        view: 'deleted',
      });
      expect(afterActive.total).toBe(0);
      expect(afterDeleted.total).toBe(1);

      vi.restoreAllMocks();
    });

    it('softDelete 하면 aggregateStatus 의 completed 카운트가 줄어든다', async () => {
      const surveyId = createTestSurvey();
      const responseId = createTestResponse(surveyId);

      vi.spyOn(aggregateStatusServer, 'aggregateStatus').mockImplementation(stubAggregateStatus);

      const before = await aggregateStatusServer.aggregateStatus(surveyId);
      expect(before.completed).toBeGreaterThanOrEqual(1);

      await softDeleteResponse({ surveyId, responseId });

      const after = await aggregateStatusServer.aggregateStatus(surveyId);
      expect(after.completed).toBe(before.completed - 1);

      vi.restoreAllMocks();
    });

    it('softDelete 후 restore 하면 active view / aggregateStatus 모두 원복된다', async () => {
      const surveyId = createTestSurvey();
      const responseId = createTestResponse(surveyId);

      vi.spyOn(profilesServer, 'listResponsesForProfiles').mockImplementation(
        stubListResponsesForProfiles,
      );
      vi.spyOn(aggregateStatusServer, 'aggregateStatus').mockImplementation(stubAggregateStatus);

      const normalizedArgs = {
        surveyId,
        page: 1,
        pageSize: 20,
        status: 'all' as const,
        sort: 'idx' as const,
        dir: 'desc' as const,
        view: 'active' as const,
        condition: null,
        test: 'all' as const,
      };

      // 1단계: softDelete
      await softDeleteResponse({ surveyId, responseId });

      const midActive = await profilesServer.listResponsesForProfiles({
        ...normalizedArgs,
        view: 'active',
      });
      const midDeleted = await profilesServer.listResponsesForProfiles({
        ...normalizedArgs,
        view: 'deleted',
      });
      const midCounts = await aggregateStatusServer.aggregateStatus(surveyId);
      expect(midActive.total).toBe(0);
      expect(midDeleted.total).toBe(1);
      expect(midCounts.completed).toBe(0);

      // 2단계: restore
      await restoreResponse({ surveyId, responseId });

      const afterActive = await profilesServer.listResponsesForProfiles({
        ...normalizedArgs,
        view: 'active',
      });
      const afterDeleted = await profilesServer.listResponsesForProfiles({
        ...normalizedArgs,
        view: 'deleted',
      });
      const afterCounts = await aggregateStatusServer.aggregateStatus(surveyId);
      expect(afterActive.total).toBe(1);
      expect(afterDeleted.total).toBe(0);
      expect(afterCounts.completed).toBe(1);

      vi.restoreAllMocks();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // saveAdminEdit
  // ─────────────────────────────────────────────────────────────

  describe('saveAdminEdit', () => {
    it('questionResponses 를 갱신하고 completedAt 은 보존한다', async () => {
      const surveyId = createTestSurvey();
      const qid = createTestQuestion(surveyId, 'text');
      const responseId = createTestResponse(surveyId, {
        questionResponses: { [qid]: 'old' },
      });
      const before = h.responseStore.get(responseId);
      const beforeCompletedAt = before?.completedAt?.getTime();

      await saveAdminEdit(
        {
          surveyId,
          responseId,
          questionResponses: { [qid]: 'new' },
        },
        { id: 'admin-1', email: 'a@b.com' },
      );

      const after = h.responseStore.get(responseId);
      expect((after?.questionResponses as { [k: string]: string })[qid]).toBe('new');
      expect(after?.completedAt?.getTime()).toBe(beforeCompletedAt);
      expect(after?.lastEditedAt).not.toBeNull();
      expect(after?.currentStepId).toBeNull();
      // status / startedAt 은 보존
      expect(after?.status).toBe('completed');
      expect(after?.startedAt.getTime()).toBe(before?.startedAt.getTime());
    });

    it('삭제된 응답은 수정 거부 — Cannot edit deleted response throw', async () => {
      const surveyId = createTestSurvey();
      const responseId = createTestResponse(surveyId);
      await softDeleteResponse({ surveyId, responseId });

      await expect(
        saveAdminEdit(
          { surveyId, responseId, questionResponses: {} },
          { id: 'admin-1', email: 'a@b.com' },
        ),
      ).rejects.toThrow('Cannot edit deleted response');
    });

    it('response_answers 를 새 응답으로 재기록한다 (옛 답 제거 + 새 답 INSERT)', async () => {
      const surveyId = createTestSurvey();
      const oldQid = createTestQuestion(surveyId, 'text');
      const newQid = createTestQuestion(surveyId, 'text');
      const responseId = createTestResponse(surveyId, {
        questionResponses: { [oldQid]: 'OLD_ANS' },
      });
      // 기존 답변 행 한 건 추가 (oldQid)
      const seedAnswerId = genId('answer');
      h.answerStore.set(seedAnswerId, {
        id: seedAnswerId,
        responseId,
        questionId: oldQid,
      });
      expect(
        Array.from(h.answerStore.values()).filter((a) => a.responseId === responseId),
      ).toHaveLength(1);

      await saveAdminEdit(
        {
          surveyId,
          responseId,
          questionResponses: { [newQid]: 'NEW_ANS' },
        },
        { id: 'admin-1', email: 'a@b.com' },
      );

      const remaining = Array.from(h.answerStore.values()).filter(
        (a) => a.responseId === responseId,
      );
      // 옛 행은 사라지고 새 행 한 건이 남는다
      expect(remaining).toHaveLength(1);
      const remaining0 = remaining[0];
      if (!remaining0) throw new Error('remaining[0] 없음');
      expect(remaining0.questionId).toBe(newQid);
    });

    it('존재하지 않는 응답은 Response not found throw', async () => {
      const surveyId = createTestSurvey();
      await expect(
        saveAdminEdit(
          { surveyId, responseId: 'nonexistent-id', questionResponses: {} },
          { id: 'admin-1', email: 'a@b.com' },
        ),
      ).rejects.toThrow('Response not found');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 인증 가드 (옵션 b: 단일 어드민 구조라 IDOR 없음, 미인증 차단 검증)
  //
  // 현재 시스템은 surveys.userId 컬럼이 없는 단일 어드민 구조이므로
  // 다중 사용자 IDOR(attacker vs victim) 시나리오는 의미 없음.
  //
  // oRPC 마이그레이션으로 인증은 service 가 아니라 authed 미들웨어(procedure 레벨)가
  // 담당한다. 미인증 차단 검증은 procedure 레벨로 이동 — context.user 가 null 이면
  // service/db 호출 전에 UNAUTHORIZED 로 막힌다. service 의 소유권 검증
  // (SurveyOwnershipError) 은 인증과 별개이므로 service 직접 호출로 그대로 검증한다.
  // (procedure UNAUTHORIZED 매핑은 src/features/.../procedures/manage.test.ts 와 중복 커버.)
  // ─────────────────────────────────────────────────────────────

  describe('인증 가드', () => {
    it('미인증(context.user=null) 상태에서 manage.softDelete 는 UNAUTHORIZED 로 막힌다', async () => {
      const surveyId = createTestSurvey();
      const responseId = createTestResponse(surveyId);

      const noUserContext: ORPCContext = {
        db: {} as never,
        supabase: {} as never,
        user: null,
      };
      const client = createRouterClient({ manage }, { context: noUserContext });

      await expect(
        client.manage.softDelete({ surveyId, responseId }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('존재하지 않는 surveyId 로 호출하면 SurveyOwnershipError 를 throw 한다', async () => {
      // survey 를 store 에 넣지 않음 — findFirst 가 undefined 반환
      const nonExistentSurveyId = 'does-not-exist';
      const responseId = createTestResponse('some-survey');

      await expect(
        softDeleteResponse({ surveyId: nonExistentSurveyId, responseId }),
      ).rejects.toThrow();
    });
  });
});
