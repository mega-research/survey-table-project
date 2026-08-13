import 'server-only';

import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Cloudflare R2는 S3 호환 API 사용 (image-utils-server 와 동일 env)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env['CLOUDFLARE_R2_ACCESS_KEY'] || '',
    secretAccessKey: process.env['CLOUDFLARE_R2_SECRET_KEY'] || '',
  },
});

export type R2DeleteResult = { ok: true } | { ok: false; error: string };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 키 단위 결과를 반환하는 R2 삭제 + HEAD 검증.
 *
 * 기존 best-effort 유틸(deleteImagesFromR2Server 등 — 부분 실패 swallow)은
 * 재사용하지 않는다. 영구 키를 실제로 지우는 코드는 유예 삭제 집행부의 이
 * 함수뿐이어야 한다 — 다른 경로에서 import 금지.
 */
export async function deleteR2ObjectVerified(key: string): Promise<R2DeleteResult> {
  const bucket = process.env['CLOUDFLARE_R2_BUCKET'];
  if (!bucket) return { ok: false, error: 'CLOUDFLARE_R2_BUCKET 환경변수 미설정' };

  try {
    await r2Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    return { ok: false, error: `DeleteObject 실패: ${errorMessage(e)}` };
  }

  // HEAD 검증 — NotFound(404)여야 삭제 완료로 회계한다
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { ok: false, error: 'HEAD 검증 실패: 삭제 후에도 객체가 존재' };
  } catch (e) {
    const name = (e as { name?: string }).name;
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (name === 'NotFound' || status === 404) return { ok: true };
    return { ok: false, error: `HEAD 검증 오류: ${errorMessage(e)}` };
  }
}
