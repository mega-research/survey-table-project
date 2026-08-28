/**
 * 교차 팀 IDOR 음성 스위트 — oRPC 전 표면 (역할 모델 v2 티켓 15, B 검증 게이트).
 *
 * 묻는 것은 하나다: **다른 팀 설문의 id 를 넣으면 그 표면이 데이터에 닿기 전에 멈추는가.**
 *
 * 목록의 출처가 이 파일의 미덕이다. 손으로 적은 목록만 돌면 새로 붙은 procedure 는 영원히
 * 초록이므로, `@/server/router` 를 런타임에 열거해(tests/helpers/rpc-surface) "설문 id 를
 * 받는 내부 표면" 을 뽑고 그 집합이 아래 인벤토리와 **정확히 일치**하는지 먼저 검사한다.
 * 표면이 하나 늘면 인벤토리 불일치로 즉시 빨개진다 — 그것이 "누락 표면 없음" 의 증명이다.
 *
 * 판정 환경:
 *  - 주체는 **A팀 팀원**(활성 소속 하나). 슈퍼어드민도 아니고 미배치도 아니다 — 미배치로
 *    두면 판정이 3번 가드(팀 미배치)에서 끝나 "팀 경계" 자체는 검증되지 않는다.
 *  - 대상 설문은 **B팀 소유**(팀 공개·소유자도 B팀 사람). 즉 존재하지만 내 팀 것이 아니다.
 *  - 그래서 기대값은 전부 NOT_FOUND 다 — survey.view 가 없으면 존재를 알리지 않는 것이
 *    코어(denialReasonFor)의 계약이라, FORBIDDEN 이 오면 id 스캔으로 타 팀 설문의 존재가
 *    확인된다는 뜻이다.
 *
 * 서비스 도달 여부는 db mock 이 잡는다: 관문이 쓰는 `surveys` 조회만 살아 있고 나머지
 * 쓰기·트랜잭션·query 는 전부 던진다. 관문을 빠뜨린 procedure 는 NOT_FOUND 대신 그 사고를
 * 들고 나오므로 단언이 실패한다.
 */
import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { router } from '@/server/router';
import * as gate from '@/server/rpc-survey-access';
import * as accessCore from '@/server/survey-access';
import { internalActorContext } from '@tests/helpers/rpc-context';
import {
  enumerateProcedures,
  isInternalBase,
  takesSurveyId,
  type ProcedureEntry,
} from '@tests/helpers/rpc-surface';

/**
 * 모킹 팩토리는 호이스트되어 파일 상단의 const 를 볼 수 없다 — 양쪽이 함께 쓰는 값은
 * vi.hoisted 로 한 번만 만든다(같은 문자열을 두 벌 적으면 한쪽만 고쳐지는 날이 온다).
 */
const IDS = vi.hoisted(() => ({
  ACTOR_ID: '3a000000-0000-4000-8000-00000000ac01',
  MY_TEAM_ID: '3a000000-0000-4000-8000-0000000a1111',
  OTHER_TEAM_ID: '3a000000-0000-4000-8000-0000000b2222',
  OTHER_OWNER_ID: '3a000000-0000-4000-8000-0000000b0001',
  /** B팀 설문 — 존재하지만 내 팀 것이 아니다. */
  FOREIGN_SURVEY_ID: '3a000000-0000-4000-8000-0000000f0001',
  /** 타 설문에 딸린 하위 행 id — 설문 관문이 먼저 서므로 어느 것도 읽히면 안 된다. */
  FOREIGN_CHILD_ID: '3a000000-0000-4000-8000-0000000f0002',
  /** 서비스가 DB 를 만졌다는 신호. 관문이 있었다면 여기 닿을 수 없다. */
  SERVICE_REACHED: 'CROSS_TEAM_IDOR: 관문을 지나 서비스가 DB 에 닿았다',
}));

const { ACTOR_ID, FOREIGN_SURVEY_ID, FOREIGN_CHILD_ID } = IDS;

