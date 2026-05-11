import { describe, expect, it } from 'vitest';

import {
  diffOrphanAttachmentKeys,
  diffOrphanImages,
  extractMailTemplateAssets,
} from '@/lib/mail/mail-image-extractor';

describe('extractMailTemplateAssets', () => {
  describe('빈 입력', () => {
    it('bodyHtml이 빈 문자열이고 attachments가 빈 배열이면 빈 결과 반환', () => {
      const result = extractMailTemplateAssets({ bodyHtml: '', attachments: [] });
      expect(result.imageUrls).toEqual([]);
      expect(result.attachmentKeys).toEqual([]);
    });

    it('bodyHtml이 null이고 attachments가 null이면 빈 결과 반환', () => {
      const result = extractMailTemplateAssets({ bodyHtml: null, attachments: null });
      expect(result.imageUrls).toEqual([]);
      expect(result.attachmentKeys).toEqual([]);
    });

    it('bodyHtml이 undefined이고 attachments가 undefined이면 빈 결과 반환', () => {
      const result = extractMailTemplateAssets({});
      expect(result.imageUrls).toEqual([]);
      expect(result.attachmentKeys).toEqual([]);
    });
  });

  describe('bodyHtml 이미지 추출', () => {
    it('단일 img src 추출', () => {
      const html = '<p>안녕</p><img src="https://pub-x.r2.dev/images/a.webp">';
      const result = extractMailTemplateAssets({ bodyHtml: html, attachments: [] });
      expect(result.imageUrls).toEqual(['https://pub-x.r2.dev/images/a.webp']);
    });

    it('복수 img src 추출', () => {
      const html =
        '<img src="https://pub-x.r2.dev/images/a.webp"><img src="https://pub-x.r2.dev/images/b.webp">';
      const result = extractMailTemplateAssets({ bodyHtml: html, attachments: [] });
      expect(result.imageUrls).toEqual([
        'https://pub-x.r2.dev/images/a.webp',
        'https://pub-x.r2.dev/images/b.webp',
      ]);
    });

    it('data: URL은 무시', () => {
      const html =
        '<img src="data:image/png;base64,iVBOR..."><img src="https://pub-x.r2.dev/images/a.webp">';
      const result = extractMailTemplateAssets({ bodyHtml: html, attachments: [] });
      expect(result.imageUrls).toEqual(['https://pub-x.r2.dev/images/a.webp']);
    });

    it('img 태그 없으면 빈 배열', () => {
      const html = '<p>텍스트만 있는 본문</p><div>내용</div>';
      const result = extractMailTemplateAssets({ bodyHtml: html, attachments: [] });
      expect(result.imageUrls).toEqual([]);
    });

    it('bodyHtml 내 중복 URL 제거', () => {
      const html =
        '<img src="https://pub-x.r2.dev/images/a.webp"><img src="https://pub-x.r2.dev/images/a.webp">';
      const result = extractMailTemplateAssets({ bodyHtml: html, attachments: [] });
      expect(result.imageUrls).toEqual(['https://pub-x.r2.dev/images/a.webp']);
    });
  });

  describe('attachments key 추출', () => {
    it('단일 attachment key 추출', () => {
      const result = extractMailTemplateAssets({
        bodyHtml: '',
        attachments: [{ key: 'mail/survey-id/file.pdf', filename: 'file.pdf', size: 100, mime: 'application/pdf' }],
      });
      expect(result.attachmentKeys).toEqual(['mail/survey-id/file.pdf']);
    });

    it('복수 attachment key 추출', () => {
      const result = extractMailTemplateAssets({
        bodyHtml: '',
        attachments: [
          { key: 'mail/survey-id/file.pdf', filename: 'file.pdf', size: 100, mime: 'application/pdf' },
          { key: 'mail/survey-id/img.png', filename: 'img.png', size: 200, mime: 'image/png' },
        ],
      });
      expect(result.attachmentKeys).toEqual(['mail/survey-id/file.pdf', 'mail/survey-id/img.png']);
    });

    it('attachment key 중복 제거', () => {
      const result = extractMailTemplateAssets({
        bodyHtml: '',
        attachments: [
          { key: 'mail/survey-id/file.pdf', filename: 'file.pdf', size: 100, mime: 'application/pdf' },
          { key: 'mail/survey-id/file.pdf', filename: 'file.pdf', size: 100, mime: 'application/pdf' },
        ],
      });
      expect(result.attachmentKeys).toEqual(['mail/survey-id/file.pdf']);
    });

    it('key가 빈 문자열인 entry는 포함하지 않음', () => {
      const result = extractMailTemplateAssets({
        bodyHtml: '',
        attachments: [
          { key: '', filename: 'empty.pdf', size: 100, mime: 'application/pdf' },
          { key: 'mail/survey-id/valid.pdf', filename: 'valid.pdf', size: 100, mime: 'application/pdf' },
        ],
      });
      expect(result.attachmentKeys).toEqual(['mail/survey-id/valid.pdf']);
    });
  });

  describe('bodyHtml + attachments 조합', () => {
    it('bodyHtml 이미지와 attachment key 모두 추출', () => {
      const html = '<img src="https://pub-x.r2.dev/images/a.webp">';
      const result = extractMailTemplateAssets({
        bodyHtml: html,
        attachments: [{ key: 'mail/survey-id/file.pdf', filename: 'file.pdf', size: 100, mime: 'application/pdf' }],
      });
      expect(result.imageUrls).toEqual(['https://pub-x.r2.dev/images/a.webp']);
      expect(result.attachmentKeys).toEqual(['mail/survey-id/file.pdf']);
    });

    it('imageUrls와 attachmentKeys는 독립적으로 관리', () => {
      // bodyHtml에 이미지 URL과 attachments key 가 같더라도 별도 배열로 관리
      const html = '<img src="https://pub-x.r2.dev/images/img.png">';
      const result = extractMailTemplateAssets({
        bodyHtml: html,
        attachments: [{ key: 'mail/survey-id/img.png', filename: 'img.png', size: 100, mime: 'image/png' }],
      });
      expect(result.imageUrls).toEqual(['https://pub-x.r2.dev/images/img.png']);
      expect(result.attachmentKeys).toEqual(['mail/survey-id/img.png']);
    });
  });
});

