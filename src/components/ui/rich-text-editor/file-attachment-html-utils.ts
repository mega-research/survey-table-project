import {
  NOTICE_ATTACHMENT_PREFIX,
  TMP_NOTICE_ATTACHMENT_PREFIX,
} from '@/lib/upload/attachment-policy';

const ATTACHMENT_TAG_RE = /<a\b[^>]*\bdata-file-attachment="true"[^>]*>/gi;
const DATA_KEY_ATTR_RE = /\bdata-key="([^"]+)"/i;
const HREF_ATTR_RE = /\bhref="([^"]+)"/i;

/**
 * HTML 안 `<a data-file-attachment="true">` 의 attribute 를 모두 수집.
 * `which` 로 data-key 또는 href 중 선택.
 */
function extractAttrValues(html: string, which: 'key' | 'href'): string[] {
  if (!html) return [];
  const re = which === 'key' ? DATA_KEY_ATTR_RE : HREF_ATTR_RE;
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  ATTACHMENT_TAG_RE.lastIndex = 0;
  while ((match = ATTACHMENT_TAG_RE.exec(html)) !== null) {
    const m = match[0].match(re);
    if (m && m[1]) values.add(m[1]);
  }
  return [...values];
}

/** 모든 첨부 키 (prefix 무관). */
export function extractAllAttachmentKeysFromHtml(html: string): string[] {
  return extractAttrValues(html, 'key');
}

/** tmp prefix 첨부 키만. tracker 가 사용. */
export function extractTmpAttachmentKeysFromHtml(html: string): string[] {
  return extractAllAttachmentKeysFromHtml(html).filter((k) =>
    k.startsWith(TMP_NOTICE_ATTACHMENT_PREFIX),
  );
}

/** 영구 prefix 첨부 키만. (유예 삭제 큐의 키 추출은 server/storage-lifecycle/key-extract 가 자체 data-key 스캔으로 수행) */
export function extractPermanentAttachmentKeysFromHtml(html: string): string[] {
  return extractAllAttachmentKeysFromHtml(html).filter(
    (k) => k.startsWith(NOTICE_ATTACHMENT_PREFIX) && !k.startsWith(TMP_NOTICE_ATTACHMENT_PREFIX),
  );
}

/**
 * `<a data-file-attachment="true">` 의 href 값을 모두 추출.
 * URL/prefix 필터는 호출부 책임.
 */
export function extractAttachmentHrefsFromHtml(html: string): string[] {
  return extractAttrValues(html, 'href');
}