// ─────────────────────────────────────────────────────────────────────────────
// 모킹 — surveys 조회만 살리고 나머지는 전부 사고로 만든다
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/db', async (importOriginal) => {
  // importOriginal 스프레드가 필수다 — `@/db` 는 스키마를 통째로 되내보내므로, 팩토리가
  // `{ db }` 만 돌려주면 테이블 export 가 사라지고 전 표면이 「없는 설문」으로 초록이 된다.
  const actual = await importOriginal<typeof import('@/db')>();
  const { createDbStub } = await import('@tests/helpers/db-stub');
  const { surveyGroups, surveys } = await import('@/db/schema');

  const foreignSurveyRow = {
    id: IDS.FOREIGN_SURVEY_ID,
    teamId: IDS.OTHER_TEAM_ID,
    visibility: 'team',
    ownerUserId: IDS.OTHER_OWNER_ID,
    assignmentStatus: 'assigned',
    deletedAt: null,
  };

  return {
    ...actual,
    db: createDbStub({
      reachedMessage: IDS.SERVICE_REACHED,
      /**
       * 조회는 두 테이블만 살려 둔다.
       *  - `surveys` : 관문이 판정에 쓰는 행. 없으면 "없는 설문" 이 되어 팀 경계가 아니라
       *    존재 여부를 검사하는 꼴이 된다.
       *  - `survey_groups` : 담기 표면은 **그룹 구조 관문이 먼저** 선다. 그것을 통과시켜야
       *    그 뒤의 설문 관문이 실제로 검증된다 — 그룹에서 막히면 설문 관문은 돌지도 않는다.
       */
      rowsFor: (table) => {
        if (table === surveys) return [foreignSurveyRow];
        if (table === surveyGroups) return [{ teamId: IDS.MY_TEAM_ID }];
        return [];
      },
      relationalRowFor: (table) => (table === 'surveys' ? foreignSurveyRow : undefined),
    }),
  };
});

// 주체는 A팀 팀원 — 멤버십 조회는 read-model 하나로 모여 있어 여기만 심으면 된다.
vi.mock('@/server/read-models/team-memberships', () => ({
  getActiveTeamMemberships: vi.fn(async () => [{ teamId: IDS.MY_TEAM_ID, role: 'member' }]),
  getTeamRole: vi.fn(async () => null),
}));

/**
 * 코어 관문에도 스파이를 얹는다 — 관문이 **서비스 안**에 있는 경로(duplicate·ensure·
 * saveWithDetails)는 procedure 어댑터를 지나지 않아, 요구 capability 를 다른 데서 볼 수 없다.
 * 그것을 안 보면 서비스의 요구를 survey.edit → survey.view 로 약화해도 교차 팀 주체는
 * 어차피 둘 다 없어 NOT_FOUND 라 스위트가 통과한다(구현이 스스로를 채점하는 구조).
 */
vi.mock('@/server/survey-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/survey-access')>();
  return { ...actual, assertSurveyCapability: vi.fn(actual.assertSurveyCapability) };
});

