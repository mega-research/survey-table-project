import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 파일 최상단 hoisted mock — promote 가 의존하는 R2 mover / deleter mock
vi.mock('@/lib/image-utils-server', () => ({
  moveR2Objects: vi.fn(),
  deleteR2ObjectsByKey: vi.fn(),
}));

// permanentObjectExists 가 사용하는 S3 client mock.
// recovery 경로(이미 영구 위치에 존재) 테스트를 위해 HeadObject 응답을 제어한다.
const headExistsKeys = new Set<string>();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    async send(cmd: { input?: { Key?: string } }) {
      const key = cmd?.input?.Key;
      if (key && headExistsKeys.has(key)) return {};
      throw new Error('NotFound');
    }
  },
  HeadObjectCommand: class {
    input: { Bucket?: string; Key?: string };
    constructor(input: { Bucket?: string; Key?: string }) {
      this.input = input;
    }
  },
}));

import { deleteR2ObjectsByKey, moveR2Objects } from '@/lib/image-utils-server';
import {
  extractPermanentAttachmentKeysFromHtml,
  extractTmpNoticeAttachmentUrlsFromHtml,
  isTmpNoticeAttachmentUrl,
  promoteNoticeAttachments,
  replaceNoticeAttachmentUrlsInQuestion,
} from '@/lib/survey/notice-attachment-promote';

describe('isTmpNoticeAttachmentUrl', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
  });
  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  });

  it('tmp/notice-attachment/ prefix 는 true', () => {
    expect(isTmpNoticeAttachmentUrl('https://cdn.test/tmp/notice-attachment/x.pdf')).toBe(true);
  });
  it('영구 prefix 는 false', () => {
    expect(isTmpNoticeAttachmentUrl('https://cdn.test/notice-attachment/x.pdf')).toBe(false);
  });
  it('tmp/mail-attachment 는 false', () => {
    expect(isTmpNoticeAttachmentUrl('https://cdn.test/tmp/mail-attachment/x.pdf')).toBe(false);
  });
  it('tmp/survey 는 false', () => {
    expect(isTmpNoticeAttachmentUrl('https://cdn.test/tmp/survey/x.webp')).toBe(false);
  });
});

describe('extractTmpNoticeAttachmentUrlsFromHtml', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
  });
  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  });

  it('a[data-file-attachment] 의 href 만 추출', () => {
    const html =
      '<p><a data-file-attachment="true" href="https://cdn.test/tmp/notice-attachment/a.pdf">A</a>' +
      '<a href="https://example.com/page">B 일반 링크</a>' +
      '<img src="https://cdn.test/tmp/survey/x.webp" />' +
      '</p>';
    expect(extractTmpNoticeAttachmentUrlsFromHtml(html)).toEqual([
      'https://cdn.test/tmp/notice-attachment/a.pdf',
    ]);
  });

  it('중복 제거', () => {
    const html =
      '<a data-file-attachment="true" href="https://cdn.test/tmp/notice-attachment/a.pdf">A</a>' +
      '<a data-file-attachment="true" href="https://cdn.test/tmp/notice-attachment/a.pdf">A2</a>';
    expect(extractTmpNoticeAttachmentUrlsFromHtml(html)).toEqual([
      'https://cdn.test/tmp/notice-attachment/a.pdf',
    ]);
  });

  it('영구 prefix 는 제외', () => {
    const html =
      '<a data-file-attachment="true" href="https://cdn.test/notice-attachment/a.pdf">A</a>';
    expect(extractTmpNoticeAttachmentUrlsFromHtml(html)).toEqual([]);
  });

  it('빈 HTML 은 빈 배열', () => {
    expect(extractTmpNoticeAttachmentUrlsFromHtml('')).toEqual([]);
  });
});

