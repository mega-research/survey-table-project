import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSurveyForResponse, flowProps } = vi.hoisted(() => ({
  getSurveyForResponse: vi.fn(),
  flowProps: vi.fn(),
}));

vi.mock('@/server/survey-builder/services/survey-read', () => ({
  getSurveyForResponse: (...a: unknown[]) => getSurveyForResponse(...a),
}));
vi.mock('@/features/survey-response/survey-response-flow', () => ({
  SurveyResponseFlow: (props: unknown) => {
    flowProps(props);
    return <div>응답 화면</div>;
  },
}));

import { ClientPreviewScreen } from './preview-screen';

const DOCUMENT_VIEW = { url: 'https://r2.example/doc.pdf', pageCount: 3, anchors: [] };

/**
 * 설문지 미리보기 본문 — 클라이언트(게스트 계정·클라이언트 링크)가 함께 쓴다 (티켓 06).
 */
describe('ClientPreviewScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('배포된 설문을 열람 전용 모드로 그리고 조사표를 함께 넘긴다', async () => {
    // 조사표(PDF 분할 화면)를 넘기지 않으면 조사표가 붙은 설문이 분할 없이 그려진다 —
    // 응답자가 보는 화면과 클라이언트가 보는 미리보기가 다른 모양이 된다. 내부·외주 링크의
    // 미리보기는 이미 넘기고 있었고 이쪽만 빠져 있었다.
    getSurveyForResponse.mockResolvedValue({
      survey: { id: 's-1' },
      versionId: 'v-1',
      documentView: DOCUMENT_VIEW,
    });

    render(await ClientPreviewScreen({ surveyId: 's-1' }));

    expect(getSurveyForResponse).toHaveBeenCalledWith({ surveyId: 's-1' }, { requirePublished: true });
    expect(flowProps).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'preview',
        surveyIdentifier: 's-1',
        previewContext: { survey: { id: 's-1' }, versionId: 'v-1', documentView: DOCUMENT_VIEW },
      }),
    );
  });

  it('배포된 버전이 없으면 응답 화면 대신 안내를 그린다', async () => {
    getSurveyForResponse.mockResolvedValue(null);

    render(await ClientPreviewScreen({ surveyId: 's-1' }));

    expect(screen.getByText('아직 배포된 설문이 없습니다')).toBeInTheDocument();
    expect(flowProps).not.toHaveBeenCalled();
  });
});
