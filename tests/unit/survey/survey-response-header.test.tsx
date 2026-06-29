import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SurveyResponseHeader } from '@/components/survey-response/survey-response-header';

describe('SurveyResponseHeader', () => {
  it('기본형은 기존 제목과 설명을 표시한다', () => {
    render(
      <SurveyResponseHeader
        title="테스트 설문"
        description="설명"
        responseHeader={{ style: 'plain', titleSize: 'auto' }}
        sideMeta={<span>1 / 3</span>}
      />,
    );

    expect(screen.getByRole('heading', { name: '테스트 설문' })).toBeInTheDocument();
    expect(screen.getByText('설명')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('제목 옆 로고형은 로고 오른쪽 배치를 반영한다', () => {
    render(
      <SurveyResponseHeader
        title="로고 설문"
        description=""
        responseHeader={{
          style: 'logo-title',
          titleSize: 'md',
          logo: {
            imageUrl: 'https://example.com/logo.png',
            altText: '기관 로고',
            size: 'sm',
          },
          logoTitle: {
            logoPosition: 'right',
          },
        }}
      />,
    );

    expect(screen.getByRole('img', { name: '기관 로고' })).toHaveAttribute(
      'src',
      'https://example.com/logo.png',
    );
    expect(screen.getByTestId('logo-title-layout')).toHaveAttribute('data-logo-position', 'right');
  });

  it('양끝 정보형은 ID 없이 통계법 문구와 로고를 표시한다', () => {
    render(
      <SurveyResponseHeader
        title="공문서 설문"
        description=""
        responseHeader={{
          style: 'official-band',
          titleSize: 'lg',
          logo: {
            imageUrl: 'https://example.com/logo.png',
            altText: '기관 로고',
            size: 'md',
          },
          officialBand: {
            arrangement: 'logo-left-stat-right',
            statisticNotice: {
              title: '통계법 제33조',
              body: '비밀은 보호됩니다.',
              width: 'sm',
            },
          },
        }}
      />,
    );

    expect(screen.getByText('통계법 제33조')).toBeInTheDocument();
    expect(screen.getByText('비밀은 보호됩니다.')).toBeInTheDocument();
    expect(screen.queryByText('ID')).not.toBeInTheDocument();
    expect(screen.getByTestId('official-band-layout')).toHaveAttribute(
      'data-arrangement',
      'logo-left-stat-right',
    );
  });

  it('제목 정렬을 data-title-align 으로 반영한다', () => {
    render(
      <SurveyResponseHeader
        title="정렬 설문"
        description=""
        responseHeader={{ style: 'plain', titleSize: 'auto', titleAlign: 'right' }}
      />,
    );

    expect(screen.getByTestId('title-block')).toHaveAttribute('data-title-align', 'right');
  });

  it('양끝 정보형 로고 세로 정렬을 data-logo-align 으로 반영한다', () => {
    render(
      <SurveyResponseHeader
        title="공문서 설문"
        description=""
        responseHeader={{
          style: 'official-band',
          titleSize: 'auto',
          titleAlign: 'center',
          logo: { imageUrl: 'https://example.com/logo.png', altText: '로고', size: 'md' },
          officialBand: {
            arrangement: 'stat-left-logo-right',
            logoAlign: 'center',
            statisticNotice: { title: 'a', body: 'b', width: 'md' },
          },
        }}
      />,
    );

    expect(screen.getByTestId('official-band-row')).toHaveAttribute('data-logo-align', 'center');
  });
});
