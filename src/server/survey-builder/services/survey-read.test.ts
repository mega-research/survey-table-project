import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Survey as SurveyType } from '@/types/survey';

// read-models/survey-structure 의 단일 구현(매핑 SoT)을 이 service 가 그대로 내보내는지 검증한다.
// publish/analytics 와 빌더 read 가 동일 매핑을 공유하도록 강제하여
// "신규 질문 컬럼이 한쪽 사본에만 추가돼 publish 스냅샷/분석에서 누락"되는 divergence 를 차단한다.
//
// getSurveyWithDetails 만 갈아끼우고 나머지는 원본을 살린다 — 다른 조회들은 아래에서
// 모킹된 @/db 를 상대로 실제 컬럼 투영을 검증해야 하므로 통 mock 으로 덮으면 안 된다.
vi.mock('@/server/read-models/survey-structure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/read-models/survey-structure')>()),
  getSurveyWithDetails: vi.fn(),
  getScopedSurveys: vi.fn(),
  getDeletedSurveys: vi.fn(),
  countDeletedSurveys: vi.fn(),
}));

vi.mock('@/server/read-models/responses', () => ({
  getResponseCountsGroupedBySurvey: vi.fn(),
}));

vi.mock('@/server/read-models/team-memberships', () => ({
  getActiveTeamMemberships: vi.fn(),
}));

vi.mock('@/server/read-models/teams', () => ({
  listActiveTeams: vi.fn(),
}));

const surveysFindFirst = vi.fn();
const surveysFindMany = vi.fn();
const surveyVersionsFindFirst = vi.fn();
const contactTargetsFindFirst = vi.fn();

vi.mock('@/server/read-models/invite-lookup', () => ({
  findContactByInviteToken: vi.fn(),
}));

vi.mock('@/server/read-models/survey-owner-email', () => ({
  getSurveyOwnerEmail: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: {
        findFirst: (...args: unknown[]) => surveysFindFirst(...args),
        findMany: (...args: unknown[]) => surveysFindMany(...args),
      },
      surveyVersions: {
        findFirst: (...args: unknown[]) => surveyVersionsFindFirst(...args),
      },
      contactTargets: {
        findFirst: (...args: unknown[]) => contactTargetsFindFirst(...args),
      },
    },
  },
}));

import { getResponseCountsGroupedBySurvey } from '@/server/read-models/responses';
import {
  countDeletedSurveys,
  getDeletedSurveys,
  getScopedSurveys,
  getSurveyWithDetails as getSurveyWithDetailsData,
} from '@/server/read-models/survey-structure';
import { getActiveTeamMemberships } from '@/server/read-models/team-memberships';
import { listActiveTeams } from '@/server/read-models/teams';
import { DEFAULT_RESPONSE_HEADER_CONFIG } from '@/lib/survey/response-header-config';
import { findContactByInviteToken } from '@/server/read-models/invite-lookup';
import { getSurveyOwnerEmail } from '@/server/read-models/survey-owner-email';

import * as readModels from '@/server/read-models/survey-structure';

import {
  getSurveyById,
  getSurveyForResponse,
  getSurveyListWithCounts,
  getSurveyWithDetails,
} from './survey-read';

const SURVEY_ID = 'survey-1';

