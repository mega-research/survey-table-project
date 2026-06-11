'use client';

import { Input } from '@/components/ui/input';
import { Question } from '@/types/survey';
import {
  collectRankingGroups,
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
          placeholder="답변을 입력하세요..."
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
            tableHeaderGrid={question.tableHeaderGrid}
            className="border-0 shadow-none"
            hideColumnLabels={question.hideColumnLabels}
          />
        );
      }
      const layout = getOptionsLayout(question.optionsColumns);
      return (
        <div className={layout.className} style={layout.style}>
          {question.options?.map((option) => (
            <div key={option.id} className="flex items-center space-x-2">
              <input type={question.type} name={question.id} disabled className="text-blue-500" />
              <label className="text-sm text-gray-700">{option.label}</label>
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
          tableHeaderGrid={question.tableHeaderGrid}
          className="border-0 shadow-none"
          hideColumnLabels={question.hideColumnLabels}
        />
      ) : (
        <div className="py-4 text-center text-sm text-gray-400">테이블이 구성되지 않았습니다.</div>
      );

    case 'notice':
      return question.noticeContent ? (
        <NoticeRenderer
          content={question.noticeContent}
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

/** 순위형 질문 미리보기: 드롭다운 스택 + (옵션 목록 | 내장 테이블) */
function RankingPreview({ question }: { question: Question }) {
  const requestedPositions = Math.max(1, question.rankingConfig?.positions ?? 3);
  // Case 2 는 options 가 비어있고 실제 옵션은 tableRowsData 의 ranking_opt 셀.
  // resolveRankingOptions 로 통합해서 정확한 옵션 카운트를 얻는다.
  const resolvedOptions = resolveRankingOptions(question);
  // 셀-레벨 기타가 있으면 질문-레벨 synthetic 엔트리는 중복 방지 차원에서 추가하지 않음
  // (응답 UI 의 ranking-question.tsx 와 동일 규칙).
  const hasOtherCell = resolvedOptions.some((o) => o.value === RANKING_OTHER_VALUE);
  const allowOther = question.allowOtherOption === true && !hasOtherCell;
  const columns = question.rankingConfig?.positionsColumns;
  const layout = getOptionsLayout(columns);
  const isHorizontal = columns === 0;
  const isTableSource = question.rankingConfig?.optionsSource === 'table';
  // 그룹 여부: 테이블 소스에서만 그룹이 존재 가능 (응답 UI 와 동일 조건)
  const isGrouped = isTableSource && isGroupedRankingQuestion(question);
  const hasEmbeddedTable =
    isTableSource
    && !!question.tableColumns
    && question.tableColumns.length > 0
    && !!question.tableRowsData
    && question.tableRowsData.length > 0;

  // ── 그룹 경로: 그룹마다 헤딩 + disabled 드롭다운 스택 ──────────────────
  if (isGrouped) {
    const rankingGroups = collectRankingGroups(question);
    return (
      <div className="space-y-6">
        {rankingGroups.map((g) => {
          const groupOptions = resolveRankingOptionsFromCells(g.cells);
          // cap 규칙: 응답 UI 와 동일 (min(질문 positions, 그룹 유효 옵션 수))
          const groupPositions = Math.min(requestedPositions, Math.max(groupOptions.length, 1));
          return (
            <div key={g.groupKey} className="space-y-2">
              <p className="text-sm font-medium text-gray-900">{g.label || g.groupKey}</p>
              <div className={layout.className} style={layout.style}>
                {Array.from({ length: groupPositions }, (_, i) => i + 1).map((rank) => (
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
                      {groupOptions.map((o) => (
                        <option key={o.id}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {groupPositions < requestedPositions && (
                <p className="text-sm text-gray-500">
                  선택지가 {groupOptions.length}개라 최대 {groupPositions}순위까지 입력할 수 있습니다.
                </p>
              )}
            </div>
          );
        })}

        {hasEmbeddedTable && (
          <TablePreview
            tableTitle={question.tableTitle}
            columns={question.tableColumns}
            rows={question.tableRowsData}
            tableHeaderGrid={question.tableHeaderGrid}
            className="border-0 shadow-none"
            hideColumnLabels={question.hideColumnLabels}
          />
        )}
      </div>
    );
  }

  // ── 비그룹 경로 (기존 단일 스택, 무수정) ───────────────────────────────
  const renderPositions = Math.min(requestedPositions, Math.max(resolvedOptions.length, 1));

  return (
    <div className="space-y-3">
      <div className={layout.className} style={layout.style}>
        {Array.from({ length: renderPositions }, (_, i) => i + 1).map((rank) => (
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
              {resolvedOptions.map((o) => (
                <option key={o.id}>{o.label}</option>
              ))}
              {allowOther && <option>기타 (직접 입력)</option>}
            </select>
          </div>
        ))}
      </div>

      {hasEmbeddedTable ? (
        <TablePreview
          tableTitle={question.tableTitle}
          columns={question.tableColumns}
          rows={question.tableRowsData}
          tableHeaderGrid={question.tableHeaderGrid}
          className="border-0 shadow-none"
          hideColumnLabels={question.hideColumnLabels}
        />
      ) : (
        ((question.options?.length ?? 0) > 0 || allowOther) && (
          <div
            className={`rounded-md border border-gray-200 bg-gray-50/50 p-3 text-sm ${layout.className}`}
            style={layout.style}
          >
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
