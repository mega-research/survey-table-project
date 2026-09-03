import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

import { FileAttachment } from '@/components/ui/rich-text-editor/file-attachment-node';

function createEditor(content: string) {
  return new Editor({
    extensions: [StarterKit.configure({ heading: false }), FileAttachment],
    content,
  });
}

describe('FileAttachment node', () => {
  it('parseHTML: <a data-file-attachment="true"> 를 노드로 파싱', () => {
    const editor = createEditor(
      '<p><a data-file-attachment="true" data-key="tmp/notice-attachment/abc.pdf" ' +
        'data-filename="협조공문.pdf" data-size="240000" data-mime="application/pdf" ' +
        'href="https://cdn.test/tmp/notice-attachment/abc.pdf">협조 공문</a></p>',
    );
    const json = editor.getJSON();
    const para = json.content?.[0] as { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> } | undefined;
    const node = para?.content?.[0];
    expect(node?.type).toBe('fileAttachment');
    expect(node?.attrs?.['key']).toBe('tmp/notice-attachment/abc.pdf');
    expect(node?.attrs?.['filename']).toBe('협조공문.pdf');
    expect(node?.attrs?.['size']).toBe('240000');
    expect(node?.attrs?.['mime']).toBe('application/pdf');
    expect(node?.attrs?.['url']).toBe('https://cdn.test/tmp/notice-attachment/abc.pdf');
    expect(node?.attrs?.['label']).toBe('협조 공문');
    editor.destroy();
  });

  it('renderHTML: 6개 attr 모두 직렬화', () => {
    const editor = createEditor('');
    editor
      .chain()
      .insertContent({
        type: 'fileAttachment',
        attrs: {
          key: 'notice-attachment/x.pdf',
          url: 'https://cdn.test/notice-attachment/x.pdf',
          filename: '공문.pdf',
          label: '협조 공문',
          size: 1234,
          mime: 'application/pdf',
        },
      })
      .run();
    const html = editor.getHTML();
    expect(html).toContain('data-file-attachment="true"');
    expect(html).toContain('data-key="notice-attachment/x.pdf"');
    expect(html).toContain('data-filename="공문.pdf"');
    expect(html).toContain('data-size="1234"');
    expect(html).toContain('data-mime="application/pdf"');
    expect(html).toContain('href="https://cdn.test/notice-attachment/x.pdf"');
    expect(html).toContain('download="공문.pdf"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('class="notice-file-attachment"');
    expect(html).toContain('<span class="notice-file-attachment-text">');
    expect(html).toContain('<span class="notice-file-attachment-label">협조 공문</span>');
    expect(html).toContain('<span class="notice-file-attachment-meta">공문.pdf · 1 KB</span>');
    editor.destroy();
  });

  it('label 비어있으면 filename 으로 표시', () => {
    const editor = createEditor('');
    editor
      .chain()
      .insertContent({
        type: 'fileAttachment',
        attrs: {
          key: 'notice-attachment/x.pdf',
          url: 'https://cdn.test/notice-attachment/x.pdf',
          filename: '공문.pdf',
          label: '',
          size: 1234,
          mime: 'application/pdf',
        },
      })
      .run();
    expect(editor.getHTML()).toContain('<span class="notice-file-attachment-label">공문.pdf</span>');
    editor.destroy();
  });

  it('parseHTML ↔ renderHTML round-trip lossless', () => {
    const original =
      '<p><a data-file-attachment="true" data-key="notice-attachment/x.pdf" ' +
      'data-filename="공문.pdf" data-size="1234" data-mime="application/pdf" ' +
      'href="https://cdn.test/notice-attachment/x.pdf" download="공문.pdf" ' +
      'target="_blank" rel="noopener noreferrer" class="notice-file-attachment">' +
      '<span class="notice-file-attachment-text">' +
      '<span class="notice-file-attachment-label">협조 공문</span>' +
      '<span class="notice-file-attachment-meta">공문.pdf · 1 KB</span>' +
      '</span></a></p>';
    const editor = createEditor(original);
    const json = editor.getJSON();
    const para = json.content?.[0] as { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> } | undefined;
    const parsed = para?.content?.[0];
    expect(parsed?.attrs?.['label']).toBe('협조 공문');

    const out = editor.getHTML();
    for (const fragment of [
      'data-file-attachment="true"',
      'data-key="notice-attachment/x.pdf"',
      'data-filename="공문.pdf"',
      'data-size="1234"',
      'data-mime="application/pdf"',
      'href="https://cdn.test/notice-attachment/x.pdf"',
      'download="공문.pdf"',
      '<span class="notice-file-attachment-label">협조 공문</span>',
      '<span class="notice-file-attachment-meta">공문.pdf · 1 KB</span>',
    ]) {
      expect(out).toContain(fragment);
    }
    editor.destroy();
  });
});
