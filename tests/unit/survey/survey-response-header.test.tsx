import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SurveyResponseHeader } from '@/components/survey-response/survey-response-header';
import type { SurveyResponseHeaderConfig } from '@/db/schema/schema-types';

const composed = (over: Partial<Extract<SurveyResponseHeaderConfig, { style: 'composed' }>> = {}): SurveyResponseHeaderConfig => ({
  style: 'composed', ...over,
});

describe('SurveyResponseHeader (composed 데스크톱)', () => {
  it('showBranding=false면 컴팩트 제목만 렌더한다', () => {
    render(<SurveyResponseHeader title="제목" responseHeader={composed()} showBranding={false} />);
    expect(screen.getByTestId('title-block')).toBeInTheDocument();
    expect(screen.queryByTestId('header-band')).not.toBeInTheDocument();
  });

  it('stacked — 블록 행과 제목 밴드를 렌더하고 밴드 스타일 괘선을 적용한다', () => {
    render(
      <SurveyResponseHeader
        title="2026 신문산업 실태조사"
        device="desktop"
        responseHeader={composed({
          bandStyle: 'band', bandBg: '#f0f0f0',
          blocks: [
            { id: 'm1', type: 'mark', pos: 'left', size: 'lg', imageUrl: 'https://x/mark.png' },
            { id: 'l1', type: 'logo', pos: 'right', size: 'md', imageUrl: '' },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('header-block-row')).toBeInTheDocument();
    const band = screen.getByTestId('header-band');
    expect(band).toHaveStyle({ backgroundColor: '#f0f0f0', borderTop: '2px solid #3f3f3f', borderBottom: '2px solid #3f3f3f' });
    expect(screen.getByRole('heading', { name: '2026 신문산업 실태조사' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '국가통계 마크' })).toHaveAttribute('src', 'https://x/mark.png');
    expect(screen.getByText('로고')).toBeInTheDocument(); // 빈 imageUrl 자리표시자
  });

  it('부제목이 있으면 제목 아래 렌더하고, 비우면 렌더하지 않는다', () => {
    const { rerender } = render(
      <SurveyResponseHeader title="T" device="desktop" responseHeader={composed({ subtitle: '(본 조사)' })} />,
    );
    expect(screen.getByText('(본 조사)')).toBeInTheDocument();
    rerender(<SurveyResponseHeader title="T" device="desktop" responseHeader={composed({ subtitle: '' })} />);
    expect(screen.queryByText('(본 조사)')).not.toBeInTheDocument();
  });

  it('한줄형 문구를 제목 위/아래에 렌더한다', () => {
    render(
      <SurveyResponseHeader
        title="T" device="desktop"
        responseHeader={composed({
          blocks: [
            { id: 'n1', type: 'notice', pos: 'above', size: 'md', format: 'line', title: '', boxBody: '', lineBody: '위 문구' },
            { id: 'n2', type: 'notice', pos: 'below', size: 'md', format: 'line', title: '', boxBody: '', lineBody: '아래 문구' },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('header-above-notices')).toHaveTextContent('위 문구');
    expect(screen.getByTestId('header-below-notices')).toHaveTextContent('아래 문구');
  });

  it('inline — 표 셀 구조로 렌더한다', () => {
    render(
      <SurveyResponseHeader
        title="목재이용실태조사" device="desktop"
        responseHeader={composed({
          layout: 'inline', bandBg: '#cfe0ad',
          blocks: [{ id: 'm1', type: 'mark', pos: 'left', size: 'md', imageUrl: 'https://x/m.png' }],
        })}
      />,
    );
    expect(screen.getByTestId('header-inline-table')).toBeInTheDocument();
    expect(screen.queryByTestId('header-block-row')).not.toBeInTheDocument();
  });

  it('박스형 문구 — 검정 타이틀바와 본문을 렌더한다', () => {
    render(
      <SurveyResponseHeader
        title="T" device="desktop"
        responseHeader={composed({
          blocks: [{ id: 'n1', type: 'notice', pos: 'left', size: 'md', format: 'box', title: '통계법 제33조(비밀의 보호)', boxBody: '본문입니다', lineBody: '' }],
        })}
      />,
    );
    expect(screen.getByText('통계법 제33조(비밀의 보호)')).toBeInTheDocument();
    expect(screen.getByText('본문입니다')).toBeInTheDocument();
  });

  it('v1 official-band 입력도 composed로 마이그레이션되어 렌더된다', () => {
    render(
      <SurveyResponseHeader
        title="T" device="desktop"
        responseHeader={{
          style: 'official-band', titleSize: 'auto',
          logo: { imageUrl: 'https://x/l.png', size: 'md' },
          officialBand: {
            arrangement: 'stat-left-logo-right',
            statisticNotice: { title: '통계법 제33조', body: '비밀 보호', width: 'md' },
          },
        }}
      />,
    );
    expect(screen.getByText('통계법 제33조')).toBeInTheDocument();
    expect(screen.getByAltText('설문 로고')).toHaveAttribute('src', 'https://x/l.png');
  });
});

describe('SurveyResponseHeader (composed 모바일)', () => {
  const blocks: SurveyResponseHeaderConfig = composed({
    mobileStyle: 'gov', bandStyle: 'band', bandBg: '#f0f0f0',
    blocks: [
      { id: 'm1', type: 'mark', pos: 'left', size: 'lg', imageUrl: 'https://x/mark.png' },
      { id: 'n1', type: 'notice', pos: 'left', size: 'md', format: 'box', title: '통계법 제33조(비밀의 보호)', boxBody: '박스 본문', lineBody: '한줄 요약' },
      { id: 'l1', type: 'logo', pos: 'right', size: 'md', imageUrl: 'https://x/logo.png' },
    ],
  });

  it('gov — 락업 행과 밴드 제목, 문구 카드를 렌더하고 카드를 펼치면 본문이 보인다', () => {
    render(<SurveyResponseHeader title="T" device="mobile" responseHeader={blocks} />);
    expect(screen.getByTestId('header-mobile-gov')).toBeInTheDocument();
    expect(screen.getByTestId('header-mobile-lockup')).toBeInTheDocument();
    const card = screen.getByTestId('header-notice-card');
    expect(card).toHaveTextContent('통계법 제33조(비밀의 보호)');
    expect(card).not.toHaveAttribute('open');
    expect(screen.getByText('박스 본문')).toBeInTheDocument(); // details 내부(접힘 상태 DOM 존재)
  });

  it('title — 제목+마크, 로고 행, 하단 밑줄을 렌더한다 (로고도 표시 결정)', () => {
    render(
      <SurveyResponseHeader
        title="2025년 인공지능산업 실태조사" device="mobile"
        responseHeader={composed({
          mobileStyle: 'title',
          blocks: [
            { id: 'm1', type: 'mark', pos: 'title-right', size: 'md', imageUrl: 'https://x/mark.png' },
            { id: 'l1', type: 'logo', pos: 'right', size: 'md', imageUrl: 'https://x/logo.png' },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('header-mobile-title')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '국가통계 마크' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '설문 로고' })).toBeInTheDocument();
  });

  it('band — 인라인 밴드와 박스형 문구의 한줄 텍스트를 렌더하고 부제를 표시한다', () => {
    render(
      <SurveyResponseHeader
        title="목재이용실태조사" device="mobile"
        responseHeader={composed({
          mobileStyle: 'band', layout: 'inline', subtitle: '(본 조사)', bandBg: '#cfe0ad',
          blocks: [
            { id: 'm1', type: 'mark', pos: 'left', size: 'md', imageUrl: 'https://x/m.png' },
            { id: 'n1', type: 'notice', pos: 'left', size: 'md', format: 'box', title: '제목', boxBody: '박스', lineBody: '모바일 한줄 문구' },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('header-mobile-band')).toBeInTheDocument();
    expect(screen.getByText('(본 조사)')).toBeInTheDocument();
    expect(screen.getByText('모바일 한줄 문구')).toBeInTheDocument();
    expect(screen.queryByTestId('header-notice-card')).not.toBeInTheDocument(); // band 모드는 카드 대신 한줄
  });
});
