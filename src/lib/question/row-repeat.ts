/**
 * 표 문항 행 반복 — 구조 펼치기 순수 로직.
 *
 * 응답자가 `+` 로 늘리는 행은 응답 중에 만들어지지 않는다. 빌더가 반복 블록을 켜는
 * 순간 구조에 maxRepeats 벌까지 실제로 펼쳐 두고, 응답 화면은 값에서 파생한 만큼만
 * 노출한다. 그래야 응답값 키가 발행 스냅샷 안의 cell.id 로 유지되어 저장 경계·초안·
 * 이월 임포트·관리자 편집·내보내기가 전부 무변경이다.
 *
 * **펼치기는 멱등이어야 한다.** 저장할 때마다 다시 펼쳐 셀 id 를 재발번하면 이미
 * 수집된 응답의 키가 끊긴다. 그래서 이미 존재하는 벌은 재사용하고, 없는 벌만 만든다.
 *
 * rowCode 를 명시 발번하는 이유는 buildTableCellVarName 의 제로패딩 자릿수가
 * rows.length 기준이기 때문이다 — 반복 블록을 켜서 20벌로 펼치는 순간 같은 표의
 * 비반복 행 변수명이 r1 에서 r01 로 통째 바뀐다. 펼치기 이전 행 수로 계산한 코드를
 * 행에 박아 그 길이 의존을 끊는다 (설계 결정 3).
 */
import type { RowRepeatConfig, TableCell, TableRow } from '@/types/survey';
import { generateId } from '@/lib/utils';

/** 최대 반복 벌 수 상한. 구조에 실제로 펼쳐지는 행이라 무한대는 없다. */
export const ROW_REPEAT_MAX = 20;
/** 기본 최대 벌 수 */
export const DEFAULT_ROW_REPEAT_MAX = 20;
/** 추가 버튼 기본 문구 */
export const DEFAULT_ROW_REPEAT_ADD_LABEL = '행 추가';

/** 벌 번호 표시용 원문자 ①..⑳ (라벨 접미에 쓴다) */
const CIRCLED_NUMBERS = [
  '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳',
];

/** 반복 행의 rowCode 접미 `_NN` — 재펼치기 때 밑동을 되찾는 데 쓴다(누적 방지). */
const BUNDLE_CODE_SUFFIX = /_\d{2}$/;

/** 복제 벌에 실어 나르지 않는 셀 필드 — 그대로 복제하면 변수명이 중복된다. */
type ClonedAwayCellField =
  | 'cellCode'
  | 'isCustomCellCode'
  | 'exportLabel'
  | 'isCustomExportLabel'
  | 'rankVarNames';

export function clampMaxRepeats(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_ROW_REPEAT_MAX;
  return Math.min(ROW_REPEAT_MAX, Math.max(1, Math.trunc(value as number)));
}

/** 이 행이 몇 번째 벌인지 — 반복 행이 아니면 undefined */
export function repeatIndexOf(row: TableRow): number | undefined {
  return typeof row.repeatIndex === 'number' && row.repeatIndex >= 1 ? row.repeatIndex : undefined;
}

/**
 * 펼치기 이전 모습 — 2벌 이후를 걷어낸 행 목록.
 * 멱등성의 축이다: 이미 펼쳐진 배열을 다시 넣어도 여기서 원래 모습으로 돌아온다.
 */
export function collapseRepeatRows(rows: TableRow[]): TableRow[] {
  return rows.filter((row) => (row.repeatIndex ?? 1) <= 1);
}

/** 반복 설정이 실제로 켜져 있고 템플릿이 지정돼 있는가 */
export function isRowRepeatActive(config: RowRepeatConfig | null | undefined): boolean {
  return Boolean(config?.enabled && (config?.templateRowIds?.length ?? 0) > 0);
}

function bundleLabel(templateLabel: string, bundle: number): string {
  const marker = CIRCLED_NUMBERS[bundle - 1] ?? String(bundle);
  const base = (templateLabel ?? '').trim();
  return base.length > 0 ? `${base} ${marker}` : marker;
}

function baseRowCodeOf(row: TableRow, fallback: string): string {
  const raw = row.rowCode?.trim();
  if (!raw) return fallback;
  // 이미 펼쳐진 1벌 행은 rowCode 가 `<밑동>_01` 이다 — 밑동을 되찾아 누적을 막는다.
  if (repeatIndexOf(row) !== undefined) {
    const stripped = raw.replace(BUNDLE_CODE_SUFFIX, '');
    return stripped.length > 0 ? stripped : fallback;
  }
  return raw;
}

