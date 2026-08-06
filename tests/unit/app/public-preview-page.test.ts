import { beforeEach, describe, expect, it, vi } from 'vitest';

// notFound() 는 실제 Next.js 에서 렌더를 즉시 중단시키는 throw 다 — 페이지 이후 코드가
// idRow/survey 를 null-check 없이 계속 쓰는 계약(admin preview 와 동일 패턴)을 재현하려면
// mock 도 반드시 throw 해야 한다. vi.mock factory 는 호이스팅되므로 참조 변수는
// vi.hoisted 로 감싼다(test-mode-control.test.tsx 의 refreshMock 과 동일 관행).
const { notFoundMock, getSurveyByPrivateTokenMock, getSurveyByIdMock, getSurveyForResponseMock } =
  vi.hoisted(() => ({
    notFoundMock: vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
    }),
    getSurveyByPrivateTokenMock: vi.fn(),
    getSurveyByIdMock: vi.fn(),
    getSurveyForResponseMock: vi.fn(),
  }));

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

vi.mock('@/features/survey-builder/server/services/survey-read.service', () => ({
  getSurveyByPrivateToken: (...a: unknown[]) => getSurveyByPrivateTokenMock(...a),
  getSurveyById: (...a: unknown[]) => getSurveyByIdMock(...a),
  getSurveyForResponse: (...a: unknown[]) => getSurveyForResponseMock(...a),
}));

function SurveyResponseFlowStub(): null {
  return null;
}
vi.mock('@/components/survey-response/survey-response-flow', () => ({
  SurveyResponseFlow: SurveyResponseFlowStub,
}));

import PublicSurveyPreviewPage from '@/app/preview/[token]/page';

const SURVEY_ID = '00000000-0000-4000-8000-000000000901';
const PRIVATE_TOKEN = '11111111-2222-4333-8444-555555555555';
const SURVEY_ROW = {
  id: SURVEY_ID,
  privateToken: PRIVATE_TOKEN,
  slug: 'my-public-slug',
  deletedAt: null,
};

type ElementLike = { type: unknown; props?: Record<string, unknown> };

function isElementLike(node: unknown): node is ElementLike {
  return node != null && typeof node === 'object' && 'type' in node;
}

// admin-response-edit-page.test.ts 의 findInitialContactAttrs 와 동일한 재귀 트리 탐색 —
// RSC 가 반환한 React element 트리에서 특정 type 의 노드를 찾는다.
function findElementByType(node: unknown, target: unknown): ElementLike | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByType(child, target);
      if (found) return found;
    }
    return null;
  }
  if (!isElementLike(node)) return null;
  if (node.type === target) return node;
  const children = node.props?.['children'];
  return children === undefined ? null : findElementByType(children, target);
}

function flattenText(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string') {
    acc.push(node);
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) flattenText(child, acc);
    return acc;
  }
  if (isElementLike(node)) {
    const children = node.props?.['children'];
    if (children !== undefined) flattenText(children, acc);
  }
  return acc;
}

