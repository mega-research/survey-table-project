import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 파일 최상단 hoisted mock — survey-image-promote / notice-attachment-promote 둘 다
// top-level static import 로 moveR2Objects 를 의존하므로 한 번에 잡힘.
vi.mock('@/lib/image-utils-server', () => ({
  moveR2Objects: vi.fn(),
}));

import { moveR2Objects } from '@/lib/image-utils-server';
import { promoteNoticeAttachments } from '@/lib/survey/notice-attachment-promote';
import { promoteSurveyImages } from '@/lib/survey/survey-image-promote';

describe('publish 통합 — survey 이미지 + notice 첨부 동시 처리', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
    vi.mocked(moveR2Objects).mockReset();
  });
  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  });

  it('이미지 promote 후 첨부 promote 직렬 — noticeContent 안 양쪽 모두 영구 prefix 로', async () => {
    vi.mocked(moveR2Objects).mockImplementation(async (pairs) => ({
      movedKeys: pairs.map((p) => ({ srcKey: p.srcKey, dstKey: p.dstKey })),
      failed: [],
    }));

    const draftQuestions = [
      {
        type: 'notice',
        noticeContent:
          '<p>이미지: <img src="https://cdn.test/tmp/survey/img1.webp" /></p>' +
          '<p>첨부: <a data-file-attachment="true" ' +
          'href="https://cdn.test/tmp/notice-attachment/x.pdf" ' +
          'data-key="tmp/notice-attachment/x.pdf">공문</a></p>',
      },
    ];

    const promoted = await promoteNoticeAttachments(
      await promoteSurveyImages(draftQuestions),
    );
    const html = promoted[0].noticeContent ?? '';
    expect(html).toContain('https://cdn.test/survey/img1.webp');
    expect(html).toContain('https://cdn.test/notice-attachment/x.pdf');
    expect(html).not.toContain('tmp/survey/');
    expect(html).not.toContain('tmp/notice-attachment/');
  });
});
