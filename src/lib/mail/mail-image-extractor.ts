import type { MailAttachment } from '@/db/schema/schema-types';
import { extractImageUrlsFromHtml } from '@/lib/image-extractor';

/**
 * 메일 템플릿에서 사용된 모든 이미지 URL을 추출합니다.
 * bodyHtml의 <img src> + attachments의 R2 key를 함께 반환합니다.
 *
 * 주의: attachments는 URL 이 아닌 R2 object key(예: "mail/<surveyId>/<uuid>.pdf")를
 * 저장하므로 별도로 처리해야 합니다. 이 함수는 HTML 이미지 URL과 첨부 key를
 * 분리하여 반환합니다.
 */
export interface MailTemplateAssets {
  /** bodyHtml에서 추출한 이미지 URL 목록 (중복 제거) */
  imageUrls: string[];
  /** attachments의 R2 object key 목록 (중복 제거) */
  attachmentKeys: string[];
}

/**
 * 메일 템플릿 에셋(이미지 URL + 첨부 key)을 추출합니다.
 *
 * @param template bodyHtml과 attachments를 포함한 객체
 * @returns imageUrls (bodyHtml img src) + attachmentKeys (R2 key)
 */
export function extractMailTemplateAssets(template: {
  bodyHtml?: string | null;
  attachments?: Array<Partial<MailAttachment>> | null;
}): MailTemplateAssets {
  const imageUrls: string[] = [];
  const attachmentKeys: string[] = [];

  if (template.bodyHtml) {
    imageUrls.push(...extractImageUrlsFromHtml(template.bodyHtml));
  }

  if (template.attachments) {
    for (const att of template.attachments) {
      if (att.key) {
        attachmentKeys.push(att.key);
      }
    }
  }

  return {
    imageUrls: [...new Set(imageUrls)],
    attachmentKeys: [...new Set(attachmentKeys)],
  };
}

/**
 * 두 URL 배열의 차집합을 반환합니다.
 * orphan = 기존에 있었지만 새 버전에 없는 URL (삭제해야 할 대상).
 *
 * @param oldUrls 업데이트 전 URL 목록
 * @param newUrls 업데이트 후 URL 목록
 * @returns 삭제해야 할 URL 목록 (중복 제거)
 */
export function diffOrphanImages(oldUrls: string[], newUrls: string[]): string[] {
  const newSet = new Set(newUrls);
  return [...new Set(oldUrls.filter((url) => !newSet.has(url)))];
}

/**
 * 두 R2 key 배열의 차집합을 반환합니다.
 * orphan = 기존에 있었지만 새 버전에 없는 key (삭제해야 할 대상).
 *
 * @param oldKeys 업데이트 전 attachment key 목록
 * @param newKeys 업데이트 후 attachment key 목록
 * @returns 삭제해야 할 key 목록 (중복 제거)
 */
export function diffOrphanAttachmentKeys(oldKeys: string[], newKeys: string[]): string[] {
  const newSet = new Set(newKeys);
  return [...new Set(oldKeys.filter((key) => !newSet.has(key)))];
}
