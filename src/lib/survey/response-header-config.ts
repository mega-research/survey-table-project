import type {
  ResponseHeaderBandStyle,
  ResponseHeaderBlockPos,
  ResponseHeaderBlockSize,
  ResponseHeaderImageFrame,
  ResponseHeaderLayout,
  ResponseHeaderLogoAlign,
  ResponseHeaderLogoSize,
  ResponseHeaderMobileStyle,
  ResponseHeaderNoticeFormat,
  ResponseHeaderNoticeWidth,
  ResponseHeaderTitleAlign,
  ResponseHeaderTitleSize,
  ResponseHeaderVAlign,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';
import { cn, generateId } from '@/lib/utils';

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

export const DEFAULT_RESPONSE_HEADER_CONFIG: Extract<SurveyResponseHeaderConfig, { style: 'plain' }> = {
  style: 'plain',
  titleSize: 'auto',
  titleAlign: 'left',
};

type HeaderConfigRecord = Record<string, unknown>;

const logoSizes = new Set<ResponseHeaderLogoSize>(['sm', 'md', 'lg']);
const titleSizes = new Set<ResponseHeaderTitleSize>(['auto', 'md', 'lg']);
const noticeWidths = new Set<ResponseHeaderNoticeWidth>(['sm', 'md', 'lg']);
const titleAligns = new Set<ResponseHeaderTitleAlign>(['left', 'center', 'right']);
const logoAligns = new Set<ResponseHeaderLogoAlign>(['top', 'center', 'bottom']);
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

function normalizeTitleAlign(
  value: unknown,
  fallback: ResponseHeaderTitleAlign,
): ResponseHeaderTitleAlign {
  return typeof value === 'string' && titleAligns.has(value as ResponseHeaderTitleAlign)
    ? (value as ResponseHeaderTitleAlign)
    : fallback;
}

function normalizeLogoAlign(value: unknown): ResponseHeaderLogoAlign {
  return typeof value === 'string' && logoAligns.has(value as ResponseHeaderLogoAlign)
    ? (value as ResponseHeaderLogoAlign)
    : 'top';
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

  // composed 는 그대로 통과 — 정밀 정규화는 resolveResponseHeaderConfig 가 담당 (Task 8 에서 통합)
  if (raw['style'] === 'composed') return config as SurveyResponseHeaderConfig;

  if (raw['style'] === 'plain') {
    return {
      style: 'plain',
      titleSize: normalizeTitleSize(raw['titleSize']),
      titleAlign: normalizeTitleAlign(raw['titleAlign'], 'left'),
    };
  }

  if (raw['style'] === 'logo-title') {
    const logo = normalizeLogo(asRecord(raw['logo']));
    const logoTitle = asRecord(raw['logoTitle']);

    return {
      style: 'logo-title',
      titleSize: normalizeTitleSize(raw['titleSize']),
      titleAlign: normalizeTitleAlign(raw['titleAlign'], 'center'),
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
      titleAlign: normalizeTitleAlign(raw['titleAlign'], 'center'),
      logo,
      officialBand: {
        arrangement: normalizeArrangement(officialBand?.['arrangement']),
        logoAlign: normalizeLogoAlign(officialBand?.['logoAlign']),
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
  // 모바일은 한 단계 작게 잡고 sm/md 부터 키운다 — 긴 제목이 좁은 화면에서 과하게 줄바꿈되는 것을 줄인다.
  switch (size) {
    case 'lg':
      return 'text-2xl sm:text-3xl font-semibold';
    case 'md':
      return 'text-xl sm:text-2xl font-semibold';
    case 'auto':
      return 'text-xl sm:text-2xl md:text-3xl font-semibold';
  }
}

export function getTitleAlignClass(align: ResponseHeaderTitleAlign): string {
  switch (align) {
    case 'left':
      return 'text-left';
    case 'right':
      return 'text-right';
    case 'center':
      return 'text-center';
  }
}

export function getLogoAlignClass(align: ResponseHeaderLogoAlign): string {
  switch (align) {
    case 'top':
      return 'md:items-start';
    case 'bottom':
      return 'md:items-end';
    case 'center':
      return 'md:items-center';
  }
}

export function getNoticeWidthClass(width: ResponseHeaderNoticeWidth): string {
  // 모바일에서는 풀폭으로 늘려 통계 표지처럼 보이게 하고, md 이상에서만 폭 상한을 적용한다.
  switch (width) {
    case 'sm':
      return 'md:max-w-[200px]';
    case 'lg':
      return 'md:max-w-[360px]';
    case 'md':
      return 'md:max-w-[280px]';
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

// ── composed(v2) 정규화 완료형 — 모든 optional 필드를 채운 렌더러 친화 타입 ──────────
export type NormalizedHeaderImageBlock = {
  id: string;
  type: 'mark' | 'logo';
  pos: ResponseHeaderBlockPos;
  size: ResponseHeaderBlockSize;
  imageUrl: string;
  altText: string;
  frame: ResponseHeaderImageFrame;
};
export type NormalizedHeaderNoticeBlock = {
  id: string;
  type: 'notice';
  pos: ResponseHeaderBlockPos;
  size: ResponseHeaderBlockSize;
  format: ResponseHeaderNoticeFormat;
  title: string;
  boxBody: string;
  lineBody: string;
  alignBox: ResponseHeaderTitleAlign;
  alignLine: ResponseHeaderTitleAlign;
  fontSize: number | null;
};
export type NormalizedResponseHeaderBlock = NormalizedHeaderImageBlock | NormalizedHeaderNoticeBlock;
export type NormalizedResponseHeaderConfig = {
  style: 'composed';
  mobileStyle: ResponseHeaderMobileStyle;
  layout: ResponseHeaderLayout;
  blocks: NormalizedResponseHeaderBlock[];
  subtitle: string;
  titleAlign: ResponseHeaderTitleAlign;
  titleTextAlign: ResponseHeaderTitleAlign;
  titleVAlign: ResponseHeaderVAlign;
  titleScale: ResponseHeaderBlockSize;
  titlePx: number | null;
  vAlignLogo: ResponseHeaderVAlign;
  vAlignNotice: ResponseHeaderVAlign;
  bandStyle: ResponseHeaderBandStyle;
  bandBg: string;
};

export const DEFAULT_NOTICE_LINE =
  '본 조사는 통계법 제33조(비밀의 보호)에 의거, 응답하신 내용은 통계 작성 목적 외에는 사용되지 않습니다.';

export const HEADER_MARK_HEIGHTS = { sm: 72, md: 98, lg: 128 } as const;
export const HEADER_LOGO_HEIGHTS = { sm: 26, md: 38, lg: 52 } as const;
export const HEADER_NOTICE_BOX_WIDTHS = { sm: 190, md: 240, lg: 300 } as const;
export const HEADER_TITLE_PX = { sm: 26, md: 33, lg: 42 } as const;
export const HEADER_NOTICE_LINE_FONT_PX = { sm: 12, md: 13.5, lg: 15.5 } as const;

export const DEFAULT_COMPOSED_RESPONSE_HEADER: NormalizedResponseHeaderConfig = {
  style: 'composed', mobileStyle: 'gov', layout: 'stacked', blocks: [], subtitle: '',
  titleAlign: 'left', titleTextAlign: 'left', titleVAlign: 'center',
  titleScale: 'md', titlePx: null, vAlignLogo: 'center', vAlignNotice: 'center',
  bandStyle: 'plain', bandBg: '#ffffff',
};

const blockSizes = new Set<ResponseHeaderBlockSize>(['sm', 'md', 'lg']);
const blockPositions = new Set<ResponseHeaderBlockPos>(['left', 'center', 'right', 'title-left', 'title-right', 'above', 'below']);
const imageFrames = new Set<ResponseHeaderImageFrame>(['none', 'line', 'wrap']);
const vAligns = new Set<ResponseHeaderVAlign>(['top', 'center', 'bottom']);
const bandStyleSet = new Set<ResponseHeaderBandStyle>(['band', 'boxed', 'rule', 'plain']);
const mobileStyleSet = new Set<ResponseHeaderMobileStyle>(['gov', 'band', 'title']);
const layoutSet = new Set<ResponseHeaderLayout>(['stacked', 'inline']);

function pickEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? (value as T) : fallback;
}
function pickString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function clampNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.min(max, Math.max(min, value));
}

const isLineNotice = (b: NormalizedResponseHeaderBlock): b is NormalizedHeaderNoticeBlock =>
  b.type === 'notice' && b.format === 'line';

// notice pos 규칙: box 인데 above/below → left, line 인데 그 외 → above
function coerceNoticePos(format: ResponseHeaderNoticeFormat, pos: ResponseHeaderBlockPos): ResponseHeaderBlockPos {
  if (format === 'line') return pos === 'below' ? 'below' : 'above';
  return pos === 'above' || pos === 'below' ? 'left' : pos;
}

function normalizeComposedBlock(raw: unknown, index: number): NormalizedResponseHeaderBlock | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const type = rec['type'];
  const id = pickString(rec['id']) || `block-${index}`;
  const size = pickEnum(rec['size'], blockSizes, 'md');
  const pos = pickEnum(rec['pos'], blockPositions, 'left');
  if (type === 'mark' || type === 'logo') {
    return {
      id, type, pos: pos === 'above' || pos === 'below' ? 'left' : pos, size,
      imageUrl: pickString(rec['imageUrl']), altText: pickString(rec['altText']),
      frame: pickEnum(rec['frame'], imageFrames, 'none'),
    };
  }
  if (type === 'notice') {
    const format = pickEnum(rec['format'], new Set<ResponseHeaderNoticeFormat>(['box', 'line']), 'box');
    return {
      id, type, pos: coerceNoticePos(format, pos), size, format,
      title: pickString(rec['title'], DEFAULT_STATISTIC_NOTICE.title),
      boxBody: pickString(rec['boxBody'], DEFAULT_STATISTIC_NOTICE.body),
      lineBody: pickString(rec['lineBody'], DEFAULT_NOTICE_LINE),
      alignBox: normalizeTitleAlign(rec['alignBox'], 'left'),
      alignLine: normalizeTitleAlign(rec['alignLine'], 'center'),
      fontSize: clampNumber(rec['fontSize'], 9, 28),
    };
  }
  return null; // 미지 type 드롭
}

export function coerceBlocksForInlineLayout(blocks: NormalizedResponseHeaderBlock[]): NormalizedResponseHeaderBlock[] {
  return blocks.map((b) => {
    if (b.pos === 'above' || b.pos === 'below') return b; // 한줄형 문구는 유지
    if (b.pos === 'center' || b.pos === 'title-left') return { ...b, pos: 'left' as const };
    if (b.pos === 'title-right') return { ...b, pos: 'right' as const };
    return b;
  });
}

function normalizeComposedResponseHeader(rec: Record<string, unknown>): NormalizedResponseHeaderConfig {
  const layout = pickEnum(rec['layout'], layoutSet, 'stacked');
  const rawBlocks = Array.isArray(rec['blocks']) ? rec['blocks'] : [];
  let blocks = rawBlocks
    .map((b, i) => normalizeComposedBlock(b, i))
    .filter((b): b is NormalizedResponseHeaderBlock => b !== null);
  if (layout === 'inline') blocks = coerceBlocksForInlineLayout(blocks);
  return {
    style: 'composed',
    mobileStyle: pickEnum(rec['mobileStyle'], mobileStyleSet, 'gov'),
    layout, blocks,
    subtitle: pickString(rec['subtitle']),
    titleAlign: normalizeTitleAlign(rec['titleAlign'], 'left'),
    titleTextAlign: normalizeTitleAlign(rec['titleTextAlign'], 'left'),
    titleVAlign: pickEnum(rec['titleVAlign'], vAligns, 'center'),
    titleScale: pickEnum(rec['titleScale'], blockSizes, 'md'),
    titlePx: clampNumber(rec['titlePx'], 14, 72),
    vAlignLogo: pickEnum(rec['vAlignLogo'], vAligns, 'center'),
    vAlignNotice: pickEnum(rec['vAlignNotice'], vAligns, 'center'),
    bandStyle: pickEnum(rec['bandStyle'], bandStyleSet, 'plain'),
    bandBg: pickString(rec['bandBg'], '#ffffff') || '#ffffff',
  };
}

const V1_TITLE_SCALE: Record<ResponseHeaderTitleSize, ResponseHeaderBlockSize> = {
  auto: 'md', md: 'sm', lg: 'md',
};

// 기존 normalizeResponseHeaderConfig(v1 정제)의 출력을 composed 로 매핑
function migrateV1ResponseHeader(config: SurveyResponseHeaderConfig): NormalizedResponseHeaderConfig {
  // composed 는 호출부(resolveResponseHeaderConfig)에서 이미 분기 처리되어 여기 도달하지 않음 — 타입 좁히기용 안전망
  if (config.style === 'composed') return DEFAULT_COMPOSED_RESPONSE_HEADER;
  const base: NormalizedResponseHeaderConfig = {
    ...DEFAULT_COMPOSED_RESPONSE_HEADER,
    titleScale: V1_TITLE_SCALE[config.titleSize ?? 'auto'],
  };
  if (config.style === 'logo-title') {
    const pos = config.logoTitle?.logoPosition === 'right' ? 'title-right' : 'title-left';
    return {
      ...base,
      titleAlign: config.titleAlign ?? 'center', titleTextAlign: config.titleAlign ?? 'center',
      blocks: [{
        id: 'v1-logo', type: 'logo', pos, size: config.logo.size ?? 'md',
        imageUrl: config.logo.imageUrl, altText: config.logo.altText ?? '', frame: 'none',
      }],
    };
  }
  if (config.style === 'official-band') {
    const noticePos = config.officialBand?.arrangement === 'logo-left-stat-right' ? 'right' : 'left';
    const logoPos = noticePos === 'left' ? 'right' : 'left';
    const notice = config.officialBand?.statisticNotice;
    return {
      ...base,
      titleAlign: config.titleAlign ?? 'center', titleTextAlign: config.titleAlign ?? 'center',
      vAlignLogo: config.officialBand?.logoAlign ?? 'top',
      blocks: [
        {
          id: 'v1-notice', type: 'notice', pos: noticePos, size: notice?.width ?? 'md', format: 'box',
          title: notice?.title ?? DEFAULT_STATISTIC_NOTICE.title,
          boxBody: notice?.body ?? DEFAULT_STATISTIC_NOTICE.body,
          lineBody: DEFAULT_NOTICE_LINE, alignBox: 'left', alignLine: 'center', fontSize: null,
        },
        {
          id: 'v1-logo', type: 'logo', pos: logoPos, size: config.logo.size ?? 'md',
          imageUrl: config.logo.imageUrl, altText: config.logo.altText ?? '', frame: 'none',
        },
      ],
    };
  }
  // plain
  return {
    ...base,
    titleAlign: config.titleAlign ?? 'left',
    titleTextAlign: config.titleAlign ?? 'left',
  };
}

export function resolveResponseHeaderConfig(
  config: SurveyResponseHeaderConfig | null | undefined,
): NormalizedResponseHeaderConfig {
  const rec = asRecord(config);
  if (!rec) return DEFAULT_COMPOSED_RESPONSE_HEADER;
  if (rec['style'] === 'composed') return normalizeComposedResponseHeader(rec);
  return migrateV1ResponseHeader(normalizeResponseHeaderConfig(config));
}

export function resolveHeaderTitlePx(config: NormalizedResponseHeaderConfig, title: string): number {
  if (config.titlePx !== null) return config.titlePx;
  const base = HEADER_TITLE_PX[config.titleScale];
  const len = title.length;
  const shrink = len > 40 ? 0.72 : len > 26 ? 0.85 : 1; // 긴 제목은 자동 축소해 두 줄로 흐르게 한다
  return Math.round(base * shrink);
}

export function resolveMobileHeaderTitlePx(desktopPx: number): number {
  return Math.min(26, Math.max(17, Math.round(desktopPx * 0.62)));
}

export function getHeaderBandBorders(style: ResponseHeaderBandStyle): { top: string; bottom: string; side: string } {
  switch (style) {
    case 'band': return { top: '2px solid #3f3f3f', bottom: '2px solid #3f3f3f', side: 'none' };
    case 'boxed': return { top: '1.5px solid #333333', bottom: '1.5px solid #333333', side: '1.5px solid #333333' };
    case 'rule': return { top: 'none', bottom: '2.5px solid #222222', side: 'none' };
    case 'plain': return { top: 'none', bottom: 'none', side: 'none' };
  }
}

export function createHeaderBlock(type: 'mark' | 'logo' | 'notice'): NormalizedResponseHeaderBlock {
  if (type === 'notice') {
    return {
      id: generateId(), type: 'notice', pos: 'left', size: 'md', format: 'box',
      title: DEFAULT_STATISTIC_NOTICE.title, boxBody: DEFAULT_STATISTIC_NOTICE.body,
      lineBody: DEFAULT_NOTICE_LINE, alignBox: 'left', alignLine: 'center', fontSize: null,
    };
  }
  return {
    id: generateId(), type, pos: type === 'mark' ? 'left' : 'right', size: 'md',
    imageUrl: '', altText: '', frame: 'none',
  };
}

export function noticeFormatPatch(
  block: NormalizedHeaderNoticeBlock, format: ResponseHeaderNoticeFormat,
): Partial<NormalizedHeaderNoticeBlock> {
  return { format, pos: coerceNoticePos(format, block.pos) };
}

export function partitionHeaderBlocks(blocks: NormalizedResponseHeaderBlock[]) {
  const solid = blocks.filter((b) => !isLineNotice(b));
  const lines = blocks.filter(isLineNotice);
  return {
    rowLeft: solid.filter((b) => b.pos === 'left'),
    rowCenter: solid.filter((b) => b.pos === 'center'),
    rowRight: solid.filter((b) => b.pos === 'right'),
    titleLeft: solid.filter((b) => b.pos === 'title-left'),
    titleRight: solid.filter((b) => b.pos === 'title-right'),
    above: lines.filter((b) => b.pos !== 'below'),
    below: lines.filter((b) => b.pos === 'below'),
  };
}

// 프리셋 — 블록·배치·밴드만 교체, subtitle·titleTextAlign·titleVAlign 유지 (스펙 §5)
export type ResponseHeaderPresetKey = 'gov' | 'band' | 'title';

const PRESET_TITLE_NOTICE_BODY =
  '① 통계작성과정에서 알려진 사항으로서 개인 또는 법인이나 단체의 비밀에 속하는 사항은 보호되어야 한다. ② 수집된 기초자료는 통계작성의 목적 외에 사용하여서는 아니 된다.';

function buildPresetBlocks(preset: ResponseHeaderPresetKey): NormalizedResponseHeaderBlock[] {
  if (preset === 'gov') {
    return [
      { ...createHeaderBlock('mark'), pos: 'left', size: 'lg' },
      { ...createHeaderBlock('notice') },
      { ...createHeaderBlock('logo'), pos: 'right' },
      { ...createHeaderBlock('logo'), pos: 'right' },
    ];
  }
  if (preset === 'band') return [{ ...createHeaderBlock('mark'), pos: 'left', size: 'md' }];
  return [
    { ...(createHeaderBlock('notice') as NormalizedHeaderNoticeBlock), pos: 'title-right', size: 'lg', boxBody: PRESET_TITLE_NOTICE_BODY },
    { ...createHeaderBlock('mark'), pos: 'title-right', size: 'md' },
  ];
}

const PRESET_PATCH: Record<ResponseHeaderPresetKey, Partial<NormalizedResponseHeaderConfig>> = {
  gov: { mobileStyle: 'gov', layout: 'stacked', bandStyle: 'band', bandBg: '#f0f0f0', titleAlign: 'center', titleScale: 'md' },
  band: { mobileStyle: 'band', layout: 'inline', bandStyle: 'band', bandBg: '#cfe0ad', titleAlign: 'center', titleScale: 'md' },
  title: { mobileStyle: 'title', layout: 'stacked', bandStyle: 'plain', bandBg: '#ffffff', titleAlign: 'left', titleScale: 'lg' },
};

export function applyResponseHeaderPreset(
  preset: ResponseHeaderPresetKey, current: NormalizedResponseHeaderConfig,
): NormalizedResponseHeaderConfig {
  // 기존 블록의 업로드 이미지·문구 내용을 같은 타입 슬롯에 순서대로 승계 (스펙 §5)
  const marks = current.blocks.filter((b): b is NormalizedHeaderImageBlock => b.type === 'mark');
  const logos = current.blocks.filter((b): b is NormalizedHeaderImageBlock => b.type === 'logo');
  const notices = current.blocks.filter((b): b is NormalizedHeaderNoticeBlock => b.type === 'notice');
  let mi = 0; let li = 0; let ni = 0;
  const blocks = buildPresetBlocks(preset).map((block) => {
    if (block.type === 'notice') {
      const src = notices[ni++];
      return src
        ? { ...block, title: src.title, boxBody: src.boxBody, lineBody: src.lineBody, alignBox: src.alignBox, alignLine: src.alignLine, fontSize: src.fontSize }
        : block;
    }
    const src = block.type === 'mark' ? marks[mi++] : logos[li++];
    return src ? { ...block, imageUrl: src.imageUrl, altText: src.altText } : block;
  });
  return {
    ...current, ...PRESET_PATCH[preset], blocks,
    vAlignLogo: 'center', vAlignNotice: 'center', titlePx: null,
  };
}
