import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractTmpSurveyUrlsFromQuestion,
  extractTmpSurveyUrlsFromResponseHeader,
  isTmpSurveyUrl,
  replaceUrlsInQuestion,
  replaceUrlsInResponseHeader,
  tmpToPermanentUrl,
  urlToR2Key,
} from '@/lib/survey/survey-image-promote';
import type { Question } from '@/types/survey';

// ========================
// isTmpSurveyUrl
// ========================

describe('isTmpSurveyUrl', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
  });

  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  });

  it('tmp/survey/ prefix URL은 true', () => {
    expect(isTmpSurveyUrl('https://cdn.test/tmp/survey/abc.webp')).toBe(true);
  });

  it('영구 survey/ URL은 false', () => {
    expect(isTmpSurveyUrl('https://cdn.test/survey/abc.webp')).toBe(false);
  });

  it('tmp/mail/ URL은 false', () => {
    expect(isTmpSurveyUrl('https://cdn.test/tmp/mail/abc.webp')).toBe(false);
  });

  it('외부 URL은 false', () => {
    expect(isTmpSurveyUrl('https://external.com/tmp/survey/abc.webp')).toBe(false);
  });

  it('빈 문자열은 false', () => {
    expect(isTmpSurveyUrl('')).toBe(false);
  });
});

// ========================
// tmpToPermanentUrl
// ========================

describe('tmpToPermanentUrl', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
  });

  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  });

  it('tmp/survey/ → survey/ 변환', () => {
    expect(tmpToPermanentUrl('https://cdn.test/tmp/survey/abc.webp')).toBe(
      'https://cdn.test/survey/abc.webp',
    );
  });

  it('중첩 경로도 변환', () => {
    expect(tmpToPermanentUrl('https://cdn.test/tmp/survey/dir/file.png')).toBe(
      'https://cdn.test/survey/dir/file.png',
    );
  });

  it('tmp/survey/가 아닌 URL은 그대로', () => {
    const url = 'https://cdn.test/tmp/mail/abc.webp';
    expect(tmpToPermanentUrl(url)).toBe(url);
  });
});

// ========================
// urlToR2Key
// ========================

describe('urlToR2Key', () => {
  it('pathname에서 leading slash 제거', () => {
    expect(urlToR2Key('https://cdn.test/tmp/survey/abc.webp')).toBe('tmp/survey/abc.webp');
  });

  it('중첩 경로도 처리', () => {
    expect(urlToR2Key('https://cdn.test/survey/dir/file.png')).toBe('survey/dir/file.png');
  });

  it('유효하지 않은 URL은 null', () => {
    expect(urlToR2Key('not-a-url')).toBeNull();
  });

  it('빈 문자열은 null', () => {
    expect(urlToR2Key('')).toBeNull();
  });
});

// ========================
// extractTmpSurveyUrlsFromQuestion
// ========================