describe('survey-read.service getSurveyWithDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contactTargetsFindFirst.mockReset();
    vi.mocked(findContactByInviteToken).mockReset();
  });

  // 재수출이라 두 심볼은 같은 함수 객체다 — 사본이 아니라는 것이 이 검사의 내용이다.
  it('read-models 의 단일 구현을 그대로 내보낸다', async () => {
    const fake = { id: SURVEY_ID, title: 'T' } as unknown as SurveyType;
    vi.mocked(getSurveyWithDetailsData).mockResolvedValue(fake);

    const result = await getSurveyWithDetails(SURVEY_ID);

    expect(getSurveyWithDetailsData).toHaveBeenCalledWith(SURVEY_ID);
    expect(result).toBe(fake);
  });

  // 사본을 되살리는 회귀를 막는 고정. getSurveyById 는 React cache() 로 감싸여 있어
  // 정의가 둘이면 같은 RSC pass 에서 같은 surveyId 를 두 번 조회하게 된다 —
  // operations/layout 과 read-models/variable-catalog 가 실제로 그 두 경로였다.
  it('getSurveyById 는 read-models 와 같은 함수 객체다', () => {
    expect(getSurveyById).toBe(readModels.getSurveyById);
  });

  it('null 반환을 그대로 전달한다', async () => {
    vi.mocked(getSurveyWithDetailsData).mockResolvedValue(null);

    const result = await getSurveyWithDetails(SURVEY_ID);

    expect(result).toBeNull();
  });
});

describe('survey-read.service getSurveyListWithCounts', () => {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  const updatedAt = new Date('2026-06-02T00:00:00.000Z');

  function scopedRow(over: Record<string, unknown> = {}) {
    return {
      id: 'survey-1',
      title: '첫 설문',
      description: null,
      slug: 'first',
      privateToken: '11111111-1111-1111-1111-111111111111',
      createdAt,
      updatedAt,
      endDate: null,
      isPublic: true,
      status: 'published',
      teamId: 'team-1',
      teamName: '연구1본부 - 1팀',
      visibility: 'team' as const,
      assignmentStatus: 'assigned' as const,
      ownerUserId: 'u-1',
      ownerName: '홍길동',
      surveyGroupId: null,
      deletedAt: null,
      isParticipant: false,
      ...over,
    };
  }

  const member = { id: 'u-1', isSuperadmin: false, userType: 'internal' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getActiveTeamMemberships).mockResolvedValue([
      { teamId: 'team-1', teamName: '연구1본부 - 1팀', teamOrder: 0, role: 'member' },
    ]);
    vi.mocked(listActiveTeams).mockResolvedValue([]);
    vi.mocked(getResponseCountsGroupedBySurvey).mockResolvedValue(new Map());
    vi.mocked(getScopedSurveys).mockResolvedValue([]);
    vi.mocked(getDeletedSurveys).mockResolvedValue([]);
    vi.mocked(countDeletedSurveys).mockResolvedValue(0);
  });

  it('해석된 범위로 조회하고 전체/완료 응답 수를 병합한다', async () => {
    vi.mocked(getScopedSurveys).mockResolvedValue([scopedRow()]);
    vi.mocked(getResponseCountsGroupedBySurvey).mockResolvedValue(
      new Map([['survey-1', { total: 5, completed: 3 }]]),
    );

    const result = await getSurveyListWithCounts(member, null);

    expect(getScopedSurveys).toHaveBeenCalledWith({
      kind: 'team',
      teamId: 'team-1',
      viewerId: 'u-1',
      seesInviteOnly: false,
    });
    expect(getResponseCountsGroupedBySurvey).toHaveBeenCalledWith(['survey-1']);
    expect(result.scope).toEqual({ kind: 'team', teamId: 'team-1' });
    expect(result.canSeeSystemScope).toBe(false);
    expect(result.surveys).toEqual([
      {
        id: 'survey-1',
        title: '첫 설문',
        description: null,
        slug: 'first',
        privateToken: '11111111-1111-1111-1111-111111111111',
        responseCount: 5,
        completedResponseCount: 3,
        createdAt,
        updatedAt,
        endDate: null,
        isPublic: true,
        status: 'published',
        teamId: 'team-1',
        teamName: '연구1본부 - 1팀',
        visibility: 'team',
        assignmentStatus: 'assigned',
        // 소유자는 화면 편의(작성자 표기·소유자 필터·버튼 노출 근사, 티켓 08)다.
        // 접근 판정은 여전히 서버 capability 엔진만 한다(티켓 07).
        ownerUserId: 'u-1',
        ownerName: '홍길동',
        // 소속 그룹도 화면 편의다(그룹 화면 좁힘·케밥의 현재 그룹, 티켓 12).
        surveyGroupId: null,
        // 일반 목록의 행은 언제나 null — 화면이 이 값으로 휴지통 여부를 가른다(티켓 17).
        deletedAt: null,
        // 참여자 여부는 카드 버튼 노출 근사가 본다(티켓 18).
        isParticipant: false,
      },
    ]);
  });

  it('status 는 어휘 밖 값을 draft 로 접는다', async () => {
    vi.mocked(getScopedSurveys).mockResolvedValue([
      scopedRow({ status: 'weird-legacy-value' }),
    ] as never);

    const result = await getSurveyListWithCounts(member, null);

    expect(result.surveys[0]?.status).toBe('draft');
  });

  it('그 팀의 팀장은 invite_only 까지 보는 조건으로 조회한다', async () => {
    vi.mocked(getActiveTeamMemberships).mockResolvedValue([
      { teamId: 'team-1', teamName: '연구1본부 - 1팀', teamOrder: 0, role: 'leader' },
    ]);

    await getSurveyListWithCounts(member, 'team-1');

    expect(getScopedSurveys).toHaveBeenCalledWith(
      expect.objectContaining({ seesInviteOnly: true }),
    );
  });

  it('슈퍼어드민의 기본 범위는 시스템 전체이고 고를 수 있는 팀은 전 팀이다', async () => {
    vi.mocked(listActiveTeams).mockResolvedValue([{ id: 'team-9', name: '연구3본부 - 7팀' }]);

    const result = await getSurveyListWithCounts(
      { id: 'su-1', isSuperadmin: true, userType: 'internal' },
      null,
    );

    // viewerId 는 좁히는 조건이 아니라 「내가 참여자인가」 투영의 입력이다(티켓 18).
    expect(getScopedSurveys).toHaveBeenCalledWith({ kind: 'all', viewerId: 'su-1' });
    expect(result.scope).toEqual({ kind: 'system' });
    expect(result.canSeeSystemScope).toBe(true);
    expect(result.teams).toEqual([{ id: 'team-9', name: '연구3본부 - 7팀' }]);
  });

  it('팀 미배치 사용자는 아무 설문도 조회하지 않는다', async () => {
    vi.mocked(getActiveTeamMemberships).mockResolvedValue([]);

    const result = await getSurveyListWithCounts(member, null);

    expect(getScopedSurveys).toHaveBeenCalledWith({ kind: 'none' });
    expect(result.scope).toEqual({ kind: 'none' });
    expect(result.surveys).toEqual([]);
  });
});

