// @vitest-environment jsdom
import { generateHTML, generateJSON } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { createUnifiedExtensions } from '@/components/ui/rich-text-editor/extensions';
import { sanitizeRichHtml } from '@/lib/sanitize';

/**
 * 회귀 테스트: 직렬화된 이미지의 파싱 왕복 무손실.
 *
 * renderHTML 은 wrapperStyle(크기 % 가 사는 곳)을 img inline style 로 합쳐 쓰는데,
 * 라이브러리 parseHTML 은 wrapperstyle "속성"만 읽고 없으면 기본값(float: left,
 * 크기 없음)으로 폴백한다. 그 결과 저장 HTML 을 에디터가 다시 파싱하는 모든 경로
 * (모달 재열기, RichTextEditor 동기화 이펙트의 setContent 리셋)에서 이미지 크기
 * % 가 증발했고, 그 상태로 재저장되면 영구 소실됐다. 직렬화가 wrapperstyle /
 * containerstyle 속성을 함께 남겨 왕복을 무손실로 만든다.
 */
describe('이미지 직렬화 왕복', () => {
  const exts = createUnifiedExtensions({ kind: 'survey' });
  // 크기 50% 버튼을 누른 이미지의 직렬화 형태 (wrapperstyle 속성 포함)
  const serialized =
    '<p style="text-align: center;"><img src="https://x.test/a.webp" ' +
    'wrapperstyle="display: inline-block; vertical-align: top; box-sizing: border-box; width: 50%;" ' +
    'containerstyle="width: 100%; height: auto;" ' +
    'style="display: inline-block; vertical-align: top; box-sizing: border-box; width: 50%; height: auto; max-width: 100%;"></p>';

  it('왕복해도 width 50% 가 유지되고 float 은 재등장하지 않는다', () => {
    const once = generateHTML(generateJSON(serialized, exts), exts);
    expect(once).toMatch(/style="[^"]*width:\s*50%/);
    expect(once).not.toMatch(/float/);
  });

  it('2회 왕복이 1회 왕복과 동일하다 (idempotent — setContent 리셋 루프 차단)', () => {
    const once = generateHTML(generateJSON(serialized, exts), exts);
    const twice = generateHTML(generateJSON(once, exts), exts);
    expect(twice).toBe(once);
  });

  it('구버전 HTML(속성 없이 style 만)도 style 에서 크기를 복원한다', () => {
    const legacy =
      '<p style="text-align: center;"><img src="https://x.test/a.webp" ' +
      'style="display: inline-block; vertical-align: top; box-sizing: border-box; width: 25%; height: auto; max-width: 100%;"></p>';
    const once = generateHTML(generateJSON(legacy, exts), exts);
    expect(once).toMatch(/style="[^"]*width:\s*25%/);
    expect(once).not.toMatch(/float/);
  });

  it('직렬화 출력에 wrapperstyle 속성이 남는다 (재파싱 복원용)', () => {
    const once = generateHTML(generateJSON(serialized, exts), exts);
    expect(once.toLowerCase()).toContain('wrapperstyle=');
  });

  it('렌더 표면(sanitize)에서는 wrapperstyle / containerstyle 속성이 제거된다', () => {
    const once = generateHTML(generateJSON(serialized, exts), exts);
    const out = sanitizeRichHtml(once);
    expect(out.toLowerCase()).not.toContain('wrapperstyle');
    expect(out.toLowerCase()).not.toContain('containerstyle');
    // 시각 스타일은 inline style 로 유지
    expect(out).toMatch(/width:\s*50%/);
  });
});
