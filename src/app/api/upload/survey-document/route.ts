import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/nextjs';

import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import { allowAdminOnly, guardUploadRoute } from '@/lib/upload/route-guard';
import { readPdfPageCount } from '@/server/survey-document/services/pdf-page-count';
import { TMP_SURVEY_DOCUMENT_PREFIX } from '@/server/survey-document/services/document-key';
import { MIN_FILE_BYTES, validateFilename } from '@/lib/upload/attachment-policy';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env['CLOUDFLARE_R2_ACCESS_KEY'] || '',
    secretAccessKey: process.env['CLOUDFLARE_R2_SECRET_KEY'] || '',
  },
});

/** 조사표는 20쪽 안팎의 스캔 조사표라 첨부보다 넉넉히 잡는다. */
export const MAX_SURVEY_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** PDF magic: %PDF- */
function looksLikePdf(buf: Buffer): boolean {
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
}

/**
 * 조사표 PDF 업로드 — tmp 로 받는다. 영구 위치로 옮기는 것은 attach 프로시저다
 * (붙이지 못한 업로드는 tmp lifecycle 로 저절로 사라진다).
 *
 * 쪽 수는 여기서 파일을 열어 읽는다 — 클라이언트가 보낸 값을 믿지 않는다.
 */
async function handleSurveyDocumentUpload(request: NextRequest, ctx: RouteLogContext) {
  // 조사표는 빌더 오서링이라 내부 계정 전용이다. 설문 capability 는 여기서 묻지 않는다 —
  // 업로드는 tmp 네임스페이스에 갇히고, 설문에 닿는 attach 프로시저가 survey.edit 을 진다
  // (route-guard 의 업로드 면제 원칙).
  const guard = await guardUploadRoute(ctx, allowAdminOnly);
  if (!guard.ok) return guard.response;

  const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
  if (!bucketName) {
    const error = new Error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
    ctx.log.error({ err: error }, 'R2 환경 변수 미설정');
    Sentry.captureException(error, { tags: { operation: 'survey_document_upload' } });
    return NextResponse.json({ error: '서버 설정 오류 (R2 미구성)' }, { status: 500 });
  }

  const formData = await request.formData();
  const fileEntry = formData.get('file');
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: '파일이 제공되지 않았습니다.' }, { status: 400 });
  }
  const file = fileEntry;
  ctx.bind({ filename: file.name, size: file.size, contentType: file.type });

  if (file.size < MIN_FILE_BYTES) {
    return NextResponse.json({ error: '빈 파일은 업로드할 수 없습니다.' }, { status: 400 });
  }
  if (file.size > MAX_SURVEY_DOCUMENT_BYTES) {
    return NextResponse.json(
      { error: `조사표는 ${Math.round(MAX_SURVEY_DOCUMENT_BYTES / 1024 / 1024)}MB 이하여야 합니다.` },
      { status: 400 },
    );
  }
  const filenameError = validateFilename(file.name);
  if (filenameError) {
    return NextResponse.json({ error: filenameError }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!looksLikePdf(buffer)) {
    return NextResponse.json({ error: '조사표는 PDF 파일만 올릴 수 있습니다.' }, { status: 400 });
  }

  const pageCount = await readPdfPageCount(new Uint8Array(buffer));
  if (pageCount === null) {
    return NextResponse.json(
      { error: 'PDF 를 열 수 없습니다. 암호가 걸려 있거나 손상된 파일입니다.' },
      { status: 400 },
    );
  }
  ctx.bind({ pageCount });

  const key = `${TMP_SURVEY_DOCUMENT_PREFIX}${randomUUID()}.pdf`;
  ctx.bind({ key });

  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: 'application/pdf',
        ContentLength: buffer.byteLength,
      }),
    );
    await r2Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
  } catch (error) {
    ctx.log.error({ err: error }, '조사표 업로드 — R2 저장 실패');
    Sentry.captureException(error, {
      tags: { operation: 'survey_document_upload' },
      extra: { key, size: file.size },
    });
    r2Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key })).catch(() => undefined);
    return NextResponse.json(
      { error: '저장소 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ key, filename: file.name, pageCount, size: file.size });
}

export const POST = withRouteLogging('/api/upload/survey-document', handleSurveyDocumentUpload, {
  errorMessage: '조사표 업로드 중 오류가 발생했습니다.',
  sentryTags: { operation: 'survey_document_upload' },
});
