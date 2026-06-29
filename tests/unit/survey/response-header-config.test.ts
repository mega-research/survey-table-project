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
  it('통계법 기본 문구는 제품 스펙 문구를 사용한다', () => {
    expect(DEFAULT_STATISTIC_NOTICE).toEqual({
      title: '통계법 제33조(비밀의 보호)',
      body: '통계의 작성 과정에서 알려진 사항으로서 개인이나 법인 또는 단체의 비밀에 속하는 사항은 보호되어야 한다.',
      width: 'md',
    });
  });

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

  it('로고 크기는 고정 높이로 단계별 차이를 보장한다', () => {
    // 회귀: 과거 max-h-*(최댓값)만 반환해 작은 로고는 sm/md/lg 가 동일하게 보였다.
    expect(getLogoSizeClass('sm')).toBe('h-10 max-w-[180px]');
    expect(getLogoSizeClass('md')).toBe('h-16 max-w-[240px]');
    expect(getLogoSizeClass('lg')).toBe('h-24 max-w-[340px]');
  });

  it('통계법 박스 좁게는 충분히 좁은 폭을 사용한다', () => {
    expect(getNoticeWidthClass('sm')).toBe('max-w-[240px]');
    expect(getNoticeWidthClass('md')).toBe('max-w-md');
    expect(getNoticeWidthClass('lg')).toBe('max-w-xl');
  });

  it('제목 크기 헬퍼는 의미 있는 Tailwind 클래스를 반환한다', () => {
    expect(getTitleSizeClass('lg')).toContain('text-3xl');
  });
});
