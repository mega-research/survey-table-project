import type {
  ResponseHeaderLogoSize,
  ResponseHeaderNoticeWidth,
  ResponseHeaderTitleSize,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';

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
  title: '통계법 제33조에 따라 응답 내용은 통계 작성 목적으로만 사용됩니다.',
  body: '귀하의 응답은 비밀이 보장되며, 조사 결과는 통계적으로 처리되어 공개됩니다.',
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
  const imageUrl = typeof config?.['imageUrl'] === 'string' ? config['imageUrl'] : '';
  if (!imageUrl) return null;

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
    if (!logo) return DEFAULT_RESPONSE_HEADER_CONFIG;
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
    if (!logo) return DEFAULT_RESPONSE_HEADER_CONFIG;
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
  switch (size) {
    case 'sm':
      return 'max-h-16 max-w-40';
    case 'lg':
      return 'max-h-28 max-w-72';
    case 'md':
      return 'max-h-20 max-w-56';
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
      return 'max-w-sm';
    case 'lg':
      return 'max-w-xl';
    case 'md':
      return 'max-w-md';
  }
}
