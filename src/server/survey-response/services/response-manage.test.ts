import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// allowReeditResponse 의 수용 게이트(status·paused·endDate) 전용 안전망.
// A-1 리팩터 이전에 현행 판정을 박제한다 — 이 게이트는 레포에서 유일하게 service 레벨
// 테스트가 없던 곳이다. 리팩터 전/후 모두 무수정으로 통과해야 한다.

const h = vi.hoisted(() => ({
  surveyExists: true,
  responseRow: null as Record<string, unknown> | null,
  gateRow: null as Record<string, unknown> | null,
  versionRow: null as Record<string, unknown> | null,
  /** resolveContactAnchor 의 역방향 조회 결과 — 레거시(정방향 null) 링크 재현용. */
  reverseContactRow: null as Record<string, unknown> | null,
  /** tx.select 에 넘어온 필드 키 집합 기록 — 조회 회피·부분집합 검증용. */
  selectedFieldSets: [] as string[][],
  /** tx.update(...).set(payload) 캡처 — 되돌리기 UPDATE 실행 여부 검증용. */
  updates: [] as unknown[],
}));

// requireAuth 체인(next/headers·supabase)을 끌고 오지 않도록 에러 클래스만 대체한다.
vi.mock('@/lib/auth/require-survey-ownership', () => ({
  SurveyOwnershipError: class SurveyOwnershipError extends Error {
    constructor(public readonly reason: 'not_found') {
      super(reason);
      this.name = 'SurveyOwnershipError';
    }
  },
}));

vi.mock('@/db', () => {
  function terminalFor(fields: Record<string, unknown>): unknown[] {
    const keys = Object.keys(fields);
    h.selectedFieldSets.push(keys);
    // 응답 행 조회
    if (keys.includes('isCompleted')) return h.responseRow ? [h.responseRow] : [];
    // 설문 게이트 행 조회 (status 도 포함하므로 isPaused 로 먼저 가른다)
    if (keys.includes('isPaused')) return h.gateRow ? [h.gateRow] : [];
    // 버전 행 조회
    if (keys.length === 1 && keys[0] === 'status') return h.versionRow ? [h.versionRow] : [];
    // resolveContactAnchor 의 역방향 컨택 조회 (contact_targets.response_id 로 찾는다).
    if (keys.length === 1 && keys[0] === 'id') {
      return h.reverseContactRow ? [h.reverseContactRow] : [];
    }
    return [];
  }

  function makeSelect(fields: Record<string, unknown>): Record<string, unknown> {
    const run = async () => terminalFor(fields);
    const result: Record<string, unknown> = {
      limit: () => run(),
      for: () => result,
      then: (resolve: (v: unknown) => unknown) => run().then(resolve),
    };
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => result,
    };
    return chain;
  }

  function makeUpdate(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['set'] = (payload: unknown) => {
      h.updates.push(payload);
      return chain;
    };
    chain['where'] = () => chain;
    chain['returning'] = async () => [{ id: 'resp-1' }];
    chain['then'] = (resolve: (v: unknown) => unknown) => resolve(undefined);
    return chain;
  }

  const tx = {
    select: (fields: Record<string, unknown>) => makeSelect(fields),
    update: () => makeUpdate(),
    insert: () => ({ values: async () => undefined }),
  };

  return {
    db: {
      query: {
        surveys: {
          findFirst: async () => (h.surveyExists ? { id: 'survey-1' } : undefined),
        },
      },
      transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
    },
  };
});

const INPUT = { surveyId: 'survey-1', responseId: 'resp-1' };

/** 되돌리기 대상이 되는 완료 실응답 기본 행. */
function completedResponse(over: Record<string, unknown> = {}) {
  return {
    contactTargetId: null,
    isCompleted: true,
    isTest: false,
    metadata: null,
    ...over,
  };
}

function gate(over: Record<string, unknown> = {}) {
  return {
    status: 'published',
    isPaused: false,
    endDate: null as Date | null,
    // 기본은 공개 + 토큰 비강제 — invite 술어가 발동하지 않는다.
    isPublic: true,
    requireInviteToken: false,
    currentVersionId: null as string | null,
    ...over,
  };
}

