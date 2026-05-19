import { type AnyExtension, Extension } from '@tiptap/core';
import { type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Link from '@tiptap/extension-link';
import Strike from '@tiptap/extension-strike';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import ImageResize from 'tiptap-extension-resize-image';

import { TableSelectOnBackspace } from '@/lib/tiptap/table-select-on-backspace';

import { FontSize } from './font-size-mark';
import {
  parseTableAlign,
  parseVerticalAlign,
  tableAlignStyle,
  verticalAlignStyle,
  type HAlign,
  type VAlign,
} from './table-attrs-helpers';
import { TrailingNode } from './trailing-node';
import { createVarTokenPlugin } from './var-token-plugin';
import type { RichTextEditorKind } from './types';

const VarTokenExtension = Extension.create({
  name: 'varToken',
  addProseMirrorPlugins() {
    return [createVarTokenPlugin()];
  },
});

// TipTap Table extension 의 TableView NodeView 는 update 에서 attrs.style 을 재적용하지
// 않고, this.parent 로 baseRenderer 를 가져오는 일반 패턴도 addNodeView 에 대해서는
// undefined 라 wrap 이 불가능하다. 그래서 별도 ProseMirror plugin 이 wrapper 에 flex +
// justify-content Decoration 을 박아 inner table 을 정렬.
//
// 성능: plugin state 에 DecorationSet 을 캐시하고 tr.docChanged 시에만 재계산.
// selection 만 변하는 transaction (커서 이동) 은 skip → 큰 문서 + 다수 table 환경에서
// cell typing 시 풀스캔 부담을 줄인다.
function buildTableAlignDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return;
    const align = (node.attrs.align ?? 'left') as 'left' | 'center' | 'right';
    const justify =
      align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        style: `display: flex; justify-content: ${justify};`,
      }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

const TableAlignDecoration = Extension.create({
  name: 'tableAlignDecoration',
  addProseMirrorPlugins() {
    // 매 에디터 인스턴스마다 새 PluginKey — 두 에디터 동시 마운트 시 키 충돌 방지
    const key = new PluginKey<DecorationSet>('table-align-decoration');
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, { doc }) => buildTableAlignDecorations(doc),
          apply: (tr, old) =>
            tr.docChanged ? buildTableAlignDecorations(tr.doc) : old,
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});

const ImageResizeWithProxy = ImageResize.extend({
  addAttributes() {
    return { ...this.parent?.() };
  },
  // 베이스 ImageResize 는 renderHTML 을 override 하지 않아 단순 <img> 만 출력한다.
  // 그 결과 NodeView 의 wrapper/container DOM 이 미리보기·메일 발송 HTML 에 남지 않아
  // 정렬과 크기 attr 가 사라진다. 여기서 wrapperStyle 을 img inline style 로 직렬화한다.
  // wrapper 의 width 는 img 의 시각 크기를 결정하므로, container width 는 redundant 가 되어 drop.
  // height 와 max-width 안전망만 보강.
  renderHTML({ HTMLAttributes }) {
    const wrapperStyle = (HTMLAttributes.wrapperStyle ?? '') as string;
    const next: Record<string, unknown> = { ...HTMLAttributes };
    delete next.wrapperStyle;
    delete next.containerStyle;
    const base = wrapperStyle.trim().replace(/;+$/, '');
    const finalStyle = base
      ? `${base}; height: auto; max-width: 100%;`
      : 'height: auto; max-width: 100%;';
    next.style = finalStyle;
    return ['img', next];
  },
});

function makeCellAttrs() {
  return {
    backgroundColor: {
      default: null as string | null,
      // 메일(style only) + 설문(data-background-color) 양쪽 모두 파싱
      parseHTML: (el: HTMLElement) =>
        el.getAttribute('data-background-color') || el.style.backgroundColor || null,
      renderHTML: (attrs: { backgroundColor?: string | null }) => {
        if (!attrs.backgroundColor) return {};
        return {
          'data-background-color': attrs.backgroundColor,
          style: `background-color: ${attrs.backgroundColor}`,
        };
      },
    },
    verticalAlign: {
      default: 'top' as VAlign,
      parseHTML: (el: HTMLElement) => parseVerticalAlign(el),
      renderHTML: (attrs: { verticalAlign?: VAlign }) => ({
        style: verticalAlignStyle((attrs.verticalAlign ?? 'top') as VAlign),
      }),
    },
    colwidth: {
      default: null as number[] | null,
      parseHTML: (el: HTMLElement) => {
        const cw = el.getAttribute('colwidth');
        return cw ? cw.split(',').map((n) => parseInt(n, 10)) : null;
      },
      renderHTML: (attrs: { colwidth?: number[] | null }) => {
        if (!attrs.colwidth || !attrs.colwidth.length) return {};
        const width = attrs.colwidth.reduce((a, b) => a + b, 0);
        return { colwidth: attrs.colwidth.join(','), style: `width: ${width}px` };
      },
    },
  };
}

