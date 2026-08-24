'use client';

import { Label } from '@/components/ui/label';
import { TablePreview } from '@/features/question-renderer/table-preview';
import { DynamicTableEditor } from '@/features/survey-builder/table-editor/dynamic-table-editor';
import { getGroupTypeOfCell } from '@/utils/choice-group-helpers';
import type { Question } from '@/types/survey';

interface QuestionTableFieldsProps {
  question: Question;
  questionId: string;
  questions: Question[];
  formData: Partial<Question>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Question>>>;
  answerQuoteEnabled: boolean;
  isRankingTableSource: boolean;
  showTableEditor: boolean;
}

/** 질문 편집의 '테이블 설정' 구획. 상태는 부모가 그대로 들고 있다. */
export function QuestionTableFields({
  question,
  questionId,
  questions,
  formData,
  setFormData,
  answerQuoteEnabled,
  isRankingTableSource,
  showTableEditor,
}: QuestionTableFieldsProps) {
  return (
    <>
  {showTableEditor && (
    <div className="space-y-6">
      <Label className="text-lg font-medium">
        {isRankingTableSource ? '순위 옵션 테이블' : '테이블 설정'}
      </Label>

      <div className="rounded bg-blue-50 p-2 text-xs text-blue-600">
        {isRankingTableSource
          ? '💡 이 랭킹 질문 안에 표시될 설명 테이블입니다. 옵션으로 쓸 셀은 편집 모달의 "순위 옵션" 탭으로 저장하세요.'
          : '💡 테이블 질문은 매트리스(고정 행) 패턴으로 자동 설정됩니다. 엑셀 내보내기 시 각 셀의 코드가 열 이름에 반영됩니다.'}
      </div>

      <DynamicTableEditor
        tableTitle={formData.tableTitle}
        columns={formData.tableColumns}
        rows={formData.tableRowsData}
        tableHeaderGrid={formData.tableHeaderGrid ?? undefined}
        currentQuestionId={questionId || ''}
        questionCode={formData.questionCode}
        questionTitle={formData.title}
        answerQuoteEnabled={answerQuoteEnabled}
        dynamicRowConfigs={formData.dynamicRowConfigs}
        onTableChange={(data) => {
          setFormData((prev) => {
            const next: Partial<Question> = {
              ...prev,
              tableTitle: data.tableTitle,
              tableColumns: data.tableColumns,
              tableRowsData: data.tableRowsData,
            };
            // 키를 지우면 저장 경로가 "미변경"으로 읽어 해제가 유실된다.
            // 에디터는 그리드가 없으면 null 을 실어 보내므로 그대로 반영한다.
            next.tableHeaderGrid = data.tableHeaderGrid;
            return next;
          });
        }}
        onDynamicRowConfigsChange={(configs) => {
          setFormData((prev) => {
            const next: Partial<Question> = { ...prev };
            if (configs !== undefined) {
              next.dynamicRowConfigs = configs;
            } else {
              delete next.dynamicRowConfigs;
            }
            return next;
          });
        }}
      />

      {/* 미리보기 */}
      {formData.tableColumns && formData.tableColumns.length > 0 && (
        <div className="space-y-3">
          <Label className="text-base font-medium">미리보기</Label>
          <TablePreview
            tableTitle={formData.tableTitle}
            columns={formData.tableColumns}
            rows={formData.tableRowsData}
            tableHeaderGrid={formData.tableHeaderGrid ?? undefined}
            className="border-2 border-dashed border-gray-300"
            hideColumnLabels={questions.find((q) => q.id === questionId)?.hideColumnLabels}
            choiceControlType={(cell) =>
              getGroupTypeOfCell(
                {
                  ...(question as Question),
                  type: question?.type ?? 'radio',
                  tableRowsData: formData.tableRowsData,
                  choiceGroups: questions.find((q) => q.id === questionId)?.choiceGroups,
                } as Question,
                cell.id,
              )
            }
          />
        </div>
      )}
    </div>
  )}
    </>
  );
}
