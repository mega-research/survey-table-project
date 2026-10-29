import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AlreadyRespondedView } from '@/features/survey-response/already-responded-view';

describe('AlreadyRespondedView', () => {
  it('문의 이메일을 mailto 링크가 아닌 텍스트로 표시한다', () => {
    render(
      <AlreadyRespondedView
        reason="token_already_used"
        surveyTitle="테스트 설문"
        contactEmail="admin@example.com"
      />,
    );

    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('[href^="mailto:"]')).toBeNull();
  });

  it('quota_closed 는 기본 제목 멘트 없이 마감 안내 문구만 표시한다', () => {
    render(
      <AlreadyRespondedView
        reason="quota_closed"
        surveyTitle="테스트 설문"
        contactEmail={null}
        customBody={'모집이 완료되었습니다.\n감사합니다.'}
      />,
    );

    expect(screen.queryByText('설문이 마감되었습니다')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    // 에디터 미리보기와 동일하게 설문 제목도 표시하지 않는다
    expect(screen.queryByText('테스트 설문')).not.toBeInTheDocument();
    expect(screen.getByText(/모집이 완료되었습니다/)).toBeInTheDocument();
  });

  it('다른 차단 사유는 기존 제목을 유지한다', () => {
    render(
      <AlreadyRespondedView
        reason="token_already_used"
        surveyTitle="테스트 설문"
        contactEmail={null}
      />,
    );

    expect(screen.getByRole('heading', { name: '이미 응답하신 설문입니다' })).toBeInTheDocument();
  });

  it('survey_paused 는 제목 없이 운영자 중단 문구(customBody)만 표시한다', () => {
    render(
      <AlreadyRespondedView
        reason="survey_paused"
        surveyTitle="테스트 설문"
        contactEmail={null}
        customBody={'점검 중입니다.\n잠시 후 다시 시도해 주세요.'}
      />,
    );

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    // quota_closed 와 동일하게 설문 제목도 숨긴다
    expect(screen.queryByText('테스트 설문')).not.toBeInTheDocument();
    expect(screen.getByText(/점검 중입니다/)).toBeInTheDocument();
  });

  it('invalid_test_token 은 전용 제목과 안내 문구를 표시한다', () => {
    render(
      <AlreadyRespondedView
        reason="invalid_test_token"
        surveyTitle="테스트 설문"
        contactEmail={null}
        customBody={null}
      />,
    );

    expect(
      screen.getByRole('heading', { name: '테스트 링크가 유효하지 않습니다' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/테스트 모드가 꺼져 있거나 링크가 잘못되었습니다/)).toBeInTheDocument();
  });
  describe('중단 문구가 한국어 기본 문구 그대로일 때 (운영 콘솔이 기본 문구를 채워 저장한다)', () => {
    const KO_DEFAULT = '설문이 일시 중단되었습니다. 잠시 후 다시 시도해 주세요.';

    it('현재 언어의 기본 문구를 보인다', () => {
      render(
        <AlreadyRespondedView
          reason="survey_paused"
          surveyTitle="테스트 설문"
          contactEmail={null}
          customBody={KO_DEFAULT}
          locale="zh"
        />,
      );
      expect(screen.getByText('问卷已暂停。请稍后再试。')).toBeInTheDocument();
      expect(screen.queryByText(KO_DEFAULT)).not.toBeInTheDocument();
    });

    it('언어 미정이면 세 언어 기본 문구를 함께 보인다', () => {
      render(
        <AlreadyRespondedView
          reason="survey_paused"
          surveyTitle="테스트 설문"
          contactEmail={null}
          customBody={KO_DEFAULT}
          locale={null}
        />,
      );
      expect(screen.getByText(KO_DEFAULT)).toBeInTheDocument();
      expect(screen.getByText('问卷已暂停。请稍后再试。')).toBeInTheDocument();
      expect(
        screen.getByText('The survey has been paused. Please try again later.'),
      ).toBeInTheDocument();
    });

    it('다국어 설문이 아니면(한국어) 글자 그대로 한 줄이다', () => {
      const { container } = render(
        <AlreadyRespondedView
          reason="survey_paused"
          surveyTitle="테스트 설문"
          contactEmail={null}
          customBody={KO_DEFAULT}
        />,
      );
      const body = screen.getByText(KO_DEFAULT);
      expect(body.tagName).toBe('P');
      expect(container.querySelectorAll('[lang]')).toHaveLength(0);
    });
  });
});
