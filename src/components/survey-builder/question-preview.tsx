'use client';

import {
  RANKING_OTHER_OPTION,
  RankingRankBadge,
  RankingSummaryBar,
  rankingGridLayout,
} from '@/components/survey-response/ranking-click-select';
import { Input } from '@/components/ui/input';
import { Question } from '@/types/survey';
import {
  collectRankingGroups,
  getGroupTypeOfCell,
  isGroupedRankingQuestion,
} from '@/utils/choice-group-helpers';
import { getOptionsLayout } from '@/utils/options-layout';
import {
  RANKING_HORIZONTAL_ITEM_WIDTH,
  RANKING_OTHER_VALUE,
  RANKING_SELECT_BASE_CLS,
} from '@/utils/ranking-shared';
import { resolveRankingOptions, resolveRankingOptionsFromCells } from '@/utils/ranking-source';
import { isChoiceTableSource } from '@/utils/choice-source';

import { NoticeRenderer } from './notice-renderer';
import { TablePreview } from './table-preview';
import { UserDefinedMultiLevelSelectPreview } from './user-defined-multi-level-select';

export function QuestionPreview({ question }: { question: Question }) {
  switch (question.type) {
    case 'text':
      return (
        <Input
          placeholder={question.placeholder || '답변을 입력하세요...'}
          disabled
          className="bg-white"
        />
      );

    case 'textarea':
      return (
        <textarea
          className="w-full resize-none rounded-md border border-gray-200 bg-white p-3"
          rows={3}
          placeholder={question.placeholder || '답변을 입력하세요...'}
          disabled
        />
      );

    case 'radio':
    case 'checkbox': {
      if (isChoiceTableSource(question)) {
        return (
          <TablePreview
            tableTitle={question.tableTitle}
            columns={question.tableColumns}
            rows={question.tableRowsData}
            tableHeaderGrid={question.tableHeaderGrid ?? undefined}
            className="border-0 shadow-none"
            hideColumnLabels={question.hideColumnLabels}
            stickyColumnCount={question.stickyColumnCount}
            choiceControlType={(cell) => getGroupTypeOfCell(question, cell.id)}
          />
        );
      }
      const layout = getOptionsLayout(question.optionsColumns, question.optionsAlign);
      return (
        <div className={layout.className} style={layout.style}>
          {question.options?.map((option) => (
            // items-start + mt-0.5: 여러 줄 라벨에서 컨트롤을 첫 줄 중앙에 고정
            <div key={option.id} className="flex items-start space-x-2">
              <input
                type={question.type}
                name={question.id}
                disabled
                className="mt-0.5 shrink-0 text-blue-500"
              />
              <label className="whitespace-pre-line text-sm text-gray-700">{option.label}</label>
            </div>
          ))}
        </div>
      );
    }

    case 'select':
      return (
        <select disabled className="w-full rounded-md border border-gray-200 bg-white p-3">
          <option>선택하세요...</option>
          {question.options?.map((option) => (
            <option key={option.id}>{option.label}</option>
          ))}
          <option>기타</option>
        </select>
      );

    case 'multiselect':
      return question.selectLevels ? (
        <UserDefinedMultiLevelSelectPreview levels={question.selectLevels} />
      ) : (
        <div className="text-sm text-gray-400">다단계 Select가 설정되지 않았습니다.</div>
      );

    case 'ranking':
      return <RankingPreview question={question} />;

    case 'table':
      return question.tableColumns && question.tableRowsData ? (
        <TablePreview
          tableTitle={question.tableTitle}
          columns={question.tableColumns}
          rows={question.tableRowsData}
          tableHeaderGrid={question.tableHeaderGrid ?? undefined}
          className="border-0 shadow-none"
          hideColumnLabels={question.hideColumnLabels}
          stickyColumnCount={question.stickyColumnCount}
        />
      ) : (
        <div className="py-4 text-center text-sm text-gray-400">테이블이 구성되지 않았습니다.</div>
      );

    case 'notice':
      return question.noticeContent ? (
        <NoticeRenderer
          content={question.noticeContent}
          bgColor={question.noticeBgColor}
          requiresAcknowledgment={question.requiresAcknowledgment}
          value={false}
          isTestMode={false}
        />
      ) : (
        <div className="py-4 text-center text-sm text-gray-400">공지사항 내용이 없습니다.</div>
      );

    default:
      return <div className="text-sm text-gray-400">미리보기 준비 중...</div>;
  }
}