/** 되돌리기 UPDATE 의 payload — 정방향 백필 검증용. */
function revertPayload(): Record<string, unknown> | undefined {
  return h.updates.find(
    (p) => typeof p === 'object' && p !== null && (p as Record<string, unknown>)['isCompleted'] === false,
  ) as Record<string, unknown> | undefined;
}

/** 설문 게이트 행이 실제로 조회됐는지. */
function surveyGateWasQueried(): boolean {
  return h.selectedFieldSets.some((keys) => keys.includes('isPaused'));
}

/** 되돌리기 UPDATE 가 실행됐는지 (status 를 in_progress 로 되돌리는 payload). */
function revertWasApplied(): boolean {
  return h.updates.some(
    (p) => typeof p === 'object' && p !== null && (p as Record<string, unknown>)['isCompleted'] === false,
  );
}

beforeEach(() => {
  h.surveyExists = true;
  h.responseRow = completedResponse();
  h.gateRow = gate();
  h.versionRow = null;
  h.reverseContactRow = null;
  h.selectedFieldSets = [];
  h.updates = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('allowReeditResponse — 수용 게이트 (A-1 사전 박제)', () => {
  it('[1] 미배포 설문(버전 폴백 없음)은 status_not_published 로 거부하고 되돌리기를 실행하지 않는다', async () => {
    h.gateRow = gate({ status: 'draft', currentVersionId: null });
    const { allowReeditResponse, ReeditUnavailableError } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).rejects.toBeInstanceOf(ReeditUnavailableError);
    expect(revertWasApplied()).toBe(false);
  });

  it('[1b] 거부 사유는 reason 필드로 노출된다 (procedure 문구 매핑 키)', async () => {
    h.gateRow = gate({ status: 'closed', currentVersionId: null });
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).rejects.toMatchObject({
      reason: 'status_not_published',
    });
  });

  it('[2] 설문이 draft 여도 현재 버전이 published 면 되돌리기를 수행한다 (설문 OR 버전)', async () => {
    h.gateRow = gate({ status: 'draft', currentVersionId: 'ver-1' });
    h.versionRow = { status: 'published' };
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).resolves.toEqual({ ok: true });
    expect(revertWasApplied()).toBe(true);
  });

  it('[3] 중단 설문은 survey_paused 로 거부한다', async () => {
    h.gateRow = gate({ isPaused: true });
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).rejects.toMatchObject({ reason: 'survey_paused' });
    expect(revertWasApplied()).toBe(false);
  });

  it('[4] 마감 경계는 <= 다 — endDate 가 now 와 같으면 거부, 1ms 뒤면 통과한다', async () => {
    vi.useFakeTimers();
    const fixed = new Date('2026-08-20T00:00:00.000Z');
    vi.setSystemTime(fixed);
    const { allowReeditResponse } = await import('./response-manage');

    h.gateRow = gate({ endDate: new Date(fixed.getTime()) });
    await expect(allowReeditResponse(INPUT)).rejects.toMatchObject({ reason: 'end_date_passed' });

    h.updates = [];
    h.selectedFieldSets = [];
    h.gateRow = gate({ endDate: new Date(fixed.getTime() + 1) });
    await expect(allowReeditResponse(INPUT)).resolves.toEqual({ ok: true });
    expect(revertWasApplied()).toBe(true);
  });

  it('[5] 정원은 검사하지 않는다 — 게이트 조회 컬럼에 maxResponses 가 없다 (의도된 부분집합)', async () => {
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).resolves.toEqual({ ok: true });

    const gateKeys = h.selectedFieldSets.find((keys) => keys.includes('isPaused'));
    // B-a 로 초대 검사가 들어오면서 isPublic·requireInviteToken 2컬럼이 추가됐다(쿼리 수 불변).
    expect(gateKeys).toEqual([
      'status',
      'isPaused',
      'endDate',
      'isPublic',
      'requireInviteToken',
      'currentVersionId',
    ]);
    expect(gateKeys).not.toContain('maxResponses');
  });

  it('[6] 테스트 응답은 게이트 전체를 면제받고 설문 행 조회 자체를 건너뛴다', async () => {
    h.responseRow = completedResponse({ isTest: true });
    h.gateRow = gate({ status: 'closed', isPaused: true });
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).resolves.toEqual({ ok: true });
    expect(surveyGateWasQueried()).toBe(false);
    expect(revertWasApplied()).toBe(true);
  });

  it('[7] 설문 게이트 행이 없으면 fail-open — 던지지 않고 되돌리기를 진행한다', async () => {
    h.gateRow = null;
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).resolves.toEqual({ ok: true });
    expect(revertWasApplied()).toBe(true);
  });

  it('[8] 여러 규칙을 동시에 위반하면 status → paused → endDate 순서로 첫 사유가 이긴다', async () => {
    vi.useFakeTimers();
    const fixed = new Date('2026-08-20T00:00:00.000Z');
    vi.setSystemTime(fixed);
    const { allowReeditResponse } = await import('./response-manage');

    h.gateRow = gate({
      status: 'draft',
      isPaused: true,
      endDate: new Date(fixed.getTime() - 1000),
    });
    await expect(allowReeditResponse(INPUT)).rejects.toMatchObject({
      reason: 'status_not_published',
    });

    h.gateRow = gate({
      status: 'published',
      isPaused: true,
      endDate: new Date(fixed.getTime() - 1000),
    });
    await expect(allowReeditResponse(INPUT)).rejects.toMatchObject({ reason: 'survey_paused' });
  });

  it('[9] 완료 상태가 아니면 게이트를 타지 않고 no-op 이다 (fail-soft 의미론 유지)', async () => {
    h.responseRow = completedResponse({ isCompleted: false });
    h.gateRow = gate({ status: 'draft' });
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).resolves.toEqual({ ok: true });
    expect(surveyGateWasQueried()).toBe(false);
    expect(revertWasApplied()).toBe(false);
  });

  it('[10] 비공개 설문 + 앵커 없음이면 invite_required 로 거부한다 (B-a)', async () => {
    h.gateRow = gate({ isPublic: false });
    h.responseRow = completedResponse({ contactTargetId: null });
    h.reverseContactRow = null;
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).rejects.toMatchObject({
      reason: 'invite_required',
    });
    expect(revertWasApplied()).toBe(false);
  });

  it('[10b] requireInviteToken 강제 설문도 같은 사유로 거부한다', async () => {
    h.gateRow = gate({ requireInviteToken: true });
    h.responseRow = completedResponse({ contactTargetId: null });
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).rejects.toMatchObject({
      reason: 'invite_required',
    });
  });

  it('[11] 레거시 역방향 전용 링크는 통과하고 정방향을 백필한다 (앵커 해석이 게이트보다 앞)', async () => {
    // 정방향(survey_responses.contact_target_id)은 null 인데 역방향
    // (contact_targets.response_id)만 연결된 실데이터. 게이트가 row.contactTargetId 로
    // 판정하면 여기서 invite_required 로 잘리고 자가 치유 경로까지 영영 막힌다.
    h.gateRow = gate({ isPublic: false });
    h.responseRow = completedResponse({ contactTargetId: null });
    h.reverseContactRow = { id: 'ct-legacy' };
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).resolves.toEqual({ ok: true });
    expect(revertWasApplied()).toBe(true);
    expect(revertPayload()).toMatchObject({ contactTargetId: 'ct-legacy' });
  });

  it('[12] 정방향 앵커가 있으면 역방향 조회 없이 통과한다', async () => {
    h.gateRow = gate({ isPublic: false });
    h.responseRow = completedResponse({ contactTargetId: 'ct-1' });
    h.reverseContactRow = null;
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).resolves.toEqual({ ok: true });
    expect(revertWasApplied()).toBe(true);
    expect(h.selectedFieldSets.some((keys) => keys.length === 1 && keys[0] === 'id')).toBe(false);
  });

  it('[13] 공개 설문의 앵커 없는 익명 응답은 그대로 되돌린다 (술어 자체가 발동하지 않는다)', async () => {
    h.gateRow = gate();
    h.responseRow = completedResponse({ contactTargetId: null });
    const { allowReeditResponse } = await import('./response-manage');

    await expect(allowReeditResponse(INPUT)).resolves.toEqual({ ok: true });
    expect(revertWasApplied()).toBe(true);
  });
});