// 관문 호출을 기록한다 — "거부됐다" 뿐 아니라 "무엇을 요구했는가" 까지 고정하기 위해서다.
vi.mock('@/server/rpc-survey-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/rpc-survey-access')>();
  return {
    ...actual,
    assertSurveyCapabilityRpc: vi.fn(actual.assertSurveyCapabilityRpc),
    assertScopedSurveyCapabilityRpc: vi.fn(actual.assertScopedSurveyCapabilityRpc),
    assertSurveyCapabilityBatchRpc: vi.fn(actual.assertSurveyCapabilityBatchRpc),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// 인벤토리 — 설문 id 를 받는 내부(authed·scoped) 표면 전수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 관문의 종류.
 *  - `rpc`     : handler 첫 줄의 assertSurveyCapabilityRpc
 *  - `scoped`  : 게스트 허용 표면의 assertScopedSurveyCapabilityRpc
 *  - `batch`   : 여러 설문을 한 왕복으로 보는 assertSurveyCapabilityBatchRpc
 *  - `service` : 생성/저장 한 입구라 관문이 서비스 트랜잭션 안에 있는 경로
 */
type GateKind = 'rpc' | 'scoped' | 'batch' | 'service';

interface SurfaceSpec {
  gate: GateKind;
  /** 관문이 요구하는 capability. batch 는 배열. service 는 코어 스파이로 확인한다. */
  capability?: string | readonly string[];
  input: unknown;
  /**
   * 관문 거부가 예외가 아니라 값으로 나오는 표면 — 사유를 함께 적는다.
   *
   * `control.get` 하나뿐이다: 미저장 설문의 빌더 헤더가 10초마다 폴링하므로 NOT_FOUND 를
   * null(=제어 OFF)로 접는 것이 규약이다. 데이터가 새지 않는다는 점은 같다.
   */
  resolvesTo?: unknown;
}

const S = FOREIGN_SURVEY_ID;
const C = FOREIGN_CHILD_ID;

/** 엑셀 업로드 표면은 zod 가 File 인스턴스를 요구한다 — 내용은 읽히지 않는다. */
function xlsxFile(): File {
  return new File([new Uint8Array()], 'cross-team.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** 메일 템플릿 입력의 필수 칸 — 발신 표기까지 전부 요구된다. */
const MAIL_TEMPLATE_INPUT = {
  name: '주입 템플릿',
  subject: '주입',
  bodyHtml: '<p>주입</p>',
  fromLocal: 'no-reply',
  fromName: '메가리서치',
  replyTo: 'ops@megaresearch.co.kr',
};

/**
 * 표면 → (관문 종류, 요구 capability, 최소 입력).
 *
 * 입력은 zod 검증만 통과하면 되는 최소값이다 — 관문이 handler 첫 줄이라 그 뒤 값은 읽히지
 * 않는다. **하위 id(responseId·campaignId 등)에는 일부러 타 설문의 것을 넣는다**: 설문
 * 관문이 서면 하위 id 가 무엇이든 거기서 멈춰야 한다.
 */
const SURFACES: Record<string, SurfaceSpec> = {
  // ── 설문 CRUD ───────────────────────────────────────────────────────────
  'surveyBuilder.surveys.update': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, data: {} },
  },
  'surveyBuilder.surveys.delete': {
    gate: 'rpc',
    capability: 'survey.delete',
    input: { surveyId: S },
  },
  'surveyBuilder.surveys.duplicate': {
    gate: 'service',
    capability: 'survey.edit',
    input: { surveyId: S },
  },
  'surveyBuilder.surveys.ensure': {
    gate: 'service',
    capability: 'survey.edit',
    input: { id: S, title: '남의 팀 설문', privateToken: 'tok-cross-team', settings: {} },
  },

  // ── 저장 · 발행 ─────────────────────────────────────────────────────────
  'surveyBuilder.save.saveDiff': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, groups: [], questionChanges: { upserted: [], deleted: [] } },
  },
  'surveyBuilder.save.saveWithDetails': {
    gate: 'service',
    capability: 'survey.edit',
    input: { id: S, title: '남의 팀 설문', questions: [], groups: [] },
  },
  'surveyBuilder.publish.publish': {
    gate: 'rpc',
    capability: 'survey.publish',
    input: { surveyId: S },
  },
  'surveyBuilder.publish.migratableCount': {
    gate: 'rpc',
    capability: 'survey.publish',
    input: { surveyId: S },
  },

  // ── 질문 · 그룹 ─────────────────────────────────────────────────────────
  'surveyBuilder.questions.create': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, id: C, type: 'text', title: '주입', order: 0 },
  },
  'surveyBuilder.questions.update': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, questionId: C, data: {} },
  },
  'surveyBuilder.questions.remove': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, questionId: C },
  },
  'surveyBuilder.questions.reorder': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, questionIds: [C] },
  },
  'surveyBuilder.groups.create': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, id: C, name: '주입', order: 0 },
  },
  'surveyBuilder.groups.update': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, groupId: C, data: {} },
  },
  'surveyBuilder.groups.remove': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, groupId: C },
  },
  'surveyBuilder.groups.reorder': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, groupIds: [C] },
  },

  // ── 조회 ────────────────────────────────────────────────────────────────
  'surveyBuilder.read.byId': { gate: 'rpc', capability: 'survey.view', input: { surveyId: S } },
  'surveyBuilder.read.withDetails': {
    gate: 'rpc',
    capability: 'survey.view',
    input: { surveyId: S },
  },
  'surveyBuilder.read.questionGroups': {
    gate: 'rpc',
    capability: 'survey.view',
    input: { surveyId: S },
  },
  'surveyBuilder.read.questions': {
    gate: 'rpc',
    capability: 'survey.view',
    input: { surveyId: S },
  },
  'surveyBuilder.read.responsesBySurvey': {
    gate: 'rpc',
    capability: 'responses.view',
    input: { surveyId: S },
  },
  'surveyBuilder.read.completedResponses': {
    gate: 'rpc',
    capability: 'responses.view',
    input: { surveyId: S },
  },
  'surveyBuilder.read.responseById': {
    gate: 'rpc',
    capability: 'responses.view',
    input: { surveyId: S, responseId: C },
  },
  'surveyBuilder.read.responsesWithAnswers': {
    gate: 'rpc',
    capability: 'responses.view',
    input: { surveyId: S },
  },
  'surveyBuilder.read.surveyVersions': {
    gate: 'rpc',
    capability: 'survey.view',
    input: { surveyId: S },
  },
  'surveyBuilder.read.exportJson': {
    gate: 'rpc',
    capability: 'export.download',
    input: { surveyId: S },
  },
  'surveyBuilder.read.exportCsv': {
    gate: 'rpc',
    capability: 'export.download',
    input: { surveyId: S },
  },
  'surveyBuilder.read.variableCatalog': {
    gate: 'rpc',
    capability: 'survey.view',
    input: { surveyId: S },
  },

  // ── LUT · 테스트 표본 ───────────────────────────────────────────────────
  'surveyBuilder.lookups.copy': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, savedLookupId: C },
  },
  'surveyBuilder.lookups.upsert': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, lookup: { id: C, name: 'x', columns: [], rows: [] } },
  },
  'surveyBuilder.lookups.remove': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, surveyLookupId: C },
  },
  'surveyBuilder.testSample.get': {
    gate: 'rpc',
    capability: 'survey.view',
    input: { surveyId: S },
  },

  // ── 분석 ────────────────────────────────────────────────────────────────
  'analytics.stats.survey': { gate: 'rpc', capability: 'analytics.view', input: { surveyId: S } },
  'analytics.stats.question': {
    gate: 'rpc',
    capability: 'analytics.view',
    input: { surveyId: S, questionId: C },
  },
  'analytics.analyze.survey': { gate: 'rpc', capability: 'analytics.view', input: { surveyId: S } },

  // ── 컨택 ────────────────────────────────────────────────────────────────
  'contacts.targets.add': {
    gate: 'scoped',
    capability: 'contacts.manage',
    input: { surveyId: S, attrs: {} },
  },
  'contacts.targets.update': {
    gate: 'scoped',
    capability: 'contacts.manage',
    input: { surveyId: S, id: C, attrs: {} },
  },
  'contacts.targets.remove': {
    gate: 'rpc',
    capability: 'contacts.manage',
    input: { surveyId: S, id: C },
  },
  'contacts.targets.generateTest': {
    gate: 'rpc',
    capability: 'contacts.manage',
    input: { surveyId: S, count: 1, recipientEmail: 'ops@megaresearch.co.kr' },
  },
  'contacts.columns.update': {
    gate: 'rpc',
    capability: 'contacts.manage',
    input: { surveyId: S, scheme: { columns: [] } },
  },
  'contacts.columns.updateGroupLevels': {
    gate: 'rpc',
    capability: 'contacts.manage',
    input: { surveyId: S, levels: {} },
  },
  'contacts.uploads.ingest': {
    gate: 'rpc',
    capability: 'contacts.manage',
    input: { surveyId: S, file: xlsxFile(), mapping: {} },
  },
  'contacts.uploads.matchPreview': {
    gate: 'rpc',
    capability: 'contacts.manage',
    input: { surveyId: S, file: xlsxFile(), mapping: {} },
  },
  'contacts.uploads.existingCount': {
    gate: 'rpc',
    capability: 'contacts.manage',
    input: { surveyId: S },
  },
  'contacts.attempts.add': {
    gate: 'scoped',
    capability: 'contacts.writeAttempts',
    input: { surveyId: S, contactTargetId: C, resultCode: 'x' },
  },
  'contacts.attempts.update': {
    gate: 'scoped',
    capability: 'contacts.writeAttempts',
    input: { surveyId: S, contactTargetId: C, id: C, resultCode: 'x' },
  },
  'contacts.attempts.remove': {
    gate: 'scoped',
    capability: 'contacts.writeAttempts',
    input: { surveyId: S, contactTargetId: C, id: C },
  },
  'contacts.resultCodes.update': {
    gate: 'rpc',
    capability: 'contacts.manage',
    input: { surveyId: S, codes: [] },
  },
  'contacts.attrValues.list': {
    gate: 'scoped',
    capability: 'contacts.view',
    input: { surveyId: S, attrsKey: 'k' },
  },

  // ── 메일 ────────────────────────────────────────────────────────────────
  'mail.templates.create': {
    gate: 'scoped',
    capability: 'mail.send',
    input: { surveyId: S, input: MAIL_TEMPLATE_INPUT },
  },
  'mail.templates.update': {
    gate: 'scoped',
    capability: 'mail.send',
    input: { surveyId: S, templateId: C, input: MAIL_TEMPLATE_INPUT },
  },
  'mail.templates.remove': {
    gate: 'scoped',
    capability: 'mail.send',
    input: { surveyId: S, templateId: C },
  },
  'mail.preview.sample': {
    gate: 'scoped',
    capability: 'mail.view',
    input: { surveyId: S, contactTargetId: C },
  },
  'mail.preview.testSend': {
    gate: 'scoped',
    capability: 'mail.send',
    input: {
      surveyId: S,
      to: 'ops@megaresearch.co.kr',
      subject: '주입',
      bodyHtml: '<p>주입</p>',
      fromName: '메가리서치',
      fromLocal: 'no-reply',
      replyTo: 'ops@megaresearch.co.kr',
    },
  },
  'mail.campaigns.create': {
    gate: 'scoped',
    capability: 'mail.send',
    input: { surveyId: S, mailTemplateId: C, title: 'x', contactTargetIds: [C] },
  },
  'mail.campaigns.cancel': {
    gate: 'scoped',
    capability: 'mail.send',
    input: { surveyId: S, campaignId: C },
  },
  'mail.campaigns.resync': {
    gate: 'scoped',
    capability: 'mail.send',
    input: { surveyId: S, campaignId: C },
  },
  'mail.campaigns.fetchCandidateIds': {
    gate: 'scoped',
    capability: 'mail.send',
    input: { surveyId: S, filter: {} },
  },
  'mail.campaigns.previewPreflight': {
    gate: 'scoped',
    capability: 'mail.send',
    input: { surveyId: S, selectedContactIds: [C] },
  },
  'mail.campaigns.sendSingle': {
    gate: 'scoped',
    capability: 'mail.send',
    input: { surveyId: S, contactTargetId: C, mailTemplateId: C },
  },
  'mail.unsubscribe.revertByContactId': {
    gate: 'rpc',
    capability: 'contacts.manage',
    input: { surveyId: S, contactId: C },
  },

  // ── 응답 관리 ───────────────────────────────────────────────────────────
  'surveyResponse.edit.saveAdminEdit': {
    gate: 'scoped',
    capability: 'responses.view',
    input: { surveyId: S, responseId: C, questionResponses: {}, versionId: C },
  },
  'surveyResponse.manage.softDelete': {
    gate: 'rpc',
    capability: 'responses.view',
    input: { surveyId: S, responseId: C },
  },
  'surveyResponse.manage.restore': {
    gate: 'rpc',
    capability: 'responses.view',
    input: { surveyId: S, responseId: C },
  },
  'surveyResponse.manage.hardReset': {
    gate: 'rpc',
    capability: 'responses.view',
    input: { surveyId: S, responseId: C },
  },
  'surveyResponse.manage.allowReedit': {
    gate: 'rpc',
    capability: 'responses.view',
    input: { surveyId: S, responseId: C },
  },

  // ── 운영 제어 · 쿼터 ────────────────────────────────────────────────────
  'operations.progress.updateColumns': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, scheme: { columns: [] } },
  },
  'operations.profileColumns.updateColumns': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, scheme: { columns: [] } },
  },
  'operations.control.get': {
    gate: 'rpc',
    capability: 'operations.view',
    input: { surveyId: S },
    resolvesTo: null,
  },
  'operations.control.setPaused': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, isPaused: true },
  },
  'operations.control.setTestMode': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, enabled: true },
  },
  'operations.control.disable': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: { surveyId: S, disposition: 'keep' },
  },
  'quota.get': { gate: 'rpc', capability: 'operations.view', input: { surveyId: S } },
  'quota.save': {
    gate: 'rpc',
    capability: 'survey.edit',
    input: {
      surveyId: S,
      config: { enabled: false, dimensions: [], cells: [], closedMessage: null },
    },
  },

  // ── 설문 그룹(담기·이동) ────────────────────────────────────────────────
  'workspace.surveyGroups.collect': {
    gate: 'batch',
    capability: ['survey.edit', 'surveyGroup.manage'],
    input: { groupId: C, surveyIds: [S] },
  },
  'workspace.surveyGroups.move': {
    gate: 'batch',
    capability: ['survey.edit', 'surveyGroup.manage'],
    input: { surveyId: S, groupId: null },
  },

  // ── 설문 참여자 ─────────────────────────────────────────────────────────
  //
  // 초대는 팀 경계를 넘는 유일한 통로라(티켓 18) 이 스위트의 축이 특히 중요하다 —
  // 관문이 없으면 「남의 팀 설문에 나를 참여자로 추가」가 그대로 권한 상승이 된다.
  'workspace.participants.list': {
    gate: 'rpc',
    capability: 'survey.invite',
    input: { surveyId: S },
  },
  'workspace.participants.searchCandidates': {
    gate: 'rpc',
    capability: 'survey.invite',
    input: { surveyId: S, query: '' },
  },
  'workspace.participants.add': {
    gate: 'rpc',
    capability: 'survey.invite',
    input: { surveyId: S, userId: C },
  },
  'workspace.participants.remove': {
    gate: 'rpc',
    capability: 'survey.manageAccess',
    input: { surveyId: S, userId: C },
  },

  // ── 소유권 이전 ─────────────────────────────────────────────────────────
  'workspace.ownership.candidates': {
    gate: 'rpc',
    capability: 'survey.transferOwnership',
    input: { surveyId: S },
  },
  'workspace.ownership.transfer': {
    gate: 'rpc',
    capability: 'survey.transferOwnership',
    input: { surveyId: S, newOwnerUserId: C },
  },

  // ── 공유 설정(공개 범위) ────────────────────────────────────────────────
  'workspace.sharing.setVisibility': {
    gate: 'rpc',
    capability: 'survey.manageAccess',
    input: { surveyId: S, visibility: 'invite_only' },
  },
};

