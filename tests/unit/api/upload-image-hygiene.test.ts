// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 인증 통과 사용자 mock
vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'admin-1' })),
}));

// R2 PutObject 입력을 캡처하기 위한 S3 client mock
const putInputs: Array<Record<string, unknown>> = [];
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    async send(cmd: { input?: Record<string, unknown> }) {
      if (cmd?.input) putInputs.push(cmd.input);
      return {};
    }
  },
  PutObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

// sharp 변환 mock — 변환 경로가 실제 라이브러리에 의존하지 않도록 결정적 출력 반환
vi.mock('sharp', () => {
  const make = () => ({
    png: () => make(),
    webp: () => make(),
    toBuffer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  return { default: () => make() };
});

import { POST } from '@/app/api/upload/image/route';

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeRequest(file: File, kind = 'survey'): Request {
  const formData = new FormData();
  formData.set('file', file);
  formData.set('kind', kind);
  return new Request('http://localhost/api/upload/image', {
    method: 'POST',
    body: formData,
  });
}

describe('POST /api/upload/image 입력 위생', () => {
  beforeEach(() => {
    putInputs.length = 0;
    process.env['CLOUDFLARE_R2_BUCKET'] = 'test-bucket';
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
  });

  it('악성 파일명 (path traversal) → 400 차단', async () => {
    const file = new File([PNG_MAGIC], '../../etc/passwd.png', { type: 'image/png' });
    const res = await POST(makeRequest(file) as never);
    expect(res.status).toBe(400);
  });

  it('윈도우 reserved 특수문자 파일명 → 400 차단', async () => {
    const file = new File([PNG_MAGIC], 'a:b*c?.png', { type: 'image/png' });
    const res = await POST(makeRequest(file) as never);
    expect(res.status).toBe(400);
  });

  it('정상 PNG 업로드 비파괴 — 감지 형식으로 안전 키 생성', async () => {
    const file = new File([PNG_MAGIC], 'logo.png', { type: 'image/png' });
    const res = await POST(makeRequest(file) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    // survey + png 는 변환 대상 아님 → 원본 유지, 확장자는 감지 형식(png)
    expect(body.url).toMatch(/^https:\/\/cdn\.test\/tmp\/survey\/\d+-[a-z0-9]+\.png$/);
    // 키는 파일명을 보간하지 않고 timestamp-random 만 사용
    expect(body.url).not.toContain('logo');
  });

  it('256KB 이후에 <script> 숨긴 SVG → 400 차단 (전체 본문 검사)', async () => {
    const padding = '<!-- ' + 'A'.repeat(300 * 1024) + ' -->';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      padding +
      '<script>alert(1)</script></svg>';
    expect(Buffer.byteLength(svg, 'utf8')).toBeGreaterThan(256 * 1024);
    const file = new File([svg], 'x.svg', { type: 'image/svg+xml' });
    const res = await POST(makeRequest(file) as never);
    expect(res.status).toBe(400);
    expect(putInputs.length).toBe(0);
  });

  it('정상 SVG 업로드 → 200 + attachment disposition (inline 실행 차단)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const file = new File([svg], 'icon.svg', { type: 'image/svg+xml' });
    const res = await POST(makeRequest(file) as never);
    expect(res.status).toBe(200);
    expect(putInputs.length).toBe(1);
    expect(putInputs[0]?.['ContentDisposition']).toBe('attachment');
    expect(putInputs[0]?.['Key']).toMatch(/\.svg$/);
  });
});
