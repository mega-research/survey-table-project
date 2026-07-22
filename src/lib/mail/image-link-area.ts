/**
 * 메일 이미지 클릭 영역(가로 밴드 슬라이스) 지원.
 *
 * 에디터는 img 에 data-link-rect(0~1 상대좌표)·data-link-natural(원본 W,H)만
 * 심는다. 템플릿 저장 시 서버(ensureImageLinkAreaSlices)가 원본 이미지를 영역
 * y 범위 기준 top/mid/bottom 가로 밴드로 잘라 R2 에 올리고 data-link-bands 에
 * 밴드 URL 을 기록한다. 발송/미리보기 직전 renderMailPreview 진입점에서
 * expandImageLinkAreas 가 img 를 <table> 3행으로 치환하고 가운데 밴드를
 * <a href="{{invite_link}}"> 로 감싼다 — href 는 기존 변수 치환 파이프라인이
 * 실제 URL 로 바꾼다 (변수 치환보다 먼저 실행되어야 하는 이유).
 *
 * 이미지맵(<area coords>) 대신 밴드 슬라이스를 쓰는 이유: area 좌표는 렌더
 * 픽셀 고정이라 %폭(반응형) 이미지에서 어긋나지만, 밴드는 모든 조각이 같은
 * %로 스케일되어 어떤 클라이언트 폭에서도 비율이 유지된다. 이미지맵을
 * 지원하지 않는 Outlook 데스크톱에서도 동작한다.
 */

export const IMG_TAG_RE = /<img\b[^>]*>/g;

/** sanitize transformTags 의 표 테두리 주입을 면제받기 위한 마커 클래스 */
export const LINK_BANDS_CLASS = 'mail-link-bands';

export interface LinkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function parseLinkRect(s: string | null | undefined): LinkRect | null {
  if (!s) return null;
  const parts = s.split(',').map(Number);
  if (parts.length !== 4 || !parts.every((n) => Number.isFinite(n))) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  return { x, y, w, h };
}

export function parseNaturalSize(
  s: string | null | undefined,
): { width: number; height: number } | null {
  if (!s) return null;
  const parts = s.split(',').map(Number);
  if (parts.length !== 2 || !parts.every((n) => Number.isFinite(n) && n > 0)) return null;
  return { width: parts[0] as number, height: parts[1] as number };
}

/**
 * 상대좌표 rect 의 y 범위 → 원본 픽셀 밴드 경계 [y1, y2).
 * y1 == 0 이면 top 밴드 없음, y2 == height 이면 bottom 밴드 없음.
 * 입력 불량 시 null.
 */
export function computeBandRows(
  rect: LinkRect,
  height: number,
): { y1: number; y2: number } | null {
  if (!Number.isFinite(height) || height <= 0) return null;
  if (!Number.isFinite(rect.y) || !Number.isFinite(rect.h) || rect.h <= 0) return null;
  const y1 = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)));
  const y2 = Math.max(y1 + 1, Math.min(height, Math.round((rect.y + rect.h) * height)));
  return { y1, y2 };
}

/** 밴드 URL 3개 → data-link-bands 값. top/bottom 은 없을 수 있다. */
export function buildLinkBandsAttr(
  top: string | null,
  mid: string,
  bottom: string | null,
): string {
  return `${top ?? ''}|${mid}|${bottom ?? ''}`;
}

export function parseLinkBands(
  s: string | null | undefined,
): { top: string | null; mid: string; bottom: string | null } | null {
  if (!s) return null;
  const parts = s.split('|');
  if (parts.length !== 3) return null;
  const [top, mid, bottom] = parts as [string, string, string];
  if (!mid) return null;
  return { top: top || null, mid, bottom: bottom || null };
}

/** img 태그의 style 에서 폭 선언을 추출 — 없으면 width attr(px), 그것도 없으면 100% */
function extractWidthDecl(tag: string): string {
  const style = tag.match(/\bstyle="([^"]*)"/)?.[1] ?? '';
  const decl = style.match(/(?<![\w-])width:\s*(\d+(?:\.\d+)?)(px|%)/);
  if (decl) return `width: ${decl[1]}${decl[2]}`;
  const attr = tag.match(/(?<![\w-])width="(\d+(?:\.\d+)?)"/)?.[1];
  if (attr) return `width: ${attr}px`;
  return 'width: 100%';
}

