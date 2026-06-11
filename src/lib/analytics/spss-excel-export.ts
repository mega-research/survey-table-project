/**
 * SPSS 공용 열/데이터 정의 빌더
 *
 * 현재 소비자:
 *  - `@/lib/spss/sav-builder` — .sav 네이티브 내보내기
 *  - `@/lib/analytics/raw-workbook` — Raw Data 엑셀 워크북
 *  - `@/lib/analytics/split-workbook` — 분할 내보내기 워크북
 *
 * 과거 엑셀 Blob/워크북/코딩북 헬퍼는 UI에서 제거됨에 따라 함께 삭제되었다.
 */
import { getOptionText } from '@/lib/option-text-read';
import {
  transformMultiselect,
  transformNumericText,
  transformRankingOtherText,
  transformRankingWithOptions,
  transformSingleChoice,
  transformTableChoiceCell,
  transformText,
} from '@/lib/spss/data-transformer';
import type {
  Question,
  QuestionOption,
  SurveySubmission,
  TableCell,
  TableRow,
} from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { getOtherOptionCode } from '@/utils/option-code-generator';
import { hasOtherRankingCell, resolveRankingOptions, resolveRankingOptionsFromCells } from '@/utils/ranking-source';
import { buildCheckboxItemVarName, buildOptionTextVarName } from '@/utils/spss-var-name';
import {
  buildTableCellVarName,
  generateExportLabel,
  resolveRankVarName,
} from '@/utils/table-cell-code-generator';
import {
  collectChoiceGroups,
  collectRankingGroups,
  DEFAULT_GROUP_KEY,
  isGroupedChoiceQuestion,
  isGroupedRankingQuestion,
} from '@/utils/choice-group-helpers';

export interface SPSSExportColumn {
  spssVarName: string;
  questionText: string;
  optionLabel: string;
  questionId: string;
  type:
    | 'single'
    | 'checkbox-item'
    | 'text'
    | 'multiselect'
    | 'table-cell'
    | 'other-text'
    | 'notice-agree'
    | 'notice-date'
    | 'ranking-rank'
    | 'ranking-other'
    | 'radio-group'
    | 'table-cell-ranking'
    | 'table-cell-ranking-other'
    | 'option-text'
    | 'table-cell-option-text'
    | 'choice-group'
    | 'choice-group-item';
  optionIndex?: number;
  optionValue?: string;
  tableCellId?: string;
  tableCellType?: string;
  // ranking-rank / ranking-other / table-cell-ranking(-other) 전용: 1-based 순위 인덱스
  rankIndex?: number;
  // table-cell-ranking(-other) 전용: 행/열 라벨 (SPSS 변수 라벨 생성용)
  rowLabel?: string;
  colLabel?: string;
  // table-cell-ranking(-other) 전용: 셀의 랭킹 옵션 (value labels / 응답값 변환용)
  cellOptions?: QuestionOption[];
  // 셀 단위 SPSS 오버라이드
  cellSpssVarType?: 'Numeric' | 'String' | 'Date' | 'DateTime';
  cellSpssMeasure?: 'Nominal' | 'Ordinal' | 'Continuous';
  // === 'radio-group' 전용: 같은 radioGroupName 셀들을 변수 1개로 합산 ===
  // 그룹명 (디버깅/식별용)
  radioGroupName?: string;
  // 멤버 셀 id → 응답 시 기록할 숫자값 (옵션의 spssNumericCode 또는 위치 인덱스 폴백)
  radioGroupCellValueMap?: Record<string, number>;
  // 숫자값 → SPSS VALUE LABEL 라벨 (옵션 라벨 우선, 없으면 행/열 라벨 폴백)
  radioGroupValueLabels?: Record<number, string>;
  // option-text / table-cell-option-text 전용: 옵션 id (응답 데이터 조회용)
  optionId?: string;
  // 테이블 셀 계열 및 radio-group 전용: 코딩북/헤더 행2에 쓰는 셀 엑셀라벨
  cellExportLabel?: string;
  // 'text' 컬럼 전용: 숫자 단답형(question.inputType==='number') 이면 Numeric 변수로 처리
  numericText?: boolean;
  // === 'choice-group' 전용: radio choiceGroups 기반 그룹별 단일선택 변수 ===
  // 이 변수가 담당하는 그룹의 groupKey
  // (ranking-rank / ranking-other 에서도 재사용: ranking 그룹 키)
  choiceGroupKey?: string;
  // 멤버 셀 id → 응답 시 기록할 숫자값 (spssNumericCode 또는 그룹 내 1-based 순서 폴백)
  choiceGroupCellValueMap?: Record<string, number>;
  // 숫자값 → SPSS VALUE LABEL 배열
  choiceGroupValueLabels?: Array<{ value: number; label: string }>;
  // === 'choice-group-item' 전용: checkbox choiceGroups 기반 보기별 counted 변수 ===
  // 이 변수가 담당하는 보기가 속한 그룹의 groupKey
  // (choice-group 과 공용: choiceGroupKey)
  // 이 변수가 담당하는 보기의 셀 id
  choiceGroupMemberCellId?: string;
  // 이 보기 선택 시 저장할 counted 숫자값 (spssNumericCode 또는 그룹 내 1-based 폴백)
  choiceGroupMemberCode?: number;
  // === 'ranking-rank' / 'ranking-other' 전용 ===
  // 질문의 ranking 그룹이 1개뿐일 때 true.
  // legacy flat 응답(rnk1 이식 후 미마이그레이션 응답)을 그 그룹으로 해석하는 폴백 허용 판정용.
  soleRankingGroup?: boolean;
}

