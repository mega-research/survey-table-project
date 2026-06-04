import { NextRequest, NextResponse } from 'next/server';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/nextjs';
import sharp from 'sharp';

import { getCurrentUser } from '@/lib/auth';

/**
 * 파일 첫 16바이트로 실제 이미지 형식을 감지 (defense in depth).
 * MIME 헤더가 위조되어도 magic byte 로 차단.
 */
function detectImageKind(buf: Buffer): string | null {
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return 'image/png';
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  // WebP: 52 49 46 46 .. .. .. .. 57 45 42 50
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return 'image/webp';
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  // SVG: starts with '<'
  if (buf[0] === 0x3c) return 'image/svg+xml';
  return null;
}

// Cloudflare R2는 S3 호환 API를 사용합니다
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env['CLOUDFLARE_R2_ACCESS_KEY'] || '',
    secretAccessKey: process.env['CLOUDFLARE_R2_SECRET_KEY'] || '',
  },
});

// 설문(kind=survey): WebP 로 변환할 타입.
// SVG/GIF 는 애니메이션/벡터라 원본 유지, PNG 는 로고처럼 투명 배경/무손실이 필요한
// 케이스가 많아 원본 유지.
const SURVEY_CONVERTIBLE_TYPES = ['image/jpeg', 'image/jpg', 'image/bmp'];

// 메일(kind=mail): PNG 로 변환할 타입. Outlook 데스크톱이 WebP 미지원이라
// 이미 업로드된 WebP 도 PNG 로 재변환. SVG/GIF 만 원본 유지.
const MAIL_CONVERTIBLE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/bmp',
  'image/webp',
];

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: '파일이 제공되지 않았습니다.' }, { status: 400 });
    }

    // 이미지 파일만 허용 (BMP 추가)
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'image/bmp',
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        {
          error:
            '지원하지 않는 파일 형식입니다. JPG, PNG, GIF, WebP, SVG, BMP만 업로드 가능합니다.',
        },
        { status: 400 },
      );
    }

    // MIME 헤더 외에 실제 바이트로 형식 확인 (defense in depth)
    const headerBuffer = Buffer.from(await file.slice(0, 16).arrayBuffer());
    const detectedKind = detectImageKind(headerBuffer);
    if (!detectedKind || !allowedTypes.includes(detectedKind)) {
      return NextResponse.json(
        { error: '파일 내용이 이미지 형식과 일치하지 않습니다.' },
        { status: 400 },
      );
    }

    // 파일 크기 제한 (10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: '파일 크기는 10MB 이하여야 합니다.' }, { status: 400 });
    }

    // 환경 변수 확인
    const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
    const publicUrl = process.env['CLOUDFLARE_R2_PUBLIC_URL'];

    if (!bucketName || !publicUrl) {
      const error = new Error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
      console.error(error.message);
      Sentry.captureException(error);
      return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 });
    }

    // kind 파라미터 검증 (mail | survey) — 변환 분기에 필요하므로 먼저 읽음
    const KIND_VALUES = new Set(['mail', 'survey']);
    const kindRaw = formData.get('kind');
    const kind = typeof kindRaw === 'string' && KIND_VALUES.has(kindRaw) ? kindRaw : null;
    if (!kind) {
      return NextResponse.json(
        { error: '잘못된 또는 누락된 kind 파라미터 (mail | survey)' },
        { status: 400 },
      );
    }

    // 파일을 ArrayBuffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);
    let contentType = file.type;
    let fileExtension: string;

    // SVG 본문 가드: <script>, on*= 이벤트 핸들러, javascript: URL 등 차단
    if (file.type === 'image/svg+xml') {
      const svgText = buffer.toString('utf8', 0, Math.min(buffer.length, 256 * 1024));
      if (/<script|on\w+\s*=|javascript:/i.test(svgText)) {
        return NextResponse.json(
          { error: 'SVG 파일에 허용되지 않는 요소가 포함되어 있습니다.' },
          { status: 400 },
        );
      }
    }

    // 변환 분기: 메일은 PNG (Outlook 호환), 설문은 WebP (브라우저 최적화).
    // GIF/SVG 는 양쪽 모두 원본 유지 (애니메이션/벡터).
    const shouldConvert =
      kind === 'mail'
        ? MAIL_CONVERTIBLE_TYPES.includes(file.type)
        : SURVEY_CONVERTIBLE_TYPES.includes(file.type);

    if (shouldConvert) {
      try {
        if (kind === 'mail') {
          buffer = await sharp(buffer).png({ compressionLevel: 9 }).toBuffer();
          contentType = 'image/png';
          fileExtension = 'png';
        } else {
          buffer = await sharp(buffer).webp({ quality: 85 }).toBuffer();
          contentType = 'image/webp';
          fileExtension = 'webp';
        }
      } catch (conversionError) {
        console.error('이미지 변환 실패, 원본 저장:', conversionError);
        Sentry.captureException(conversionError, {
          tags: { operation: 'image_conversion', kind },
          level: 'warning',
        });
        // 변환 실패 시 원본 저장
        fileExtension = file.name.split('.').pop() || 'jpg';
      }
    } else {
      // 변환 대상 아님 (mail: GIF/SVG / survey: GIF/SVG/WebP/PNG) — 원본 유지
      fileExtension = file.name.split('.').pop() || 'jpg';
    }

    // 파일 이름 생성 (타임스탬프 + 랜덤 문자열)
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const fileName = `tmp/${kind}/${timestamp}-${randomString}.${fileExtension}`;

    // R2에 업로드
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: buffer,
      ContentType: contentType,
    });

    await r2Client.send(command);

    // 공개 URL 반환
    const imageUrl = `${publicUrl}/${fileName}`;
    return NextResponse.json({ url: imageUrl });
  } catch (error) {
    console.error('이미지 업로드 오류:', error);
    Sentry.captureException(error, {
      tags: { operation: 'image_upload' },
    });
    return NextResponse.json({ error: '이미지 업로드 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