describe('extractTmpSurveyUrlsFromQuestion', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
  });

  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  });

  const baseQuestion: Question = {
    id: 'q1',
    type: 'text',
    title: '테스트',
    required: false,
    order: 0,
  };

  it('description의 tmp/survey/ URL 추출', () => {
    const q: Question = {
      ...baseQuestion,
      description: '<p><img src="https://cdn.test/tmp/survey/img1.webp"></p>',
    };
    expect(extractTmpSurveyUrlsFromQuestion(q)).toEqual(['https://cdn.test/tmp/survey/img1.webp']);
  });

  it('noticeContent의 tmp/survey/ URL 추출', () => {
    const q: Question = {
      ...baseQuestion,
      noticeContent: '<img src="https://cdn.test/tmp/survey/notice.png">',
    };
    expect(extractTmpSurveyUrlsFromQuestion(q)).toEqual([
      'https://cdn.test/tmp/survey/notice.png',
    ]);
  });

  it('tableRowsData cell.imageUrl 추출', () => {
    const q: Question = {
      ...baseQuestion,
      type: 'table',
      tableRowsData: [
        {
          id: 'row1',
          label: '행1',
          cells: [
            {
              id: 'cell1',
              type: 'image',
              content: '',
              imageUrl: 'https://cdn.test/tmp/survey/cell.webp',
            },
          ],
        },
      ],
    };
    expect(extractTmpSurveyUrlsFromQuestion(q)).toEqual([
      'https://cdn.test/tmp/survey/cell.webp',
    ]);
  });

  it('영구 URL은 추출하지 않음', () => {
    const q: Question = {
      ...baseQuestion,
      description: '<img src="https://cdn.test/survey/perm.webp">',
    };
    expect(extractTmpSurveyUrlsFromQuestion(q)).toEqual([]);
  });

  it('tmp/mail/ URL은 추출하지 않음', () => {
    const q: Question = {
      ...baseQuestion,
      description: '<img src="https://cdn.test/tmp/mail/mail.webp">',
    };
    expect(extractTmpSurveyUrlsFromQuestion(q)).toEqual([]);
  });

  it('중복 URL 제거', () => {
    const q: Question = {
      ...baseQuestion,
      description: `
        <img src="https://cdn.test/tmp/survey/dup.webp">
        <img src="https://cdn.test/tmp/survey/dup.webp">
      `,
    };
    expect(extractTmpSurveyUrlsFromQuestion(q)).toEqual(['https://cdn.test/tmp/survey/dup.webp']);
  });

  it('description + noticeContent + cell.imageUrl 동시 추출', () => {
    const q: Question = {
      ...baseQuestion,
      type: 'table',
      description: '<img src="https://cdn.test/tmp/survey/a.webp">',
      noticeContent: '<img src="https://cdn.test/tmp/survey/b.png">',
      tableRowsData: [
        {
          id: 'row1',
          label: '행1',
          cells: [
            {
              id: 'cell1',
              type: 'image',
              content: '',
              imageUrl: 'https://cdn.test/tmp/survey/c.webp',
            },
          ],
        },
      ],
    };
    const result = extractTmpSurveyUrlsFromQuestion(q);
    expect(result).toHaveLength(3);
    expect(result).toContain('https://cdn.test/tmp/survey/a.webp');
    expect(result).toContain('https://cdn.test/tmp/survey/b.png');
    expect(result).toContain('https://cdn.test/tmp/survey/c.webp');
  });

  it('아무 이미지 없으면 빈 배열', () => {
    expect(extractTmpSurveyUrlsFromQuestion(baseQuestion)).toEqual([]);
  });
});

// ========================
// replaceUrlsInQuestion
// ========================

