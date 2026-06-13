import 'server-only';

import {
  deleteImagesFromR2Server,
  deleteR2ObjectsByKey,
} from '@/lib/image-utils-server';

import {
  isAllowedImageDeletionKey,
  type DeleteAttachmentTmpResult,
  type DeleteImagesInput,
  type DeleteImagesResult,
  type DeleteMailAttachmentTmpInput,
  type DeleteNoticeAttachmentTmpInput,
} from '../../domain/media';

/**
 * media 서비스 — cross-cutting lib(R2 SDK) 함수에 위임하는 얇은 레이어.
 *
 * 인증은 procedure(authed) 미들웨어가 보장하므로 여기서 requireAuth 호출하지 않는다.
 * 무효화(revalidatePath)는 클라이언트 invalidate 책임이라 여기서 호출하지 않는다.
 * R2 이동/promote 는 cross-cutting 이라 lib 에 유지(이 서비스는 삭제만 위임).
 */

/**
 * URL 을 R2 object key 로 변환. 우리 R2 public URL 이 아니면 null(외부 URL → 삭제 대상 아님).
 * lib deleteImagesFromR2Server 내부 로직과 동일한 규칙(deleted/failed 카운팅 재현용).
 */
function resolveR2KeyFromUrl(url: string, publicUrl: string): string | null {
  if (!url.includes(publicUrl)) return null;
  try {
    const pathname = new URL(url).pathname;
    const key = pathname.startsWith('/') ? pathname.substring(1) : pathname;
    // prefix whitelist 재검증 — publicUrl substring 포함만으로 의도 namespace 밖의
    // 임의 영구 키(survey/<known>.webp 가 아닌 mail/... 등)가 삭제 대상이 되지 않게 한다.
    // (입력 refine 과 이중 게이트 — 형제 첨부 라우트와 대칭)
    if (!isAllowedImageDeletionKey(key)) return null;
    return key;
  } catch {
    return null;
  }
}

/**
 * 이미지 URL 일괄 삭제. 기존 POST /api/upload/image/delete 와 동일한 결과 shape 반환.
 * prefix 게이트(resolveR2KeyFromUrl→isAllowedImageDeletionKey)를 통과한 URL 만
 * lib deleteImagesFromR2Server 에 넘겨 실제 삭제한다. 카운트(deletedUrls/failedUrls)도
 * 같은 게이트 통과 집합 기준이라 보고 shape 와 실제 삭제 대상이 일치한다.
 */
export async function deleteImages(
  input: DeleteImagesInput,
): Promise<DeleteImagesResult> {
  const { urls } = input;

  // 우리 R2 public URL 이면서 prefix 게이트(isAllowedImageDeletionKey)를 통과한
  // URL 만 실제 삭제 대상. 외부 URL·게이트 밖 영구 키(mail/·루트·타 설문 등)는 제외.
  const publicUrl = process.env['CLOUDFLARE_R2_PUBLIC_URL'] ?? '';
  const ownedUrls = publicUrl
    ? urls.filter((url) => resolveR2KeyFromUrl(url, publicUrl) !== null)
    : [];

  // 실제 R2 삭제는 lib 에 위임하되, 게이트 통과 URL(ownedUrls)만 넘긴다.
  // lib 은 url.includes(publicUrl) 만 검사하고 자체적으로 key 를 재추출해 삭제하므로,
  // raw urls 를 넘기면 prefix 게이트를 우회한 cross-survey 객체가 삭제된다(IDOR).
  // 검증 대상(ownedUrls)과 삭제 대상을 일치시켜 게이트가 삭제 경로를 통제하게 한다.
  // (첨부 라우트 deleteMailAttachmentTmp/Notice 와 대칭 — 게이트한 그 대상만 삭제)
  const ok = await deleteImagesFromR2Server(ownedUrls);

  // lib 은 best-effort 라 부분 실패를 swallow → 성공 시 우리 R2 소유 URL 을 deleted 로,
  // 실패(false) 시 전부 failed 로 보고. (외부 URL 은 deleted/failed 어디에도 포함 안 함)
  if (ok) {
    return {
      success: true as const,
      deleted: ownedUrls.length,
      failed: 0,
      deletedUrls: ownedUrls,
      failedUrls: [],
    };
  }

  return {
    success: true as const,
    deleted: 0,
    failed: ownedUrls.length,
    deletedUrls: [],
    failedUrls: ownedUrls,
  };
}

/**
 * 메일 첨부 tmp 객체 삭제. tmp prefix 검증은 input(domain zod)에서 끝났으므로
 * 여기서는 lib deleteR2ObjectsByKey 에 위임만 한다.
 * best-effort — R2 lifecycle 안전망이 있어 부분 실패는 swallow.
 */
export async function deleteMailAttachmentTmp(
  input: DeleteMailAttachmentTmpInput,
): Promise<DeleteAttachmentTmpResult> {
  await deleteR2ObjectsByKey([input.key]);
  return { ok: true as const };
}

/**
 * 공지 첨부 tmp 객체 삭제. tmp prefix 검증은 input(domain zod)에서 끝났으므로
 * 여기서는 lib deleteR2ObjectsByKey 에 위임만 한다.
 */
export async function deleteNoticeAttachmentTmp(
  input: DeleteNoticeAttachmentTmpInput,
): Promise<DeleteAttachmentTmpResult> {
  await deleteR2ObjectsByKey([input.key]);
  return { ok: true as const };
}