describe('replaceNoticeAttachmentUrlsInQuestion', () => {
  it('mapping 의 URL 만 치환, 그 외는 유지', () => {
    const mapping = new Map([
      [
        'https://cdn.test/tmp/notice-attachment/a.pdf',
        'https://cdn.test/notice-attachment/a.pdf',
      ],
    ]);
    const q = {
      noticeContent:
        '<a data-file-attachment="true" data-key="tmp/notice-attachment/a.pdf" ' +
        'href="https://cdn.test/tmp/notice-attachment/a.pdf">A</a>',
    };
    const out = replaceNoticeAttachmentUrlsInQuestion(q, mapping);
    // href URL 치환 확인
    expect(out.noticeContent).toContain('href="https://cdn.test/notice-attachment/a.pdf"');
    expect(out.noticeContent).not.toContain('tmp/notice-attachment/a.pdf');
  });

  it('noticeContent 없는 질문 그대로 반환', () => {
    const q = { noticeContent: null };
    const mapping = new Map([['x', 'y']]);
    expect(replaceNoticeAttachmentUrlsInQuestion(q, mapping)).toEqual(q);
  });

  it('mapping 비었으면 same reference', () => {
    const q = { noticeContent: '<a>x</a>' };
    expect(replaceNoticeAttachmentUrlsInQuestion(q, new Map())).toBe(q);
  });
});

