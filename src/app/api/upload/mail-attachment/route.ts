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
import {
  ALLOWED_MIME,
  EXT_TO_MIME,
  getFileExt,
  isAllowedMime,
  MIN_FILE_BYTES,
  resolveAttachmentType,
  SAFE_FILENAME_RE,
  validateFilename,
} from '@/lib/upload/attachment-policy';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY || '',
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY || '',
  },
});

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