function cloneCellForBundle(
  template: TableCell,
  existing: TableCell | undefined,
  makeId: () => string,
): TableCell {
  const rest: Omit<TableCell, ClonedAwayCellField> & Partial<Pick<TableCell, ClonedAwayCellField>> =
    { ...template };
  delete rest.cellCode;
  delete rest.isCustomCellCode;
  delete rest.exportLabel;
  delete rest.isCustomExportLabel;
  delete rest.rankVarNames;
  return { ...(rest as TableCell), id: existing?.id ?? makeId() };
}

/**
 * 템플릿 묶음을 maxRepeats 벌까지 펼친다.
 *
 * - 이미 있는 벌(`repeatSourceRowId` + `repeatIndex` 로 식별)은 **재사용**한다 — 행 id 도
 *   셀 id 도 그대로 두고 템플릿의 구조 변경만 덮어쓴다.
 * - 없는 벌만 새로 만들고 그때만 id 를 발번한다.
 * - maxRepeats 를 줄이면 뒤쪽 벌이 잘린다 (빌더가 경고를 띄운 뒤 부르는 경로).
 * - 설정이 꺼져 있으면 원본 배열을 **참조 그대로** 돌려준다 — 반복을 쓰지 않는 표의
 *   rowCode 를 건드리면 그 표의 기존 변수명이 바뀐다.
 */
export function expandRepeatRows(
  rows: TableRow[],
  config: RowRepeatConfig | null | undefined,
  makeId: () => string = generateId,
): TableRow[] {
  if (!isRowRepeatActive(config)) return rows;
  const templateIds = config!.templateRowIds;
  const maxRepeats = clampMaxRepeats(config!.maxRepeats);

  const collapsed = collapseRepeatRows(rows);
  const templateIdSet = new Set(templateIds);
  const templates = collapsed.filter((row) => templateIdSet.has(row.id));
  // 템플릿 행이 지워졌으면 손대지 않는다 — 빌더 검증이 잡을 상태를 여기서 뭉개지 않는다.
  if (templates.length === 0) return rows;

  // 기존 복제 벌 색인 — `<원본 행 id>#<벌 번호>`
  const existingBundles = new Map<string, TableRow>();
  for (const row of rows) {
    const idx = repeatIndexOf(row);
    if (idx !== undefined && idx >= 2 && row.repeatSourceRowId) {
      existingBundles.set(`${row.repeatSourceRowId}#${idx}`, row);
    }
  }

  // rowCode 밑동 — 펼치기 이전 행 수 기준 패딩 (buildTableCellVarName 과 같은 규칙)
  const pad = collapsed.length >= 100 ? 3 : collapsed.length >= 10 ? 2 : 1;
  const baseCodes = new Map<string, string>();
  collapsed.forEach((row, index) => {
    baseCodes.set(row.id, baseRowCodeOf(row, `r${String(index + 1).padStart(pad, '0')}`));
  });

  const firstTemplateId = templates[0]!.id;
  const out: TableRow[] = [];

  for (const row of collapsed) {
    if (templateIdSet.has(row.id)) {
      // 블록은 첫 템플릿 행 자리에서 통째로 펼친다 (나머지 템플릿 행은 그 안에서 나온다)
      if (row.id !== firstTemplateId) continue;
      for (let bundle = 1; bundle <= maxRepeats; bundle++) {
        for (const template of templates) {
          const code = `${baseCodes.get(template.id)!}_${String(bundle).padStart(2, '0')}`;
          if (bundle === 1) {
            // 1벌은 템플릿 행 자신 — 셀도 라벨도 사람이 쓴 그대로 둔다
            out.push({
              ...template,
              rowCode: code,
              repeatIndex: 1,
              repeatSourceRowId: template.id,
            });
            continue;
          }
          const existing = existingBundles.get(`${template.id}#${bundle}`);
          out.push({
            ...template,
            id: existing?.id ?? makeId(),
            rowCode: code,
            label: bundleLabel(template.label, bundle),
            repeatIndex: bundle,
            repeatSourceRowId: template.id,
            cells: template.cells.map((cell, cellIdx) =>
              cloneCellForBundle(cell, existing?.cells[cellIdx], makeId),
            ),
          });
        }
      }
      continue;
    }
    const code = baseCodes.get(row.id)!;
    out.push(row.rowCode === code ? row : { ...row, rowCode: code });
  }

  return out;
}
