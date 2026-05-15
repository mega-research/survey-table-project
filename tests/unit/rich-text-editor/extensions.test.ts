import { Editor, generateHTML, generateJSON } from '@tiptap/core';
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

  describe('schema 진단', () => {
    function inspect(kind: 'mail' | 'survey') {
      const exts = createUnifiedExtensions({ kind });
      const editor = new Editor({ extensions: exts });
      const nodes = Object.keys(editor.schema.nodes).sort();
      const tableHeaderType = editor.schema.nodes.tableHeader;
      const tableCellType = editor.schema.nodes.tableCell;
      const tableRowType = editor.schema.nodes.tableRow;
      const tableType = editor.schema.nodes.table;
      const insertResult = editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
      editor.destroy();
      return {
        nodes,
        tableHeaderType,
        tableCellType,
        tableRowType,
        tableType,
        insertResult,
      };
    }

    it('mail kind: 모든 table 관련 node 가 schema 에 등록되고 insertTable 이 성공한다', () => {
      const r = inspect('mail');
      expect(r.tableType).toBeDefined();
      expect(r.tableRowType).toBeDefined();
      expect(r.tableCellType).toBeDefined();
      expect(r.tableHeaderType).toBeDefined();
      expect(r.insertResult).toBe(true);
    });

    it('survey kind: 모든 table 관련 node 가 schema 에 등록되고 insertTable 이 성공한다', () => {
      const r = inspect('survey');
      expect(r.tableType).toBeDefined();
      expect(r.tableRowType).toBeDefined();
      expect(r.tableCellType).toBeDefined();
      expect(r.tableHeaderType).toBeDefined();
      expect(r.insertResult).toBe(true);
    });

    it('image 노드는 ImageResize 의 wrapperStyle / containerStyle attr 를 노출한다', () => {
      // ImageResize 의 node name 은 image 가 아닌 imageResize 임에 주의
      const exts = createUnifiedExtensions({ kind: 'survey' });
      const editor = new Editor({
        extensions: exts,
        content: '<p><img src="x.png" alt="t" /></p>',
      });

      interface PMNodeLite {
        type: { name: string };
        attrs: Record<string, unknown>;
      }
      let imageNode: PMNodeLite | null = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'imageResize' && imageNode === null) {
          imageNode = node as unknown as PMNodeLite;
        }
        return true;
      });
      expect(imageNode).not.toBeNull();

      // ImageResize 의 wrapperStyle default 는 inline 모드에서 float: left 포함 문자열
      const initialWrapperStyle = (imageNode as unknown as PMNodeLite).attrs.wrapperStyle;
      expect(typeof initialWrapperStyle).toBe('string');
      expect(initialWrapperStyle as string).toMatch(/float:\s*left/);

      // containerStyle attr 도 schema 에 등록되어 있는지
      const imageSchemaSpec = editor.schema.nodes.imageResize.spec as {
        attrs?: Record<string, unknown>;
      };
      expect(imageSchemaSpec.attrs).toHaveProperty('wrapperStyle');
      expect(imageSchemaSpec.attrs).toHaveProperty('containerStyle');

      editor.destroy();
    });

    it('ImageResize 의 node name 은 imageResize 로 schema 에 등록된다', () => {
      const exts = createUnifiedExtensions({ kind: 'survey' });
      const editor = new Editor({ extensions: exts, content: '<p>x</p>' });
      expect(editor.schema.nodes.imageResize).toBeDefined();
      expect(editor.schema.nodes.image).toBeUndefined();
      editor.destroy();
    });
  });
});
