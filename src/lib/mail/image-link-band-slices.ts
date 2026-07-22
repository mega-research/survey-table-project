/**
 * 메일 이미지 클릭 영역 — 가로 밴드 슬라이스 생성 (서버 전용).
 *
 * 템플릿 저장 시 bodyHtml 의 img[data-link-rect] 를 찾아 원본을 R2 에서 받아
 * sharp 로 top/mid/bottom 가로 밴드로 자르고, 업로드한 밴드 URL 을
 * data-link-bands 속성으로 주입한다. 발송 변환(expandImageLinkAreas)은 이
 * 속성만 읽는 순수 함수로 분리되어 있다.
 *
 * 밴드 key 는 (src + rect) 해시로 결정적 — rect 가 같으면 같은 key 에
 * overwrite 되어 재저장이 idempotent 하다. rect 변경 시 이전 밴드 조각은
 * R2 에 orphan 으로 남는다 (소용량, 수용).
 */
import { createHash } from 'crypto';

import sharp from 'sharp';

import { downloadR2Object, uploadR2Object } from '@/lib/image-utils-server';
import { getR2PublicUrl } from '@/lib/r2-env';

import {
  IMG_TAG_RE,
  buildLinkBandsAttr,
  computeBandRows,
  parseLinkRect,
} from './image-link-area';

/** sharp format → 파일 확장자/컨텐트 타입. 미지원 포맷은 png 로 재인코딩. */
function formatInfo(format: string | undefined): { ext: string; mime: string; reencode: boolean } {
  switch (format) {
    case 'jpeg':
      return { ext: 'jpg', mime: 'image/jpeg', reencode: false };
    case 'png':
      return { ext: 'png', mime: 'image/png', reencode: false };
    case 'webp':
      return { ext: 'webp', mime: 'image/webp', reencode: false };
    case 'gif':
      // gif 는 extract 시 애니메이션이 깨질 수 있어 png 로 재인코딩
      return { ext: 'png', mime: 'image/png', reencode: true };
    default:
      return { ext: 'png', mime: 'image/png', reencode: true };
  }
}

/**
 * bodyHtml 의 클릭 영역 이미지에 밴드 슬라이스를 생성·주입한다.
 *
 * - data-link-rect 가 없으면 원본 그대로 반환 (no-op).
 * - src 가 우리 R2 공개 URL 이 아닌 이미지는 스킵 (외부 이미지 미지원).
 * - 다운로드/슬라이스/업로드 실패는 throw — caller(템플릿 저장)가 저장을 중단하고
 *   사용자에게 에러를 보여준다. 절반만 처리된 상태로 저장되는 것을 막는다.
 */
export async function ensureImageLinkBandSlices(bodyHtml: string): Promise<string> {
  if (!bodyHtml || !bodyHtml.includes('data-link-rect')) return bodyHtml;
  const publicUrl = getR2PublicUrl();

  let out = bodyHtml;
  for (const tag of bodyHtml.match(IMG_TAG_RE) ?? []) {
    if (!tag.includes('data-link-rect')) continue;
    const rect = parseLinkRect(tag.match(/data-link-rect="([^"]*)"/)?.[1]);
    const src = tag.match(/\bsrc="([^"]+)"/)?.[1];
    if (!rect || !src || !src.startsWith(`${publicUrl}/`)) continue;

    const buf = await downloadR2Object(src.slice(publicUrl.length + 1));
    const meta = await sharp(buf).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width <= 0 || height <= 0) {
      throw new Error('클릭 영역 이미지의 크기를 읽을 수 없습니다.');
    }
    const rows = computeBandRows(rect, height);
    if (!rows) continue;

    const { ext, mime, reencode } = formatInfo(meta.format);
    const hash = createHash('sha1')
      .update(`${src}|${rect.x},${rect.y},${rect.w},${rect.h}`)
      .digest('hex')
      .slice(0, 16);

    const makeBand = async (top: number, bandHeight: number, name: string): Promise<string> => {
      let pipeline = sharp(buf).extract({ left: 0, top, width, height: bandHeight });
      if (reencode) pipeline = pipeline.png();
      const bandBuf = await pipeline.toBuffer();
      const key = `mail/link-bands/${hash}-${name}.${ext}`;
      await uploadR2Object(key, bandBuf, mime);
      return `${publicUrl}/${key}`;
    };

    const topUrl = rows.y1 > 0 ? await makeBand(0, rows.y1, 'top') : null;
    const midUrl = await makeBand(rows.y1, rows.y2 - rows.y1, 'mid');
    const bottomUrl = rows.y2 < height ? await makeBand(rows.y2, height - rows.y2, 'bottom') : null;

    // 이전 저장의 stale 밴드 속성을 제거하고 새 값 주입
    const cleaned = tag.replace(/\s+data-link-bands="[^"]*"/, '');
    const withBands = cleaned.replace(
      /(\s*\/?)>$/,
      ` data-link-bands="${buildLinkBandsAttr(topUrl, midUrl, bottomUrl)}"$1>`,
    );
    out = out.replace(tag, withBands);
  }
  return out;
}
