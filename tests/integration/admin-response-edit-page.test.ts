import { describe, expect, it, vi } from 'vitest';
import { extractRawSql } from './_helpers/result-code-mock';

const SURVEY_ID = '00000000-0000-4000-8000-000000000051';
const OTHER_SURVEY_ID = '00000000-0000-4000-8000-000000000052';
const RESPONSE_ID = '00000000-0000-4000-8000-000000000053';
const CONTACT_ID = '00000000-0000-4000-8000-000000000054';

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
// 이 테스트의 관심사는 컨택 스코프 격리다. 페이지를 요청 스코프 밖에서 직접 부르므로
// headers() 를 쓰는 진입 관문(티켓 10 의 콘솔 페이지 관문)은 통과시켜 두고 스코프 관심사만
// 본다 — 관문 자체는 src/server/page-survey-access.test.ts 가 본다.
vi.mock('@/server/page-survey-access', () => ({
  assertSurveyConsolePageAccess: vi.fn(async () => ({
    id: 'u-1',
    isSuperadmin: false,
    userType: 'internal',
  })),
}));
vi.mock('@/server/read-models/responses', () => ({
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
vi.mock('@/server/data-scope', () => ({
  getOperationsDataScope: vi.fn(async () => 'real'),
  testFlagForScope: vi.fn(() => false),
}));
vi.mock('@/server/operations/services/profiles', () => ({
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
vi.mock('@/server/contacts/services/contact-prior-answers', () => ({
  lookupPriorAnswersByContactTarget: vi.fn(async () => null),
}));
vi.mock('@/app/_operations/admin-response-editor', () => ({
  AdminResponseEditor: () => null,
}));

import { lookupPriorAnswersByContactTarget } from '@/server/contacts/services/contact-prior-answers';

import { ResponseEditScreen } from '@/app/_operations/response-edit-screen';

// 본문은 내부 콘솔과 외주 링크 트리가 함께 쓴다(ADR-0027) — 스코프 격리는 본문의 계약이다.
function renderScreen() {
  return ResponseEditScreen({
    surveyId: SURVEY_ID,
    responseId: RESPONSE_ID,
    basePath: `/surveys/${SURVEY_ID}/operations`,
    scope: 'real' as never,
    idx: null,
  });
}

describe('ResponseEditScreen contact scope', () => {
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
    const rendered = await renderScreen();

    const props = findEditorProps(rendered);
    expect(props?.['initialContactAttrs']).toEqual({});
    // 미배포 설문(surveys.currentVersionId=null, mock 기본값) — 이관 대상 아님.
    expect(props?.['renderedVersionId']).toBeNull();
    expect(props?.['migratedFromOldVersion']).toBe(false);
  });

  it('이월 응답 조회도 이 설문·이 파티션으로 못 박아 부른다', async () => {
    await renderScreen();

    expect(vi.mocked(lookupPriorAnswersByContactTarget)).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      contactTargetId: CONTACT_ID,
      isTest: false,
    });
  });
});