describe('diffOrphanImages', () => {
  it('기존에 있고 새 버전에 없는 URL 반환', () => {
    expect(diffOrphanImages(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });

  it('orphan 없으면 빈 배열 반환', () => {
    expect(diffOrphanImages(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
  });

  it('둘 다 빈 배열이면 빈 배열 반환', () => {
    expect(diffOrphanImages([], [])).toEqual([]);
  });

  it('oldUrls만 있으면 모두 orphan', () => {
    expect(diffOrphanImages(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('newUrls만 있으면 orphan 없음', () => {
    expect(diffOrphanImages([], ['a', 'b'])).toEqual([]);
  });

  it('oldUrls 내 중복 제거', () => {
    expect(diffOrphanImages(['a', 'a', 'b'], ['b'])).toEqual(['a']);
  });

  it('대소문자 구분하여 정확 매칭', () => {
    expect(diffOrphanImages(['https://r2.dev/Image.png'], ['https://r2.dev/image.png'])).toEqual([
      'https://r2.dev/Image.png',
    ]);
  });
});

describe('diffOrphanAttachmentKeys', () => {
  it('기존에 있고 새 버전에 없는 key 반환', () => {
    expect(diffOrphanAttachmentKeys(['key1', 'key2', 'key3'], ['key2'])).toEqual([
      'key1',
      'key3',
    ]);
  });

  it('orphan 없으면 빈 배열 반환', () => {
    expect(diffOrphanAttachmentKeys(['key1'], ['key1', 'key2'])).toEqual([]);
  });

  it('둘 다 빈 배열이면 빈 배열 반환', () => {
    expect(diffOrphanAttachmentKeys([], [])).toEqual([]);
  });

  it('oldKeys만 있으면 모두 orphan', () => {
    expect(diffOrphanAttachmentKeys(['mail/id/a.pdf', 'mail/id/b.pdf'], [])).toEqual([
      'mail/id/a.pdf',
      'mail/id/b.pdf',
    ]);
  });

  it('oldKeys 내 중복 제거', () => {
    expect(diffOrphanAttachmentKeys(['key1', 'key1', 'key2'], ['key2'])).toEqual(['key1']);
  });
});