/**
 * 설문 id 를 받지만 설문 관문을 지지 **않는** 내부 표면 — 사유를 함께 적는다.
 *
 * 여기 새 항목을 더할 때는 "왜 관문이 없어도 되는가" 를 같은 줄에 쓸 것. 쓸 말이 없으면
 * 관문이 빠진 것이다.
 */
const GATE_EXEMPT: Record<string, string> = {
  'surveyBuilder.read.slugAvailable':
    'excludeSurveyId 는 대상 지목이 아니라 자기 슬러그 제외용 — 응답은 슬러그 가용 여부(boolean) 뿐이다',
};

/**
 * 설문을 지목하지만 `surveyId` 라는 이름으로 받지 않는 표면 — 자동 탐지가 못 잡는 자리다.
 *
 * 자동 탐지(`takesSurveyId`)는 입력 키 이름에 기댄다. 그래서 **키 이름이 다르거나**
 * (`id`·`excludeSurveyId`) **입력이 zod object 가 아니면**(z.custom) 목록에서 조용히
 * 빠진다. 조용히 빠지는 것이 이 스위트의 유일한 실패 방식이므로 여기 손으로 적고,
 * 아래 검사가 "비-object 입력을 가진 내부 표면" 전수와 대조해 새 사각지대를 막는다.
 */
