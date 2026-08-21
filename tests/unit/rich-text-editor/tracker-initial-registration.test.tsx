import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/image-utils', () => ({ deleteImagesFromR2: vi.fn() }));
vi.mock('@/components/ui/rich-text-editor/file-attachment-r2-client', () => ({
  deleteTmpNoticeAttachmentKeys: vi.fn(),
}));

import { useEditorFileAttachmentTracker } from '@/components/ui/rich-text-editor/use-editor-file-attachment-tracker';
import { useEditorImageTracker } from '@/components/ui/rich-text-editor/use-editor-image-tracker';

/**
 * 두 트래커는 마운트 시점의 initialHtml 만 추적 집합에 등록한다. 호출자가 폼 state 를
 * initialHtml 로 왕복시켜 키 입력마다 prop 이 바뀌어도 집합이 누적되면 안 된다 —
 * 집합은 cancel/unmount 시 R2 DELETE 대상을 정하므로 외부 부작용의 범위가 달라진다.
 */
describe('에디터 트래커 — initialHtml 은 마운트 시 1회만 등록', () => {
  it('useEditorImageTracker: initialHtml 변경 재렌더는 추적 집합을 바꾸지 않는다', () => {
    const { result, rerender } = renderHook(({ html }) => useEditorImageTracker(html), {
      initialProps: { html: '<p><img src="https://r2.example/a.png"></p>' },
    });
    expect(result.current.getOrphans('')).toEqual(['https://r2.example/a.png']);

    rerender({ html: '<p><img src="https://r2.example/b.png"></p>' });
    expect(result.current.getOrphans('')).toEqual(['https://r2.example/a.png']);
  });

  it('useEditorFileAttachmentTracker: initialHtml 변경 재렌더는 추적 집합을 바꾸지 않는다', () => {
    const a = 'tmp/notice-attachment/a.pdf';
    const b = 'tmp/notice-attachment/b.pdf';
    const { result, rerender } = renderHook(({ html }) => useEditorFileAttachmentTracker(html), {
      initialProps: { html: `<a data-file-attachment="true" data-key="${a}">a</a>` },
    });
    expect(result.current.getOrphans('')).toEqual([a]);

    rerender({ html: `<a data-file-attachment="true" data-key="${b}">b</a>` });
    expect(result.current.getOrphans('')).toEqual([a]);
  });
});