/**
 * 질문 목록에서 SPSS 열 정의를 생성한다.
 * - notice 제외
 * - checkbox는 옵션별 분리 (Q2M1, Q2M2...)
 * - 나머지는 열 1개
 */
export function generateSPSSColumns(questions: Question[]): SPSSExportColumn[] {
  const columns: SPSSExportColumn[] = [];

  for (const q of questions) {
    // notice 중 requiresAcknowledgment가 있는 경우 동의 + 날짜 열 생성
    if (q.type === 'notice') {
      if (q.requiresAcknowledgment && q.questionCode) {
        columns.push({
          spssVarName: q.questionCode,
          questionText: q.title,
          optionLabel: '동의 여부',
          questionId: q.id,
          type: 'notice-agree',
        });
        columns.push({
          spssVarName: `${q.questionCode}_DATE`,
          questionText: q.title,
          optionLabel: '동의 일시 (MM DD YYYY)',
          questionId: q.id,
          type: 'notice-date',
        });
      }
      continue;
    }
    if (!q.questionCode) continue;

    if ((q.type === 'radio' || q.type === 'checkbox') && isGroupedChoiceQuestion(q)) {
      // choiceGroups 가 1개 이상 정의된 radio/checkbox 질문은 이 분기에서 처리.
      // 그룹 없는 checkbox 질문은 아래 else-if 의 기존 checkbox-item 경로를 탄다.
      // choiceGroups 기반 radio/checkbox — 그룹별 변수 생성
      for (const group of collectChoiceGroups(q)) {
        if (group.type === 'radio') {
          // radio 그룹 → 기존 'choice-group' 1변수 (무변경)
          const cellValueMap: Record<string, number> = {};
          const valueLabels: Array<{ value: number; label: string }> = [];
          group.cells.forEach((cell, idx) => {
            const code = cell.spssNumericCode ?? idx + 1;
            cellValueMap[cell.id] = code;
            valueLabels.push({
              value: code,
              label: (cell.choiceLabel ?? '').trim() || (cell.content ?? '').trim() || '(라벨 없음)',
            });
          });
          const isDefault = group.groupKey === DEFAULT_GROUP_KEY;
          const groupVarName = isDefault ? q.questionCode : `${q.questionCode}_${group.groupKey}`;
          columns.push({
            spssVarName: groupVarName,
            questionText: q.title,
            optionLabel: group.label || q.title,
            questionId: q.id,
            type: 'choice-group',
            choiceGroupKey: group.groupKey,
            choiceGroupCellValueMap: cellValueMap,
            choiceGroupValueLabels: valueLabels,
          });
          // allowTextInput 멤버 셀마다 STRING 사이드카 텍스트 변수 생성.
          // 저장 경로는 __optTexts__[questionId][cell.id] 로 비그룹과 동일하므로
          // optionId=cell.id 를 그대로 사용해 기존 option-text 추출 case 가 동작한다.
          group.cells.forEach((cell, idx) => {
            if (!cell.allowTextInput) return;
            const varNumber = cell.spssNumericCode != null ? String(cell.spssNumericCode) : String(idx + 1);
            columns.push({
              spssVarName: buildOptionTextVarName(groupVarName, varNumber),
              questionText: q.title,
              optionLabel: `${(cell.choiceLabel ?? '').trim() || (cell.content ?? '').trim() || '(라벨 없음)'} (텍스트)`,
              questionId: q.id,
              type: 'option-text',
              optionId: cell.id,
            });
          });
        } else {
          // checkbox 그룹 → 멤버 셀별 'choice-group-item' (counted value 방식)
          const isDefault = group.groupKey === DEFAULT_GROUP_KEY;
          // 그룹 라벨: 명시 그룹이면 group.label, default 그룹이면 q.title 폴백
          const groupLabel = isDefault ? q.title : (group.label || q.title);
          // if (!q.questionCode) continue 가드가 위에 있어 항상 string 이지만 타입을 명확히 한다
          const qCode = q.questionCode!;
          group.cells.forEach((cell, idx) => {
            const code = cell.spssNumericCode ?? idx + 1;
            // 변수명: default 그룹이면 buildCheckboxItemVarName(질문코드, undefined, i) — 기존 checkbox 하위호환
            //         명시 그룹이면 질문코드_groupKey_그룹내1-based
            const varName = isDefault
              ? buildCheckboxItemVarName(qCode, undefined, idx)
              : `${qCode}_${group.groupKey}_${idx + 1}`;
            // 보기 라벨: choiceLabel > content > '(라벨 없음)'
            const optLabel = (cell.choiceLabel ?? '').trim() || (cell.content ?? '').trim() || '(라벨 없음)';
            columns.push({
              spssVarName: varName,
              questionText: q.title,
              // optionLabel 에 그룹 컨텍스트를 포함시켜 SPSS 변수 라벨로 바로 사용 가능하게 함
              optionLabel: `${groupLabel} - ${optLabel}`,
              questionId: q.id,
              type: 'choice-group-item',
              choiceGroupKey: group.groupKey,
              choiceGroupMemberCellId: cell.id,
              choiceGroupMemberCode: code,
              optionIndex: idx,
            });
            // allowTextInput 사이드카: base 는 그룹 변수명 접두(질문코드[_groupKey]).
            // default 그룹은 기존 비그룹 checkbox 사이드카(Q8_1_text)와 동일해야 한다 — 하위호환.
            if (cell.allowTextInput) {
              const sidecarBase = isDefault ? qCode : `${qCode}_${group.groupKey}`;
              columns.push({
                spssVarName: buildOptionTextVarName(sidecarBase, String(idx + 1)),
                questionText: q.title,
                optionLabel: `${optLabel} (텍스트)`,
                questionId: q.id,
                type: 'option-text',
                optionId: cell.id,
              });
            }
          });
        }
      }
    } else if (q.type === 'checkbox') {
      // choiceGroups 없는 순수 checkbox 질문 — 기존 checkbox-item 경로 (하위호환)
      const opts = resolveChoiceOptions(q);
      for (let i = 0; i < opts.length; i++) {
        const opt = opts[i];
        if (!opt) continue;
        columns.push({
          spssVarName: buildCheckboxItemVarName(q.questionCode, opt.optionCode, i),
          questionText: q.title,
          optionLabel: opt.label,
          questionId: q.id,
          type: 'checkbox-item',
          optionIndex: i,
          optionValue: opt.value,
          // 테이블-소스 옵션 셀의 exportLabel이 있으면 헤더 행2/코딩북 셀라벨에 우선 사용.
          ...(opt.exportLabel !== undefined ? { cellExportLabel: opt.exportLabel } : {}),
        });
        // allowTextInput 옵션마다 STRING 사이드카 텍스트 변수 생성
        if (opt.allowTextInput) {
          const varNumber = opt.optionCode ?? String(i + 1);
          columns.push({
            spssVarName: buildOptionTextVarName(q.questionCode, varNumber),
            questionText: q.title,
            optionLabel: `${opt.label} (텍스트)`,
            questionId: q.id,
            type: 'option-text',
            optionId: opt.id,
            ...(opt.exportLabel !== undefined ? { cellExportLabel: opt.exportLabel } : {}),
          });
        }
      }
      // 기타 옵션이 있으면 기타 텍스트 컬럼 추가
      if (q.allowOtherOption) {
        const otherCode = getOtherOptionCode(opts);
        columns.push({
          spssVarName: `${q.questionCode}_${otherCode}_etc`,
          questionText: q.title,
          optionLabel: '기타 입력',
          questionId: q.id,
          type: 'other-text',
        });
      }
    } else if (q.type === 'radio' || q.type === 'select') {
      const opts = resolveChoiceOptions(q);
      const optionLabel = opts.length > 0 ? opts.map((o) => o.label).join(' / ') : '';
      columns.push({
        spssVarName: q.questionCode,
        questionText: q.title,
        optionLabel,
        questionId: q.id,
        type: 'single',
      });
      // allowTextInput 옵션마다 STRING 사이드카 텍스트 변수 생성
      for (let i = 0; i < opts.length; i++) {
        const opt = opts[i];
        if (!opt) continue;
        if (opt.allowTextInput) {
          const varNumber = opt.optionCode ?? String(i + 1);
          columns.push({
            spssVarName: buildOptionTextVarName(q.questionCode, varNumber),
            questionText: q.title,
            optionLabel: `${opt.label} (텍스트)`,
            questionId: q.id,
            type: 'option-text',
            optionId: opt.id,
            ...(opt.exportLabel !== undefined ? { cellExportLabel: opt.exportLabel } : {}),
          });
        }
      }
      // 기타 옵션이 있으면 기타 텍스트 컬럼 추가
      if (q.allowOtherOption) {
        const otherCode = getOtherOptionCode(opts);
        columns.push({
          spssVarName: `${q.questionCode}_${otherCode}_etc`,
          questionText: q.title,
          optionLabel: '기타 입력',
          questionId: q.id,
          type: 'other-text',
        });
      }
    } else if (q.type === 'ranking') {
      if (isGroupedRankingQuestion(q)) {
        // grouped: 그룹별 순위 슬롯 변수. 명시 그룹 = 질문코드_{groupKey}_rk{k}, default = 질문코드_rk{k} (기존 호환)
        const groups = collectRankingGroups(q);
        for (const g of groups) {
          const groupOptions = resolveRankingOptionsFromCells(g.cells);
          const requested = Math.max(1, q.rankingConfig?.positions ?? 3);
          const positions = Math.min(requested, Math.max(groupOptions.length, 1));
          const prefix = g.groupKey === DEFAULT_GROUP_KEY
            ? q.questionCode
            : `${q.questionCode}_${g.groupKey}`;
          // _etc 는 기타 셀이 속한 그룹에만. 질문 레벨 allowOtherOption synthetic 은 grouped 에서 비활성(렌더러와 동일 규칙).
          const needsOther = g.cells.some((c) => c.isOtherRankingCell === true);
          for (let k = 1; k <= positions; k++) {
            columns.push({
              spssVarName: `${prefix}_rk${k}`,
              questionText: q.title,
              optionLabel: g.label ? `${g.label} - ${k}순위` : `${k}순위`,
              questionId: q.id,
              type: 'ranking-rank',
              rankIndex: k,
              cellOptions: groupOptions,
              choiceGroupKey: g.groupKey,
              soleRankingGroup: groups.length === 1,
            });
            if (needsOther) {
              columns.push({
                spssVarName: `${prefix}_rk${k}_etc`,
                questionText: q.title,
                optionLabel: g.label ? `${g.label} - ${k}순위 기타 입력` : `${k}순위 기타 입력`,
                questionId: q.id,
                type: 'ranking-other',
                rankIndex: k,
                choiceGroupKey: g.groupKey,
                soleRankingGroup: groups.length === 1,
              });
            }
          }
        }
      } else {
        // 기존 비그룹 경로 그대로 이동 (무수정)
        // Case 1 (standalone): question.options / Case 2 (table source): ranking_opt 셀
        const resolvedOptions = resolveRankingOptions(q);
        const positions = Math.max(1, q.rankingConfig?.positions ?? 3);
        // 기타 응답값 저장용 _etc 컬럼은 질문-레벨 토글 OR 셀-레벨 isOtherRankingCell 둘 중 하나라도 있으면 emit
        const needsOtherColumn = q.allowOtherOption || hasOtherRankingCell(q);
        for (let k = 1; k <= positions; k++) {
          columns.push({
            spssVarName: `${q.questionCode}_rk${k}`,
            questionText: q.title,
            optionLabel: `${k}순위`,
            questionId: q.id,
            type: 'ranking-rank',
            rankIndex: k,
            // Case 2 value labels / 응답값 변환을 위해 해결된 옵션을 주입
            cellOptions: resolvedOptions,
          });
          if (needsOtherColumn) {
            columns.push({
              spssVarName: `${q.questionCode}_rk${k}_etc`,
              questionText: q.title,
              optionLabel: `${k}순위 기타 입력`,
              questionId: q.id,
              type: 'ranking-other',
              rankIndex: k,
            });
          }
        }
      }
    } else if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
      // === Phase 5: radioGroup 사전 스캔 ===
      // 같은 radioGroupName 셀들을 묶어 변수 1개로 export.
      // 그룹 방향 자동 감지: 같은 행이면 열 단위 응답, 같은 열이면 행 단위 응답.
      const groupedCellIds = collectAndEmitRadioGroupColumns(q, columns);

      // 테이블 질문: 입력 가능한 셀마다 개별 열 생성
      for (const tRow of q.tableRowsData) {
        for (let colIdx = 0; colIdx < q.tableColumns.length; colIdx++) {
          const cell = tRow.cells[colIdx];
          if (!cell) continue;
          // 병합(colspan/rowspan)으로 가려진 셀은 변수에서 제외 (변수명 중복 방지)
          if (cell.isHidden) continue;
          // radioGroup 그룹에 속한 셀은 스킵 (그룹 변수로 이미 emit됨)
          if (groupedCellIds.has(cell.id)) continue;
          // 입력 불가능한 셀(text, image, video, ranking_opt)은 건너뛰기
          if (!['checkbox', 'radio', 'select', 'input', 'ranking'].includes(cell.type)) continue;
          // 셀코드가 의도적으로 비어있으면 내보내기에서 제외 (표시용 셀)
          if (cell.isCustomCellCode === true && !cell.cellCode) continue;

          // 변수명: cellCode > questionCode_rowCode_colCode (폴백)
          // exportLabel은 한국어가 포함될 수 있어 SPSS 변수명으로 부적합
          const varName =
            cell.cellCode ||
            buildTableCellVarName(q, tRow, colIdx, q.tableColumns, q.tableRowsData!);

          // exportLabel 미저장 셀은 questionCode_열라벨_행라벨 자동 라벨로 폴백.
          // (빌더는 placeholder로 같은 자동값을 표시하므로 export도 동일하게 맞춘다.)
          const autoExportLabel = buildAutoTableCellExportLabel(q, tRow, colIdx, cell);

          // ranking 셀 (Case 3): positions 만큼 {baseVarName}{접미사} 변수 생성.
          // 접미사는 셀의 rankSuffixPattern (기본 '_rk{k}') 으로 결정. rankVarNames 오버라이드 우선.
          if (cell.type === 'ranking') {
            const rowLabel = tRow.label;
            const colLabel = q.tableColumns[colIdx]?.label ?? '';
            const cellOptions = cell.rankingOptions ?? [];
            const positions = Math.max(1, cell.rankingConfig?.positions ?? 3);
            for (let k = 1; k <= positions; k++) {
              const rankVarName = resolveRankVarName(
                varName,
                cell.rankSuffixPattern,
                cell.rankVarNames,
                k,
              );
              columns.push({
                spssVarName: rankVarName,
                questionText: q.title,
                optionLabel: `${k}순위`,
                questionId: q.id,
                type: 'table-cell-ranking',
                tableCellId: cell.id,
                tableCellType: 'ranking',
                rankIndex: k,
                rowLabel,
                colLabel,
                cellOptions,
                ...(autoExportLabel !== undefined ? { cellExportLabel: autoExportLabel } : {}),
              });
              if (cell.allowOtherOption) {
                columns.push({
                  spssVarName: `${rankVarName}_etc`,
                  questionText: q.title,
                  optionLabel: `${k}순위 기타 입력`,
                  questionId: q.id,
                  type: 'table-cell-ranking-other',
                  tableCellId: cell.id,
                  tableCellType: 'ranking',
                  rankIndex: k,
                  rowLabel,
                  colLabel,
                  ...(autoExportLabel !== undefined ? { cellExportLabel: autoExportLabel } : {}),
                });
              }
            }
            continue;
          }

          // checkbox 셀: checkboxOptions가 있으면 옵션별 분리 변수 생성
          if (cell.type === 'checkbox' && cell.checkboxOptions && cell.checkboxOptions.length > 0) {
            for (let optIdx = 0; optIdx < cell.checkboxOptions.length; optIdx++) {
              const opt = cell.checkboxOptions[optIdx];
              if (!opt) continue;
              columns.push({
                spssVarName: `${varName}_${opt.optionCode ?? String(optIdx + 1)}`,
                questionText: q.title,
                optionLabel: opt.label,
                questionId: q.id,
                type: 'table-cell',
                tableCellId: cell.id,
                tableCellType: 'checkbox',
                optionIndex: optIdx,
                optionValue: opt.value,
                // 코딩북/value labels가 실제 spssNumericCode를 쓰도록 셀 옵션 전달
                // (CheckboxOption은 QuestionOption과 구조 호환 — radio/select 셀과 동일 처리)
                cellOptions: cell.checkboxOptions,
                ...(cell.spssVarType !== undefined ? { cellSpssVarType: cell.spssVarType } : {}),
                ...(cell.spssMeasure !== undefined ? { cellSpssMeasure: cell.spssMeasure } : {}),
                ...(autoExportLabel !== undefined ? { cellExportLabel: autoExportLabel } : {}),
              });
              // allowTextInput 옵션마다 STRING 사이드카 텍스트 변수 생성
              if (opt.allowTextInput) {
                const varNumber = opt.optionCode ?? String(optIdx + 1);
                columns.push({
                  spssVarName: buildOptionTextVarName(varName, varNumber),
                  questionText: q.title,
                  optionLabel: `${opt.label} (텍스트)`,
                  questionId: q.id,
                  type: 'table-cell-option-text',
                  tableCellId: cell.id,
                  optionId: opt.id,
                  ...(autoExportLabel !== undefined ? { cellExportLabel: autoExportLabel } : {}),
                });
              }
            }
          } else {
            // radio/select/input: 기존 로직
            let optionLabel = '';
            const opts = cell.radioOptions || cell.selectOptions;
            if (opts && opts.length > 0) {
              optionLabel = opts.map((o) => o.label).join(' / ');
            }

            columns.push({
              spssVarName: varName,
              questionText: q.title,
              optionLabel: optionLabel || `${tRow.label} - ${q.tableColumns[colIdx]?.label ?? ''}`,
              questionId: q.id,
              type: 'table-cell',
              tableCellId: cell.id,
              tableCellType: cell.type,
              ...(cell.spssVarType !== undefined ? { cellSpssVarType: cell.spssVarType } : {}),
              ...(cell.spssMeasure !== undefined ? { cellSpssMeasure: cell.spssMeasure } : {}),
              ...(autoExportLabel !== undefined ? { cellExportLabel: autoExportLabel } : {}),
              // radio/select 셀의 응답값을 spssNumericCode로 매핑하기 위한 옵션.
              // RadioOption은 QuestionOption과 구조적으로 호환되어 그대로 widening.
              ...(opts ? { cellOptions: opts } : {}),
            });

            // radio/select 셀의 allowTextInput 옵션마다 STRING 사이드카 텍스트 변수 생성
            if (cell.type === 'radio' && cell.radioOptions) {
              for (let optIdx = 0; optIdx < cell.radioOptions.length; optIdx++) {
                const opt = cell.radioOptions[optIdx];
                if (!opt) continue;
                if (opt.allowTextInput) {
                  const varNumber = opt.optionCode ?? String(optIdx + 1);
                  columns.push({
                    spssVarName: buildOptionTextVarName(varName, varNumber),
                    questionText: q.title,
                    optionLabel: `${opt.label} (텍스트)`,
                    questionId: q.id,
                    type: 'table-cell-option-text',
                    tableCellId: cell.id,
                    optionId: opt.id,
                    ...(autoExportLabel !== undefined ? { cellExportLabel: autoExportLabel } : {}),
                  });
                }
              }
            } else if (cell.type === 'select' && cell.selectOptions) {
              for (let optIdx = 0; optIdx < cell.selectOptions.length; optIdx++) {
                const opt = cell.selectOptions[optIdx];
                if (!opt) continue;
                if (opt.allowTextInput) {
                  const varNumber = opt.optionCode ?? String(optIdx + 1);
                  columns.push({
                    spssVarName: buildOptionTextVarName(varName, varNumber),
                    questionText: q.title,
                    optionLabel: `${opt.label} (텍스트)`,
                    questionId: q.id,
                    type: 'table-cell-option-text',
                    tableCellId: cell.id,
                    optionId: opt.id,
                    ...(autoExportLabel !== undefined ? { cellExportLabel: autoExportLabel } : {}),
                  });
                }
              }
            }
          }
        }
      }
    } else {
      columns.push({
        spssVarName: q.questionCode,
        questionText: q.title,
        optionLabel: '',
        questionId: q.id,
        type: q.type === 'text' || q.type === 'textarea' ? 'text' : 'multiselect',
        numericText: q.type === 'text' && q.inputType === 'number',
      });
    }
  }

  return columns;
}

