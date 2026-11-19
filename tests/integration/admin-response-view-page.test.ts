import { beforeEach, describe, expect, it, vi } from 'vitest';

const SURVEY_ID = '00000000-0000-4000-8000-000000000061';
const RESPONSE_ID = '00000000-0000-4000-8000-000000000063';
const CONTACT_ID = '00000000-0000-4000-8000-000000000064';
const VERSION_ID = '00000000-0000-4000-8000-000000000065';

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
// 페이지 진입 가드의 판정은 require-survey-console-page.test.ts 가 고정한다 — 여기서는 부른 정책만 본다.
vi.mock('@/lib/auth/require-survey-console-page', () => ({
  requireSurveyConsolePage: vi.fn(async () => ({ id: 'client-1' })),
}));
vi.mock('@/lib/auth/require-survey-ownership', () => ({
  requireSurveyOwnership: vi.fn(),
}));
vi.mock('@/server/read-models/responses', () => ({
  getResponseById: vi.fn(async () => ({
    id: RESPONSE_ID,
    surveyId: SURVEY_ID,
    isTest: false,
    deletedAt: null,
    versionId: VERSION_ID,
    contactTargetId: CONTACT_ID,
    questionResponses: { q1: '답' },
  })),
}));
vi.mock('@/server/data-scope', () => ({
  getOperationsDataScope: vi.fn(async () => 'real'),
  testFlagForScope: vi.fn(() => false),
}));
vi.mock('@/server/operations/services/profiles', () => ({
  isResponseExcluded: vi.fn(async () => false),
}));
vi.mock('@/server/workflows/test-version', () => ({ ensureTestVersion: vi.fn() }));
vi.mock('@/server/survey-builder/services/survey-read', () => ({
  buildDocumentView: vi.fn(async () => null),
}));
vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: { findFirst: vi.fn(async () => ({ currentVersionId: VERSION_ID })) },
      surveyVersions: {
        findFirst: vi.fn(async () => ({
          id: VERSION_ID,
          // 설문이 읽는 명단 값은 사업자등록번호 하나다 — 토큰으로.
          snapshot: {
            title: '설문',
            questions: [{ id: 'q1', type: 'text', title: '{{사업자등록번호}} 확인', order: 0 }],
            groups: [],
          },
        })),
      },
      contactTargets: { findFirst: vi.fn(async () => ({ id: CONTACT_ID })) },
    },
  },
}));
vi.mock('@/server/read-models/contact-prior-answers', () => ({
  lookupPriorAnswersByContactTarget: vi.fn(async () => null),
}));
vi.mock('@/server/read-models/respondent-contact-attrs', () => ({
  loadRespondentContactAttrs: vi.fn(async () => ({ 업소명: '메가유업' })),
}));
vi.mock(
  '@/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/admin-response-editor',
  () => ({ AdminResponseEditor: () => null }),
);

import { requireSurveyConsolePage } from '@/lib/auth/require-survey-console-page';
import { loadRespondentContactAttrs } from '@/server/read-models/respondent-contact-attrs';
import { ensureTestVersion } from '@/server/workflows/test-version';

import AdminResponseEditPage from '@/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/page';
import AdminResponseViewPage from '@/app/admin/surveys/[id]/operations/profiles/[responseId]/view/page';

function findEditorProps(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const props = findEditorProps(child);
      if (props) return props;
    }
    return null;
  }
  if (node == null || typeof node !== 'object' || !('props' in node)) return null;
  const props = (node as { props: Record<string, unknown> }).props;
  if ('initialContactAttrs' in props) return props;
  return findEditorProps(props['children']);
}

const pageArgs = {
  params: Promise.resolve({ id: SURVEY_ID, responseId: RESPONSE_ID }),
  searchParams: Promise.resolve({ idx: '3' }),
};

/**
 * 응답 조회 화면 — 보는 사람이 고객 계정일 수 있어, 브라우저로 나가는 명단 개인정보는 그리는 설문이
 * 실제로 읽는 열로 좁힌다(2026-11-16 Codex 리뷰: 수정 화면의 로더를 그대로 쓰면 화면에 쓰지도 않는
 * 연락처가 RSC props 로 나간다).
 */
describe('AdminResponseViewPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('응답 조회 정책으로 가드를 부르고 편집기를 조회 전용으로 그린다', async () => {
    const rendered = await AdminResponseViewPage(pageArgs);

    expect(vi.mocked(requireSurveyConsolePage)).toHaveBeenCalledWith(SURVEY_ID, {
      viewOnly: 'responseViewGrant',
      share: 'allow',
    });
    const props = findEditorProps(rendered);
    expect(props?.['readOnly']).toBe(true);
    expect(props?.['idx']).toBe(3);
    expect(vi.mocked(ensureTestVersion)).not.toHaveBeenCalled();
  });

  it('명단 개인정보는 설문이 읽는 열만 싣도록 좁혀 읽는다', async () => {
    await AdminResponseViewPage(pageArgs);

    const call = vi.mocked(loadRespondentContactAttrs).mock.calls[0];
    expect(call?.[0]).toBe(CONTACT_ID);
    const allowed = await call?.[2]?.allowedKeys?.();
    expect(allowed && [...allowed]).toEqual(['사업자등록번호']);
  });

  it('수정 화면은 종전대로 좁히지 않는다 — 서버 재평가와 같은 값을 본다', async () => {
    const rendered = await AdminResponseEditPage(pageArgs);

    expect(findEditorProps(rendered)?.['readOnly']).toBe(false);
    const call = vi.mocked(loadRespondentContactAttrs).mock.calls[0];
    expect(call).toEqual([CONTACT_ID]);
  });
});
