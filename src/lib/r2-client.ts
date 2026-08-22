/**
 * R2 인프라 어댑터 — S3 호환 클라이언트의 단일 소유자.
 *
 * 8개 모듈이 각각 `new S3Client({...})` 를 바이트 단위로 같은 설정으로 만들고 있었다.
 * 자격증명·엔드포인트 규칙이 여러 벌이면 한 곳만 고쳤을 때 조용히 갈리고,
 * 커넥션 풀도 모듈 수만큼 나뉜다. 여기 하나만 둔다.
 *
 * env 검증은 `r2-env.ts` 소관이다 — 그쪽은 SDK 를 모르는 순수 env 헬퍼로 남긴다.
 */
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Cloudflare R2 는 S3 호환 API 를 쓴다.
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env['CLOUDFLARE_R2_ACCESS_KEY'] || '',
    secretAccessKey: process.env['CLOUDFLARE_R2_SECRET_KEY'] || '',
  },
});

/**
 * 영구 위치(dstKey)에 객체가 이미 존재하는지 확인.
 * 클라이언트의 stale state 가 같은 publish 를 N 회 시도해도 idempotent 하도록
 * 첫 publish 가 이미 옮겨놓은 객체를 재인식하는 데 사용한다.
 *
 * bucket env 가 없으면 false — promote 세 경로(설문 이미지·공지 첨부·메일 이미지)가
 * 각자 갖고 있던 사본의 처리와 같다. 여기서 던지면 없던 실패 경로가 생긴다.
 */
export async function permanentObjectExists(dstKey: string): Promise<boolean> {
  const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
  if (!bucketName) return false;
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: dstKey }));
    return true;
  } catch {
    return false;
  }
}

/** 공개 URL 의 pathname 을 R2 object key 로 바꾼다. 파싱 불가면 null. */
export function urlToR2Key(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname;
  } catch {
    return null;
  }
}
