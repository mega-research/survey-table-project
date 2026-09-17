import { generateHTML, generateJSON, getText, getTextSerializersFromSchema, getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import {
  createInlineCellExtensions,
  createInlineTitleExtensions,
} from '@/components/ui/rich-text-editor/inline-cell-extensions';
import { sanitizeTitleHtml } from '@/lib/sanitize';

const exts = createInlineCellExtensions();
const schema = getSchema(exts);

function roundTrip(html: string): string {
  return generateHTML(generateJSON(html, exts), exts);
}

function plainText(html: string): string {
  const doc = PMNode.fromJSON(schema, generateJSON(html, exts));
  return getText(doc, {
    blockSeparator: '\n',
    textSerializers: getTextSerializersFromSchema(schema),
  });
}

describe('셀 본문 편집기 스키마', () => {
  it('굵게·글자색·문단·줄바꿈은 지킨다 (색은 CSSOM 이 rgb() 로 다시 쓴다)', () => {
    expect(roundTrip('<p>a <strong>b</strong> <span style="color: #ff0000">c</span></p><p>d<br>e</p>'))
      .toBe('<p>a <strong>b</strong> <span style="color: rgb(255, 0, 0);">c</span></p><p>d<br>e</p>');
  });

  it('이미지·링크·글꼴·표는 붙여넣어도 떨어진다', () => {
    const out = roundTrip(
      '<p><a href="https://x">링크</a> <span style="font-size: 30px">큰글</span> <em>기울임</em></p><img src="x">',
    );
    expect(out).toBe('<p>링크 큰글 기울임</p>');
  });

  it('평문 추출은 문단과 줄바꿈을 모두 \\n 으로 편다 — content 정본과 1:1', () => {
    expect(plainText('<p>제목</p><p>설명 <strong>강조</strong><br>둘째</p>')).toBe('제목\n설명 강조\n둘째');
  });
});

describe('문항 제목 편집기 스키마', () => {
  const titleExts = createInlineTitleExtensions();
  const titleRoundTrip = (html: string) => generateHTML(generateJSON(html, titleExts), titleExts);

  it('굵게·밑줄·글자색·글자 크기를 지킨다', () => {
    const out = titleRoundTrip(
      '<p><strong>a</strong><u>b</u><span style="color: #ff0000">c</span><span style="font-size: 24px">d</span></p>',
    );
    expect(out).toContain('<strong>a</strong>');
    expect(out).toContain('<u>b</u>');
    expect(out).toContain('color: rgb(255, 0, 0)');
    expect(out).toContain('font-size: 24px');
  });

  it('제목 편집기가 낸 서식본은 sanitizeTitleHtml 을 통과해도 서식이 남는다', () => {
    const out = sanitizeTitleHtml(
      titleRoundTrip('<p><u>b</u><span style="color: #ff0000">c</span><span style="font-size: 24px">d</span></p>'),
    );
    expect(out).toContain('<u>b</u>');
    expect(out).toMatch(/color:\s*rgb\(255, 0, 0\)/);
    expect(out).toMatch(/font-size:\s*24px/);
  });

  it('허용 밖 글자 크기·링크·기울임은 떨어진다', () => {
    expect(
      titleRoundTrip('<p><a href="https://x">링크</a> <span style="font-size: 30px">큰</span> <em>기울</em></p>'),
    ).toBe('<p>링크 큰 기울</p>');
  });
});