describe('PublicSurveyPreviewPage (/preview/[token])', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('유효한 privateToken은 해당 설문을 resolve해 SurveyResponseFlow를 preview 모드로 렌더한다', async () => {
    getSurveyByPrivateTokenMock.mockResolvedValue({ id: SURVEY_ID });
    getSurveyByIdMock.mockResolvedValue(SURVEY_ROW);
    const previewSurvey = { id: SURVEY_ID, title: '테스트 설문' };
    getSurveyForResponseMock.mockResolvedValue({ survey: previewSurvey, versionId: 'v1' });

    const result = await PublicSurveyPreviewPage({
      params: Promise.resolve({ token: PRIVATE_TOKEN }),
    });

    expect(getSurveyByPrivateTokenMock).toHaveBeenCalledWith({ token: PRIVATE_TOKEN });
    expect(getSurveyByIdMock).toHaveBeenCalledWith(SURVEY_ID);
    expect(getSurveyForResponseMock).toHaveBeenCalledWith(
      { surveyId: SURVEY_ID },
      { requirePublished: true },
    );
    expect(notFoundMock).not.toHaveBeenCalled();

    const flow = findElementByType(result, SurveyResponseFlowStub);
    expect(flow).not.toBeNull();
    expect(flow?.props?.['mode']).toBe('preview');
    // surveyIdentifier 는 내부 UUID(survey.id) 가 아니라 privateToken 을 그대로 넘긴다 —
    // preview 모드는 use-survey-loader 의 isPreview 분기가 previewContext 로 즉시 렌더/리턴
    // 하므로 identifier 는 재사용되지 않는다(parsesurveyIdentifier 미도달). id 를 클라이언트에
    // 노출할 이유가 없다.
    expect(flow?.props?.['surveyIdentifier']).toBe(PRIVATE_TOKEN);
    expect(flow?.props?.['previewContext']).toEqual({ survey: previewSurvey, versionId: 'v1' });
  });

  it('알 수 없는 token은 404 처리하고 이후 조회를 진행하지 않는다', async () => {
    getSurveyByPrivateTokenMock.mockResolvedValue(undefined);

    await expect(
      PublicSurveyPreviewPage({ params: Promise.resolve({ token: 'unknown-token' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(getSurveyByPrivateTokenMock).toHaveBeenCalledWith({ token: 'unknown-token' });
    expect(getSurveyByIdMock).not.toHaveBeenCalled();
    expect(getSurveyForResponseMock).not.toHaveBeenCalled();
  });

  it('형식이 깨진(malformed) token은 500 크래시 없이 404 처리한다', async () => {
    // getSurveyByPrivateToken(실 서비스)은 uuid 컬럼 비교 전에 형태를 검사해 undefined 를
    // 반환한다(DB 22P02 방지). 이 페이지 테스트는 서비스를 mock 하므로 그 흡수 로직 자체는
    // survey-read.projection.test.ts 에서 검증하고, 여기서는 undefined 를 받았을 때 페이지가
    // throw 없이 notFound() 로만 반응하는 계약을 확인한다(메일 클라이언트가 URL을 잘라 보내는
    // 등으로 발생하는 truncated 토큰 케이스).
    getSurveyByPrivateTokenMock.mockResolvedValue(undefined);
    const malformedToken = '11111111-2222-4333-8444-5555';

    await expect(
      PublicSurveyPreviewPage({ params: Promise.resolve({ token: malformedToken }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(getSurveyByPrivateTokenMock).toHaveBeenCalledWith({ token: malformedToken });
    expect(getSurveyByIdMock).not.toHaveBeenCalled();
    expect(getSurveyForResponseMock).not.toHaveBeenCalled();
  });

  it('token이 우연히 다른 설문의 id/slug와 같아도 resolve되지 않는다', async () => {
    // getSurveyByPrivateToken 은 privateToken 컬럼만 조회하는 실 서비스 함수이므로
    // (survey-read.service.ts 의 eq(surveys.privateToken, input.token) — id/slug 로는
    // 조회하지 않는다), id/slug 값을 token 으로 넘기면 항상 undefined 를 반환한다.
    // 페이지는 이 undefined 결과를 그대로 404 로 넘긴다 — id/slug 용 별도 fallback 조회를
    // 추가로 시도하지 않는다는 것을 getSurveyByIdMock 미호출로 확인한다.
    getSurveyByPrivateTokenMock.mockResolvedValue(undefined);

    await expect(
      PublicSurveyPreviewPage({ params: Promise.resolve({ token: SURVEY_ID }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(
      PublicSurveyPreviewPage({ params: Promise.resolve({ token: SURVEY_ROW.slug }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(getSurveyByPrivateTokenMock).toHaveBeenNthCalledWith(1, { token: SURVEY_ID });
    expect(getSurveyByPrivateTokenMock).toHaveBeenNthCalledWith(2, { token: SURVEY_ROW.slug });
    expect(getSurveyByIdMock).not.toHaveBeenCalled();
  });

  it('soft-delete된 설문은 404 처리한다', async () => {
    getSurveyByPrivateTokenMock.mockResolvedValue({ id: SURVEY_ID });
    getSurveyByIdMock.mockResolvedValue({ ...SURVEY_ROW, deletedAt: new Date() });

    await expect(
      PublicSurveyPreviewPage({ params: Promise.resolve({ token: PRIVATE_TOKEN }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(getSurveyForResponseMock).not.toHaveBeenCalled();
  });

  it('배포된 버전이 없으면 관리자 버튼 없이 빈 상태만 렌더한다', async () => {
    getSurveyByPrivateTokenMock.mockResolvedValue({ id: SURVEY_ID });
    getSurveyByIdMock.mockResolvedValue(SURVEY_ROW);
    getSurveyForResponseMock.mockResolvedValue(null);

    const result = await PublicSurveyPreviewPage({
      params: Promise.resolve({ token: PRIVATE_TOKEN }),
    });

    const text = flattenText(result).join('');
    expect(text).toContain('배포된 설문이 없습니다');
    expect(text).not.toContain('현황으로');
    expect(text).not.toContain('설문 편집');
    expect(findElementByType(result, SurveyResponseFlowStub)).toBeNull();
  });
});
