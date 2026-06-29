import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ResponseHeaderSettings } from '@/components/survey-builder/response-header-settings';
import { DEFAULT_RESPONSE_HEADER_CONFIG } from '@/lib/survey/response-header-config';
import type { SurveySettings } from '@/types/survey';

function settings(overrides: Partial<SurveySettings> = {}): SurveySettings {
  return {
    isPublic: true,
    allowMultipleResponses: false,
    showProgressBar: true,
    shuffleQuestions: false,
    requireLogin: false,
    thankYouMessage: '감사합니다',
    responseHeader: DEFAULT_RESPONSE_HEADER_CONFIG,
    ...overrides,
  };
}

describe('ResponseHeaderSettings', () => {
  it('기본형에서는 로고 위치와 통계법 문구 입력을 숨긴다', () => {
    render(<ResponseHeaderSettings settings={settings()} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '기본형' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('로고 위치')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('통계법 제목')).not.toBeInTheDocument();
  });

  it('제목 옆 로고형 선택 시 로고 위치 선택을 표시하고 설정을 갱신한다', async () => {
    const onChange = vi.fn();
    render(<ResponseHeaderSettings settings={settings()} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '제목 옆 로고형' }));

    expect(onChange).toHaveBeenCalledWith({
      style: 'logo-title',
      titleSize: 'auto',
      logo: {
        imageUrl: '',
        altText: '',
        size: 'md',
      },
      logoTitle: {
        logoPosition: 'left',
      },
    });
  });

  it('양끝 정보형 선택 시 통계법 문구 입력을 표시한다', () => {
    render(
      <ResponseHeaderSettings
        settings={settings({
          responseHeader: {
            style: 'official-band',
            titleSize: 'auto',
            logo: {
              imageUrl: '',
              size: 'md',
            },
            officialBand: {
              arrangement: 'stat-left-logo-right',
              statisticNotice: {
                title: '통계법',
                body: '보호됩니다.',
                width: 'md',
              },
            },
          },
        })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('통계법 제목')).toHaveValue('통계법');
    expect(screen.getByLabelText('통계법 문구')).toHaveValue('보호됩니다.');
  });
});
