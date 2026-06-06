'use client';

import { TMP_NOTICE_ATTACHMENT_PREFIX } from '@/lib/upload/attachment-policy';
import { client } from '@/shared/lib/rpc';

/**
 * 클라이언트 측 R2 tmp 키 best-effort DELETE.
 * R2 24h lifecycle 안전망이 있으므로 실패는 무시.
 * `tmp/notice-attachment/` prefix 아닌 키는 가드해서 무시 — 영구 키 임의 삭제 방지.
 */
export async function deleteTmpNoticeAttachmentKey(key: string | null | undefined): Promise<void> {
  if (!key || !key.startsWith(TMP_NOTICE_ATTACHMENT_PREFIX)) return;
  // orpc .call 은 실패 시 throw 하므로 try/catch 로 감싸 best-effort 계약을 보존한다.
  try {
    await client.media.deleteNoticeAttachmentTmp({ key });
  } catch {
    // best-effort
  }
}

/** 여러 키 병렬 DELETE. */
export async function deleteTmpNoticeAttachmentKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await Promise.all(keys.map((k) => deleteTmpNoticeAttachmentKey(k)));
}