describe('promoteNoticeAttachments', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
    process.env['CLOUDFLARE_R2_BUCKET'] = 'test-bucket';
    headExistsKeys.clear();
    vi.mocked(moveR2Objects).mockReset();
    vi.mocked(deleteR2ObjectsByKey).mockReset();
  });
  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
    delete process.env['CLOUDFLARE_R2_BUCKET'];
    headExistsKeys.clear();
  });

  it('R2 move 성공 시 모든 tmp URL 영구 URL 치환', async () => {
    vi.mocked(moveR2Objects).mockImplementationOnce(async (pairs) => ({
      movedKeys: pairs.map((p) => ({ srcKey: p.srcKey, dstKey: p.dstKey })),
      failed: [],
    }));

    const questions = [
      {
        type: 'notice',
        noticeContent:
          '<a data-file-attachment="true" data-key="tmp/notice-attachment/a.pdf" ' +
          'href="https://cdn.test/tmp/notice-attachment/a.pdf">A</a>',
      },
    ];
    const out = await promoteNoticeAttachments(questions);
    const out0 = out[0];
    if (!out0) throw new Error('out[0] is undefined');
    expect(out0.noticeContent).toContain('https://cdn.test/notice-attachment/a.pdf');
    expect(out0.noticeContent).not.toContain('tmp/notice-attachment/a.pdf');
  });

  it('tmp URL 없으면 same reference', async () => {
    const questions = [{ type: 'notice', noticeContent: '<p>그냥 본문</p>' }];
    const out = await promoteNoticeAttachments(questions);
    expect(out).toBe(questions);
    // moveR2Objects 호출 안 됨 early return
    expect(vi.mocked(moveR2Objects)).not.toHaveBeenCalled();
  });

  it('R2 move 1차 실패 → retry 후 성공 시 정상 promote', async () => {
    let callCount = 0;
    vi.mocked(moveR2Objects).mockImplementation(async (pairs) => {
      callCount += 1;
      if (callCount === 1) {
        // 1차: 하나만 성공, 하나 실패
        const pair0 = pairs[0];
        const pair1 = pairs[1];
        if (!pair0 || !pair1) throw new Error('pairs 요소가 undefined');
        return {
          movedKeys: [{ srcKey: pair0.srcKey, dstKey: pair0.dstKey }],
          failed: [pair1.srcKey],
        };
      }
      // 2차 retry: 나머지 성공
      return {
        movedKeys: pairs.map((p) => ({ srcKey: p.srcKey, dstKey: p.dstKey })),
        failed: [],
      };
    });

    const questions = [
      {
        type: 'notice',
        noticeContent:
          '<a data-file-attachment="true" href="https://cdn.test/tmp/notice-attachment/a.pdf">A</a>' +
          '<a data-file-attachment="true" href="https://cdn.test/tmp/notice-attachment/b.pdf">B</a>',
      },
    ];
    const out = await promoteNoticeAttachments(questions);
    const out0 = out[0];
    if (!out0) throw new Error('out[0] is undefined');
    expect(out0.noticeContent).toContain('notice-attachment/a.pdf');
    expect(out0.noticeContent).toContain('notice-attachment/b.pdf');
    expect(out0.noticeContent).not.toContain('tmp/notice-attachment/');
    expect(callCount).toBe(2);
  });

  it('R2 move 1차+retry 모두 실패 → 부분 성공분 rollback + throw', async () => {
    let callCount = 0;
    vi.mocked(moveR2Objects).mockImplementation(async (pairs) => {
      callCount += 1;
      if (callCount === 1) {
        // 1차: a 성공, b 실패
        const pair0 = pairs[0];
        const pair1 = pairs[1];
        if (!pair0 || !pair1) throw new Error('pairs 요소가 undefined');
        return {
          movedKeys: [
            { srcKey: pair0.srcKey, dstKey: pair0.dstKey },
          ],
          failed: [pair1.srcKey],
        };
      }
      // retry: pairs 는 stillFailed (b) 만 포함 — 여전히 실패
      return {
        movedKeys: [],
        failed: pairs.map((p) => p.srcKey),
      };
    });
    vi.mocked(deleteR2ObjectsByKey).mockResolvedValue(true);

    const questions = [
      {
        type: 'notice',
        noticeContent:
          '<a data-file-attachment="true" href="https://cdn.test/tmp/notice-attachment/a.pdf">A</a>' +
          '<a data-file-attachment="true" href="https://cdn.test/tmp/notice-attachment/b.pdf">B</a>',
      },
    ];

    await expect(promoteNoticeAttachments(questions)).rejects.toThrow(
      /공지사항 첨부 promote 실패/,
    );
    // 부분 성공분 rollback DELETE 호출 확인
    expect(deleteR2ObjectsByKey).toHaveBeenCalledWith(['notice-attachment/a.pdf']);
  });

  it('최종 실패 롤백은 이번 호출이 옮긴 키만 삭제하고 recovered(이전 publish 라이브) 키는 보존', async () => {
    // a: 이번 호출이 새로 옮김(롤백 대상)
    // b: move 실패하지만 영구 위치에 이미 존재(이전 publish 소유 라이브 첨부 → 롤백 금지)
    // c: 진짜 실패 → 전체 promote throw 유발
    headExistsKeys.add('notice-attachment/b.pdf');

    let callCount = 0;
    vi.mocked(moveR2Objects).mockImplementation(async (pairs) => {
      callCount += 1;
      if (callCount === 1) {
        // 1차: a 성공, b/c 실패
        const movedA = pairs.find((p) => p.srcKey.endsWith('a.pdf'));
        if (!movedA) throw new Error('a pair 없음');
        return {
          movedKeys: [{ srcKey: movedA.srcKey, dstKey: movedA.dstKey }],
          failed: pairs
            .filter((p) => !p.srcKey.endsWith('a.pdf'))
            .map((p) => p.srcKey),
        };
      }
      // retry: 나머지(b, c) 여전히 실패
      return { movedKeys: [], failed: pairs.map((p) => p.srcKey) };
    });
    vi.mocked(deleteR2ObjectsByKey).mockResolvedValue(true);

    const questions = [
      {
        type: 'notice',
        noticeContent:
          '<a data-file-attachment="true" href="https://cdn.test/tmp/notice-attachment/a.pdf">A</a>' +
          '<a data-file-attachment="true" href="https://cdn.test/tmp/notice-attachment/b.pdf">B</a>' +
          '<a data-file-attachment="true" href="https://cdn.test/tmp/notice-attachment/c.pdf">C</a>',
      },
    ];

    await expect(promoteNoticeAttachments(questions)).rejects.toThrow(
      /공지사항 첨부 promote 실패/,
    );

    // 롤백은 이번 호출이 옮긴 a 만 삭제. recovered b 는 절대 삭제하면 안 됨.
    expect(deleteR2ObjectsByKey).toHaveBeenCalledTimes(1);
    expect(deleteR2ObjectsByKey).toHaveBeenCalledWith(['notice-attachment/a.pdf']);
    const deletedKeys = vi.mocked(deleteR2ObjectsByKey).mock.calls.flatMap(
      (call) => call[0] as string[],
    );
    expect(deletedKeys).not.toContain('notice-attachment/b.pdf');
  });

  it('previousQuestions 의 영구 키 중 새 HTML 에 없는 것 → deleteR2ObjectsByKey 호출', async () => {
    vi.mocked(moveR2Objects).mockResolvedValue({ movedKeys: [], failed: [] });
    vi.mocked(deleteR2ObjectsByKey).mockResolvedValue(true);

    const previousQuestions = [
      {
        type: 'notice',
        noticeContent:
          '<a data-file-attachment="true" data-key="notice-attachment/old.pdf">old</a>',
      },
    ];
    const newQuestions = [
      {
        type: 'notice',
        noticeContent:
          '<a data-file-attachment="true" data-key="notice-attachment/new.pdf">new</a>',
      },
    ];

    await promoteNoticeAttachments(newQuestions, { previousQuestions });

    expect(deleteR2ObjectsByKey).toHaveBeenCalledWith(['notice-attachment/old.pdf']);
  });

  it('previousQuestions 의 영구 키가 새 HTML 에 그대로 있으면 → DELETE 호출 안 됨', async () => {
    vi.mocked(moveR2Objects).mockResolvedValue({ movedKeys: [], failed: [] });
    vi.mocked(deleteR2ObjectsByKey).mockResolvedValue(true);

    const sameContent =
      '<a data-file-attachment="true" data-key="notice-attachment/keep.pdf">keep</a>';
    await promoteNoticeAttachments(
      [{ type: 'notice', noticeContent: sameContent }],
      { previousQuestions: [{ type: 'notice', noticeContent: sameContent }] },
    );

    expect(deleteR2ObjectsByKey).not.toHaveBeenCalled();
  });

  it('previousQuestions 미전달 시 orphan cleanup 호출 안 됨 (backward compat)', async () => {
    vi.mocked(moveR2Objects).mockResolvedValue({ movedKeys: [], failed: [] });
    vi.mocked(deleteR2ObjectsByKey).mockResolvedValue(true);

    await promoteNoticeAttachments([
      {
        type: 'notice',
        noticeContent:
          '<a data-file-attachment="true" data-key="notice-attachment/x.pdf">x</a>',
      },
    ]);

    expect(deleteR2ObjectsByKey).not.toHaveBeenCalled();
  });
});

describe('extractPermanentAttachmentKeysFromHtml', () => {
  it('영구 prefix data-key 만 추출', () => {
    const html =
      '<a data-file-attachment="true" data-key="notice-attachment/a.pdf">A</a>' +
      '<a data-file-attachment="true" data-key="tmp/notice-attachment/b.pdf">B</a>';
    expect(extractPermanentAttachmentKeysFromHtml(html)).toEqual([
      'notice-attachment/a.pdf',
    ]);
  });

  it('중복 제거', () => {
    const html =
      '<a data-file-attachment="true" data-key="notice-attachment/a.pdf">A</a>' +
      '<a data-file-attachment="true" data-key="notice-attachment/a.pdf">A2</a>';
    expect(extractPermanentAttachmentKeysFromHtml(html)).toEqual([
      'notice-attachment/a.pdf',
    ]);
  });

  it('빈 HTML 은 빈 배열', () => {
    expect(extractPermanentAttachmentKeysFromHtml('')).toEqual([]);
  });

  it('data-file-attachment 없는 a 태그는 무시', () => {
    const html = '<a data-key="notice-attachment/a.pdf">A</a>';
    expect(extractPermanentAttachmentKeysFromHtml(html)).toEqual([]);
  });
});