const BAND_IMG_STYLE = 'display: block; width: 100%; height: auto;';

/** 밴드 이미지 하나만(앞뒤 공백·<br> 허용) 들어 있는 문단 — 문단째 테이블로 교체할 대상 */
const SOLE_IMG_PARAGRAPH_RE =
  /<p\b([^>]*)>\s*(?:<br\s*\/?>\s*)*(<img\b[^>]*>)\s*(?:<br\s*\/?>\s*)*<\/p>/gi;

/**
 * 문단의 text-align 을 테이블 가로 정렬 margin 으로 옮긴다.
 * 문단을 걷어내면 text-align 상속이 끊기므로, 폭이 100% 가 아닌 밴드가
 * 왼쪽으로 쏠리지 않게 테이블 자신이 정렬을 들고 있어야 한다.
 */
function alignDeclFromParagraph(attrs: string): string {
  const style = attrs.match(/\bstyle="([^"]*)"/i)?.[1] ?? '';
  const align = style.match(/text-align:\s*(center|right)/i)?.[1]?.toLowerCase();
  if (align === 'center') return '; margin: 0 auto';
  if (align === 'right') return '; margin-left: auto; margin-right: 0';
  return '';
}

/** data-link-bands 를 가진 img 태그 → 가로 밴드 <table>. 밴드 정보가 없으면 null. */
function buildBandTable(tag: string, alignDecl: string): string | null {
  const bands = parseLinkBands(tag.match(/data-link-bands="([^"]*)"/)?.[1]);
  if (!bands) return null;
  const widthDecl = extractWidthDecl(tag);
  // font-size/line-height 0: 클라이언트가 셀 안에 공백 텍스트 노드를 만들어도
  // 밴드 사이에 틈이 생기지 않게 하는 슬라이스 메일 표준 보정
  const row = (inner: string) =>
    `<tr><td class="${LINK_BANDS_CLASS}" style="padding: 0; font-size: 0px; line-height: 0;">${inner}</td></tr>`;
  const bandImg = (src: string, alt: string) =>
    `<img src="${src}" alt="${alt}" style="${BAND_IMG_STYLE}">`;
  const rows = [
    bands.top ? row(bandImg(bands.top, '')) : '',
    row(
      `<a href="{{invite_link}}" target="_blank" rel="noopener noreferrer">` +
        `${bandImg(bands.mid, '설문 참여 링크')}</a>`,
    ),
    bands.bottom ? row(bandImg(bands.bottom, '')) : '',
  ].join('');
  return (
    `<table class="${LINK_BANDS_CLASS}" ` +
    `style="${widthDecl}; max-width: 100%; border-collapse: collapse${alignDecl};">` +
    `<tbody>${rows}</tbody></table>`
  );
}

/**
 * data-link-bands 를 가진 img 를 가로 밴드 <table> 로 치환.
 * 가운데 밴드는 <a href="{{invite_link}}"> 로 감싼다.
 * data-link-* 속성은 여기서 제거하지 않는다 — sanitize 가 최종 스트립.
 */
export function expandImageLinkAreas(html: string): string {
  if (!html || !html.includes('data-link-bands')) return html;
  // 1단계: 밴드 이미지 하나만 담은 문단은 문단째 교체.
  //   <table> 은 <p> 안에 올 수 없어 파서가 문단을 강제로 닫고 빈 <p> 를 남기는데,
  //   그 껍데기가 sanitize 의 fillEmptyParagraphs 를 만나 빈 줄(&nbsp;)로 렌더되어
  //   배너 위에 문단 높이+상하 margin 만큼 여백이 생긴다. 문단을 먼저 걷어내면
  //   껍데기 자체가 만들어지지 않는다.
  const unwrapped = html.replace(SOLE_IMG_PARAGRAPH_RE, (whole, attrs: string, imgTag: string) => {
    return buildBandTable(imgTag, alignDeclFromParagraph(attrs)) ?? whole;
  });
  // 2단계: 문단 밖이거나 텍스트와 섞여 있는 밴드 이미지는 제자리 치환.
  //   문단째 걷어내면 같은 문단의 텍스트가 유실되므로 기존 동작을 유지한다.
  //   1단계가 만든 테이블 안의 밴드 img 는 data-link-bands 가 없어 그대로 통과.
  return unwrapped.replace(IMG_TAG_RE, (tag) => buildBandTable(tag, '') ?? tag);
}