// getSurveyForResponse 의 snapshot 기반 원칙 회귀.
// published 응답 경로는 freeze 된 snapshot.settings.requireInviteToken 을 따라야 하며
// 빌더 draft 토글이 들어있는 현재 surveys 행으로 덮어쓰면 안 된다.
describe('survey-read.service getSurveyForResponse requireInviteToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function snapshotSettings(requireInviteToken: boolean | undefined) {
    const base = {
      isPublic: true,
      allowMultipleResponses: false,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '감사합니다',
    };
    return requireInviteToken === undefined
      ? base
      : { ...base, requireInviteToken };
  }

  it('published 경로는 snapshot 값을 따르고 현재 surveys 행으로 덮어쓰지 않는다', async () => {
    const surveyId = 'survey-published-1';
    // 현재 surveys 행: draft 에서 토글이 true 로 바뀐 상태
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: 'ver-1',
      requireInviteToken: true,
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    // snapshot: publish 시점 freeze 값은 false
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-1',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: snapshotSettings(false),
      },
    });

    const result = await getSurveyForResponse({ surveyId });

    expect(result).not.toBeNull();
    // snapshot 의 false 가 우선 — 현재 행의 true 가 새지 않아야 한다
    expect(result?.survey.settings.requireInviteToken).toBe(false);
    expect(result?.versionId).toBe('ver-1');
  });

  it('snapshot 에 requireInviteToken 이 없는 이전 publish 본은 현재 surveys 행으로 fallback 한다', async () => {
    const surveyId = 'survey-legacy-1';
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: 'ver-legacy',
      requireInviteToken: true,
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-legacy',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: snapshotSettings(undefined),
      },
    });

    const result = await getSurveyForResponse({ surveyId });

    expect(result?.survey.settings.requireInviteToken).toBe(true);
  });

  it('responseHeader 는 published snapshot 값을 따르고 현재 surveys 행으로 덮어쓰지 않는다', async () => {
    const surveyId = 'survey-header-published';
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: 'ver-header',
      requireInviteToken: false,
      responseHeader: {
        style: 'logo-title',
        titleSize: 'lg',
        logo: { imageUrl: 'https://example.com/draft.png', size: 'lg' },
        logoTitle: { logoPosition: 'right' },
      },
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-header',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: {
          ...snapshotSettings(false),
          responseHeader: {
            style: 'plain',
            titleSize: 'auto',
            // 'right' 는 현재 surveys 행(logo-title 스타일 → composed 변환 시 titleAlign 'center')과도,
            // composed 기본값('left')과도 겹치지 않는 판별값 — 스냅샷 값이 실제로 쓰였는지 구분 가능하게 한다.
            titleAlign: 'right',
          },
        },
      },
    });

    const result = await getSurveyForResponse({ surveyId });

    const responseHeader = result?.survey.settings.responseHeader;
    // v2 normalize 는 항상 composed 로 통합 변환한다 — v1 plain 리터럴 형태로 남지 않는다.
    expect(responseHeader?.style).toBe('composed');
    // titleAlign='right' 는 snapshot 전용 값. 코드가 현재 surveys 행(logo-title → 'center')을 잘못
    // 사용했거나, 스냅샷을 무시하고 기본값('left')으로 fallback 했다면 이 값과 어긋난다.
    expect(responseHeader?.titleAlign).toBe('right');
  });

  it('responseHeader 가 없는 기존 snapshot 은 현재 surveys 행이 아니라 새 기본형으로 fallback 한다', async () => {
    const surveyId = 'survey-header-legacy';
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: 'ver-header-legacy',
      requireInviteToken: false,
      responseHeader: {
        style: 'logo-title',
        titleSize: 'lg',
        logo: { imageUrl: 'https://example.com/draft.png', size: 'lg' },
        logoTitle: { logoPosition: 'right' },
      },
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-header-legacy',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: snapshotSettings(false),
      },
    });

    const result = await getSurveyForResponse({ surveyId });

    // 스냅샷에 responseHeader 가 없는 이전 publish 본 — 현재 surveys 행(logo-title)이 아니라
    // composed 기본값으로 fallback 해야 한다.
    expect(result?.survey.settings.responseHeader).toEqual(DEFAULT_RESPONSE_HEADER_CONFIG);
  });

  it('requirePublished 옵션이면 배포 버전 없는 설문을 현재 draft 로 fallback 하지 않는다', async () => {
    const surveyId = 'survey-draft-only';
    surveysFindFirst.mockResolvedValue({
      id: surveyId,
      currentVersionId: null,
      requireInviteToken: false,
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    vi.mocked(getSurveyWithDetailsData).mockResolvedValue({
      id: surveyId,
      title: 'draft',
      groups: [],
      questions: [],
      settings: snapshotSettings(false),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    } as unknown as SurveyType);

    const result = await getSurveyForResponse({ surveyId }, { requirePublished: true });

    expect(result).toBeNull();
    expect(getSurveyWithDetailsData).not.toHaveBeenCalled();
  });
});

