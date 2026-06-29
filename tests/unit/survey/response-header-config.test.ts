import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESPONSE_HEADER_CONFIG,
  DEFAULT_STATISTIC_NOTICE,
  getLogoSizeClass,
  getNoticeWidthClass,
  getTitleSizeClass,
  normalizeResponseHeaderConfig,
} from '@/lib/survey/response-header-config';

describe('response-header-config', () => {
  it('undefined 설정은 기본 응답 헤더 설정으로 정규화한다', () => {
    expect(normalizeResponseHeaderConfig(undefined)).toEqual(DEFAULT_RESPONSE_HEADER_CONFIG);
  });

  it('null 설정은 기본 응답 헤더 설정으로 정규화한다', () => {
    expect(normalizeResponseHeaderConfig(null)).toEqual(DEFAULT_RESPONSE_HEADER_CONFIG);
  });

  it('logo-title 설정의 누락된 중첩값을 기본값으로 채운다', () => {
    expect(
      normalizeResponseHeaderConfig({
        style: 'logo-title',
        titleSize: 'lg',
        logo: { imageUrl: 'https://example.com/logo.png' },
      } as never),
    ).toEqual({
      style: 'logo-title',
      titleSize: 'lg',
      logo: {
        imageUrl: 'https://example.com/logo.png',
        altText: '',
        size: 'md',
      },
      logoTitle: {
        logoPosition: 'left',
      },
    });
  });

  it('official-band 설정의 통계 안내문과 폭 기본값을 채운다', () => {
    expect(
      normalizeResponseHeaderConfig({
        style: 'official-band',
        titleSize: 'md',
        logo: {
          imageUrl: 'https://example.com/logo.png',
          size: 'lg',
        },
        officialBand: {
          arrangement: 'logo-left-stat-right',
        },
      } as never),
    ).toEqual({
      style: 'official-band',
      titleSize: 'md',
      logo: {
        imageUrl: 'https://example.com/logo.png',
        altText: '',
        size: 'lg',
      },
      officialBand: {
        arrangement: 'logo-left-stat-right',
        statisticNotice: {
          ...DEFAULT_STATISTIC_NOTICE,
          width: 'md',
        },
      },
    });
  });

  it('크기별 클래스 헬퍼는 의미 있는 Tailwind 클래스를 반환한다', () => {
    expect(getLogoSizeClass('sm')).toContain('max-h-16');
    expect(getTitleSizeClass('lg')).toContain('text-3xl');
    expect(getNoticeWidthClass('lg')).toContain('max-w-xl');
  });
});