const ALIASED_SURVEY_SURFACES: Record<string, string> = {
  'surveyBuilder.surveys.ensure': '빌더 자동 생성 입구라 설문 id 를 `id` 로 받는다',
  'surveyBuilder.save.saveWithDetails':
    '입력이 설문 문서 통째(z.custom)라 shape 이 없다 — 설문 id 는 그 안의 `id`',
  'surveyBuilder.read.slugAvailable': '`excludeSurveyId` — 지목이 아니라 자기 제외용',
};

/**
 * 설문이 아닌 **다른 경계**가 지키는 내부 표면 — 하위 id 는 받지만 설문 id 는 안 받는다.
 *
 * 자동 탐지는 `surveyId`·`surveyIds` 키만 본다. 그래서 「object 입력 + 하위 id 만」인 표면은
 * 목록에서 조용히 빠지고, 그것을 잡는 검사도 없었다(비-object 입력만 대조했다). 오늘 그런
 * 표면이 설문 경계를 필요로 하지 않는 것은 사실이지만 **그건 우연이지 게이트가 지켜준 것이
 * 아니었다** — 여기에 적어 두면 새 표면은 사유 없이는 들어올 수 없다.
 *
 * 사유는 「무엇이 대신 지키는가」여야 한다. 쓸 말이 없으면 설문 관문이 빠진 것이다.
 */