// getSurveyForResponse 의 control 페이로드(T7).
// isPaused/pausedMessage 는 스냅샷 밖 라이브 값이므로 항상 현재 surveys 행에서 와야 하고,
// testSession 은 testToken 유무 + isValidTestToken 판정으로 3분기한다.
describe('survey-read.service getSurveyForResponse control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contactTargetsFindFirst.mockReset();
    vi.mocked(findContactByInviteToken).mockReset();
  });

  function baseSurveyRow(surveyId: string, overrides: Record<string, unknown> = {}) {
    return {
      id: surveyId,
      currentVersionId: null,
      requireInviteToken: false,
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      lookups: [],
      isPaused: false,
      pausedMessage: null,
      testModeEnabled: false,
      testToken: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function mockFallbackDetails(surveyId: string) {
    vi.mocked(getSurveyWithDetailsData).mockResolvedValue({
      id: surveyId,
      title: 'draft',
      groups: [],
      questions: [],
      settings: {
        isPublic: true,
        allowMultipleResponses: false,
        showProgressBar: true,
        shuffleQuestions: false,
        requireLogin: false,
        thankYouMessage: '감사합니다',
      },
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    } as unknown as SurveyType);
  }

  it('testToken 미전달이면 testSession=none 이다 (미배포 fallback 경로)', async () => {
    const surveyId = 'survey-control-none';
    surveysFindFirst.mockResolvedValue(baseSurveyRow(surveyId));
    mockFallbackDetails(surveyId);

    const result = await getSurveyForResponse({ surveyId });

    expect(result?.control).toEqual({
      isPaused: false,
      pausedMessage: null,
      testSession: 'none',
      testSessionKind: null,
    });
  });

  it('유효한 testToken 이면 testSession=valid 이다', async () => {
    const surveyId = 'survey-control-valid';
    surveysFindFirst.mockResolvedValue(
      baseSurveyRow(surveyId, { testModeEnabled: true, testToken: 'tok-valid' }),
    );
    mockFallbackDetails(surveyId);

    const result = await getSurveyForResponse({ surveyId, testToken: 'tok-valid' });

    expect(result?.control).toMatchObject({
      testSession: 'valid',
      testSessionKind: 'anonymous',
    });
  });

  it('테스트 대상자가 있으면 유효한 익명 testToken도 invalid로 판정한다', async () => {
    const surveyId = 'survey-control-anonymous-disabled';
    surveysFindFirst.mockResolvedValue(
      baseSurveyRow(surveyId, { testModeEnabled: true, testToken: 'tok-valid' }),
    );
    contactTargetsFindFirst.mockResolvedValue({ id: 'test-target-1' });
    mockFallbackDetails(surveyId);

    const result = await getSurveyForResponse({ surveyId, testToken: 'tok-valid' });

    expect(result?.control).toMatchObject({
      testSession: 'invalid',
      testSessionKind: null,
    });
  });

  it('inviteToken과 testToken을 섞으면 대상 종류와 무관하게 invalid로 판정한다', async () => {
    const surveyId = 'survey-control-mixed';
    surveysFindFirst.mockResolvedValue(
      baseSurveyRow(surveyId, { testModeEnabled: true, testToken: 'tok-valid' }),
    );
    mockFallbackDetails(surveyId);

    const result = await getSurveyForResponse({
      surveyId,
      inviteToken: 'invite-token',
      testToken: 'tok-valid',
    });

    expect(result?.control).toMatchObject({
      testSession: 'invalid',
      testSessionKind: null,
    });
    expect(findContactByInviteToken).not.toHaveBeenCalled();
  });

  it('ON인 테스트 대상자 inviteToken은 target 테스트 세션으로 판정한다', async () => {
    const surveyId = 'survey-control-target';
    surveysFindFirst.mockResolvedValue(
      baseSurveyRow(surveyId, { testModeEnabled: true }),
    );
    vi.mocked(findContactByInviteToken).mockResolvedValue({
      kind: 'valid',
      contactTargetId: 'test-target-1',
      respondedAt: null,
      isTest: true,
    });
    mockFallbackDetails(surveyId);

    const result = await getSurveyForResponse({ surveyId, inviteToken: 'invite-token' });

    expect(result?.control).toMatchObject({
      testSession: 'valid',
      testSessionKind: 'target',
    });
  });

  it('실제 대상자 inviteToken은 테스트 모드 ON이어도 일반 세션이다', async () => {
    const surveyId = 'survey-control-real-target';
    surveysFindFirst.mockResolvedValue(
      baseSurveyRow(surveyId, { testModeEnabled: true }),
    );
    vi.mocked(findContactByInviteToken).mockResolvedValue({
      kind: 'valid',
      contactTargetId: 'real-target-1',
      respondedAt: null,
      isTest: false,
    });
    mockFallbackDetails(surveyId);

    const result = await getSurveyForResponse({ surveyId, inviteToken: 'invite-token' });

    expect(result?.control).toMatchObject({
      testSession: 'none',
      testSessionKind: null,
    });
  });

  it('초대 선택 설문에서도 교차 설문 테스트 토큰을 익명으로 폴백하지 않는다', async () => {
    const surveyId = 'survey-control-optional-invite';
    surveysFindFirst.mockResolvedValue(
      baseSurveyRow(surveyId, { requireInviteToken: false }),
    );
    vi.mocked(findContactByInviteToken).mockResolvedValue({ kind: 'invalid_test' });
    mockFallbackDetails(surveyId);

    const result = await getSurveyForResponse({
      surveyId,
      inviteToken: 'cross-survey-test-token',
    });

    expect(result).not.toBeNull();
    expect(result?.survey.settings.requireInviteToken).toBeFalsy();
    expect(result?.control).toEqual({
      isPaused: false,
      pausedMessage: null,
      testSession: 'invalid',
      testSessionKind: null,
    });
  });

  it('testModeEnabled=false 면 토큰이 일치해도 testSession=invalid 이다', async () => {
    const surveyId = 'survey-control-invalid-mode-off';
    surveysFindFirst.mockResolvedValue(
      baseSurveyRow(surveyId, { testModeEnabled: false, testToken: 'tok-valid' }),
    );
    mockFallbackDetails(surveyId);

    const result = await getSurveyForResponse({ surveyId, testToken: 'tok-valid' });

    expect(result?.control.testSession).toBe('invalid');
  });

  it('testToken 이 불일치하면 testSession=invalid 이다', async () => {
    const surveyId = 'survey-control-invalid-mismatch';
    surveysFindFirst.mockResolvedValue(
      baseSurveyRow(surveyId, { testModeEnabled: true, testToken: 'tok-valid' }),
    );
    mockFallbackDetails(surveyId);

    const result = await getSurveyForResponse({ surveyId, testToken: 'tok-wrong' });

    expect(result?.control.testSession).toBe('invalid');
  });

  it('isPaused/pausedMessage 는 현재 surveys 행 값을 그대로 전달한다 (미배포 fallback 경로)', async () => {
    const surveyId = 'survey-control-paused-fallback';
    surveysFindFirst.mockResolvedValue(
      baseSurveyRow(surveyId, { isPaused: true, pausedMessage: '점검 중입니다' }),
    );
    mockFallbackDetails(surveyId);

    const result = await getSurveyForResponse({ surveyId });

    expect(result?.control.isPaused).toBe(true);
    expect(result?.control.pausedMessage).toBe('점검 중입니다');
  });

  it('배포 스냅샷 경로에서도 control 은 스냅샷이 아니라 현재 surveys 행에서 온다', async () => {
    const surveyId = 'survey-control-paused-snapshot';
    surveysFindFirst.mockResolvedValue(
      baseSurveyRow(surveyId, {
        currentVersionId: 'ver-control-1',
        isPaused: true,
        pausedMessage: '점검 중입니다',
        testModeEnabled: true,
        testToken: 'tok-valid',
      }),
    );
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-control-1',
      snapshot: {
        title: '설문',
        questions: [],
        groups: [],
        settings: {
          isPublic: true,
          allowMultipleResponses: false,
          showProgressBar: true,
          shuffleQuestions: false,
          requireLogin: false,
          thankYouMessage: '감사합니다',
        },
      },
    });

    const result = await getSurveyForResponse({ surveyId, testToken: 'tok-valid' });

    expect(result?.versionId).toBe('ver-control-1');
    expect(result?.control).toEqual({
      isPaused: true,
      pausedMessage: '점검 중입니다',
      testSession: 'valid',
      testSessionKind: 'anonymous',
    });
  });
});

