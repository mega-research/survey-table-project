import { NextRequest, NextResponse } from 'next/server';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/nextjs';
import sharp from 'sharp';

import { type RouteLogContext, withRouteLogging } from '@/lib/logger';
import { r2Client } from '@/lib/r2-client';
import { validateFilename } from '@/lib/upload/attachment-policy';
import {
  AVATAR_SIZE_ERROR,
  AVATAR_TYPE_ERROR,
  AVATAR_UPLOAD_POLICY,
  detectImageKind,
} from '@/lib/upload/image-policy';
import { guardAvatarUploadRoute } from '@/lib/upload/route-guard';

/**
 * 아바타 업로드 — 프로필 화면 전용 (.pen FLOW 3-2 「이미지 변경」).
 *
 * /api/upload/image 와 갈라져 있는 이유는 청중과 정책이 둘 다 다르기 때문이다.
 *   - 청중: 세 계정 유형 모두. 저쪽은 requireAuth(내부 전용)라 게스트·실사가 못 쓴다.
 *   - 정책: SVG 를 받지 않고(아바타는 벡터일 이유가 없고 인라인 스크립트 위험만 남는다),
 *     크기 상한이 훨씬 낮으며, 원본을 보존하지 않고 정사각 WebP 로 깎아 저장한다.
 * 공유할 값어치가 있는 것은 magic byte 감지뿐이라 그것만 정책 모듈로 올렸다.
 */

const { allowedTypes, maxBytes, sizePx } = AVATAR_UPLOAD_POLICY;

async function handleAvatarUpload(request: NextRequest, ctx: RouteLogContext) {
  const guard = await guardAvatarUploadRoute(ctx);
  if (!guard.ok) return guard.response;

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '파일이 제공되지 않았습니다.' }, { status: 400 });
  }
  // 로그에는 파일 메타만 싣는다 (본문 금지)
  ctx.bind({ filename: file.name, size: file.size, contentType: file.type });

  if (!allowedTypes.includes(file.type as (typeof allowedTypes)[number])) {
    return NextResponse.json({ error: AVATAR_TYPE_ERROR }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return NextResponse.json({ error: AVATAR_SIZE_ERROR }, { status: 400 });
  }
  const filenameError = validateFilename(file.name);
  if (filenameError) {
    return NextResponse.json({ error: filenameError }, { status: 400 });
  }

  // MIME 헤더 외에 실제 바이트로 형식 확인 (defense in depth) — 헤더는 위조된다.
  const headerBuffer = Buffer.from(await file.slice(0, 16).arrayBuffer());
  const detectedKind = detectImageKind(headerBuffer);
  if (!detectedKind || !allowedTypes.includes(detectedKind as (typeof allowedTypes)[number])) {
    return NextResponse.json(
      { error: '파일 내용이 이미지 형식과 일치하지 않습니다.' },
      { status: 400 },
    );
  }

  const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
  const publicUrl = process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  if (!bucketName || !publicUrl) {
    const error = new Error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
    ctx.log.error({ err: error }, 'R2 환경 변수 미설정');
    Sentry.captureException(error);
    return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 });
  }

  // 정사각 WebP 로 깎는다. 변환 실패는 폴백하지 않고 거부한다 — 원본을 그대로 저장하면
  // 이 라우트가 약속한 형식·크기 보장이 무너지고, 아바타는 재시도 비용이 낮다.
  let body: Buffer;
  try {
    body = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate() // EXIF 방향 반영 — 세워 찍은 사진이 눕는 것을 막는다
      .resize(sizePx, sizePx, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (conversionError) {
    ctx.log.warn({ err: conversionError }, '아바타 변환 실패');
    return NextResponse.json({ error: '이미지를 처리하지 못했습니다.' }, { status: 400 });
  }

  // 사용자별 네임스페이스 + 랜덤 파일명. 덮어쓰지 않고 새 키를 쓰는 이유는 CDN·브라우저
  // 캐시가 옛 이미지를 계속 보여주는 것을 피하기 위해서다. 옛 키는 R2 유예 삭제 큐의
  // 대상이 아니라 남는다 — 아바타 정리는 별도 관심사다(현 시점 미구현).
  const random = crypto.randomUUID();
  const key = `avatars/${guard.userId}/${random}.webp`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
    }),
  );

  return NextResponse.json({ url: `${publicUrl}/${key}` });
}

export const POST = withRouteLogging('/api/upload/avatar', handleAvatarUpload, {
  errorMessage: '아바타 업로드 중 오류가 발생했습니다.',
  sentryTags: { operation: 'avatar_upload' },
});
