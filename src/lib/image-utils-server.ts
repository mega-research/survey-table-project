/**
 * 서버 사이드 이미지/파일 삭제 유틸리티
 * 서버 액션에서 R2에 직접 접근하여 이미지 및 파일을 삭제합니다.
 */
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/nextjs';

import { logger } from '@/lib/logger';

// Cloudflare R2는 S3 호환 API를 사용합니다
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env['CLOUDFLARE_R2_ACCESS_KEY'] || '',
    secretAccessKey: process.env['CLOUDFLARE_R2_SECRET_KEY'] || '',
  },
});

/**
 * 서버에서 R2의 이미지를 삭제합니다.
 * @param urls 삭제할 이미지 URL 배열
 * @returns 삭제 성공 여부
 */
export async function deleteImagesFromR2Server(urls: string[]): Promise<boolean> {
  if (!urls || urls.length === 0) {
    return true;
  }

  // 환경 변수 확인
  const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
  if (!bucketName) {
    logger.error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
    return false;
  }

  const publicUrl = process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  if (!publicUrl) {
    logger.error('Cloudflare R2 공개 URL이 설정되지 않았습니다.');
    return false;
  }

  const deletedUrls: string[] = [];
  const failedUrls: string[] = [];

  // 각 이미지 URL에서 파일 경로 추출 및 삭제
  for (const url of urls) {
    try {
      // R2 공개 URL인지 확인
      if (!url.includes(publicUrl)) {
        // 외부 URL이거나 우리 R2 URL이 아닌 경우 건너뛰기
        continue;
      }

      // URL에서 파일 경로 추출
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const key = pathname.startsWith('/') ? pathname.substring(1) : pathname;

      // R2에서 삭제
      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      await r2Client.send(command);
      deletedUrls.push(url);
    } catch (error) {
      logger.error({ url, err: error }, '이미지 삭제 실패');
      failedUrls.push(url);
    }
  }

  // 일부라도 성공했거나 모두 외부 URL이었으면 성공으로 간주
  if (deletedUrls.length > 0 || failedUrls.length === 0) {
    if (failedUrls.length > 0) {
      logger.warn({ failedCount: failedUrls.length }, '일부 이미지 삭제 실패');
    }
    return true;
  }

  return false;
}

/**
 * R2 객체를 한 key에서 다른 key로 복사합니다 (copy-only, 원본 미삭제).
 * 과거에는 COPY + DELETE(move) 였으나, 부분 실패 롤백이나 후속 DB 갱신 실패 시
 * 원본이 이미 사라져 콘텐츠가 참조하는 유일 사본을 잃는 사고가 있었다 — 이제 원본(srcKey)은
 * 절대 삭제하지 않는다. 실패의 최악 결과는 "tmp 잔존(무해)"이 된다.
 * tmp 잔여물은 R2 lifecycle(tmp/ 24h) 위임 — 대시보드 규칙 존재 확인 필요(키 권한으로 코드에서 미검증).
 * @returns 성공 시 true, 실패 시 false
 */
export async function copyR2Object(srcKey: string, dstKey: string): Promise<boolean> {
  const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
  if (!bucketName) return false;

  try {
    await r2Client.send(
      new CopyObjectCommand({
        Bucket: bucketName,
        CopySource: `${bucketName}/${srcKey}`,
        Key: dstKey,
      }),
    );
    return true;
  } catch (error) {
    logger.error({ srcKey, dstKey, err: error }, 'R2 copy 실패');
    Sentry.captureException(error, {
      tags: { operation: 'r2_copy' },
      extra: { srcKey, dstKey },
      level: 'warning',
    });
    return false;
  }
}

/**
 * 여러 R2 객체 batch copy (원본 미삭제).
 * 실패한 src는 그대로 두고 (재시도 또는 lifecycle 처리), 성공/실패 분리해 반환.
 */
export async function copyR2Objects(
  pairs: Array<{ srcKey: string; dstKey: string }>,
): Promise<{ movedKeys: Array<{ srcKey: string; dstKey: string }>; failed: string[] }> {
  const movedKeys: Array<{ srcKey: string; dstKey: string }> = [];
  const failed: string[] = [];

  for (const pair of pairs) {
    const ok = await copyR2Object(pair.srcKey, pair.dstKey);
    if (ok) movedKeys.push(pair);
    else failed.push(pair.srcKey);
  }

  return { movedKeys, failed };
}

/**
 * R2 object key 목록으로 파일을 삭제합니다.
 * URL이 아닌 key(예: "mail/<surveyId>/<uuid>.pdf")를 직접 받습니다.
 * @param keys 삭제할 R2 object key 배열
 * @returns 삭제 성공 여부 (부분 실패 시 경고 로그 후 true)
 */
export async function deleteR2ObjectsByKey(keys: string[]): Promise<boolean> {
  if (!keys || keys.length === 0) {
    return true;
  }

  const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
  if (!bucketName) {
    logger.error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
    return false;
  }

  const failedKeys: string[] = [];

  for (const key of keys) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });
      await r2Client.send(command);
    } catch (error) {
      logger.error({ key, err: error }, 'R2 파일 삭제 실패');
      failedKeys.push(key);
    }
  }

  if (failedKeys.length > 0) {
    logger.warn({ failedCount: failedKeys.length }, '일부 R2 파일 삭제 실패');
  }

  return true; // partial failure는 허용 — caller는 어쨌든 success 처리
}

/**
 * R2 object key 로 파일 본체를 다운로드해 Buffer 로 반환.
 * 메일 첨부 발송에서 Resend SDK 의 attachments[].content 로 그대로 전달하는 용도.
 * @throws 파일이 없거나 다운로드 실패 시 throw — caller 가 일괄 abort.
 */
export async function downloadR2Object(key: string): Promise<Buffer> {
  const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
  if (!bucketName) throw new Error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');

  const resp = await r2Client.send(
    new GetObjectCommand({ Bucket: bucketName, Key: key }),
  );
  if (!resp.Body) throw new Error(`R2 객체 본체 없음: ${key}`);

  // AWS SDK v3 의 transformToByteArray() — Node 환경에서 Body 가 SdkStream<Readable>.
  const bytes = await resp.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * Buffer 를 R2 object 로 업로드. 동일 key 재업로드는 overwrite (idempotent).
 * 메일 이미지 클릭 영역 밴드 슬라이스 업로드에 사용.
 * @throws 환경 변수 미설정 또는 업로드 실패 시 throw — caller 가 일괄 abort.
 */
export async function uploadR2Object(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
  if (!bucketName) throw new Error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
  await r2Client.send(
    new PutObjectCommand({ Bucket: bucketName, Key: key, Body: body, ContentType: contentType }),
  );
}