/**
 * Phase 5: 같은 radioGroupName 셀들을 묶어 변수 1개로 export.
 *
 * - 셀 안 라디오 옵션이 정확히 1개인 셀만 그룹화 대상 (옵션 여러 개 라디오는 기존 방식)
 * - 그룹 멤버 ≥ 2 일 때만 그룹 변수 생성 (1개면 일반 셀로 둠)
 * - 방향 자동 감지: 모두 같은 행이면 'row' (열 단위 응답), 모두 같은 열이면 'column' (행 단위 응답)
 * - 변수명: row 그룹 → questionCode_rowCode / column 그룹 → questionCode_columnCode
 *
 * 반환: 그룹에 emit된 셀 id의 Set (호출자가 본 순회에서 스킵)
 */
function collectAndEmitRadioGroupColumns(q: Question, columns: SPSSExportColumn[]): Set<string> {
  const groupedCellIds = new Set<string>();
  if (!q.tableRowsData || !q.tableColumns || !q.questionCode) return groupedCellIds;

  type GroupCellInfo = { cell: TableCell; row: TableRow; rowIdx: number; colIdx: number };
  const radioGroups = new Map<string, GroupCellInfo[]>();

  for (let rowIdx = 0; rowIdx < q.tableRowsData.length; rowIdx++) {
    const tRow = q.tableRowsData[rowIdx];
    if (!tRow) continue;
    for (let colIdx = 0; colIdx < q.tableColumns.length; colIdx++) {
      const cell = tRow.cells[colIdx];
      if (!cell) continue;
      if (cell.isHidden) continue;
      if (cell.type !== 'radio') continue;
      if (!cell.radioGroupName) continue;
      // 셀 안 옵션이 정확히 1개인 라디오만 그룹화 대상 (P6)
      if (!cell.radioOptions || cell.radioOptions.length !== 1) continue;

      const list = radioGroups.get(cell.radioGroupName) ?? [];
      list.push({ cell, row: tRow, rowIdx, colIdx });
      radioGroups.set(cell.radioGroupName, list);
    }
  }

  for (const [groupName, members] of radioGroups) {
    if (members.length < 2) continue; // 멤버 1개면 일반 셀로 (P2)

    const rowSet = new Set(members.map((m) => m.rowIdx));
    const colSet = new Set(members.map((m) => m.colIdx));
    const orientation: 'row' | 'column' | 'mixed' =
      rowSet.size === 1 && colSet.size > 1
        ? 'row'
        : colSet.size === 1 && rowSet.size > 1
          ? 'column'
          : 'mixed';

    const cellValueMap: Record<string, number> = {};
    const valueLabels: Record<number, string> = {};
    let groupVarName: string;
    let groupLabel: string;

    const firstMember = members[0];
    // members.length >= 2 가드 후이므로 firstMember는 항상 존재하지만
    // noUncheckedIndexedAccess를 위해 명시적 가드 추가
    if (!firstMember) continue;

    // 멤버 셀별 숫자값 충돌 방지: radio 그룹은 멤버 셀마다 고유 코드여야
    // value labels가 덮어쓰이지 않고 응답이 구분된다. 멤버 셀은 옵션 1개뿐이라
    // 기본 spssNumericCode가 모두 1로 겹치기 쉬우므로(복붙/기본값) 이미 쓰인 값이면
    // 다음 빈 정수로 재배정한다. 모든 코드가 distinct한 정상 케이스는 무영향.
    const usedValues = new Set<number>();
    const assignUniqueValue = (preferred: number): number => {
      let value = preferred;
      while (usedValues.has(value)) value += 1;
      usedValues.add(value);
      return value;
    };

    if (orientation === 'row') {
      // 같은 행 → 열 단위 응답: rowCode 기반 변수명, 옵션 라벨(폴백: 열 라벨)을 값 라벨로
      const { row, rowIdx } = firstMember;
      const rowCode = row.rowCode || `r${rowIdx + 1}`;
      groupVarName = `${q.questionCode}_${rowCode}`;
      groupLabel = row.label || groupName;

      members.forEach((m, idx) => {
        const opt = m.cell.radioOptions?.[0];
        const value = assignUniqueValue(opt?.spssNumericCode ?? (idx + 1));
        cellValueMap[m.cell.id] = value;
        valueLabels[value] = opt?.label || q.tableColumns?.[m.colIdx]?.label || '';
      });
    } else if (orientation === 'column') {
      // 같은 열 → 행 단위 응답: columnCode 기반 변수명, 옵션 라벨(폴백: 행 라벨)을 값 라벨로
      const { colIdx } = firstMember;
      const col = q.tableColumns[colIdx];
      if (!col) continue;
      const colCode = col.columnCode || `c${colIdx + 1}`;
      groupVarName = `${q.questionCode}_${colCode}`;
      groupLabel = col.label || groupName;

      members.forEach((m, idx) => {
        const opt = m.cell.radioOptions?.[0];
        const value = assignUniqueValue(opt?.spssNumericCode ?? (idx + 1));
        cellValueMap[m.cell.id] = value;
        valueLabels[value] = opt?.label || m.row.label;
      });
    } else {
      // mixed (드뭄, 비정형 그룹): 그룹명 기반 변수명, 셀별 라벨 폴백
      const sanitized = groupName.replace(/[^a-zA-Z0-9_]/g, '_');
      groupVarName = `${q.questionCode}_${sanitized}`;
      groupLabel = groupName;

      members.forEach((m, idx) => {
        const opt = m.cell.radioOptions?.[0];
        const value = assignUniqueValue(opt?.spssNumericCode ?? (idx + 1));
        cellValueMap[m.cell.id] = value;
        valueLabels[value] = opt?.label || `${m.row.label} - ${q.tableColumns?.[m.colIdx]?.label ?? ''}`;
      });
    }

    columns.push({
      spssVarName: groupVarName,
      questionText: q.title,
      optionLabel: groupLabel,
      questionId: q.id,
      type: 'radio-group',
      radioGroupName: groupName,
      radioGroupCellValueMap: cellValueMap,
      radioGroupValueLabels: valueLabels,
      // 그룹 멤버들의 셀 단위 SPSS 오버라이드를 그룹 컬럼에 전파.
      // 사용자가 5점 척도 셀에 spssMeasure='Continuous'를 명시한 경우 등을 보존.
      // 멤버들이 서로 다른 값을 가질 가능성은 낮으므로 첫 멤버의 값을 채택.
      ...(firstMember.cell.spssVarType !== undefined ? { cellSpssVarType: firstMember.cell.spssVarType } : {}),
      ...(firstMember.cell.spssMeasure !== undefined ? { cellSpssMeasure: firstMember.cell.spssMeasure } : {}),
      // radio-group cellExportLabel: 저장값 우선, 없으면 questionCode_열_행 자동 라벨로 폴백 (split/raw export 일관성)
      ...(() => {
        const cellExportLabel = buildAutoTableCellExportLabel(
          q,
          firstMember.row,
          firstMember.colIdx,
          firstMember.cell,
        );
        return cellExportLabel !== undefined ? { cellExportLabel } : {};
      })(),
    });

    members.forEach((m) => groupedCellIds.add(m.cell.id));
  }

  return groupedCellIds;
}

