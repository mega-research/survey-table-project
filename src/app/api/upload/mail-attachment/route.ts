import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/nextjs';

import { requireAuth } from '@/lib/auth';
import {
  MAX_ATTACHMENT_FILE_BYTES,
  TMP_ATTACHMENT_PREFIX,
} from '@/lib/mail/constants';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY || '',
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY || '',
  },
});

const MIN_FILE_BYTES = 1;

// 메일 첨부 허용 MIME 화이트리스트. 실행 가능 형식(.exe, .sh, .html, .js 등)은 거부.
// Office 새포맷·구포맷 모두 허용, 한컴 hwp/hwpx 포함.
const ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.hancom.hwp',
  'application/x-hwp',
  'application/haansofthwp',
  'application/hwp',
  'application/vnd.hancom.hwpx',
  'application/haansofthwpx',
  'application/hwp+zip',
  'text/plain',
  'text/csv',
]);
const ALLOWED_IMAGE_PREFIX = 'image/';

// 확장자 화이트리스트. 브라우저가 file.type 을 빈 문자열로 보내는 케이스 (특히 hwp/hwpx 같은
// 한국 포맷) 를 위해 확장자도 같이 본다. 매칭되면 EXT_TO_MIME 으로 MIME 보강.
const EXT_TO_MIME: Record<string, string> = {
  hwp: 'application/vnd.hancom.hwp',
  hwpx: 'application/vnd.hancom.hwpx',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  zip: 'application/zip',
  txt: 'text/plain',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

// 안전한 파일명 — mailAttachmentSchema 와 동일 정책 (윈도우 reserved 문자 제외).
// 추가로 NUL/CR/LF 같은 제어문자, leading dot 만, ../ 류 path traversal 시도 차단.
const SAFE_FILENAME_RE = /^[^\\/:*?"<>|\x00-\x1f]{1,200}$/;

function isAllowedMime(mime: string): boolean {
  if (ALLOWED_MIME.has(mime)) return true;
  if (mime.startsWith(ALLOWED_IMAGE_PREFIX)) return true;
  return false;
}

function getFileExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * 파일 형식 판정: 확장자 우선, MIME 보조.
 * - 확장자가 화이트리스트에 있으면 통과 (MIME 이 빈/이상해도 그 확장자의 표준 MIME 반환)
 * - 확장자가 없거나 비허용이면 MIME 으로 폴백
 * - 둘 다 실패하면 null
 */
function resolveAttachmentType(filename: string, mime: string): { mime: string } | null {
  const ext = getFileExt(filename);
  if (ext && ext in EXT_TO_MIME) {
    return { mime: mime && isAllowedMime(mime) ? mime : EXT_TO_MIME[ext] };
  }
  if (mime && isAllowedMime(mime)) {
    return { mime };
  }
  return null;
}

function validateFilename(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '파일명이 비어있습니다.';
  if (trimmed.length > 200) return '파일명이 너무 깁니다 (최대 200자).';
  if (!SAFE_FILENAME_RE.test(trimmed)) return '파일명에 사용할 수 없는 문자가 있습니다.';
  // ".pdf" 처럼 확장자만 있는 파일은 거부 — name 부분이 비어있음.
  if (trimmed.startsWith('.') && trimmed.lastIndexOf('.') === 0) {
    return '파일명이 비어있습니다 (확장자만 있음).';
  }
  // ".." 또는 "." 단독 거부 (path traversal 시도)
  if (trimmed === '.' || trimmed === '..') {
    return '유효하지 않은 파일명입니다.';
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const bucketName = process.env.CLOUDFLARE_R2_BUCKET;
  if (!bucketName) {
    const error = new Error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
    console.error(error.message);
    Sentry.captureException(error, { tags: { operation: 'mail_attachment_upload' } });
    return NextResponse.json({ error: '서버 설정 오류 (R2 미구성)' }, { status: 500 });
  }

  let file: File;
  let resolvedMime: string;
  let key: string;

  try {
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    if (fileEntry === null) {
      return NextResponse.json({ error: '파일이 제공되지 않았습니다.' }, { status: 400 });
    }
    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: 'file 필드는 파일이어야 합니다.' },
        { status: 400 },
      );
    }
    file = fileEntry;

    // 빈 파일 거부 (브라우저가 빈 File 객체를 보내는 케이스, 일부 파일이 read 실패한 경우).
    if (file.size < MIN_FILE_BYTES) {
      return NextResponse.json({ error: '빈 파일은 업로드할 수 없습니다.' }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
      return NextResponse.json(
        { error: `파일 크기는 ${Math.round(MAX_ATTACHMENT_FILE_BYTES / 1024 / 1024)}MB 이하여야 합니다.` },
        { status: 400 },
      );
    }

    const filenameError = validateFilename(file.name);
    if (filenameError) {
      return NextResponse.json({ error: filenameError }, { status: 400 });
    }

    const resolved = resolveAttachmentType(file.name, file.type);
    if (!resolved) {
      return NextResponse.json(
        { error: `지원하지 않는 파일 형식입니다 (${file.type || '알 수 없음'}).` },
        { status: 400 },
      );
    }
    resolvedMime = resolved.mime;

    const ext = getFileExt(file.name);
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'bin';
    key = `${TMP_ATTACHMENT_PREFIX}${randomUUID()}.${safeExt}`;
  } catch (error) {
    console.error('메일 첨부 업로드 — 입력 파싱 실패:', error);
    Sentry.captureException(error, {
      tags: { operation: 'mail_attachment_upload', phase: 'parse' },
    });
    return NextResponse.json(
      { error: '요청을 처리할 수 없습니다 (form data 파싱 실패).' },
      { status: 400 },
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (error) {
    console.error('메일 첨부 업로드 — 파일 read 실패:', error);
    Sentry.captureException(error, {
      tags: { operation: 'mail_attachment_upload', phase: 'read' },
      extra: { filename: file.name, size: file.size },
    });
    return NextResponse.json(
      { error: '파일을 읽을 수 없습니다.' },
      { status: 400 },
    );
  }

  // 실제 읽은 바이트가 선언된 size 와 다르면 신뢰성 의심 — 거부.
  if (buffer.byteLength !== file.size) {
    Sentry.captureMessage('메일 첨부 size mismatch', {
      level: 'warning',
      tags: { operation: 'mail_attachment_upload' },
      extra: { declared: file.size, actual: buffer.byteLength, filename: file.name },
    });
    return NextResponse.json(
      { error: '파일 크기가 일치하지 않습니다. 다시 시도해 주세요.' },
      { status: 400 },
    );
  }

  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: resolvedMime,
        ContentLength: buffer.byteLength,
      }),
    );
  } catch (error) {
    console.error('메일 첨부 업로드 — R2 PUT 실패:', error);
    Sentry.captureException(error, {
      tags: { operation: 'mail_attachment_upload', phase: 'put' },
      extra: { key, filename: file.name, size: file.size },
    });
    return NextResponse.json(
      { error: '저장소 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }

  // R2 가 실제로 객체를 받았는지 한 번 더 확인 (NoSuchKey 류 사고 방지).
  // S3 호환 strong read-after-write 보장은 있지만, 네트워크 사고로 PUT 응답이 거짓 성공
  // 일 수 있으므로 명시적으로 HEAD 로 검증한다. 실패 시 R2 정리 시도 후 에러 반환.
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
  } catch (error) {
    console.error('메일 첨부 업로드 — R2 HEAD 실패:', error);
    Sentry.captureException(error, {
      tags: { operation: 'mail_attachment_upload', phase: 'verify' },
      extra: { key, filename: file.name },
    });
    // 정리 시도 (실패해도 lifecycle 이 처리)
    r2Client
      .send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }))
      .catch(() => undefined);
    return NextResponse.json(
      { error: '저장 검증에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    key,
    filename: file.name,
    size: file.size,
    mime: resolvedMime,
  });
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const bucketName = process.env.CLOUDFLARE_R2_BUCKET;
  if (!bucketName) {
    return NextResponse.json({ error: '서버 설정 오류 (R2 미구성)' }, { status: 500 });
  }

  let key: string;
  try {
    const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
    if (!body || typeof body.key !== 'string') {
      return NextResponse.json(
        { error: 'JSON body 에 key 필드가 필요합니다.' },
        { status: 400 },
      );
    }
    if (!body.key.startsWith(TMP_ATTACHMENT_PREFIX)) {
      // 영구 위치(`mail-attachment/`)는 템플릿 actions 의 cleanup orchestrator 가 처리.
      // 이 라우트는 tmp 만 직접 삭제 허용 — 영구 객체 임의 삭제 차단.
      return NextResponse.json(
        { error: 'tmp/mail-attachment/ prefix 만 삭제 가능합니다.' },
        { status: 400 },
      );
    }
    // 추가 sanity check: 경로 traversal 시도 차단 ("tmp/mail-attachment/../foo")
    if (body.key.includes('..') || body.key.includes('//')) {
      return NextResponse.json({ error: '유효하지 않은 key 입니다.' }, { status: 400 });
    }
    key = body.key;
  } catch (error) {
    console.error('메일 첨부 삭제 — 입력 파싱 실패:', error);
    Sentry.captureException(error, {
      tags: { operation: 'mail_attachment_delete', phase: 'parse' },
    });
    return NextResponse.json({ error: '요청을 처리할 수 없습니다.' }, { status: 400 });
  }

  try {
    await r2Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('메일 첨부 삭제 — R2 DELETE 실패:', error);
    Sentry.captureException(error, {
      tags: { operation: 'mail_attachment_delete', phase: 'delete' },
      extra: { key },
    });
    // 삭제 실패해도 lifecycle 이 24h 안에 처리하므로 client 에 치명 에러 노출 불필요.
    // 단 502 로 응답해 클라이언트가 retry 결정 가능.
    return NextResponse.json(
      { error: '저장소 삭제에 실패했습니다.' },
      { status: 502 },
    );
  }
}
