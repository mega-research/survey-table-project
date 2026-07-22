'use client';

import { TableMap } from '@tiptap/pm/tables';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Columns,
  Equal,
  Frame,
  Merge,
  Paintbrush,
  Rows,
  SeparatorVertical,
  Split,
  Square,
  Trash2,
  X,
} from 'lucide-react';

import {
  normalizeHexColor,
  type CellBorderMode,
  type CellBorderSideColors,
  type CellBorderSideWidths,
  type HAlign,
  type VAlign,
} from './table-attrs-helpers';
import { Sep, ToolBtn } from './toolbar-primitives';

interface Props {
  editor: Editor;
}

export function TableContextToolbar({ editor }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) {
        return {
          canMerge: false,
          canSplit: false,
          canDeleteColumn: false,
          canDeleteRow: false,
          tableAlign: 'left' as 'left' | 'center' | 'right',
          cellVAlign: 'top' as VAlign,
          rowHeight: null as number | null,
          cellBg: '',
          cellBorder: '',
          cellBorderWidth: 1,
          cellBorderMode: 'all' as CellBorderMode,
          outerBorderWidth: null as number | null,
          outerBorderColor: '',
          cellLeftHidden: false,
          cellRightHidden: false,
        };
      }
      const tableAlign: 'left' | 'center' | 'right' = editor.isActive('table', {
        align: 'center',
      })
        ? 'center'
        : editor.isActive('table', { align: 'right' })
          ? 'right'
          : 'left';
      // td / th 어느 쪽에 있든 같은 verticalAlign attr 를 본다.
      const cellVAlign = (editor.getAttributes('tableCell')['verticalAlign']
        ?? editor.getAttributes('tableHeader')['verticalAlign']
        ?? 'top') as VAlign;
      // 커서가 위치한 행의 rowHeight attr (없으면 자동)
      let rowHeight: number | null = null;
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === 'tableRow') {
          rowHeight = (node.attrs['rowHeight'] as number | null) ?? null;
          break;
        }
      }
      return {
        canMerge: editor.can().mergeCells(),
        canSplit: editor.can().splitCell(),
        canDeleteColumn: editor.can().deleteColumn(),
        canDeleteRow: editor.can().deleteRow(),
        tableAlign,
        cellVAlign,
        rowHeight,
        cellBg:
          normalizeHexColor(
            (editor.getAttributes('tableCell')['backgroundColor'] ??
              editor.getAttributes('tableHeader')['backgroundColor']) as string | null,
          ) ?? '',
        cellBorder:
          normalizeHexColor(
            (editor.getAttributes('tableCell')['borderColor'] ??
              editor.getAttributes('tableHeader')['borderColor']) as string | null,
          ) ?? '',
        cellBorderWidth:
          ((editor.getAttributes('tableCell')['borderWidth'] ??
            editor.getAttributes('tableHeader')['borderWidth']) as number | null) ?? 1,
        cellBorderMode:
          ((editor.getAttributes('tableCell')['borderMode'] ??
            editor.getAttributes('tableHeader')['borderMode']) as CellBorderMode | null) ?? 'all',
        cellLeftHidden:
          ((editor.getAttributes('tableCell')['borderSideWidths'] ??
            editor.getAttributes('tableHeader')['borderSideWidths']) as
            | CellBorderSideWidths
            | null)?.[3] === 0,
        cellRightHidden:
          ((editor.getAttributes('tableCell')['borderSideWidths'] ??
            editor.getAttributes('tableHeader')['borderSideWidths']) as
            | CellBorderSideWidths
            | null)?.[1] === 0,
        // 외곽선 현재값: 좌상단 셀의 top 변 두께·색으로 대표
        ...(() => {
          for (let depth = $from.depth; depth >= 0; depth--) {
            const node = $from.node(depth);
            if (node.type.name === 'table') {
              const firstCell = node.firstChild?.firstChild;
              const sidesW = firstCell?.attrs['borderSideWidths'] as
                | CellBorderSideWidths
                | null
                | undefined;
              const sidesC = firstCell?.attrs['borderSideColors'] as
                | CellBorderSideColors
                | null
                | undefined;
              return {
                outerBorderWidth: sidesW?.[0] ?? null,
                outerBorderColor: sidesC?.[0] ?? '',
              };
            }
          }
          return { outerBorderWidth: null, outerBorderColor: '' };
        })(),
      };
    },
  });

  const setCellBg = (color: string | null) => {
    editor.chain().focus().updateAttributes('tableCell', { backgroundColor: color }).run();
    editor.chain().focus().updateAttributes('tableHeader', { backgroundColor: color }).run();
  };

  // 테두리 색·두께·모드는 표 전체 셀에 일괄 적용 — border-collapse 상태에서
  // 인접 셀과 테두리를 공유하므로 (같은 굵기면 왼쪽/위쪽 셀 색이 승리) 셀 단위
  // 적용은 대부분의 변이 이웃 셀 색에 가려져 변경이 보이지 않는다.
  // 내부선(base) 두께·색·모드 변경 시 각 셀의 "내부 변" 변별 고정을 해제한다 —
  // 저장→재편집 왕복 파싱이 남긴 변별값이 base 변경을 가리는 것을 방지.
  // 외곽 변(표 가장자리)과 명시적 숨김(0)은 보존.
  const applyBorderAllCells = (patch: {
    borderColor?: string | null;
    borderWidth?: number | null;
    borderMode?: CellBorderMode;
    borderSideWidths?: CellBorderSideWidths | null;
    borderSideColors?: CellBorderSideColors | null;
  }) => {
    const { state } = editor;
    const { $from } = state.selection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tableNode: any = null;
    let tablePos = -1;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'table') {
        tableNode = node;
        tablePos = $from.before(depth);
        break;
      }
    }
    if (!tableNode || tablePos < 0) return;
    const map = TableMap.get(tableNode);
    const resetInnerSides =
      patch.borderSideWidths === undefined &&
      (patch.borderWidth !== undefined ||
        patch.borderColor !== undefined ||
        patch.borderMode !== undefined);
    const { tr } = state;
    let modified = false;
    const seen = new Set<number>();
    for (const cellPos of map.map) {
      if (seen.has(cellPos)) continue;
      seen.add(cellPos);
      const cellNode = tableNode.nodeAt(cellPos);
      if (!cellNode) continue;
      const nextAttrs = { ...cellNode.attrs, ...patch };
      if (resetInnerSides) {
        const rect = map.findCell(cellPos);
        const isEdge = [
          rect.top === 0,
          rect.right === map.width,
          rect.bottom === map.height,
          rect.left === 0,
        ];
        const prevW =
          (cellNode.attrs['borderSideWidths'] as CellBorderSideWidths | null) ?? [
            null, null, null, null,
          ];
        const nextW = prevW.map((v, i) => (isEdge[i] ? v : v === 0 ? 0 : null));
        nextAttrs['borderSideWidths'] = nextW.every((v) => v == null) ? null : nextW;
        const prevC =
          (cellNode.attrs['borderSideColors'] as CellBorderSideColors | null) ?? [
            null, null, null, null,
          ];
        const nextC = prevC.map((v, i) => (isEdge[i] ? v : null));
        nextAttrs['borderSideColors'] = nextC.every((v) => v == null) ? null : nextC;
      }
      tr.setNodeMarkup(tablePos + 1 + cellPos, undefined, nextAttrs);
      modified = true;
    }
    if (modified) editor.view.dispatch(tr);
  };

  const setCellVAlign = (v: VAlign) => {
    editor.chain().focus().updateAttributes('tableCell', { verticalAlign: v }).run();
    editor.chain().focus().updateAttributes('tableHeader', { verticalAlign: v }).run();
  };

  const setTableAlign = (align: HAlign) => {
    // 편집기 시각은 TableAlignDecoration plugin 이 wrapper 에 flex 로 적용.
    // 미리보기 / 저장 HTML 은 align attr renderHTML 이 table inline style 로 직렬화.
    editor.chain().focus().updateAttributes('table', { align }).run();
  };

  const equalizeColumnWidths = () => {
    const { state } = editor;
    const { $from } = state.selection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tableNode: any = null;
    let tablePos = -1;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'table') {
        tableNode = node;
        tablePos = $from.before(depth);
        break;
      }
    }
    if (!tableNode || tablePos < 0) return;

    let colCount = 0;
    const firstRow = tableNode.firstChild;
    if (firstRow && firstRow.content) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      firstRow.content.forEach((cell: any) => {
        colCount += cell.attrs.colspan || 1;
      });
    }
    if (colCount === 0) return;

    // 현재 table 의 실제 폭을 DOM 에서 측정해 그 폭 기준으로 분배.
    // 콘텐츠가 다르더라도 표 전체 폭을 유지한 채 컬럼만 균등화한다.
    const wrapperDom = editor.view.nodeDOM(tablePos) as HTMLElement | null;
    const tableDom = wrapperDom?.querySelector('table') as HTMLElement | null;
    const measuredWidth = tableDom?.offsetWidth ?? 0;
    // 측정 실패 시 cellMinWidth (60) * colCount 로 fallback
    const totalWidth = measuredWidth > 0 ? measuredWidth : 60 * colCount;
    const equalWidth = Math.floor(totalWidth / colCount);
    const { tr } = state;
    let modified = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tableNode.descendants((node: any, pos: number) => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        const colspan = node.attrs.colspan || 1;
        tr.setNodeMarkup(tablePos + 1 + pos, undefined, {
          ...node.attrs,
          colwidth: Array(colspan).fill(equalWidth),
        });
        modified = true;
      }
    });
    if (modified) editor.view.dispatch(tr);
  };

  // 외곽선: 표 가장자리에 닿는 셀의 바깥쪽 변에만 변별 두께를 적용.
  // TableMap 으로 colspan/rowspan 을 감안해 각 셀이 닿는 가장자리를 판별한다.
  // width=null 이면 외곽 변별 두께를 해제해 내부선과 같아진다.
  const applyOuterBorder = (width: number | null) => {
    const { state } = editor;
    const { $from } = state.selection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tableNode: any = null;
    let tablePos = -1;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'table') {
        tableNode = node;
        tablePos = $from.before(depth);
        break;
      }
    }
    if (!tableNode || tablePos < 0) return;
    const map = TableMap.get(tableNode);
    const { tr } = state;
    let modified = false;
    const seen = new Set<number>();
    for (const cellPos of map.map) {
      if (seen.has(cellPos)) continue;
      seen.add(cellPos);
      const rect = map.findCell(cellPos);
      const cellNode = tableNode.nodeAt(cellPos);
      if (!cellNode) continue;
      const prev = (cellNode.attrs['borderSideWidths'] as CellBorderSideWidths | null) ?? [
        null,
        null,
        null,
        null,
      ];
      const next: CellBorderSideWidths = [...prev];
      if (rect.top === 0) next[0] = width;
      if (rect.right === map.width) next[1] = width;
      if (rect.bottom === map.height) next[2] = width;
      if (rect.left === 0) next[3] = width;
      const allNull = next.every((v) => v == null);
      tr.setNodeMarkup(tablePos + 1 + cellPos, undefined, {
        ...cellNode.attrs,
        borderSideWidths: allNull ? null : next,
      });
      modified = true;
    }
    if (modified) editor.view.dispatch(tr);
  };

  // 외곽선 색: 표 가장자리 셀의 바깥쪽 변에만 변별 색 적용 (내부선 색과 독립)
  const applyOuterColor = (color: string | null) => {
    const { state } = editor;
    const { $from } = state.selection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tableNode: any = null;
    let tablePos = -1;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'table') {
        tableNode = node;
        tablePos = $from.before(depth);
        break;
      }
    }
    if (!tableNode || tablePos < 0) return;
    const map = TableMap.get(tableNode);
    const { tr } = state;
    let modified = false;
    const seen = new Set<number>();
    for (const cellPos of map.map) {
      if (seen.has(cellPos)) continue;
      seen.add(cellPos);
      const rect = map.findCell(cellPos);
      const cellNode = tableNode.nodeAt(cellPos);
      if (!cellNode) continue;
      const prev = (cellNode.attrs['borderSideColors'] as CellBorderSideColors | null) ?? [
        null, null, null, null,
      ];
      const next: CellBorderSideColors = [...prev];
      if (rect.top === 0) next[0] = color;
      if (rect.right === map.width) next[1] = color;
      if (rect.bottom === map.height) next[2] = color;
      if (rect.left === 0) next[3] = color;
      const allNull = next.every((v) => v == null);
      tr.setNodeMarkup(tablePos + 1 + cellPos, undefined, {
        ...cellNode.attrs,
        borderSideColors: allNull ? null : next,
      });
      modified = true;
    }
    if (modified) editor.view.dispatch(tr);
  };

  // 셀 옆 세로선 토글 — border-collapse 에서 세로선은 내 셀과 이웃 셀이 공유하므로
  // (none 은 항상 지고 이웃의 solid 가 그려짐) 내 변 + 이웃의 맞닿은 변을 함께 토글한다.
  const toggleSideLine = (side: 'left' | 'right') => {
    const { state } = editor;
    const { $from } = state.selection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tableNode: any = null;
    let tablePos = -1;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'table') {
        tableNode = node;
        tablePos = $from.before(depth);
        break;
      }
    }
    if (!tableNode || tablePos < 0) return;

    // 현재 셀 (tableCell 또는 tableHeader)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cellNode: any = null;
    let cellAbsPos = -1;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        cellNode = node;
        cellAbsPos = $from.before(depth);
        break;
      }
    }
    if (!cellNode || cellAbsPos < 0) return;

    const map = TableMap.get(tableNode);
    const relPos = cellAbsPos - tablePos - 1;
    const rect = map.findCell(relPos);
    const sideIdx = side === 'right' ? 1 : 3;
    const neighborSideIdx = side === 'right' ? 3 : 1;
    const current =
      ((cellNode.attrs['borderSideWidths'] as CellBorderSideWidths | null) ?? [])[sideIdx] ?? null;
    const newVal: number | null = current === 0 ? null : 0;

    const { tr } = state;
    const touched = new Set<number>();
    const setSide = (rel: number, idx: number) => {
      if (touched.has(rel)) return;
      touched.add(rel);
      const node = tableNode.nodeAt(rel);
      if (!node) return;
      const prev = (node.attrs['borderSideWidths'] as CellBorderSideWidths | null) ?? [
        null,
        null,
        null,
        null,
      ];
      const next: CellBorderSideWidths = [...prev];
      next[idx] = newVal;
      const allNull = next.every((v) => v == null);
      tr.setNodeMarkup(tablePos + 1 + rel, undefined, {
        ...node.attrs,
        borderSideWidths: allNull ? null : next,
      });
    };

    setSide(relPos, sideIdx);
    // 이웃 셀들 (rowspan 감안해 내 셀 높이 범위의 모든 이웃)
    const neighborCol = side === 'right' ? rect.right : rect.left - 1;
    if (neighborCol >= 0 && neighborCol < map.width) {
      for (let r = rect.top; r < rect.bottom; r++) {
        setSide(map.map[r * map.width + neighborCol]!, neighborSideIdx);
      }
    }
    editor.view.dispatch(tr);
  };

  // 선택 위치에서 조상 노드를 depth 역순으로 탐색
  const findAncestor = (typeName: string) => {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === typeName) return { node, pos: $from.before(depth) };
    }
    return null;
  };

  const setCurrentRowHeight = (h: number | null) => {
    const row = findAncestor('tableRow');
    if (!row) return;
    const { tr } = editor.state;
    tr.setNodeMarkup(row.pos, undefined, { ...row.node.attrs, rowHeight: h });
    editor.view.dispatch(tr);
  };

  const setAllRowHeights = (h: number | null) => {
    const table = findAncestor('table');
    if (!table) return;
    const { tr } = editor.state;
    let modified = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table.node.descendants((node: any, pos: number) => {
      if (node.type.name === 'tableRow') {
        tr.setNodeMarkup(table.pos + 1 + pos, undefined, { ...node.attrs, rowHeight: h });
        modified = true;
      }
    });
    if (modified) editor.view.dispatch(tr);
  };

  // 모든 행 높이를 현재 가장 큰 행의 실측 높이로 통일
  const equalizeRowHeights = () => {
    const table = findAncestor('table');
    if (!table) return;
    const wrapperDom = editor.view.nodeDOM(table.pos) as HTMLElement | null;
    const trs = wrapperDom?.querySelectorAll('tr');
    let max = 0;
    trs?.forEach((el) => {
      max = Math.max(max, (el as HTMLElement).offsetHeight);
    });
    if (max <= 0) return;
    setAllRowHeights(Math.round(max));
  };

  const commitRowHeightInput = (raw: string) => {
    const v = parseInt(raw, 10);
    setCurrentRowHeight(Number.isFinite(v) && v > 0 ? v : null);
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-1 border-t border-gray-200 pt-2 mt-1">
      <span className="mr-1 text-xs font-medium text-gray-500">표</span>
      <ToolBtn onClick={() => editor.chain().focus().addColumnAfter().run()} title="열 추가">
        <Columns className="h-4 w-4" />
        <span className="text-xs">+</span>
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().addRowAfter().run()} title="행 추가">
        <Rows className="h-4 w-4" />
        <span className="text-xs">+</span>
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().deleteColumn().run()}
        disabled={!s.canDeleteColumn}
        title="열 삭제"
      >
        <Columns className="h-4 w-4 text-red-600" />
        <span className="text-xs text-red-600">-</span>
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().deleteRow().run()}
        disabled={!s.canDeleteRow}
        title="행 삭제"
      >
        <Rows className="h-4 w-4 text-red-600" />
        <span className="text-xs text-red-600">-</span>
      </ToolBtn>
      <Sep />
      <ToolBtn onClick={() => editor.chain().focus().mergeCells().run()} disabled={!s.canMerge} title="셀 병합">
        <Merge className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().splitCell().run()} disabled={!s.canSplit} title="셀 분할">
        <Split className="h-4 w-4" />
      </ToolBtn>
      <Sep />
      <label
        className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5"
        title="셀 배경색"
      >
        <Paintbrush className="h-4 w-4 text-gray-600" />
        <input
          type="color"
          value={s.cellBg || '#ffffff'}
          onChange={(e) => setCellBg(e.target.value)}
          className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
          aria-label="셀 배경색"
        />
      </label>
      <ToolBtn onClick={() => setCellBg(null)} title="셀 배경색 제거">
        <div className="relative">
          <Paintbrush className="h-4 w-4 text-red-600" />
          <X className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-red-600" />
        </div>
      </ToolBtn>
      <label
        className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5"
        title="내부선 색 (외곽 색 미지정 시 전체)"
      >
        <Square className="h-4 w-4 text-gray-600" />
        <input
          type="color"
          value={s.cellBorder || '#d1d5db'}
          onChange={(e) => applyBorderAllCells({ borderColor: e.target.value })}
          className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
          aria-label="내부선 색"
        />
      </label>
      <span className="text-xs text-gray-500">내부</span>
      <select
        className="h-8 rounded-md border border-gray-200 bg-white px-1.5 text-xs"
        value={s.cellBorderWidth}
        onChange={(e) => applyBorderAllCells({ borderWidth: parseInt(e.target.value, 10) })}
        aria-label="내부선 두께"
        title="내부선 두께"
      >
        {[1, 2, 3, 4].map((w) => (
          <option key={w} value={w}>{w}px</option>
        ))}
      </select>
      <select
        className="h-8 rounded-md border border-gray-200 bg-white px-1.5 text-xs"
        value={s.cellBorderMode}
        onChange={(e) => applyBorderAllCells({ borderMode: e.target.value as CellBorderMode })}
        aria-label="내부선 모드"
        title="내부선 모드"
      >
        <option value="all">모든 선</option>
        <option value="horizontal">가로선만</option>
        <option value="none">선 없음</option>
      </select>
      <span className="text-xs text-gray-500">외곽</span>
      <select
        className="h-8 rounded-md border border-gray-200 bg-white px-1.5 text-xs"
        value={s.outerBorderWidth ?? ''}
        onChange={(e) =>
          applyOuterBorder(e.target.value === '' ? null : parseInt(e.target.value, 10))
        }
        aria-label="외곽선 두께"
        title="외곽선 두께 (표 바깥 테두리만)"
      >
        <option value="">내부와 동일</option>
        {[1, 2, 3, 4, 5].map((w) => (
          <option key={w} value={w}>{w}px</option>
        ))}
      </select>
      <label
        className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5"
        title="외곽선 색 (표 바깥 테두리만)"
      >
        <Frame className="h-4 w-4 text-gray-600" />
        <input
          type="color"
          value={s.outerBorderColor || s.cellBorder || '#d1d5db'}
          onChange={(e) => applyOuterColor(e.target.value)}
          className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
          aria-label="외곽선 색"
        />
      </label>
      <ToolBtn
        active={s.cellLeftHidden}
        onClick={() => toggleSideLine('left')}
        title="이 셀 왼쪽 세로선 숨김/복원"
      >
        <SeparatorVertical className="h-4 w-4" />
        <span className="text-xs">좌</span>
      </ToolBtn>
      <ToolBtn
        active={s.cellRightHidden}
        onClick={() => toggleSideLine('right')}
        title="이 셀 오른쪽 세로선 숨김/복원"
      >
        <SeparatorVertical className="h-4 w-4" />
        <span className="text-xs">우</span>
      </ToolBtn>
      <ToolBtn
        onClick={() =>
          applyBorderAllCells({
            borderColor: null,
            borderWidth: null,
            borderMode: 'all',
            borderSideWidths: null,
            borderSideColors: null,
          })
        }
        title="표 테두리 초기화"
      >
        <div className="relative">
          <Square className="h-4 w-4 text-red-600" />
          <X className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-red-600" />
        </div>
      </ToolBtn>
      <Sep />
      <ToolBtn
        active={s.cellVAlign === 'top'}
        onClick={() => setCellVAlign('top')}
        title="셀 위 정렬"
      >
        <AlignVerticalJustifyStart className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.cellVAlign === 'middle'}
        onClick={() => setCellVAlign('middle')}
        title="셀 가운데 정렬"
      >
        <AlignVerticalJustifyCenter className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.cellVAlign === 'bottom'}
        onClick={() => setCellVAlign('bottom')}
        title="셀 아래 정렬"
      >
        <AlignVerticalJustifyEnd className="h-4 w-4" />
      </ToolBtn>
      <Sep />
      <ToolBtn onClick={equalizeColumnWidths} title="열 너비 균등 분배">
        <Equal className="h-4 w-4" />
      </ToolBtn>
      <Sep />
      <span className="text-xs text-gray-500">행 높이</span>
      <input
        type="number"
        min={16}
        step={4}
        key={s.rowHeight ?? 'auto'}
        defaultValue={s.rowHeight ?? ''}
        placeholder="자동"
        aria-label="행 높이 (px)"
        className="h-8 w-16 rounded-md border border-gray-200 bg-white px-1.5 text-xs"
        onBlur={(e) => commitRowHeightInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitRowHeightInput((e.target as HTMLInputElement).value);
          }
        }}
      />
      <ToolBtn onClick={equalizeRowHeights} title="행 높이 일치 (모든 행을 가장 큰 행 높이로)">
        <Equal className="h-4 w-4 rotate-90" />
      </ToolBtn>
      <ToolBtn onClick={() => setAllRowHeights(null)} title="행 높이 초기화 (자동)">
        <div className="relative">
          <Rows className="h-4 w-4 text-red-600" />
          <X className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-red-600" />
        </div>
      </ToolBtn>
      <Sep />
      <ToolBtn
        active={s.tableAlign === 'left'}
        onClick={() => setTableAlign('left')}
        title="표 왼쪽 정렬"
      >
        <AlignLeft className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.tableAlign === 'center'}
        onClick={() => setTableAlign('center')}
        title="표 가운데 정렬"
      >
        <AlignCenter className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.tableAlign === 'right'}
        onClick={() => setTableAlign('right')}
        title="표 오른쪽 정렬"
      >
        <AlignRight className="h-4 w-4" />
      </ToolBtn>
      <Sep />
      <ToolBtn
        onClick={() => editor.chain().focus().deleteTable().run()}
        title="표 삭제"
      >
        <Trash2 className="h-4 w-4 text-red-600" />
      </ToolBtn>
    </div>
  );
}
