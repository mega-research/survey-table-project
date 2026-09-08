import { describe, expect, it, vi } from 'vitest';
import { extractRawSql } from '../../integration/_helpers/result-code-mock';

const SURVEY_ID = '00000000-0000-4000-8000-000000000051';
const OTHER_SURVEY_ID = '00000000-0000-4000-8000-000000000052';
const RESPONSE_ID = '00000000-0000-4000-8000-000000000053';
const CONTACT_ID = '00000000-0000-4000-8000-000000000054';

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/lib/auth/require-survey-ownership', () => ({
  requireSurveyOwnership: vi.fn(),
}));
vi.mock('@/data/responses', () => ({
  getResponseById: vi.fn(async () => ({
    id: RESPONSE_ID,
    surveyId: SURVEY_ID,
    isTest: false,
    deletedAt: null,
    versionId: null,
    contactTargetId: CONTACT_ID,
    questionResponses: {},
  })),
}));
vi.mock('@/lib/operations/data-scope.server', () => ({
  getOperationsDataScope: vi.fn(async () => 'real'),
  testFlagForScope: vi.fn(() => false),
}));
vi.mock('@/lib/operations/profiles.server', () => ({
  isResponseExcluded: vi.fn(async () => false),
}));
vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: { findFirst: vi.fn(async () => ({ currentVersionId: null })) },
      surveyVersions: { findFirst: vi.fn(async () => null) },
      contactTargets: {
        findFirst: vi.fn(async ({ where }: { where: unknown }) => {
          const raw = extractRawSql(where);
          return raw.includes(SURVEY_ID)
            ? null
            : { attrs: { survey: OTHER_SURVEY_ID, leaked: 'foreign' } };
        }),
      },
    },
  },
}));
// 이월 표시(빨강)용 조회 — 이 파일이 지키는 것은 스코프이지 이월 값이 아니므로 서비스는
// 대역으로 두고, 호출 인자만 본다(같은 종류의 누출이 이 경로로도 날 수 있다).
vi.mock('@/features/contacts/server/services/contact-prior-answers.service', () => ({
  lookupPriorAnswersByContactTarget: vi.fn(async () => null),
}));
vi.mock(
  '@/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/admin-response-editor',
  () => ({
    AdminResponseEditor: () => null,
  }),
);

import { lookupPriorAnswersByContactTarget } from '@/features/contacts/server/services/contact-prior-answers.service';

import AdminResponseEditPage from '@/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/page';

describe('AdminResponseEditPage contact scope', () => {
  // AdminResponseEditor 로 전달되는 props 전체를 찾는다 — initialContactAttrs 는
  // 이 컴포넌트에만 있는 고유 prop 이라 이 컴포넌트 노드 식별자로도 재사용한다.
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
    if ('initialContactAttrs' in props) {
      return props;
    }
    return findEditorProps(props['children']);
  }

  it('같은 test scope라도 다른 설문의 contact attrs를 응답 편집기에 전달하지 않는다', async () => {
    const rendered = await AdminResponseEditPage({
      params: Promise.resolve({ id: SURVEY_ID, responseId: RESPONSE_ID }),
      searchParams: Promise.resolve({}),
    });

    const props = findEditorProps(rendered);
    expect(props?.['initialContactAttrs']).toEqual({});
    // 미배포 설문(surveys.currentVersionId=null, mock 기본값) — 이관 대상 아님.
    expect(props?.['renderedVersionId']).toBeNull();
    expect(props?.['migratedFromOldVersion']).toBe(false);
  });

  it('이월 응답 조회도 이 설문·이 파티션으로 못 박아 부른다', async () => {
    await AdminResponseEditPage({
      params: Promise.resolve({ id: SURVEY_ID, responseId: RESPONSE_ID }),
      searchParams: Promise.resolve({}),
    });

    expect(vi.mocked(lookupPriorAnswersByContactTarget)).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      contactTargetId: CONTACT_ID,
      isTest: false,
    });
  });
});
