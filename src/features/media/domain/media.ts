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

/** 이미지 URL 일괄 삭제 입력. URL 은 단순 문자열이라 z.string(). */
export const DeleteImagesInput = z.object({
  urls: z.array(z.string()),
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
