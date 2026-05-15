import { generateHTML, generateJSON } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { createUnifiedExtensions } from '@/components/ui/rich-text-editor/extensions';

describe('createUnifiedExtensions', () => {
  describe('survey kind', () => {
    const exts = createUnifiedExtensions({ kind: 'survey' });

    it('survey 모드는 <th>를 그대로 유지한다', () => {
      const html = '<table><tbody><tr><th>제목</th></tr><tr><td>값</td></tr></tbody></table>';
      const json = generateJSON(html, exts);
      const out = generateHTML(json, exts);
      // <thead> 와 혼동되지 않도록 엄격한 매칭
      expect(out).toMatch(/<th[\s>]/);
      expect(out).toMatch(/<td[\s>]/);
    });

    it('셀 backgroundColor 의 두 가지 표기를 모두 파싱한다', () => {
      const styleOnly =
        '<table><tbody><tr><td style="background-color: rgb(229, 231, 235)">A</td></tr></tbody></table>';
      const dataAttr =
        '<table><tbody><tr><td data-background-color="#e5e7eb">A</td></tr></tbody></table>';
      const j1 = generateJSON(styleOnly, exts);
      const j2 = generateJSON(dataAttr, exts);
      // table > tableRow > tableCell (plan 의 depth+1 경로는 paragraph 노드였음, 수정)
      const findCell = (j: any) => j.content[0].content[0].content[0];
      expect(findCell(j1).attrs.backgroundColor).toBeTruthy();
      expect(findCell(j2).attrs.backgroundColor).toBeTruthy();
    });

    it('colwidth attr가 round-trip 으로 보존된다', () => {
      const html = '<table><tbody><tr><td colwidth="100,150">x</td></tr></tbody></table>';
      const json = generateJSON(html, exts);
      const out = generateHTML(json, exts);
      expect(out).toContain('colwidth="100,150"');
    });
  });

  describe('mail kind', () => {
    const exts = createUnifiedExtensions({ kind: 'mail' });

    it('mail 모드는 <th>를 <td>로 마이그레이션한다 (Outlook 호환)', () => {
      const html = '<table><tbody><tr><th>제목</th></tr></tbody></table>';
      const json = generateJSON(html, exts);
      const out = generateHTML(json, exts);
      expect(out).not.toMatch(/<th[\s>]/);
      expect(out).toMatch(/<td[\s>]/);
    });

    it('TableCaption 노드를 허용한다', () => {
      const html =
        '<table><caption>표 제목</caption><tbody><tr><td>x</td></tr></tbody></table>';
      const json = generateJSON(html, exts);
      const captionNode = json.content[0].content[0];
      expect(captionNode.type).toBe('tableCaption');
    });

    it('FontSize mark 가 보존된다', () => {
      const html = '<p><span style="font-size: 20px">크게</span></p>';
      const json = generateJSON(html, exts);
      const out = generateHTML(json, exts);
      expect(out).toMatch(/font-size:\s*20px/);
    });
  });

  describe('공통', () => {
    const exts = createUnifiedExtensions({ kind: 'survey' });

    it('Underline mark 가 보존된다', () => {
      const html = '<p><u>밑줄</u></p>';
      const json = generateJSON(html, exts);
      const out = generateHTML(json, exts);
      expect(out).toContain('<u>');
    });

    it('Strike mark 가 보존된다', () => {
      const html = '<p><s>취소선</s></p>';
      const json = generateJSON(html, exts);
      const out = generateHTML(json, exts);
      expect(out).toMatch(/<s>|<del>/);
    });

    it('TextAlign style 이 보존된다', () => {
      const html = '<p style="text-align: center">중앙</p>';
      const json = generateJSON(html, exts);
      const out = generateHTML(json, exts);
      expect(out).toMatch(/text-align:\s*center/);
    });
  });
});
