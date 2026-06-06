import type { MailAttachment } from '@/db/schema/schema-types';
import { client } from '@/shared/lib/rpc';

import {
  MAX_ATTACHMENT_FILE_BYTES,
  TMP_ATTACHMENT_PREFIX,
} from './constants';

const UPLOAD_ENDPOINT = '/api/upload/mail-attachment';

export type UploadResult =
  | { ok: true; attachment: MailAttachment }
  | { ok: false; error: string };

/**
 * 메일 첨부 단건 업로드. 사전 클라이언트 검증 + 서버 응답 shape 검증을 한 곳에서.
 * 에러는 throw 하지 않고 결과로 반환 — 호출자가 결과별로 다르게 처리하도록.
 */
export async function uploadMailAttachment(file: File): Promise<UploadResult> {
  if (file.size === 0) {
    return { ok: false, error: `${file.name}: 빈 파일은 업로드할 수 없습니다.` };
  }
  if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
    return {
      ok: false,
      error: `${file.name}: 한도(${Math.round(MAX_ATTACHMENT_FILE_BYTES / 1024 / 1024)}MB) 를 초과합니다.`,
    };
  }

  const fd = new FormData();
  fd.append('file', file);

  let res: Response;
  try {
    res = await fetch(UPLOAD_ENDPOINT, { method: 'POST', body: fd });
  } catch {
    return { ok: false, error: `${file.name}: 네트워크 오류로 업로드에 실패했습니다.` };
  }

  let body: Partial<MailAttachment> & { error?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return {
      ok: false,
      error: `${file.name}: 서버 응답을 해석할 수 없습니다 (HTTP ${res.status}).`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `${file.name}: ${body.error ?? `업로드 실패 (HTTP ${res.status})`}`,
    };
  }

  if (
    typeof body.key !== 'string' ||
    typeof body.filename !== 'string' ||
    typeof body.size !== 'number' ||
    typeof body.mime !== 'string'
  ) {
    return { ok: false, error: `${file.name}: 서버 응답이 비정상입니다.` };
  }

  return {
    ok: true,
    attachment: {
      key: body.key,
      filename: body.filename,
      size: body.size,
      mime: body.mime,
    },
  };
}

/**
 * tmp 첨부 객체 R2 삭제. 영구 prefix 는 cleanup orchestrator 가 처리하므로 silent skip.
 * 네트워크 실패는 swallow — 24h R2 lifecycle 이 안전망.
 */
export async function deleteMailAttachmentTmp(key: string): Promise<void> {
  if (!key.startsWith(TMP_ATTACHMENT_PREFIX)) return;
  // orpc .call 은 실패 시 throw 하므로 try/catch 로 감싸 best-effort(void 반환) 계약을 보존한다.
  try {
    await client.media.deleteMailAttachmentTmp({ key });
  } catch (err) {
    console.error('첨부 tmp 삭제 네트워크 실패:', err);
  }
}

/**
 * 여러 tmp 첨부를 한 번에 정리. cancel/unmount 시 누락 cleanup 용.
 */
export function deleteMailAttachmentTmpBatch(attachments: MailAttachment[]): void {
  for (const a of attachments) {
    if (a.key.startsWith(TMP_ATTACHMENT_PREFIX)) {
      void deleteMailAttachmentTmp(a.key);
    }
  }
}
