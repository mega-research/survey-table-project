import {
  ExpressionConditionConfig,
  NumericComparison,
  Question,
} from '@/types/survey';
import { migrateNumericComparisonToExpression } from '@/utils/expression-migration';

/**
 * 메인/추가 조건 양쪽에서 numericComparison → expression 변환 버튼이 노출될 조건과
 * 클릭 시 동작을 한 곳에서 결정. 변환 후 처리 (tableConditions/additionalConditions 정리) 는
 * 호출자가 onMigrate 콜백 안에서 결정한다.
 *
 * 가드: numericComparison 존재 + rowIds[0] + cellColumnIndex + 그 셀이 input 타입.
 * input 이 아닌 셀(text/image/radio 등) 을 outerCellRef 로 잡으면 마이그레이션 후
 * expression cell operand 가 무의미한 셀을 가리키므로 버튼 자체를 미노출.
 */
export function buildMigrateHandler(
  nc: NumericComparison | undefined,
  rowIds: string[] | undefined,
  cellColumnIndex: number | undefined,
  sourceQuestion: Question | undefined,
  onMigrate: (config: ExpressionConditionConfig) => void,
): (() => void) | undefined {
  if (!nc || !sourceQuestion || cellColumnIndex === undefined) return undefined;
  const outerRow = rowIds?.[0];
  if (!outerRow) return undefined;
  const row = sourceQuestion.tableRowsData?.find((r) => r.id === outerRow);
  const cell = row?.cells[cellColumnIndex];
  if (!cell || cell.type !== 'input') return undefined;
  return () => {
    const expressionConfig = migrateNumericComparisonToExpression(nc, {
      questionId: sourceQuestion.id,
      cellId: cell.id,
    });
    onMigrate(expressionConfig);
  };
}
