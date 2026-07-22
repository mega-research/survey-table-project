/**
 * 메일 이미지 클릭 영역(이미지맵) 지원.
 *
 * 에디터는 img 에 data-link-rect(0~1 상대좌표)·data-link-natural(원본 W,H)·
 * data-link-coords(직렬화 시 파생된 픽셀좌표)만 심는다. 발송/미리보기 직전
 * renderMailPreview 진입점에서 expandImageLinkAreas 가 usemap + <map><area> 를
 * 생성하고, href 의 {{invite_link}} 는 기존 변수 치환 파이프라인이 실제 URL 로
 * 바꾼다 (변수 치환보다 먼저 실행되어야 하는 이유).
 *
 * <area coords> 는 픽셀 고정이라 %폭 이미지는 클라이언트별 렌더폭이 달라져
 * 좌표가 어긋난다. 따라서 클릭 영역 이미지는 px 고정폭(width attr)을 강제하고,
 * 모바일 축소 어긋남 방지를 위해 IMAGE_LINK_AREA_MAX_WIDTH 이하만 허용한다.
 */

/** 360px 폭 기기(컨테이너 padding 32px 제외 가용폭 328px)까지 무축소로 렌더되는 안전폭 */
export const IMAGE_LINK_AREA_MAX_WIDTH = 320;

const IMG_TAG_RE = /<img\b[^>]*>/g;

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

/** 상대좌표 rect → <area coords> 픽셀 문자열. 입력 불량 시 null. */
export function deriveLinkCoords(
  rect: LinkRect,
  naturalWidth: number,
  naturalHeight: number,
  displayWidth: number,
): string | null {
  const nums = [rect.x, rect.y, rect.w, rect.h, naturalWidth, naturalHeight, displayWidth];
  if (!nums.every((n) => Number.isFinite(n))) return null;
  if (naturalWidth <= 0 || naturalHeight <= 0 || displayWidth <= 0) return null;
  if (rect.w <= 0 || rect.h <= 0) return null;
  const w = displayWidth;
  const h = (displayWidth * naturalHeight) / naturalWidth;
  const x1 = Math.round(rect.x * w);
  const y1 = Math.round(rect.y * h);
  const x2 = Math.round((rect.x + rect.w) * w);
  const y2 = Math.round((rect.y + rect.h) * h);
  return `${x1},${y1},${x2},${y2}`;
}

/**
 * data-link-coords 를 가진 img 에 usemap 을 부여하고 바로 뒤에 <map> 형제를 생성.
 * data-link-* 속성은 여기서 제거하지 않는다 — sanitize 가 최종 스트립.
 */
export function expandImageLinkAreas(html: string): string {
  if (!html || !html.includes('data-link-coords')) return html;
  let seq = 0;
  return html.replace(IMG_TAG_RE, (tag) => {
    const m = tag.match(/data-link-coords="([\d,\s]+)"/);
    if (!m || m[1] === undefined) return tag;
    const coords = m[1].trim();
    const name = `m-link-${seq}`;
    seq += 1;
    const withUsemap = tag.replace(/(\s*\/?)>$/, ` usemap="#${name}"$1>`);
    return (
      `${withUsemap}<map name="${name}">` +
      `<area shape="rect" coords="${coords}" href="{{invite_link}}" ` +
      `target="_blank" rel="noopener noreferrer" alt="설문 참여 링크"></map>`
    );
  });
}

/**
 * 클릭 영역(data-link-rect)이 지정됐는데 px 폭이 없거나 기준 초과인 img 개수.
 * 템플릿 저장 검증용 — 영역 지정 후 이미지를 재확대하는 우회 차단.
 */
export function countOversizedLinkAreaImages(html: string): number {
  if (!html || !html.includes('data-link-rect')) return 0;
  let count = 0;
  for (const tag of html.match(IMG_TAG_RE) ?? []) {
    if (!tag.includes('data-link-rect')) continue;
    const m = tag.match(/(?<![\w-])width="(\d+(?:\.\d+)?)"/);
    const width = m?.[1] != null ? Number(m[1]) : null;
    if (width === null || width > IMAGE_LINK_AREA_MAX_WIDTH) count += 1;
  }
  return count;
}
