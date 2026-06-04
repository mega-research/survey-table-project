import { NextRequest, NextResponse } from 'next/server';

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/nextjs';

import { requireAuth } from '@/lib/auth';

// Cloudflare R2는 S3 호환 API를 사용합니다
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env['CLOUDFLARE_R2_ACCESS_KEY'] || '',
    secretAccessKey: process.env['CLOUDFLARE_R2_SECRET_KEY'] || '',
  },
});

export async function POST(request: NextRequest) {
  try {
    await requireAuth();

    // CSRF 보호: cross-origin POST 거부
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return NextResponse.json({ error: 'Cross-origin 요청 거부' }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: '잘못된 origin' }, { status: 400 });
      }
    }

    const body = await request.json();
    const { urls } = body;

    if (!urls || !Array.isArray(urls)) {
      return NextResponse.json({ error: '이미지 URL 배열이 필요합니다.' }, { status: 400 });
    }

    // 환경 변수 확인
    const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
    if (!bucketName) {
      const error = new Error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
      console.error(error.message);
      Sentry.captureException(error);
      return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 });
    }

    const publicUrl = process.env['CLOUDFLARE_R2_PUBLIC_URL'];
    if (!publicUrl) {
      return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 });
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
        Sentry.captureException(error, {
          tags: { operation: 'image_delete', url },
          level: 'warning',
        });
        failedUrls.push(url);
      }
    }

    return NextResponse.json({
      success: true,
      deleted: deletedUrls.length,
      failed: failedUrls.length,
      deletedUrls,
      failedUrls,
    });
  } catch (error) {
    if (error instanceof Error && error.message === '인증이 필요합니다.') {
      return NextResponse.json({ error: '권한 없음' }, { status: 401 });
    }
    console.error('이미지 삭제 오류:', error);
    Sentry.captureException(error, {
      tags: { operation: 'image_batch_delete' },
    });
    return NextResponse.json({ error: '이미지 삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
