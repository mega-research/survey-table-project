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
vi.mock(
  '@/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/admin-response-editor',
  () => ({
    AdminResponseEditor: () => null,
  }),
);

import AdminResponseEditPage from '@/app/admin/surveys/[id]/operations/profiles/[responseId]/edit/page';

describe('AdminResponseEditPage contact scope', () => {
  function findInitialContactAttrs(node: unknown): Record<string, unknown> | null {
    if (Array.isArray(node)) {
      for (const child of node) {
        const attrs = findInitialContactAttrs(child);
        if (attrs) return attrs;
      }
      return null;
    }
    if (node == null || typeof node !== 'object' || !('props' in node)) return null;
    const props = (node as { props: Record<string, unknown> }).props;
    if ('initialContactAttrs' in props) {
      return props['initialContactAttrs'] as Record<string, unknown>;
    }
    return findInitialContactAttrs(props['children']);
  }

  it('같은 test scope라도 다른 설문의 contact attrs를 응답 편집기에 전달하지 않는다', async () => {
    const rendered = await AdminResponseEditPage({
      params: Promise.resolve({ id: SURVEY_ID, responseId: RESPONSE_ID }),
      searchParams: Promise.resolve({}),
    });

    expect(findInitialContactAttrs(rendered)).toEqual({});
  });
});
