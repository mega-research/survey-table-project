import * as z from 'zod';

import { TMP_ATTACHMENT_PREFIX } from '@/lib/mail/constants';
import { TMP_NOTICE_ATTACHMENT_PREFIX } from '@/lib/upload/attachment-policy';

/**
 * media feature 도메인 — R2 미디어/첨부 삭제 procedure 의 입출력 스키마.
 *
 * 범위(독립 부분):
 * - deleteImages: 이미지 URL 배열 일괄 삭제 (기존 POST /api/upload/image/delete 대체)
 * - deleteMailAttachmentTmp: 메일 첨부 tmp 키 삭제 (기존 DELETE /api/upload/mail-attachment 대체)
 * - deleteNoticeAttachmentTmp: 공지 첨부 tmp 키 삭제 (기존 DELETE /api/upload/notice-attachment 대체)
 *
 * 범위 밖(이번 마이그레이션 제외 — 컨트롤러/다른 feature 처리):
 * - upload(image/mail-attachment/notice-attachment) POST 멀티파트 라우트는 REST 유지.
 * - promote / moveR2Object 등 R2 move/promote 는 cross-cutting(lib 유지).
 */

// ========================
// deleteImages
// ========================

/**
 * 삭제가 허용되는 R2 이미지 key namespace.
 * - tmp/: 업로드 직후 임시 객체(tmp/<kind>/...).
 * - survey/: promote 후 영구 이미지(tmp/survey/ → survey/).
 * 그 외 namespace(mail/ 영구 첨부, 루트 키 등)는 deleteImages 의 대상이 아니다.
 */
export const ALLOWED_IMAGE_KEY_PREFIXES = ['tmp/', 'survey/'] as const;

/**
 * R2 object key 가 삭제 허용 namespace 안에 있고 traversal 이 없는지 판정.
 * - publicUrl substring 포함만으로 임의 영구 키(survey/<known>.webp 등)가 지워지지
 *   않도록, URL→key 추출 후 service 가 이 게이트로 재검증한다(형제 첨부 라우트와 대칭).
 * - '..'/'//' traversal 거부.
 */
export function isAllowedImageDeletionKey(key: string): boolean {
  if (key.includes('..') || key.includes('//')) return false;
  return ALLOWED_IMAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * 이미지 URL 일괄 삭제 입력.
 * - 각 항목은 절대 URL(http/https) 이어야 한다. bare key 문자열(스킴 없는 상대 경로)은
 *   거부 — 영구 키를 url 로 위장해 우회하는 것을 차단.
 * - traversal('..'/'//') path 거부(형제 첨부 삭제와 대칭).
 * - 외부(non-R2) URL 은 service 단계에서 skip 되므로 입력에서는 막지 않는다(정상
 *   cleanup batch 가 외부/우리 URL 을 섞어 보낼 수 있음).
 */
export const DeleteImagesInput = z.object({
  urls: z.array(
    z
      .string()
      .refine((u) => !u.includes('..'), {
        message: '유효하지 않은 이미지 URL 입니다.',
      })
      .refine(
        (u) => {
          let parsed: URL;
          try {
            parsed = new URL(u);
          } catch {
            // 절대 URL 이 아니면 거부(스킴 없는 bare key 차단).
            return false;
          }
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false;
          }
          // path 단계 traversal('//') 거부 — scheme 의 '://' 와 구분하기 위해
          // pathname 만 검사한다.
          if (parsed.pathname.includes('//')) return false;
          return true;
        },
        { message: '유효하지 않은 이미지 URL 입니다.' },
      ),
  ),
});
export type DeleteImagesInput = z.infer<typeof DeleteImagesInput>;

/** 삭제 결과. R2 URL 만 실제 삭제 대상이라 deleted/failed 카운트 분리. */
export const DeleteImagesResult = z.object({
  success: z.literal(true),
  deleted: z.number(),
  failed: z.number(),
  deletedUrls: z.array(z.string()),
  failedUrls: z.array(z.string()),
});
export type DeleteImagesResult = z.infer<typeof DeleteImagesResult>;

// ========================
// 첨부 tmp 삭제 (safety gate: tmp prefix 만 허용)
// ========================

/**
 * 메일 첨부 tmp 키 삭제 입력.
 * - tmp/mail-attachment/ prefix 만 허용(영구 객체 임의 삭제 차단).
 * - 경로 traversal('..', '//') 차단.
 */
export const DeleteMailAttachmentTmpInput = z.object({
  key: z
    .string()
    .startsWith(TMP_ATTACHMENT_PREFIX, {
      message: 'tmp/mail-attachment/ prefix 만 삭제 가능합니다.',
    })
    .refine((k) => !k.includes('..') && !k.includes('//'), {
      message: '유효하지 않은 key 입니다.',
    }),
});
export type DeleteMailAttachmentTmpInput = z.infer<
  typeof DeleteMailAttachmentTmpInput
>;

/**
 * 공지 첨부 tmp 키 삭제 입력.
 * - tmp/notice-attachment/ prefix 만 허용.
 * - 경로 traversal 차단.
 */
export const DeleteNoticeAttachmentTmpInput = z.object({
  key: z
    .string()
    .startsWith(TMP_NOTICE_ATTACHMENT_PREFIX, {
      message: 'tmp/notice-attachment/ prefix 만 삭제 가능합니다.',
    })
    .refine((k) => !k.includes('..') && !k.includes('//'), {
      message: '유효하지 않은 key 입니다.',
    }),
});
export type DeleteNoticeAttachmentTmpInput = z.infer<
  typeof DeleteNoticeAttachmentTmpInput
>;

/** 첨부 삭제 결과 — best-effort(R2 lifecycle 안전망). */
export const DeleteAttachmentTmpResult = z.object({
  ok: z.literal(true),
});
export type DeleteAttachmentTmpResult = z.infer<
  typeof DeleteAttachmentTmpResult
>;
