'use client';

import type {
  ChoiceGroup,
  HeaderCell,
  Question,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

import type { CompleteQuestionWrite } from '@/db/schema/question-persisted-fields';
import {
  persistConditionRemaps,
  settleCreatedQuestion,
} from '@/features/survey-builder/lib/persist-question';
import {
  type SurveyBuilderState,
  useSurveyBuilderStore,
} from '@/features/survey-builder/stores/survey-store';
import { client } from '@/shared/lib/rpc';
import { collectChoiceOptCells } from '@/utils/choice-source';
import { collectRankingOptCells } from '@/utils/ranking-source';

import { GROUPABLE_CELL_TYPES, buildUpdatedCell } from './utils/serialize-cell';
import type { UseCellFormResult } from './hooks/use-cell-form';

export interface CommitCellEditArgs {
  form: UseCellFormResult['form'];
  cell: TableCell;
  questionCode: string | undefined;
  currentQuestionId: string;
  questions: Question[];
  editChoiceGroups: ChoiceGroup[];
  /** 이번 편집 세션에서 optionCode 편집이 value 를 동기화시킨 변경 쌍들(순서대로). */
  pendingValueChanges: { oldValue: string; newValue: string }[];
  /**
   * 에디터의 권위 있는 최신 구조 — 함수로 받는다. store 는 구조 편집 중 stale 이고,
   * onSave 로 셀을 반영한 **뒤에** 읽어야 하는 자리가 있어 값으로 미리 받으면 안 된다.
   */
  latest: {
    rows?: (() => TableRow[] | undefined) | undefined;
    columns?: (() => TableColumn[] | undefined) | undefined;
    headerGrid?: (() => HeaderCell[][] | undefined) | undefined;
  };
  ensureSurvey: () => Promise<void>;
  saveSurveyScoped: (scope: { questionIds: string[]; groupIds?: string[] }) => Promise<unknown>;
  remapOptionValueInConditions: SurveyBuilderState['remapOptionValueInConditions'];
  onSave: (cell: TableCell, valueChanges?: { oldValue: string; newValue: string }[]) => void;
  onChoiceGroupsChange?: ((groups: ChoiceGroup[]) => void) | undefined;
}

/**
 * 셀 편집 저장 확정 — 로컬 스토어 반영 · 그룹 정리 통보 · 서버 질문 저장/생성 · 조건 리매핑.
 *
 * 저장 중 표시(isSaving)와 모달 닫기는 호출부가 갖는다. 이 함수는 UI 수명주기를 모른다 —
 * 그래야 저장 절차만 따로 따라 읽고 테스트할 수 있다.
 */
export async function commitCellEdit({
  form,
  cell,
  currentQuestionId,
  questions,
  editChoiceGroups,
  pendingValueChanges,
  latest,
  ensureSurvey,
  saveSurveyScoped,
  remapOptionValueInConditions,
  onSave,
  onChoiceGroupsChange,
}: CommitCellEditArgs): Promise<void> {
  const readBuilderState = useSurveyBuilderStore.getState;
  const writeBuilderState = useSurveyBuilderStore.setState;
  const { contentType } = form;
  const getLatestRows = latest.rows;
  const getLatestColumns = latest.columns;
  const getLatestHeaderGrid = latest.headerGrid;
  const pendingOptionValueChangesRef = { current: pendingValueChanges };

    // 폼 상태를 저장될 TableCell 로 직렬화 (조건부 spread 로 optional 필드 처리).
    const updatedCell: TableCell = buildUpdatedCell(form, cell);

    // 로컬 스토어 업데이트 (셀 저장) — onChoiceGroupsChange 보다 먼저 수행해야
    // dynamic-table-editor 의 currentRowsRef 가 이미 새 셀을 포함한 상태에서 prune 이 동작한다.
    // 옵션 optionCode 편집으로 누적된 value 변경 쌍도 같은 커밋에 실어 게이팅을 리매핑한다.
    onSave(
      updatedCell,
      pendingOptionValueChangesRef.current.length > 0
        ? pendingOptionValueChangesRef.current
        : undefined,
    );

    // choice_opt 또는 ranking_opt 탭에서 그룹 변경이 있었으면 정리 후 부모에게 통보.
    // prune 은 updatedCell(이 셀 반영 후)의 rowsData 기준으로 계산해야 하므로
    // onSave(셀 반영) 다음에 호출한다.
    // 실질적인 prune(빈 그룹 제거)은 dynamic-table-editor 의 onChoiceGroupsChange 핸들러에서 수행한다.
    if (GROUPABLE_CELL_TYPES.has(contentType)) {
      onChoiceGroupsChange?.(editChoiceGroups);
    }

    // 서버에 질문 저장/업데이트
    if (currentQuestionId && readBuilderState().currentSurvey.id) {
      const question = questions.find((q) => q.id === currentQuestionId);
      // 저장/prune 베이스는 에디터의 권위 있는 최신 행을 우선 사용한다.
      // store.tableRowsData 는 구조 편집이 formData 에만 반영되어 stale 할 수 있어
      // 그걸로 prune 하면 그룹 멤버를 놓쳐 그룹이 풀린다(getLatestRows 폴백은 store).
      const baseRows = getLatestRows?.() ?? question?.tableRowsData;
      if (question && baseRows) {
        // 최신 행에서 해당 셀을 업데이트(onSave 로 이미 반영됐어도 id 기준 재적용은 idempotent)
        const updatedRowsData = baseRows.map((row) => ({
          ...row,
          cells: row.cells.map((c) => (c.id === cell.id ? updatedCell : c)),
        }));

        // choice_opt 저장 시 choiceGroups 도 함께 저장한다.
        // prune 은 updatedRowsData 기준으로 계산해 빈 그룹이 DB 에 남지 않도록 한다.
        // 마지막 멤버 해제로 전부 비면 빈 배열을 명시 저장해야 phantom 그룹이 남지 않는다.
        const prunedChoiceGroups = (() => {
          if (!GROUPABLE_CELL_TYPES.has(contentType)) return undefined;
          const memberIds = new Set(
            [
              ...collectChoiceOptCells(updatedRowsData),
              ...collectRankingOptCells(updatedRowsData),
            ]
              .map((c) => c.choiceGroupId)
              .filter((id): id is string => !!id),
          );
          const pruned = editChoiceGroups.filter((g) => memberIds.has(g.id));
          // 원래도 그룹이 없던 질문이면 빈 배열을 굳이 쓰지 않는다 (NULL 유지)
          if (pruned.length === 0 && (question.choiceGroups ?? []).length === 0)
            return undefined;
          return pruned;
        })();

        // 신규 판정은 dirty 추적(questionChanges.added) 기준 — 로컬 id도 randomUUID라
        // UUID 형식 검사로는 미영속 질문을 구분할 수 없다(0행 update로 저장 실패하던 버그).
        const isNewQuestion = !!readBuilderState().questionChanges.added[currentQuestionId];

        // React Compiler 는 try 문 안의 조건·옵셔널 체이닝을 낮추지 못한다 — 본문을 러너에 가둔다.
        const persistQuestion = async () => {
          await ensureSurvey();

          // 리매핑 스코프 수집 — 스코프 저장(saveSurveyScoped)의 입력.
          // create 분기에서 id 가 스왑되면 이후 리매핑은 새 id 기준이어야 한다.
          const remapScopes: Array<{ questionIds: string[]; groupIds: string[] }> = [];
          let effectiveQuestionId = currentQuestionId;

          // 행은 편집 세션의 열 구조 변경을 업고 간다 — 에디터 최신 columns/headerGrid 를
          // 항상 짝으로 커밋해야 스토어/DB 가 혼합 상태(columns N + 셀 N+1)가 되지 않는다.
          // getLatestColumns 미배선(구 호출부)이면 키 부재 = 미변경 규약 그대로 둔다.
          const latestColumns = getLatestColumns?.();
          const structurePatch = {
            ...(latestColumns !== undefined ? { tableColumns: latestColumns } : {}),
            // headerGrid 는 "키 부재 = 미변경, 해제는 명시적 null" 규약 — 배선된 경우에만 싣는다.
            ...(getLatestHeaderGrid ? { tableHeaderGrid: getLatestHeaderGrid() ?? null } : {}),
          };

          if (!isNewQuestion) {
            // 이미 DB에 저장된 질문: 업데이트
            await client.surveyBuilder.questions.update({
              questionId: currentQuestionId,
              surveyId: readBuilderState().currentSurvey.id,
              data: {
                tableRowsData: updatedRowsData,
                ...structurePatch,
                ...(prunedChoiceGroups !== undefined
                  ? { choiceGroups: prunedChoiceGroups }
                  : {}),
              },
            });
            // store 도 동일 데이터로 동기화. 표시 조건/장기 계산식 picker 가
            // store 를 직접 구독하므로 누락 시 셀 라벨 변경이 stale 로 표시됨.
            writeBuilderState((state) => ({
              currentSurvey: {
                ...state.currentSurvey,
                questions: state.currentSurvey.questions.map((q) =>
                  q.id === currentQuestionId
                    ? {
                        ...q,
                        tableRowsData: updatedRowsData,
                        ...structurePatch,
                        ...(prunedChoiceGroups !== undefined
                          ? { choiceGroups: prunedChoiceGroups }
                          : {}),
                      }
                    : q,
                ),
              },
            }));
          } else {
            // 미영속 질문: id를 그대로 전달해 서버에서 동일 id로 생성.
            // 가드: PERSISTED_QUESTION_FIELDS 를 모두 싣도록 satisfies 로 강제한다
            // (question-edit-modal 의 CREATE 경로와 같은 계약). 셀 모달은 질문 폼을
            // 소유하지 않으므로 구조 3종(열/헤더그리드/행)과 그룹만 에디터 최신값을 쓰고,
            // 나머지 질문 필드는 스토어 질문 값을 그대로 실어 create-drop 을 막는다.
            const createPayload = {
              id: currentQuestionId,
              surveyId: readBuilderState().currentSurvey.id,
              groupId: question.groupId,
              type: question.type,
              title: question.title || '',
              description: question.description,
              required: question.required ?? false,
              requiredMessage: question.requiredMessage ?? null,
              order: question.order ?? 0,
              options: question.options,
              selectLevels: question.selectLevels,
              tableTitle: question.tableTitle,
              tableColumns: latestColumns ?? question.tableColumns,
              tableRowsData: updatedRowsData,
              // 에디터가 배선돼 있으면 최신 그리드가 권위 — 해제는 null 로 명시한다.
              // 미배선(구 호출부)일 때만 스토어 값으로 폴백한다.
              tableHeaderGrid: getLatestHeaderGrid
                ? (getLatestHeaderGrid() ?? null)
                : (question.tableHeaderGrid ?? null),
              allowOtherOption: question.allowOtherOption,
              optionsColumns: question.optionsColumns,
              optionsAlign: question.optionsAlign,
              mobileOptionsColumns: question.mobileOptionsColumns,
              minSelections: question.minSelections,
              maxSelections: question.maxSelections,
              noticeContent: question.noticeContent,
              requiresAcknowledgment: question.requiresAcknowledgment,
              placeholder: question.placeholder,
              defaultValueTemplate: question.defaultValueTemplate,
              inputType: question.inputType,
              emptyDefault: question.emptyDefault,
              numberFormat: question.numberFormat,
              piiEncrypted: question.piiEncrypted,
              tableValidationRules: question.tableValidationRules,
              sumConstraints: question.sumConstraints,
              dynamicRowConfigs: question.dynamicRowConfigs,
              hideColumnLabels: question.hideColumnLabels,
              mobileOriginalTable: question.mobileOriginalTable,
              mobileTableDisplayMode: question.mobileTableDisplayMode,
              mobileDrilldownOmitLeadingColumns: question.mobileDrilldownOmitLeadingColumns,
              mobileDrilldownRepeatHeaderStartRow: question.mobileDrilldownRepeatHeaderStartRow,
              mobileDrilldownRepeatHeaderEndRow: question.mobileDrilldownRepeatHeaderEndRow,
              hideTitle: question.hideTitle,
              pageBreakBefore: question.pageBreakBefore,
              rankingConfig: question.rankingConfig,
              // prune 결과가 없으면(그룹 대상 셀이 아니거나 원래 그룹이 없던 질문)
              // 스토어 값을 그대로 유지한다 — 무관한 셀 저장이 그룹을 지우면 안 된다.
              choiceGroups: prunedChoiceGroups ?? question.choiceGroups,
              displayCondition: question.displayCondition,
              questionCode: question.questionCode,
              isCustomSpssVarName: question.isCustomSpssVarName,
              exportLabel: question.exportLabel,
              spssVarType: question.spssVarType,
              spssMeasure: question.spssMeasure,
              exportCellOrder: question.exportCellOrder,
              answerQuoteEnabled: question.answerQuoteEnabled,
              answerQuoteName: question.answerQuoteName,
              answerQuoteText: question.answerQuoteText,
            } satisfies CompleteQuestionWrite;
            const createdQuestion = await client.surveyBuilder.questions.create(createPayload);

            if (createdQuestion?.id) {
              // UPDATE 분기와 동일하게 store 도 방금 커밋한 구조로 동기화한다 —
              // 빠뜨리면 질문 모달 취소 후 재진입 시 DB(신 구조)와 store(구 구조)가
              // 갈라져 stale 구조가 표시되고 이후 질문 저장이 DB 변경을 되덮는다.
              writeBuilderState((state) => ({
                currentSurvey: {
                  ...state.currentSurvey,
                  questions: state.currentSurvey.questions.map((q) =>
                    q.id === currentQuestionId
                      ? {
                          ...q,
                          tableRowsData: updatedRowsData,
                          ...structurePatch,
                          ...(prunedChoiceGroups !== undefined
                            ? { choiceGroups: prunedChoiceGroups }
                            : {}),
                        }
                      : q,
                  ),
                },
              }));
            }
            const settled = settleCreatedQuestion(currentQuestionId, createdQuestion?.id);
            if (settled.newQuestionId) effectiveQuestionId = settled.newQuestionId;
            if (settled.remapScope) remapScopes.push(settled.remapScope);
          }

          // 새 옵션 value 가 DB 에 커밋된 직후 — 이 표 질문을 sourceQuestionId 로 참조하는
          // 다른 질문/그룹/행/열의 표시조건(table-cell-check expectedValues 는 셀 옵션 value
          // 공간)을 같은 지점에서 리매핑하고 영속시킨다. 질문 편집 모달의 저장까지 미루면
          // "셀 저장 후 질문 모달 취소" 경로에서 DB 에 신 value + 구 조건이 영구 잔류한다
          // (질문 모달의 취소 롤백은 tableRowsData 를 되돌리지 않는다).
          // 같은 표의 게이팅(enabledWhen)은 onSave→updateCell 이 이미 같은 커밋에 실었다.
          // 조건 참조는 위에서 이미 새 id 로 스왑됐을 수 있으므로 effectiveQuestionId 기준.
          if (pendingOptionValueChangesRef.current.length > 0) {
            // 같은 표의 다른 셀이 같은 옵션 value(자동 발번 option-N)를 쓰는 것이 일상이므로,
            // 이 셀의 행·열 좌표와 cellId 로 스코프를 좁혀 그 셀을 실제로 참조하는 조건만
            // 리매핑한다 (무관 셀을 겨냥한 조건의 expectedValues 오염 방지).
            const cellRow = updatedRowsData.find((row) =>
              row.cells.some((c) => c.id === cell.id),
            );
            const cellScope = cellRow
              ? {
                  rowId: cellRow.id,
                  columnIndex: cellRow.cells.findIndex((c) => c.id === cell.id),
                  cellId: cell.id,
                }
              : undefined;
            for (const change of pendingOptionValueChangesRef.current) {
              remapScopes.push(
                remapOptionValueInConditions(
                  effectiveQuestionId,
                  change.oldValue,
                  change.newValue,
                  cellScope,
                ),
              );
            }
            pendingOptionValueChangesRef.current = [];
          }

          // 리매핑이 실제 변경을 만들었으면 그 범위만 영속 — 빌더에 대기 중인 무관한
          // pending(질문 추가/삭제, 그룹 삭제 등)은 건드리지 않는다. 질문은 스코프 저장,
          // 그룹 조건은 그룹 전용 RPC 로 개별 영속한다 (전역 메타데이터 저장에 실으면
          // 미저장 제목 변경·그룹 삭제까지 동반 커밋된다).
          await persistConditionRemaps(remapScopes, saveSurveyScoped);
        };
        try {
          await persistQuestion();
        } catch (error) {
          console.error('질문 저장/업데이트 실패:', error);
        }
      }
    }
}
