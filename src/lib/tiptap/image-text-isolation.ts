import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const IMAGE_NODE = 'imageResize';
const META_FLAG = 'imageTextIsolationApplied';

interface SplitTarget {
  from: number;
  to: number;
  paragraphs: PMNode[];
}

/**
 * paragraph 안에서 텍스트와 이미지가 섞이면 별도 paragraph 로 분리.
 *
 * 정책:
 * - 텍스트만 / 이미지만 있는 paragraph 는 그대로
 * - 이미지끼리 같은 paragraph 안 나란히 두는 건 허용 (옆에 배치)
 * - 텍스트와 이미지가 같은 paragraph 에 섞이면 연속된 같은 종류끼리 그룹핑해
 *   각 그룹을 별도 paragraph 로 분리 → 이미지가 텍스트 옆에 못 가고 다음 줄로 내려간다.
 *
 * appendTransaction 으로 모든 진입점 (toolbar 삽입, paste, drop, drag, undo/redo,
 * 외부 명령 등) 을 한 곳에서 정규화. 패키지별 진입점을 일일이 막을 필요 없다.
 *
 * 기존 데이터(텍스트+이미지 섞인 paragraph) 도 첫 트랜잭션 시 자동 정규화되어 정책에 맞춰진다.
 */
export const ImageTextIsolation = Extension.create({
  name: 'imageTextIsolation',

  addProseMirrorPlugins() {
    const pluginKey = new PluginKey('imageTextIsolation');
    return [
      new Plugin({
        key: pluginKey,
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          // 이 plugin 이 dispatch 한 transaction 은 재진입 skip
          if (transactions.some((tr) => tr.getMeta(META_FLAG))) return null;

          const targets: SplitTarget[] = [];

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'paragraph') return;

            const children: PMNode[] = [];
            node.forEach((child) => {
              children.push(child);
            });
            if (children.length === 0) return;

            let hasText = false;
            let hasImage = false;
            for (const c of children) {
              if (c.isText) hasText = true;
              else if (c.type.name === IMAGE_NODE) hasImage = true;
            }
            if (!hasText || !hasImage) return;

            // 연속된 같은 종류 (text / image / other) 끼리 그룹핑
            const groups: PMNode[][] = [];
            let currentKind: 'text' | 'image' | 'other' | null = null;
            for (const c of children) {
              const kind: 'text' | 'image' | 'other' = c.isText
                ? 'text'
                : c.type.name === IMAGE_NODE
                  ? 'image'
                  : 'other';
              if (kind !== currentKind) {
                groups.push([c]);
                currentKind = kind;
              } else {
                groups[groups.length - 1].push(c);
              }
            }

            const paragraphType = newState.schema.nodes['paragraph'];
            // paragraph attrs (text-align 등) 는 모든 split 결과에 그대로 전파
            const newParagraphs = groups.map((g) => paragraphType.create(node.attrs, g));

            targets.push({
              from: pos,
              to: pos + node.nodeSize,
              paragraphs: newParagraphs,
            });
          });

          if (targets.length === 0) return null;

          const tr = newState.tr;
          // 뒤에서부터 적용 — 앞 paragraph 의 split 으로 뒤쪽 pos 가 어긋나는 것 방지
          for (let i = targets.length - 1; i >= 0; i--) {
            const t = targets[i];
            tr.replaceWith(t.from, t.to, t.paragraphs);
          }
          tr.setMeta(META_FLAG, true);
          return tr;
        },
      }),
    ];
  },
});
