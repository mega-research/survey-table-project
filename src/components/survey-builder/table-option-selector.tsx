'use client';

import { Label } from '@/components/ui/label';
import { Question } from '@/types/survey';

interface TableOptionSelectorProps {
  question: Question;
  rowIds: string[];
  colIndex: number | undefined;
  expectedValues: string[] | undefined;
  onChange: (values: string[] | undefined) => void;
  label?: string;
  helpText?: string;
  multipleRows?: boolean;
}

export function TableOptionSelector({
  question,
  rowIds,
  colIndex,
  expectedValues = [],
  onChange,
  label = '확인할 옵션 선택 (선택사항)',
  helpText = '선택한 옵션들 중 하나라도 체크/선택되었는지 확인합니다. 비워두면 아무거나 체크/선택되었는지만 확인합니다.',
  multipleRows = false,
}: TableOptionSelectorProps) {
  if (colIndex === undefined) {
    return <p className="text-sm text-gray-500">열을 선택해주세요</p>;
  }

  if (!question.tableRowsData || rowIds.length === 0) {
    return <p className="text-sm text-gray-500">행과 열을 선택해주세요</p>;
  }

  const rowsWithOptions: Array<{
    rowId: string;
    rowLabel: string;
    options: Array<{ id: string; label: string; value: string }>;
  }> = [];

  // 선택된 모든 행에서 옵션 수집
  for (const rowId of rowIds) {
    const row = question.tableRowsData.find((r) => r.id === rowId);
    const cell = row?.cells[colIndex];

    if (!cell || !row) continue;

    // 셀 타입에 따라 옵션 가져오기
    let options: Array<{ id: string; label: string; value: string }> = [];

    if (cell.type === 'checkbox' && cell.checkboxOptions) {
      options = cell.checkboxOptions;
    } else if (cell.type === 'radio' && cell.radioOptions) {
      options = cell.radioOptions;
    } else if (cell.type === 'select' && cell.selectOptions) {
      options = cell.selectOptions;
    }

    if (options.length > 0) {
      rowsWithOptions.push({
        rowId: row.id,
        rowLabel: row.label,
        options,
      });
    }
  }

  if (rowsWithOptions.length === 0) {
    const hasInputCell = rowIds.some((rowId) => {
      const row = question.tableRowsData?.find((r) => r.id === rowId);
      return row?.cells[colIndex]?.type === 'input';
    });

    if (hasInputCell) {
      return (
        <p className="text-sm text-blue-600">
          입력 필드는 값이 입력되어 있으면 조건이 충족됩니다
        </p>
      );
    }

    return <p className="text-sm text-gray-500">선택한 행의 셀에 옵션이 없습니다</p>;
  }

  const handleOptionToggle = (optionValue: string, checked: boolean) => {
    const currentValues = expectedValues || [];
    const newValues = checked
      ? [...currentValues, optionValue]
      : currentValues.filter((v) => v !== optionValue);

    onChange(newValues.length > 0 ? newValues : undefined);
  };

  const showRowLabels = multipleRows && rowsWithOptions.length > 1;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="max-h-64 space-y-4 overflow-y-auto rounded-md border border-gray-200 p-3">
        {rowsWithOptions.map((rowData) => (
          <div key={rowData.rowId} className="space-y-2">
            {showRowLabels && (
              <div className="border-b border-gray-200 pb-1 text-xs font-semibold text-gray-600">
                {rowData.rowLabel}
              </div>
            )}
            <div className="space-y-1 pl-2">
              {rowData.options.map((option) => {
                const isSelected = expectedValues?.includes(option.value) || false;

                return (
                  <div key={`${rowData.rowId}-${option.id}`} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`opt-${rowData.rowId}-${option.id}`}
                      checked={isSelected}
                      onChange={(e) => handleOptionToggle(option.value, e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label
                      htmlFor={`opt-${rowData.rowId}-${option.id}`}
                      className="flex-1 cursor-pointer text-sm"
                    >
                      {option.label}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {helpText && <p className="text-xs text-gray-500">{helpText}</p>}
    </div>
  );
}
