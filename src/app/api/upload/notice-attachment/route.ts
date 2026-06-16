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
import { isAdminUserAllowed } from '@/lib/auth/admin-allowlist';
import { MAX_ATTACHMENT_FILE_BYTES } from '@/lib/mail/constants';
import {
  buildAttachmentDisposition,
  getFileExt,
  MIN_FILE_BYTES,
  resolveAttachmentType,
  TMP_NOTICE_ATTACHMENT_PREFIX,
  validateFilename,
} from '@/lib/upload/attachment-policy';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env['CLOUDFLARE_R2_ACCESS_KEY'] || '',
    secretAccessKey: process.env['CLOUDFLARE_R2_SECRET_KEY'] || '',
  },
});

export async function POST(request: NextRequest) {
  let userId: string;
  try {
    const user = await requireAuth();
    userId = user.id;
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }
  // admin allowlist 가드 — oRPC authed 와 동일 정책. ADMIN_USER_IDS 로 어드민을
  // 잠갔을 때 임의 인증사용자의 R2 첨부 업로드 남용을 차단.
  if (!isAdminUserAllowed(userId)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
  if (!bucketName) {
    const error = new Error('Cloudflare R2 환경 변수가 설정되지 않았습니다.');
    console.error(error.message);
    Sentry.captureException(error, { tags: { operation: 'notice_attachment_upload' } });
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

    if (file.size < MIN_FILE_BYTES) {
      return NextResponse.json({ error: '빈 파일은 업로드할 수 없습니다.' }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `파일 크기는 ${Math.round(MAX_ATTACHMENT_FILE_BYTES / 1024 / 1024)}MB 이하여야 합니다.`,
        },
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
    key = `${TMP_NOTICE_ATTACHMENT_PREFIX}${randomUUID()}.${safeExt}`;
  } catch (error) {
    console.error('공지사항 첨부 업로드 — 입력 파싱 실패:', error);
    Sentry.captureException(error, {
      tags: { operation: 'notice_attachment_upload', phase: 'parse' },
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
    console.error('공지사항 첨부 업로드 — 파일 read 실패:', error);
    Sentry.captureException(error, {
      tags: { operation: 'notice_attachment_upload', phase: 'read' },
      extra: { filename: file.name, size: file.size },
    });
    return NextResponse.json({ error: '파일을 읽을 수 없습니다.' }, { status: 400 });
  }

  if (buffer.byteLength !== file.size) {
    Sentry.captureMessage('공지사항 첨부 size mismatch', {
      level: 'warning',
      tags: { operation: 'notice_attachment_upload' },
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
        ContentDisposition: buildAttachmentDisposition(file.name),
      }),
    );
  } catch (error) {
    console.error('공지사항 첨부 업로드 — R2 PUT 실패:', error);
    Sentry.captureException(error, {
      tags: { operation: 'notice_attachment_upload', phase: 'put' },
      extra: { key, filename: file.name, size: file.size },
    });
    return NextResponse.json(
      { error: '저장소 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }

  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
  } catch (error) {
    console.error('공지사항 첨부 업로드 — R2 HEAD 실패:', error);
    Sentry.captureException(error, {
      tags: { operation: 'notice_attachment_upload', phase: 'verify' },
      extra: { key, filename: file.name },
    });
    r2Client
      .send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }))
      .catch(() => undefined);
    return NextResponse.json(
      { error: '저장 검증에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }

  const publicUrl = `${process.env['CLOUDFLARE_R2_PUBLIC_URL']}/${key}`;

  return NextResponse.json({
    key,
    url: publicUrl,
    filename: file.name,
    size: file.size,
    mime: resolvedMime,
  });
}
