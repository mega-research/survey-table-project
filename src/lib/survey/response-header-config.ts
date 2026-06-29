import type {
  ResponseHeaderLogoSize,
  ResponseHeaderNoticeWidth,
  ResponseHeaderTitleSize,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';
import { cn } from '@/lib/utils';

type StatisticNoticeConfig = Extract<
  SurveyResponseHeaderConfig,
  { style: 'official-band' }
>['officialBand']['statisticNotice'];
type LogoPosition = Extract<
  SurveyResponseHeaderConfig,
  { style: 'logo-title' }
>['logoTitle']['logoPosition'];
type OfficialBandArrangement = Extract<
  SurveyResponseHeaderConfig,
  { style: 'official-band' }
>['officialBand']['arrangement'];

export const DEFAULT_STATISTIC_NOTICE = {
  title: '통계법 제33조(비밀의 보호)',
  body: '통계의 작성 과정에서 알려진 사항으로서 개인이나 법인 또는 단체의 비밀에 속하는 사항은 보호되어야 한다.',
  width: 'md',
} satisfies StatisticNoticeConfig;

export const DEFAULT_RESPONSE_HEADER_CONFIG: SurveyResponseHeaderConfig = {
  style: 'plain',
  titleSize: 'auto',
};

type HeaderConfigRecord = Record<string, unknown>;

const logoSizes = new Set<ResponseHeaderLogoSize>(['sm', 'md', 'lg']);
const titleSizes = new Set<ResponseHeaderTitleSize>(['auto', 'md', 'lg']);
const noticeWidths = new Set<ResponseHeaderNoticeWidth>(['sm', 'md', 'lg']);
const logoPositions = new Set<LogoPosition>(['left', 'right']);
const bandArrangements = new Set<OfficialBandArrangement>([
  'stat-left-logo-right',
  'logo-left-stat-right',
]);

function asRecord(value: unknown): HeaderConfigRecord | null {
  return value && typeof value === 'object' ? (value as HeaderConfigRecord) : null;
}

function normalizeTitleSize(value: unknown): ResponseHeaderTitleSize {
  return typeof value === 'string' && titleSizes.has(value as ResponseHeaderTitleSize)
    ? (value as ResponseHeaderTitleSize)
    : DEFAULT_RESPONSE_HEADER_CONFIG.titleSize;
}

function normalizeLogoPosition(value: unknown): LogoPosition {
  return typeof value === 'string' && logoPositions.has(value as LogoPosition)
    ? (value as LogoPosition)
    : 'left';
}

function normalizeArrangement(value: unknown): OfficialBandArrangement {
  return typeof value === 'string' && bandArrangements.has(value as OfficialBandArrangement)
    ? (value as OfficialBandArrangement)
    : 'stat-left-logo-right';
}

function normalizeLogo(config: HeaderConfigRecord | null) {
  // imageUrl 이 비어 있어도(로고 미업로드) 로고 스타일을 유지한다 — 빌더에서 스타일 선택 후
  // 업로드하는 흐름을 막지 않기 위함. 빈 문자열을 그대로 보존한다.
  const imageUrl = typeof config?.['imageUrl'] === 'string' ? config['imageUrl'] : '';

  return {
    imageUrl,
    altText: typeof config?.['altText'] === 'string' ? config['altText'] : '',
    size:
      typeof config?.['size'] === 'string' &&
      logoSizes.has(config['size'] as ResponseHeaderLogoSize)
        ? (config['size'] as ResponseHeaderLogoSize)
        : 'md',
  };
}

function normalizeNotice(config: HeaderConfigRecord | null) {
  return {
    title: typeof config?.['title'] === 'string' ? config['title'] : DEFAULT_STATISTIC_NOTICE.title,
    body: typeof config?.['body'] === 'string' ? config['body'] : DEFAULT_STATISTIC_NOTICE.body,
    width:
      typeof config?.['width'] === 'string' &&
      noticeWidths.has(config['width'] as ResponseHeaderNoticeWidth)
        ? (config['width'] as ResponseHeaderNoticeWidth)
        : DEFAULT_STATISTIC_NOTICE.width,
  };
}

export function normalizeResponseHeaderConfig(
  config: SurveyResponseHeaderConfig | null | undefined,
): SurveyResponseHeaderConfig {
  const raw = asRecord(config);
  if (!raw) return DEFAULT_RESPONSE_HEADER_CONFIG;

  if (raw['style'] === 'plain') {
    return {
      style: 'plain',
      titleSize: normalizeTitleSize(raw['titleSize']),
    };
  }

  if (raw['style'] === 'logo-title') {
    const logo = normalizeLogo(asRecord(raw['logo']));
    const logoTitle = asRecord(raw['logoTitle']);

    return {
      style: 'logo-title',
      titleSize: normalizeTitleSize(raw['titleSize']),
      logo,
      logoTitle: {
        logoPosition: normalizeLogoPosition(logoTitle?.['logoPosition']),
      },
    };
  }

  if (raw['style'] === 'official-band') {
    const logo = normalizeLogo(asRecord(raw['logo']));
    const officialBand = asRecord(raw['officialBand']);

    return {
      style: 'official-band',
      titleSize: normalizeTitleSize(raw['titleSize']),
      logo,
      officialBand: {
        arrangement: normalizeArrangement(officialBand?.['arrangement']),
        statisticNotice: normalizeNotice(asRecord(officialBand?.['statisticNotice'])),
      },
    };
  }

  return DEFAULT_RESPONSE_HEADER_CONFIG;
}

export function getLogoSizeClass(size: ResponseHeaderLogoSize): string {
  // 고정 높이 + 폭 상한. max-h-*(최댓값)만 쓰면 원본보다 작은 로고는 크기 차이가 안 보이므로
  // 고정 높이로 단계별 차이를 보장한다(가로가 긴 로고는 max-w 가 지배해 폭 차이로 드러난다).
  switch (size) {
    case 'sm':
      return 'h-10 max-w-[180px]';
    case 'lg':
      return 'h-24 max-w-[340px]';
    case 'md':
      return 'h-16 max-w-[240px]';
  }
}

export function getTitleSizeClass(size: ResponseHeaderTitleSize): string {
  switch (size) {
    case 'lg':
      return 'text-3xl font-semibold';
    case 'md':
      return 'text-2xl font-semibold';
    case 'auto':
      return 'text-2xl sm:text-3xl font-semibold';
  }
}

export function getNoticeWidthClass(width: ResponseHeaderNoticeWidth): string {
  switch (width) {
    case 'sm':
      return 'max-w-[240px]';
    case 'lg':
      return 'max-w-xl';
    case 'md':
      return 'max-w-md';
  }
}

export function responseHeaderButtonClass(selected: boolean): string {
  return cn(
    'rounded-lg border px-3 py-2 text-sm transition-colors',
    selected
      ? 'border-blue-500 bg-blue-50 font-semibold text-blue-700'
      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
  );
}
