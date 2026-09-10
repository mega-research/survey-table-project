import { generateHTML, generateJSON, getText, getTextSerializersFromSchema, getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import { createInlineCellExtensions } from '@/components/ui/rich-text-editor/inline-cell-extensions';

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
