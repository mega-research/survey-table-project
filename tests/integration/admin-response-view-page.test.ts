import { FIELDWORK_SHARE_ALL } from '@/server/fieldwork-share-scope';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SURVEY_ID = '00000000-0000-4000-8000-000000000061';
const RESPONSE_ID = '00000000-0000-4000-8000-000000000063';
const CONTACT_ID = '00000000-0000-4000-8000-000000000064';
const VERSION_ID = '00000000-0000-4000-8000-000000000065';

const { getResponseByIdMock } = vi.hoisted(() => ({ getResponseByIdMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/server/read-models/responses', () => ({ getResponseById: getResponseByIdMock }));
vi.mock('@/server/data-scope', () => ({
  getOperationsDataScope: vi.fn(async () => 'real'),
  testFlagForScope: vi.fn((scope: string) => scope === 'test'),
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
      surveys: {
        findFirst: vi.fn(async () => ({ currentVersionId: VERSION_ID, testVersionId: VERSION_ID })),
      },
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
vi.mock('@/app/_operations/admin-response-editor', () => ({
  AdminResponseEditor: () => null,
}));

import { loadRespondentContactAttrs } from '@/server/read-models/respondent-contact-attrs';
import { ensureTestVersion } from '@/server/workflows/test-version';

import { ResponseEditScreen } from '@/app/_operations/response-edit-screen';

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

function responseRow(over: Record<string, unknown> = {}) {
  return {
    id: RESPONSE_ID,
    surveyId: SURVEY_ID,
    isTest: false,
    deletedAt: null,
    versionId: VERSION_ID,
    contactTargetId: CONTACT_ID,
    questionResponses: { q1: '답' },
    ...over,
  };
}

function renderScreen(over: { readOnly?: boolean; scope?: 'real' | 'test' } = {}) {
  return ResponseEditScreen({
    surveyId: SURVEY_ID,
    responseId: RESPONSE_ID,
    basePath: `/surveys/${SURVEY_ID}/operations`,
    scope: (over.scope ?? 'real') as never,
    share: FIELDWORK_SHARE_ALL,
    idx: 3,
    ...(over.readOnly === undefined ? {} : { readOnly: over.readOnly }),
  });
}

/**
 * 응답 수정 본문의 조회 전용 모드 — 운영(main)의 「응답 조회」 화면 본문이다. 보는 사람이 내부 직원이
 * 아닐 수 있어, 브라우저로 나가는 명단 개인정보는 그리는 설문이 실제로 읽는 열로 좁히고 아무것도 쓰지
 * 않는다(2026-11-16 Codex 리뷰: 수정 화면의 로더를 그대로 쓰면 화면에 쓰지도 않는 연락처가 RSC props 로
 * 나간다). 이 브랜치에는 이 모드를 여는 라우트가 아직 없다 — 본문의 계약만 여기서 지킨다.
 */
describe('ResponseEditScreen — 조회 전용', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getResponseByIdMock.mockResolvedValue(responseRow());
  });

  it('편집기를 조회 전용으로 그린다', async () => {
    const props = findEditorProps(await renderScreen({ readOnly: true }));
    expect(props?.['readOnly']).toBe(true);
    expect(props?.['idx']).toBe(3);
  });

  it('명단 개인정보는 설문이 읽는 열만 싣도록 좁혀 읽는다', async () => {
    await renderScreen({ readOnly: true });

    const call = vi.mocked(loadRespondentContactAttrs).mock.calls[0];
    expect(call?.[0]).toBe(CONTACT_ID);
    const allowed = await call?.[2]?.allowedKeys?.();
    expect(allowed && [...allowed]).toEqual(['사업자등록번호']);
  });

  it('테스트 응답이어도 테스트 버전을 맞추지 않는다 — 조회는 아무것도 쓰지 않는다', async () => {
    getResponseByIdMock.mockResolvedValue(responseRow({ isTest: true }));
    await renderScreen({ readOnly: true, scope: 'test' });
    expect(vi.mocked(ensureTestVersion)).not.toHaveBeenCalled();

    await renderScreen({ scope: 'test' });
    expect(vi.mocked(ensureTestVersion)).toHaveBeenCalledWith(SURVEY_ID);
  });

  it('삭제된 응답은 없는 응답으로 다룬다', async () => {
    getResponseByIdMock.mockResolvedValue(responseRow({ deletedAt: new Date() }));
    await expect(renderScreen({ readOnly: true })).rejects.toThrow('NEXT_NOT_FOUND');
    // 수정 화면은 복원 안내를 그린다
    await expect(renderScreen()).resolves.toBeTruthy();
  });

  it('수정 화면은 종전대로 좁히지 않는다 — 서버 재평가와 같은 값을 본다', async () => {
    const rendered = await renderScreen();

    expect(findEditorProps(rendered)?.['readOnly']).toBe(false);
    const call = vi.mocked(loadRespondentContactAttrs).mock.calls[0];
    expect(call).toEqual([CONTACT_ID]);
  });
});