const OTHER_BOUNDARY_SURFACES: Record<string, string> = {
  'workspace.surveyGroups.rename': '그룹의 소유 팀으로 판정 — 타 팀 그룹은 NOT_FOUND 로 접힌다',
  'workspace.surveyGroups.remove': '위와 같음',
  'workspace.surveyGroups.reorder': '입력 teamId 로 그룹 구조 관문을 지난다',
  'library.savedQuestions.update': '보관함은 조직 공용이라 설문 경계가 없다',
  'library.savedQuestions.remove': '보관함 — 조직 공용',
  'library.savedQuestions.apply': '보관함 — 조직 공용',
  'library.savedQuestions.applyMultiple': '보관함 — 조직 공용',
  'library.savedLookups.update': '보관함 — 조직 공용',
  'library.savedLookups.remove': '보관함 — 조직 공용',
  'library.savedCells.remove': '보관함 — 조직 공용',
  'library.savedCells.apply': '보관함 — 조직 공용',
  'library.questionCategories.update': '보관함 분류 — 조직 공용',
  'library.questionCategories.remove': '보관함 분류 — 조직 공용',
  'media.fileCleanup.cancel': 'R2 유예 삭제 큐 — 설문이 아니라 키 단위 전역 자원',
  'mail.billing.deleteLatest': '메일 비용 정산 — 설문 스코프가 아닌 전역 장부',
};

/**
 * 팀 경계를 지목하지만 설문은 안 받는 표면 — 이 스위트의 축이 아니다.
 *
 * 팀 관리·멤버십은 `assertTeamManager`(입력 teamId 로 판정)와 서비스의 대상 소속 재확인이
 * 지키고, 그쪽 음성 테스트는 teams·members 의 colocated 테스트와 teams-membership.realdb 다.
 */
const TEAM_SCOPE_KEYS = new Set(['teamId', 'userId']);

/**
 * 응답자(pub) 표면 — 인증 자체가 없으므로 팀 경계가 아니라 토큰·설문 공개 여부가 자격이다.
 *
 * 이 목록은 "관문이 없다" 를 승인하는 자리가 아니라 **분류를 고정하는 자리**다. 새 procedure
 * 가 pub 으로 열리면 여기 등재를 강요받아 리뷰에 걸린다.
 */
const RESPONDENT_SURFACES = new Set([
  'surveyBuilder.publicRead.forResponse',
  'contacts.attrs.lookup',
  'surveyResponse.response.createWithFirstAnswer',
  'surveyResponse.response.createBlank',
  'surveyResponse.lifecycle.resume',
  'surveyResponse.duplicate.checkOnEntry',
  'quota.check',
]);

/** 슈퍼어드민 전용 표면 — 팀 경계가 아니라 전역 권한 축이라 이 스위트의 대상이 아니다. */
const SUPERADMIN_SURVEY_SURFACES = new Set([
  'workspace.reassignment.pendingSurvey',
  'workspace.reassignment.assignSurveys',
  // 삭제 취소(티켓 17) — capability 관문을 쓸 수 없다. 코어가 삭제된 설문을 조회 단계에서
  // 걸러 언제나 not_found 를 주기 때문이고, 그 필터를 느슨하게 하면 「삭제는 안 보인다」가
  // 무너진다. 그래서 이 표면만 판정 축이 팀이 아니라 전역 권한이다.
  'surveyBuilder.surveys.restore',
]);