describe('replaceUrlsInQuestion', () => {
  const mapping = new Map([
    ['https://cdn.test/tmp/survey/a.webp', 'https://cdn.test/survey/a.webp'],
    ['https://cdn.test/tmp/survey/b.png', 'https://cdn.test/survey/b.png'],
  ]);

  it('description의 URL 치환', () => {
    const q: Question = {
      id: 'q1',
      type: 'text',
      title: '테스트',
      required: false,
      order: 0,
      description: '<img src="https://cdn.test/tmp/survey/a.webp">',
    };
    const result = replaceUrlsInQuestion(q, mapping);
    expect(result.description).toBe('<img src="https://cdn.test/survey/a.webp">');
  });

  it('noticeContent의 URL 치환', () => {
    const q: Question = {
      id: 'q1',
      type: 'notice',
      title: '안내',
      required: false,
      order: 0,
      noticeContent: '<img src="https://cdn.test/tmp/survey/b.png">',
    };
    const result = replaceUrlsInQuestion(q, mapping);
    expect(result.noticeContent).toBe('<img src="https://cdn.test/survey/b.png">');
  });

  it('tableRowsData cell.imageUrl 치환', () => {
    const q: Question = {
      id: 'q1',
      type: 'table',
      title: '테이블',
      required: false,
      order: 0,
      tableRowsData: [
        {
          id: 'row1',
          label: '행1',
          cells: [
            {
              id: 'cell1',
              type: 'image',
              content: '',
              imageUrl: 'https://cdn.test/tmp/survey/a.webp',
            },
          ],
        },
      ],
    };
    const result = replaceUrlsInQuestion(q, mapping);
    const row0 = result.tableRowsData?.[0];
    const cell0 = row0?.cells[0];
    if (!row0 || !cell0) throw new Error('tableRowsData[0].cells[0] is undefined');
    expect(cell0.imageUrl).toBe('https://cdn.test/survey/a.webp');
  });

  it('mapping에 없는 URL은 그대로', () => {
    const q: Question = {
      id: 'q1',
      type: 'text',
      title: '테스트',
      required: false,
      order: 0,
      description: '<img src="https://cdn.test/survey/perm.webp">',
    };
    const result = replaceUrlsInQuestion(q, mapping);
    expect(result.description).toBe('<img src="https://cdn.test/survey/perm.webp">');
  });

  it('빈 mapping이면 질문 그대로 반환', () => {
    const q: Question = {
      id: 'q1',
      type: 'text',
      title: '테스트',
      required: false,
      order: 0,
      description: '<img src="https://cdn.test/tmp/survey/a.webp">',
    };
    const result = replaceUrlsInQuestion(q, new Map());
    expect(result).toBe(q); // 동일 참조 (early return)
  });

  it('description에 여러 동일 URL이 있어도 모두 치환', () => {
    const q: Question = {
      id: 'q1',
      type: 'text',
      title: '테스트',
      required: false,
      order: 0,
      description:
        '<img src="https://cdn.test/tmp/survey/a.webp"><img src="https://cdn.test/tmp/survey/a.webp">',
    };
    const result = replaceUrlsInQuestion(q, mapping);
    expect(result.description).toBe(
      '<img src="https://cdn.test/survey/a.webp"><img src="https://cdn.test/survey/a.webp">',
    );
  });
});

// ========================
// extractTmpSurveyUrlsFromResponseHeader
// ========================

describe('extractTmpSurveyUrlsFromResponseHeader', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
  });

  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  });

  it('헤더 로고의 tmp/survey/ URL을 추출한다', () => {
    expect(
      extractTmpSurveyUrlsFromResponseHeader({
        style: 'logo-title',
        titleSize: 'auto',
        logo: {
          imageUrl: 'https://cdn.test/tmp/survey/header-logo.webp',
          size: 'md',
        },
      }),
    ).toEqual(['https://cdn.test/tmp/survey/header-logo.webp']);
  });

  it('기본형 또는 영구 URL은 추출하지 않는다', () => {
    expect(
      extractTmpSurveyUrlsFromResponseHeader({
        style: 'plain',
        titleSize: 'auto',
      }),
    ).toEqual([]);

    expect(
      extractTmpSurveyUrlsFromResponseHeader({
        style: 'official-band',
        titleSize: 'auto',
        logo: {
          imageUrl: 'https://cdn.test/survey/header-logo.webp',
          size: 'md',
        },
      }),
    ).toEqual([]);
  });
});

describe('replaceUrlsInResponseHeader', () => {
  it('헤더 로고 URL만 mapping 값으로 치환한다', () => {
    const config = {
      style: 'official-band' as const,
      titleSize: 'auto' as const,
      logo: {
        imageUrl: 'https://cdn.test/tmp/survey/header-logo.webp',
        size: 'md' as const,
      },
      officialBand: {
        arrangement: 'stat-left-logo-right' as const,
        statisticNotice: {
          title: '통계법 제33조(비밀의 보호)',
          body: '비밀은 보호됩니다.',
          width: 'md' as const,
        },
      },
    };

    expect(
      replaceUrlsInResponseHeader(
        config,
        new Map([
          [
            'https://cdn.test/tmp/survey/header-logo.webp',
            'https://cdn.test/survey/header-logo.webp',
          ],
        ]),
      ).logo?.imageUrl,
    ).toBe('https://cdn.test/survey/header-logo.webp');
  });
});