// 응답자 화면의 문의 이메일은 **설정값이 없으면 현재 소유자**로 해석된다(티켓 20).
// 스냅샷에 박아 두면 소유권 이전이 반영되지 않고, surveys 행에 채워 넣으면 빌더 설정
// 패널이 「미설정인데 값이 보이는」 화면이 된다 — 그래서 pub 조회 시점에만 겹쳐 준다.
describe('survey-read.service getSurveyForResponse contactEmail 소유자 연동', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSurveyOwnerEmail).mockReset();
  });

  const SETTINGS = {
    isPublic: true,
    allowMultipleResponses: false,
    showProgressBar: true,
    shuffleQuestions: false,
    requireLogin: false,
    thankYouMessage: '감사합니다',
  };

  function publishedSurvey(contactEmail: string | null) {
    surveysFindFirst.mockResolvedValue({
      id: 'survey-contact-1',
      currentVersionId: 'ver-contact',
      requireInviteToken: false,
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    surveyVersionsFindFirst.mockResolvedValue({
      id: 'ver-contact',
      snapshot: { title: '설문', questions: [], groups: [], settings: SETTINGS },
    });
  }

  it('문의 이메일이 비어 있으면 현재 소유자 이메일로 채운다', async () => {
    publishedSurvey(null);
    vi.mocked(getSurveyOwnerEmail).mockResolvedValue('owner@example.com');

    const result = await getSurveyForResponse({ surveyId: 'survey-contact-1' });

    expect(result?.survey.contactEmail).toBe('owner@example.com');
    expect(getSurveyOwnerEmail).toHaveBeenCalledWith('survey-contact-1');
  });

  it('문의 이메일이 설정돼 있으면 소유자를 조회하지 않는다', async () => {
    publishedSurvey('help@example.kr');
    vi.mocked(getSurveyOwnerEmail).mockResolvedValue('owner@example.com');

    const result = await getSurveyForResponse({ surveyId: 'survey-contact-1' });

    expect(result?.survey.contactEmail).toBe('help@example.kr');
    expect(getSurveyOwnerEmail).not.toHaveBeenCalled();
  });

  it('소유자가 없으면 null 그대로 — 화면이 문의 안내를 감춘다', async () => {
    publishedSurvey(null);
    vi.mocked(getSurveyOwnerEmail).mockResolvedValue(null);

    const result = await getSurveyForResponse({ surveyId: 'survey-contact-1' });

    expect(result?.survey.contactEmail).toBeNull();
  });

  it('미배포 설문 fallback 경로에도 같은 규칙이 선다', async () => {
    surveysFindFirst.mockResolvedValue({
      id: 'survey-draft-1',
      currentVersionId: null,
      requireInviteToken: false,
      slug: null,
      privateToken: null,
      contactColumns: null,
      contactEmail: null,
      quotaConfig: null,
      lookups: [],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    vi.mocked(getSurveyWithDetailsData).mockResolvedValue({
      id: 'survey-draft-1',
      title: '초안',
      contactEmail: null,
    } as unknown as SurveyType);
    vi.mocked(getSurveyOwnerEmail).mockResolvedValue('owner@example.com');

    const result = await getSurveyForResponse({ surveyId: 'survey-draft-1' });

    expect(result?.survey.contactEmail).toBe('owner@example.com');
  });
});