/** 순위형 질문 미리보기. 기본(드롭다운)은 RankingDropdownPreview, inputMode='click' 은 요약 줄 + 보기 표. 조작 없음. */
function RankingPreview({ question }: { question: Question }) {
  const requestedPositions = Math.max(1, question.rankingConfig?.positions ?? 3);
  // Case 2 는 options 가 비어있고 실제 옵션은 tableRowsData 의 ranking_opt 셀.
  // resolveRankingOptions 로 통합해서 정확한 옵션 카운트를 얻는다.
  const resolvedOptions = resolveRankingOptions(question);
  // 셀-레벨 기타가 있으면 질문-레벨 synthetic 엔트리는 중복 방지 차원에서 추가하지 않음
  // (응답 UI 의 ranking-question.tsx 와 동일 규칙).
  const hasOtherCell = resolvedOptions.some((o) => o.value === RANKING_OTHER_VALUE);
  const allowOther = question.allowOtherOption === true && !hasOtherCell;
  const allowDuplicates = question.rankingConfig?.allowDuplicateRanks === true;
  const isTableSource = question.rankingConfig?.optionsSource === 'table';
  // 그룹 여부: 테이블 소스에서만 그룹이 존재 가능 (응답 UI 와 동일 조건)
  const isGrouped = isTableSource && isGroupedRankingQuestion(question);
  const hasEmbeddedTable =
    isTableSource
    && !!question.tableColumns
    && question.tableColumns.length > 0
    && !!question.tableRowsData
    && question.tableRowsData.length > 0;

  if (question.rankingConfig?.inputMode !== 'click' || allowDuplicates) {
    return <RankingDropdownPreview question={question} />;
  }

  const embeddedTable = hasEmbeddedTable ? (
    <TablePreview
      tableTitle={question.tableTitle}
      columns={question.tableColumns}
      rows={question.tableRowsData}
      tableHeaderGrid={question.tableHeaderGrid ?? undefined}
      className="border-0 shadow-none"
      hideColumnLabels={question.hideColumnLabels}
      stickyColumnCount={question.stickyColumnCount}
    />
  ) : null;

  // ── 그룹 경로: 그룹마다 헤딩 + 요약 줄, 표는 하나 ──────────────────────
  if (isGrouped) {
    const rankingGroups = collectRankingGroups(question);
    return (
      <div className="space-y-4">
        {rankingGroups.map((g) => {
          const groupOptions = resolveRankingOptionsFromCells(g.cells);
          // cap 규칙: 응답 UI 와 동일 (min(질문 positions, 그룹 유효 옵션 수))
          const groupPositions = Math.min(requestedPositions, Math.max(groupOptions.length, 1));
          return (
            <div key={g.groupKey} className="space-y-2">
              <p className="text-sm font-medium text-gray-900">{g.label || g.groupKey}</p>
              <RankingSummaryBar
                answers={[]}
                options={groupOptions}
                positions={groupPositions}
                onReset={() => {}}
              />
              {groupPositions < requestedPositions && (
                <p className="text-sm text-gray-500">
                  선택지가 {groupOptions.length}개라 최대 {groupPositions}순위까지 입력할 수 있습니다.
                </p>
              )}
            </div>
          );
        })}
        {embeddedTable}
      </div>
    );
  }

  // ── 비그룹 경로 ─────────────────────────────────────────────────────────
  const renderPositions = Math.min(requestedPositions, Math.max(resolvedOptions.length, 1));
  const rows = allowOther ? [...resolvedOptions, RANKING_OTHER_OPTION] : resolvedOptions;
  const grid = rankingGridLayout(question.optionsColumns);

  return (
    <div className="space-y-3">
      <RankingSummaryBar
        answers={[]}
        options={resolvedOptions}
        positions={renderPositions}
        onReset={() => {}}
      />
      {renderPositions < requestedPositions && (
        <p className="text-sm text-gray-500">
          선택지가 {resolvedOptions.length}개라 최대 {renderPositions}순위까지 입력할 수 있습니다.
        </p>
      )}
      {embeddedTable ?? (
        rows.length > 0 && (
          <div className={grid.className} style={grid.style}>
            {rows.map((opt) => (
              <div
                key={opt.id}
                className={`flex items-start gap-2 px-3 py-2.5 text-base text-gray-800 ${grid.itemClassName}${opt.textBold ? ' font-bold' : ''}`}
                style={{
                  ...(opt.backgroundColor ? { backgroundColor: opt.backgroundColor } : {}),
                  ...(opt.textColor ? { color: opt.textColor } : {}),
                }}
              >
                <span className="mt-0.5 shrink-0">
                  <RankingRankBadge rank={undefined} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="whitespace-pre-line [overflow-wrap:anywhere]">{opt.label}</span>
                </span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/** 드롭다운 입력 방식(기본) 미리보기 — 응답 UI 의 RankingDropdown 과 같은 모양. */
function RankingDropdownPreview({ question }: { question: Question }) {
  const requestedPositions = Math.max(1, question.rankingConfig?.positions ?? 3);
  const resolvedOptions = resolveRankingOptions(question);
  const hasOtherCell = resolvedOptions.some((o) => o.value === RANKING_OTHER_VALUE);
  const allowOther = question.allowOtherOption === true && !hasOtherCell;
  const columns = question.rankingConfig?.positionsColumns;
  const layout = getOptionsLayout(columns);
  const isHorizontal = columns === 0;
  const isTableSource = question.rankingConfig?.optionsSource === 'table';
  const isGrouped = isTableSource && isGroupedRankingQuestion(question);
  const hasEmbeddedTable =
    isTableSource
    && !!question.tableColumns
    && question.tableColumns.length > 0
    && !!question.tableRowsData
    && question.tableRowsData.length > 0;

  const renderStack = (options: ReturnType<typeof resolveRankingOptions>, positions: number, withOther: boolean) => (
    <div className={layout.className} style={layout.style}>
      {Array.from({ length: positions }, (_, i) => i + 1).map((rank) => (
        <div key={rank} className="flex items-center gap-1.5">
          <span
            className={
              isHorizontal
                ? 'shrink-0 text-sm font-medium text-gray-700'
                : 'w-12 shrink-0 text-sm font-medium text-gray-700'
            }
          >
            {rank}순위
          </span>
          <select
            disabled
            className={isHorizontal ? RANKING_SELECT_BASE_CLS : `w-full ${RANKING_SELECT_BASE_CLS}`}
            style={isHorizontal ? { width: RANKING_HORIZONTAL_ITEM_WIDTH } : undefined}
          >
            <option>선택하세요...</option>
            {options.map((o) => (
              <option key={o.id}>{o.label}</option>
            ))}
            {withOther && <option>기타 (직접 입력)</option>}
          </select>
        </div>
      ))}
    </div>
  );

  const embeddedTable = hasEmbeddedTable ? (
    <TablePreview
      tableTitle={question.tableTitle}
      columns={question.tableColumns}
      rows={question.tableRowsData}
      tableHeaderGrid={question.tableHeaderGrid ?? undefined}
      className="border-0 shadow-none"
      hideColumnLabels={question.hideColumnLabels}
      stickyColumnCount={question.stickyColumnCount}
    />
  ) : null;

  if (isGrouped) {
    const rankingGroups = collectRankingGroups(question);
    return (
      <div className="space-y-6">
        {rankingGroups.map((g) => {
          const groupOptions = resolveRankingOptionsFromCells(g.cells);
          const groupPositions = Math.min(requestedPositions, Math.max(groupOptions.length, 1));
          return (
            <div key={g.groupKey} className="space-y-2">
              <p className="text-sm font-medium text-gray-900">{g.label || g.groupKey}</p>
              {renderStack(groupOptions, groupPositions, false)}
              {groupPositions < requestedPositions && (
                <p className="text-sm text-gray-500">
                  선택지가 {groupOptions.length}개라 최대 {groupPositions}순위까지 입력할 수 있습니다.
                </p>
              )}
            </div>
          );
        })}
        {embeddedTable}
      </div>
    );
  }

  const renderPositions = Math.min(requestedPositions, Math.max(resolvedOptions.length, 1));
  return (
    <div className="space-y-3">
      {renderStack(resolvedOptions, renderPositions, allowOther)}
      {embeddedTable ?? (
        ((question.options?.length ?? 0) > 0 || allowOther) && (
          <div className="rounded-md border border-gray-200 bg-gray-50/50 p-3 text-sm">
            {question.options?.map((opt) => (
              <div
                key={opt.id}
                className="whitespace-pre-wrap text-gray-800 [overflow-wrap:anywhere]"
              >
                {opt.label}
              </div>
            ))}
            {allowOther && (
              <div className="whitespace-pre-wrap text-gray-500 italic [overflow-wrap:anywhere]">
                기타 (직접 입력)
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