// ─────────────────────────────────────────────────────────────────────────────
// 호출 준비
// ─────────────────────────────────────────────────────────────────────────────

const client = createRouterClient(router, {
  context: internalActorContext({ id: ACTOR_ID, name: 'A팀 팀원' }),
});

/** 점으로 이은 경로를 따라 클라이언트의 호출 함수를 꺼낸다. */
function callerFor(path: string): (input: unknown) => Promise<unknown> {
  const fn = path
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown>)[key],
      client as unknown,
    );
  if (typeof fn !== 'function') throw new Error(`호출할 수 없는 경로: ${path}`);
  return fn as (input: unknown) => Promise<unknown>;
}

const procedures = enumerateProcedures();
const byPath = new Map<string, ProcedureEntry>(procedures.map((p) => [p.path, p]));

/**
 * 라우터가 말하는 "설문을 지목하는 내부 표면" 전수.
 *
 * 자동 탐지(입력 키)에 별칭 목록을 더한다 — 별칭 쪽은 손으로 적되, 아래 인벤토리 검사가
 * 그 목록을 라우터와 대조하므로 유령·누락이 남지 않는다.
 */
const internalSurveySurfaces = [
  ...new Set([
    ...procedures.filter((p) => isInternalBase(p.base) && takesSurveyId(p)).map((p) => p.path),
    ...Object.keys(ALIASED_SURVEY_SURFACES),
  ]),
].sort();