function buildAutoTableCellExportLabel(
  q: Question,
  row: TableRow,
  colIdx: number,
  cell?: TableCell,
): string | undefined {
  const col = q.tableColumns?.[colIdx];
  return (
    cell?.exportLabel ||
    generateExportLabel(q.questionCode, col?.label || col?.columnCode, row.label || row.rowCode)
  );
}

/**
 * 테이블 질문에서 특정 셀의 checkboxOptions를 찾는다.
 */
function findTableCellCheckboxOptions(question: Question, cellId: string) {
  if (!question.tableRowsData) return undefined;
  for (const row of question.tableRowsData) {
    for (const cell of row.cells) {
      if (cell.id === cellId) {
        return cell.checkboxOptions;
      }
    }
  }
  return undefined;
}

/**
 * 응답 데이터를 SPSS 열 정의에 맞춰 2차원 배열로 변환한다.
 */
export function buildDataRows(
  columns: SPSSExportColumn[],
  questions: Question[],
  submissions: SurveySubmission[],
): (string | number | null)[][] {
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  return submissions.map((sub) => buildDataRow(columns, questionMap, sub));
}

/**
 * grouped ranking 응답에서 이 컬럼 그룹의 RankingAnswer 배열 후보를 해석.
 * legacy flat 폴백: flat 배열 + 질문의 그룹 1개 = 그 그룹의 응답으로 해석
 * (rnk1 이식 후 미마이그레이션 기존 응답 호환). 그룹 2개 이상 + flat 은 모호하므로 null.
 */
