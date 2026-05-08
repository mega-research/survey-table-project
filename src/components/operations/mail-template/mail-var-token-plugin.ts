import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const VAR_TOKEN_RE = /\{\{[^}]+\}\}/g;

export interface TokenRange {
  from: number;
  to: number;
}

/**
 * doc 전체를 순회하며 {{var}} 토큰의 절대 위치 범위를 반환.
 * Pure function — 테스트 가능.
 */
export function scanTokenRanges(doc: PMNode): TokenRange[] {
  const ranges: TokenRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    let m: RegExpExecArray | null;
    VAR_TOKEN_RE.lastIndex = 0;
    while ((m = VAR_TOKEN_RE.exec(text)) !== null) {
      const from = pos + m.index;
      ranges.push({ from, to: from + m[0].length });
    }
  });
  return ranges;
}

function buildDecorations(doc: PMNode): DecorationSet {
  const ranges = scanTokenRanges(doc);
  const decorations = ranges.map((r) =>
    Decoration.inline(r.from, r.to, { class: 'mail-var-token' }),
  );
  return DecorationSet.create(doc, decorations);
}

export const mailVarTokenPluginKey = new PluginKey<DecorationSet>('mail-var-token');

export const mailVarTokenPlugin = new Plugin<DecorationSet>({
  key: mailVarTokenPluginKey,
  state: {
    init: (_, { doc }) => buildDecorations(doc),
    apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
  },
  props: {
    decorations(state) {
      return mailVarTokenPluginKey.getState(state);
    },
  },
});
