import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

/**
 * 현재 selection의 부모 체인을 거슬러 올라가 가장 가까운 table 노드를 찾는다.
 * 셀 내부 paragraph 텍스트 커서처럼 `editor.isActive('table')`로 잡히지 않는
 * selection 케이스까지 안전하게 커버한다.
 *
 * @returns 찾으면 `{ node, pos }` — `pos`는 표 노드 시작 위치. 못 찾으면 `null`.
 */
export function findTableAtSelection(
  state: EditorState,
): { node: ProseMirrorNode; pos: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'table') {
      return { node, pos: $from.before(d) };
    }
  }
  return null;
}
