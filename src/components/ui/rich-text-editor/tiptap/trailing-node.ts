import { Extension } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

interface TrailingNodeOptions {
  /** 문서 끝에 자동으로 보강할 노드 이름 */
  node: string;
  /** 마지막 노드가 이 중 하나면 보강하지 않음 */
  notAfter: string[];
}

/**
 * TrailingNode가 자동으로 붙이는 문서 끝 빈 paragraph 제거 — 부모 isDirty 오탐 방지.
 * TextAlign(v3)이 모든 문단에 style="text-align: ..." 을 렌더하므로 속성 유무와 무관하게 매치해야 한다.
 * 내용이 있는 문단과 의도적 빈 줄(<p><br></p>)은 유지한다.
 */
export function stripTrailingEmptyParagraph(html: string): string {
  return html.replace(/(?:<p\b[^>]*><\/p>\s*)+$/i, '');
}

/**
 * 문서 마지막 노드가 paragraph가 아니면 빈 paragraph를 자동으로 붙인다.
 * 표/이미지/HR이 문서 끝에 있을 때 커서가 빠져나갈 자리를 보장하기 위한 용도.
 */
export const TrailingNode = Extension.create<TrailingNodeOptions>({
  name: 'trailingNode',

  addOptions() {
    return {
      node: 'paragraph',
      notAfter: ['paragraph'],
    };
  },

  addProseMirrorPlugins() {
    const { editor, options } = this;
    const pluginKey = new PluginKey<boolean>('trailingNode');
    const disabledNodes: NodeType[] = Object.values(editor.schema.nodes).filter(
      (node) => options.notAfter.includes(node.name),
    );

    return [
      new Plugin<boolean>({
        key: pluginKey,
        appendTransaction: (_transactions, _oldState, newState) => {
          const shouldInsertNodeAtEnd = pluginKey.getState(newState);
          if (!shouldInsertNodeAtEnd) return null;
          const type = newState.schema.nodes[options.node];
          if (!type) return null;
          return newState.tr.insert(newState.doc.content.size, type.create());
        },
        state: {
          init: (_config, state) => {
            const lastNode = state.doc.lastChild;
            if (!lastNode) return false;
            return !disabledNodes.includes(lastNode.type);
          },
          apply: (tr, value) => {
            if (!tr.docChanged) return value;
            const lastNode = tr.doc.lastChild;
            if (!lastNode) return false;
            return !disabledNodes.includes(lastNode.type);
          },
        },
      }),
    ];
  },

  // 초기 상태가 표/이미지/HR로 끝나는 경우, 첫 트랜잭션 전까지는 paragraph가
  // 보강되지 않는다. 빈 트랜잭션을 dispatch하여 appendTransaction을 트리거.
  onCreate() {
    const { view } = this.editor;
    view.dispatch(view.state.tr);
  },
});