beforeEach(() => {
  vi.mocked(gate.assertSurveyCapabilityRpc).mockClear();
  vi.mocked(gate.assertScopedSurveyCapabilityRpc).mockClear();
  vi.mocked(gate.assertSurveyCapabilityBatchRpc).mockClear();
  vi.mocked(accessCore.assertSurveyCapability).mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// 인벤토리 검사 — 목록의 출처가 사람이 아니라 라우터임을 못 박는다
// ─────────────────────────────────────────────────────────────────────────────

describe('표면 인벤토리 (라우터 열거)', () => {
  it('열거기가 실제로 라우터를 훑는다', () => {
    // 정규식·프로퍼티 이름이 어긋나 0건이 되면 아래 검사가 통째로 무의미해진다.
    expect(procedures.length).toBeGreaterThan(100);
    expect(new Set(procedures.map((p) => p.base))).toEqual(
      new Set(['pub', 'authed', 'superadmin', 'account', 'scoped']),
    );
  });

  it('설문 id 를 받는 내부 표면은 전부 인벤토리에 있다 — 누락 없음', () => {
    const declared = new Set([...Object.keys(SURFACES), ...Object.keys(GATE_EXEMPT)]);
    const missing = internalSurveySurfaces.filter((path) => !declared.has(path));
    expect(missing, '새 표면이 붙었다면 SURFACES 또는 GATE_EXEMPT 에 등재할 것').toEqual([]);
  });

  it('인벤토리에 유령 항목이 없다 — 사라진 표면은 함께 지운다', () => {
    const live = new Set(internalSurveySurfaces);
    const stale = [...Object.keys(SURFACES), ...Object.keys(GATE_EXEMPT)].filter(
      (path) => !live.has(path),
    );
    expect(stale).toEqual([]);
  });

  it('별칭 목록은 실재하는 표면만 담는다', () => {
    for (const path of Object.keys(ALIASED_SURVEY_SURFACES)) {
      expect(byPath.get(path), `${path} 가 사라졌다면 별칭 목록에서도 지울 것`).toBeDefined();
    }
  });

  it('하위 id 만 받는 내부 표면은 전부 사유와 함께 등재돼 있다', () => {
    // 자동 탐지가 못 보는 두 번째 사각지대. 「id 로 끝나는 키를 받는데 설문 id 는 없는」
    // 내부 표면이 새로 생기면 여기서 걸려 사유 등재를 강요받는다.
    const childIdKey = /^ids?$|Ids?$/;
    const unexplained = procedures
      .filter((p) => isInternalBase(p.base) && p.hasObjectInput && !takesSurveyId(p))
      .filter((p) =>
        p.inputKeys.some((key) => childIdKey.test(key) && !TEAM_SCOPE_KEYS.has(key)),
      )
      .map((p) => p.path)
      .filter((path) => !(path in OTHER_BOUNDARY_SURFACES) && !(path in ALIASED_SURVEY_SURFACES));
    expect(unexplained).toEqual([]);
  });

  it('그 목록도 유령을 담지 않는다', () => {
    for (const path of Object.keys(OTHER_BOUNDARY_SURFACES)) {
      expect(byPath.get(path), `${path} 가 사라졌다면 목록에서도 지울 것`).toBeDefined();
    }
  });

  it('목이 외래 설문 행을 실제로 돌려준다 — 「없는 설문」으로 초록이 된 것이 아니다', async () => {
    // 이 스위트의 유일한 실패 방식은 조용한 거짓 초록이다: db 목이 surveys 를 못 찾으면
    // 관문 유무와 무관하게 전 표면이 NOT_FOUND 가 된다. 같은 행을 슈퍼어드민이 보면
    // 권한이 서고 A팀 팀원이 보면 안 선다는 **대비**가 「팀 경계를 쟀다」는 증거다.
    const asSuperadmin = await accessCore.loadSurveyCapabilities(
      { id: '3a000000-0000-4000-8000-00000000ad01', isSuperadmin: true, userType: 'internal' },
      FOREIGN_SURVEY_ID,
    );
    expect(asSuperadmin.size).toBeGreaterThan(0);

    const asMember = await accessCore.loadSurveyCapabilities(
      { id: ACTOR_ID, isSuperadmin: false, userType: 'internal' },
      FOREIGN_SURVEY_ID,
    );
    expect(asMember.size).toBe(0);
  });

  it('입력 키로 탐지할 수 없는 내부 표면은 전부 별칭 목록에 있다 — 사각지대 봉인', () => {
    // 입력이 zod object 가 아니면 shape 이 없어 자동 탐지가 통째로 눈을 감는다.
    // (입력이 아예 없는 표면은 설문을 지목할 방법 자체가 없으므로 사각지대가 아니다.)
    // 그런 표면이 새로 생기면 여기서 걸려 별칭 목록 등재를 강요받는다.
    const opaque = procedures
      .filter((p) => isInternalBase(p.base) && p.hasInputSchema && !p.hasObjectInput)
      .map((p) => p.path)
      .filter((path) => !(path in ALIASED_SURVEY_SURFACES));
    expect(opaque).toEqual([
      // 설문과 무관한 보관함·정리 표면 — 목록 필터·페이지네이션 입력이다.
      'library.savedLookups.list',
      'media.fileCleanup.listPending',
      'media.fileCleanup.listHistory',
    ]);
  });

  it('설문 id 를 받는 pub·superadmin 표면도 분류가 고정돼 있다', () => {
    const others = procedures
      .filter((p) => !isInternalBase(p.base) && takesSurveyId(p))
      .map((p) => p.path)
      .sort();
    expect(others).toEqual(
      [...RESPONDENT_SURFACES, ...SUPERADMIN_SURVEY_SURFACES].sort(),
    );
  });

  it('scoped 베이스는 설문 관문 없이 쓰이지 않는다 — 유일한 예외만 남는다', () => {
    const scopedWithoutSurvey = procedures
      .filter((p) => p.base === 'scoped' && !takesSurveyId(p))
      .map((p) => p.path);
    // tmp 네임스페이스 검증에 의존하는 표면 하나(orpc.ts 주석).
    expect(scopedWithoutSurvey).toEqual(['media.deleteMailAttachmentTmp']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 음성 스위트 — 타 팀 설문 id 주입
// ─────────────────────────────────────────────────────────────────────────────

describe('타 팀 설문 id 주입은 전 표면에서 NOT_FOUND 다', () => {
  for (const [path, spec] of Object.entries(SURFACES)) {
    it(path, async () => {
      const entry = byPath.get(path);
      expect(entry, '인벤토리 항목이 라우터에 없다').toBeDefined();

      if ('resolvesTo' in spec) {
        await expect(callerFor(path)(spec.input)).resolves.toEqual(spec.resolvesTo);
      } else {
        await expect(callerFor(path)(spec.input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }

      if (spec.gate === 'rpc') {
        expect(gate.assertSurveyCapabilityRpc).toHaveBeenCalledWith(
          expect.objectContaining({ id: ACTOR_ID }),
          FOREIGN_SURVEY_ID,
          spec.capability,
        );
      } else if (spec.gate === 'scoped') {
        expect(gate.assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
          expect.objectContaining({ id: ACTOR_ID }),
          FOREIGN_SURVEY_ID,
          spec.capability,
        );
      } else if (spec.gate === 'batch') {
        expect(gate.assertSurveyCapabilityBatchRpc).toHaveBeenCalledWith(
          expect.objectContaining({ id: ACTOR_ID }),
          [FOREIGN_SURVEY_ID],
          spec.capability,
        );
      } else {
        // 관문이 서비스 안에 있는 경로 — 코어를 직접 물어본다. 결과(NOT_FOUND)만 보면
        // 요구를 survey.edit → survey.view 로 약화해도 스위트가 통과한다.
        expect(accessCore.assertSurveyCapability).toHaveBeenCalledWith(
          expect.objectContaining({ id: ACTOR_ID }),
          FOREIGN_SURVEY_ID,
          spec.capability,
        );
      }
    });
  }
});