function resolveGroupedRankingValue(col: SPSSExportColumn, rawValue: unknown): unknown {
  if (!col.choiceGroupKey) return rawValue;          // 비그룹 컬럼: 기존 경로 그대로
  if (Array.isArray(rawValue)) return col.soleRankingGroup ? rawValue : null;
  if (rawValue && typeof rawValue === 'object') {
    return (rawValue as Record<string, unknown>)[col.choiceGroupKey];
  }
  return null;
}

export function buildDataRow(
  columns: SPSSExportColumn[],
  questionMap: ReadonlyMap<string, Question>,
  sub: SurveySubmission,
): (string | number | null)[] {
  return columns.map((col) => {
    const question = questionMap.get(col.questionId);
    if (!question) return null;

    const rawValue = sub.questionResponses[col.questionId];

    switch (col.type) {
      case 'notice-agree': {
        // { agreed: true, agreedAt: "..." } 또는 boolean(하위 호환)
        if (rawValue && typeof rawValue === 'object' && 'agreed' in rawValue) {
          return (rawValue as { agreed: boolean }).agreed ? '동의' : null;
        }
        return rawValue === true ? '동의' : null;
      }

      case 'notice-date': {
        // agreedAt ISO 문자열 → 한국시 MM DD YYYY 형식
        if (rawValue && typeof rawValue === 'object' && 'agreedAt' in rawValue) {
          const agreedAt = (rawValue as { agreedAt?: string }).agreedAt;
          if (agreedAt) {
            const d = new Date(agreedAt);
            const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
            const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(kst.getUTCDate()).padStart(2, '0');
            const yyyy = String(kst.getUTCFullYear());
            return `${mm} ${dd} ${yyyy}`;
          }
        }
        return null;
      }

      case 'single':
        return transformSingleChoice(
          question,
          rawValue as
            | string
            | { selectedValue: string; otherValue?: string; hasOther: true }
            | null,
        );

      case 'checkbox-item': {
        const values = rawValue as Array<
          string | { selectedValue: string; otherValue?: string; hasOther: true }
        > | null;
        const resolved = resolveChoiceOptions(question);
        if (col.optionIndex == null) return null;
        const opt = resolved[col.optionIndex];
        if (!opt) return null;
        const isSelected =
          values != null &&
          values.some((v) => {
            if (typeof v === 'object' && v !== null && 'hasOther' in v) {
              return v.selectedValue === opt.id || v.selectedValue === opt.value;
            }
            return v === opt.id || v === opt.value;
          });
        return isSelected ? (opt.spssNumericCode ?? col.optionIndex + 1) : null;
      }

      case 'other-text': {
        // radio/select: { hasOther: true, otherValue: "..." }
        if (
          rawValue &&
          typeof rawValue === 'object' &&
          !Array.isArray(rawValue) &&
          'hasOther' in rawValue
        ) {
          return (rawValue as { otherValue?: string }).otherValue || null;
        }
        // checkbox: 배열 내 hasOther 객체에서 otherValue 추출
        if (Array.isArray(rawValue)) {
          const otherItem = rawValue.find(
            (v) =>
              typeof v === 'object' &&
              v !== null &&
              'hasOther' in v &&
              (v as { hasOther: boolean }).hasOther,
          ) as { otherValue?: string } | undefined;
          return otherItem?.otherValue || null;
        }
        return null;
      }

      case 'table-cell': {
        // rawValue는 테이블 응답 객체: { cellId: value, ... }
        if (!rawValue || typeof rawValue !== 'object') return null;
        const tableAnswer = rawValue as Record<string, unknown>;
        const cellId = col.tableCellId;
        if (!cellId) return null;
        const cellVal = tableAnswer[cellId];
        if (cellVal == null) return null;

        // checkbox 옵션별 분리 변수: 해당 옵션 선택 여부만 반환
        if (
          col.tableCellType === 'checkbox' &&
          col.optionIndex != null &&
          col.optionValue != null
        ) {
          const selectedValues = Array.isArray(cellVal) ? cellVal : [cellVal];
          const isSelected = selectedValues.some((v: unknown) => v === col.optionValue);
          // 셀의 checkboxOptions에서 spssNumericCode 조회 (컬럼 메타 우선, 폴백 역참조)
          const cellOptions = col.cellOptions ?? findTableCellCheckboxOptions(question, cellId);
          const code = cellOptions?.[col.optionIndex]?.spssNumericCode ?? col.optionIndex + 1;
          return isSelected ? code : null;
        }

        return transformTableChoiceCell(col.tableCellType || 'input', cellVal, col.cellOptions);
      }

      case 'choice-group': {
        // rawValue는 그룹별 응답 맵: { groupKey: selectedCellId, ... }
        // 해당 그룹의 선택 cellId를 꺼내 cellValueMap으로 숫자코드로 변환.
        if (rawValue == null || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null;
        const groupAnswer = rawValue as Record<string, string>;
        const cellId = groupAnswer[col.choiceGroupKey ?? ''];
        if (!cellId) return null;
        return col.choiceGroupCellValueMap?.[cellId] ?? null;
      }

      case 'choice-group-item': {
        // rawValue는 그룹별 응답 맵: { groupKey: string[] (선택 cellId 목록), ... }
        // 이 보기의 그룹 응답 배열에 해당 cellId 가 포함되면 counted 코드, 아니면 null.
        if (rawValue == null || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null;
        const groupAnswer = rawValue as Record<string, unknown>;
        const groupVal = groupAnswer[col.choiceGroupKey ?? ''];
        if (!Array.isArray(groupVal)) return null;
        const selected = groupVal as string[];
        return selected.includes(col.choiceGroupMemberCellId ?? '') ? (col.choiceGroupMemberCode ?? null) : null;
      }

      case 'radio-group': {
        // rawValue는 테이블 응답 객체: { cellId: value, ... }
        // 그룹 멤버 셀 중 응답이 있는 셀을 찾고, 그 셀의 매핑된 숫자값 반환.
        // 정책 P1: 다중체크 발생 시 마지막으로 발견된 셀의 값 채택 (Object.keys 순회 순서).
        if (!rawValue || typeof rawValue !== 'object') return null;
        if (!col.radioGroupCellValueMap) return null;
        const tableAnswer = rawValue as Record<string, unknown>;
        let chosen: number | null = null;
        for (const [cellId, expectedValue] of Object.entries(col.radioGroupCellValueMap)) {
          const cellResponse = tableAnswer[cellId];
          if (cellResponse == null || cellResponse === '') continue;
          // radio 셀 응답: optionId 문자열 또는 { optionId, otherValue, hasOther }
          // 옵션 1개짜리 셀이므로 응답이 truthy하면 선택된 것으로 간주.
          chosen = expectedValue;
        }
        return chosen;
      }

      case 'ranking-rank':
        if (col.rankIndex == null) return null;
        // col.cellOptions 에 Case 1/2 해결된 옵션 리스트가 있음 (generateSPSSColumns에서 주입)
        return transformRankingWithOptions(
          col.cellOptions, resolveGroupedRankingValue(col, rawValue), col.rankIndex);

      case 'ranking-other':
        if (col.rankIndex == null) return null;
        return transformRankingOtherText(resolveGroupedRankingValue(col, rawValue), col.rankIndex);

      case 'table-cell-ranking': {
        if (col.rankIndex == null || !col.tableCellId) return null;
        if (!rawValue || typeof rawValue !== 'object') return null;
        const tableAnswer = rawValue as Record<string, unknown>;
        const cellVal = tableAnswer[col.tableCellId];
        return transformRankingWithOptions(col.cellOptions, cellVal, col.rankIndex);
      }

      case 'table-cell-ranking-other': {
        if (col.rankIndex == null || !col.tableCellId) return null;
        if (!rawValue || typeof rawValue !== 'object') return null;
        const tableAnswer = rawValue as Record<string, unknown>;
        const cellVal = tableAnswer[col.tableCellId];
        return transformRankingOtherText(cellVal, col.rankIndex);
      }

      case 'option-text': {
        // allowTextInput 옵션 선택 시 사용자가 입력한 텍스트.
        if (!col.optionId) return null;
        return (
          getOptionText(
            sub.questionResponses as Record<string, unknown>,
            col.questionId,
            col.optionId,
          ) ?? null
        );
      }

      case 'table-cell-option-text': {
        // 테이블 셀 옵션의 allowTextInput 사이드카 텍스트.
        // 레거시 경로(optionTexts)는 테이블 셀에 대해 지원하지 않음 (신규 패턴만 사용).
        if (!col.optionId) return null;
        return (
          getOptionText(
            sub.questionResponses as Record<string, unknown>,
            col.questionId,
            col.optionId,
          ) ?? null
        );
      }

      case 'multiselect':
        // 다단계 선택 응답(string[])을 밑줄로 합산한 텍스트(STRING 변수)로 변환.
        // case 누락 시 default 의 String(['a','b']) → 'a,b'(콤마)로 의도와 다르게 export 됨.
        return transformMultiselect(rawValue as string[] | null);

      case 'text':
        return col.numericText
          ? transformNumericText(rawValue)
          : transformText(rawValue as string | null);

      default:
        return rawValue != null ? String(rawValue) : null;
    }
  });
}
