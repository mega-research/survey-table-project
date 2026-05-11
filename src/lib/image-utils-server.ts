/**
 * 서버 사이드 이미지/파일 삭제 유틸리티
 * 서버 액션에서 R2에 직접 접근하여 이미지 및 파일을 삭제합니다.
 */
import { CopyObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/nextjs';

// Cloudflare R2는 S3 호환 API를 사용합니다
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY || '',
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY || '',
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
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET;
  if (!bucketName) {
    console.error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
    return false;
  }

  const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;
  if (!publicUrl) {
    console.error('Cloudflare R2 공개 URL이 설정되지 않았습니다.');
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
      console.error(`이미지 삭제 실패 (${url}):`, error);
      failedUrls.push(url);
    }
  }

  // 일부라도 성공했거나 모두 외부 URL이었으면 성공으로 간주
  if (deletedUrls.length > 0 || failedUrls.length === 0) {
    if (failedUrls.length > 0) {
      console.warn(`일부 이미지 삭제 실패: ${failedUrls.length}개`);
    }
    return true;
  }

  return false;
}

/**
 * R2 객체를 한 key에서 다른 key로 복사 + 원본 삭제 (move 동작).
 * 단일 작업이라 트랜잭션 아님 — COPY 성공 후 DELETE 실패 시 원본 객체 남음 (lifecycle이 처리).
 * @returns 성공 시 true, 실패 시 false
 */
export async function moveR2Object(srcKey: string, dstKey: string): Promise<boolean> {
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET;
  if (!bucketName) return false;

  try {
    await r2Client.send(
      new CopyObjectCommand({
        Bucket: bucketName,
        CopySource: `${bucketName}/${srcKey}`,
        Key: dstKey,
      }),
    );
    await r2Client
      .send(new DeleteObjectCommand({ Bucket: bucketName, Key: srcKey }))
      .catch(() => {
        // DELETE 실패해도 COPY는 됐으니 OK. tmp/ lifecycle이 처리.
      });
    return true;
  } catch (error) {
    console.error(`R2 move 실패 ${srcKey} → ${dstKey}:`, error);
    Sentry.captureException(error, {
      tags: { operation: 'r2_move' },
      extra: { srcKey, dstKey },
      level: 'warning',
    });
    return false;
  }
}

/**
 * 여러 R2 객체 batch move.
 * 실패한 src는 그대로 두고 (lifecycle 처리), 성공/실패 분리해 반환.
 */
export async function moveR2Objects(
  pairs: Array<{ srcKey: string; dstKey: string }>,
): Promise<{ movedKeys: Array<{ srcKey: string; dstKey: string }>; failed: string[] }> {
  const movedKeys: Array<{ srcKey: string; dstKey: string }> = [];
  const failed: string[] = [];

  for (const pair of pairs) {
    const ok = await moveR2Object(pair.srcKey, pair.dstKey);
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

  const bucketName = process.env.CLOUDFLARE_R2_BUCKET;
  if (!bucketName) {
    console.error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
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
      console.error(`R2 파일 삭제 실패 (key: ${key}):`, error);
      failedKeys.push(key);
    }
  }

  if (failedKeys.length > 0) {
    console.warn(`일부 R2 파일 삭제 실패: ${failedKeys.length}개`);
  }

  return true; // partial failure는 허용 — caller는 어쨌든 success 처리
}
