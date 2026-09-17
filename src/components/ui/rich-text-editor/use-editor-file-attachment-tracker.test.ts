import { describe, expect, it } from 'vitest';

import { extractTmpAttachmentKeysFromHtml } from '@/components/ui/rich-text-editor/use-editor-file-attachment-tracker';

describe('extractTmpAttachmentKeysFromHtml', () => {
  it('tmp/notice-attachment/ data-key 만 추출', () => {
    const html =
      '<a data-file-attachment="true" data-key="tmp/notice-attachment/a.pdf">A</a>' +
      '<a data-file-attachment="true" data-key="notice-attachment/b.pdf">B</a>';
    expect(extractTmpAttachmentKeysFromHtml(html)).toEqual([
      'tmp/notice-attachment/a.pdf',
    ]);
  });

  it('중복 제거', () => {
    const html =
      '<a data-file-attachment="true" data-key="tmp/notice-attachment/a.pdf">A</a>' +
      '<a data-file-attachment="true" data-key="tmp/notice-attachment/a.pdf">A2</a>';
    expect(extractTmpAttachmentKeysFromHtml(html)).toEqual([
      'tmp/notice-attachment/a.pdf',
    ]);
  });

  it('data-file-attachment 아닌 <a> 는 무시', () => {
    const html = '<a data-key="tmp/notice-attachment/x.pdf">x</a>';
    expect(extractTmpAttachmentKeysFromHtml(html)).toEqual([]);
  });

  it('tmp/mail-attachment/ 는 제외', () => {
    const html =
      '<a data-file-attachment="true" data-key="tmp/mail-attachment/x.pdf">x</a>';
    expect(extractTmpAttachmentKeysFromHtml(html)).toEqual([]);
  });

  it('빈 HTML 은 빈 배열', () => {
    expect(extractTmpAttachmentKeysFromHtml('')).toEqual([]);
  });
});