export interface CreateUnifiedExtensionsOptions {
  kind?: RichTextEditorKind;
}

/**
 * 통합 TipTap extensions 배열을 만든다.
 * 호출하는 React 컴포넌트에서는 반드시 useMemo 로 감싸 매 렌더마다 에디터가 destroy/recreate 되지 않도록 한다.
 */
export function createUnifiedExtensions(options: CreateUnifiedExtensionsOptions = {}): AnyExtension[] {
  const kind = options.kind ?? 'survey';

  const TableCellExtended = TableCell.extend({
    addAttributes() {
      return { ...this.parent?.(), ...makeCellAttrs() };
    },
  });

  // mail: <th>를 <td>로 마이그레이션 (Outlook 호환), survey: <th> 유지
  // 베이스는 양쪽 모두 TableHeader 로 통일 — prosemirror-tables 가 schema 에서
  // tableRole='header_cell' 인 노드를 lookup 하므로, TableCell 기반으로 헤더를
  // 만들면 header_cell role 이 누락되어 insertTable 이 createAndFill 단계에서 폭발한다.
  const TableHeaderExtended =
    kind === 'mail'
      ? TableHeader.extend({
          addAttributes() {
            return { ...this.parent?.(), ...makeCellAttrs() };
          },
          // parseHTML 은 TableHeader 의 기본 <th> 매칭을 그대로 사용
          renderHTML({ HTMLAttributes }) {
            return ['td', HTMLAttributes, 0];
          },
        })
      : TableHeader.extend({
          addAttributes() {
            return { ...this.parent?.(), ...makeCellAttrs() };
          },
        });

  const TableExtended = Table.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        align: {
          default: 'left' as HAlign,
          parseHTML: (el: HTMLElement) => parseTableAlign(el),
          // 미리보기 / 저장 HTML 에는 table inline style 로 margin auto 박는다.
          // 편집기 시각은 별도 TableAlignDecoration plugin 이 wrapper 에 flex 로 처리.
          renderHTML: (attrs: { align?: HAlign }) => ({
            style: tableAlignStyle((attrs.align ?? 'left') as HAlign),
          }),
        },
      };
    },
  });

  return [
    StarterKit.configure({
      // heading 자체 비활성. 기존 콘텐츠에서 H1/H2/H3 사용 없음 — schema 에서 제거.
      // 만약 누락된 데이터가 있더라도 TipTap 은 paragraph 로 fallback 한다.
      heading: false,
      // StarterKit 기본 strike 끄고 별도 ext 로 통일
      strike: false,
      // StarterKit 3.x 에 bundled된 ext를 끄고 아래에서 별도 configure
      underline: false,
      link: false,
      // StarterKit 의 trailingNode 끄고 @/lib/tiptap/trailing-node 사용
      trailingNode: false,
    }),
    Underline,
    Strike,
    TextStyle,
    FontSize,
    TextAlign.configure({
      // ImageResize 는 NodeView 모드로 paragraph text-align 을 무시하고
      // 자체 wrapperStyle attr (float) 로 정렬을 제어한다. 이미지 정렬은 image-context-toolbar 가 담당.
      // heading 노드 자체를 schema 에서 제거했으므로 types 에도 없음.
      types: ['paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: 'left',
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer', class: 'text-blue-600 underline' },
    }),
    ImageResizeWithProxy.configure({ inline: true, allowBase64: true }),
    TableExtended.configure({
      resizable: true,
      cellMinWidth: 60,
      lastColumnResizable: true,
      allowTableNodeSelection: true,
    }),
    TableRow,
    TableHeaderExtended,
    TableCellExtended,
    TrailingNode,
    TableSelectOnBackspace,
    VarTokenExtension,
    TableAlignDecoration,
  ];
}
