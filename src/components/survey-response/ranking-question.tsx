'use client';

import { useMemo } from 'react';

import { TablePreview } from '@/components/survey-builder/table-preview';
import { useMobileView } from '@/hooks/use-media-query';
import { Question, RankingAnswer } from '@/types/survey';
import {
  collectRankingGroups,
  GroupedRankingAnswer,
  isGroupedRankingQuestion,
} from '@/utils/choice-group-helpers';
import { getOptionsLayout } from '@/utils/options-layout';
import { parseRankingAnswers, RANKING_OTHER_VALUE } from '@/utils/ranking-shared';
import { resolveRankingOptions, resolveRankingOptionsFromCells } from '@/utils/ranking-source';

import { MobileOptionCard } from './mobile-card-shared';
import { RankingDropdownStack } from './ranking-dropdown-stack';

interface RankingQuestionProps {
  question: Question;
  value: unknown;
  onChange: (value: RankingAnswer[] | GroupedRankingAnswer) => void;
}

/**
 * 순위형(ranking) 질문 응답 컴포넌트.
 * - optionsSource='manual': question.options 로부터 드롭다운 (flat RankingAnswer[] 응답)
 * - optionsSource='table' + 비그룹: 질문 자체 tableRowsData ranking_opt 셀이 옵션 소스
 *   상단에 드롭다운 → 하단에 설명 테이블(TablePreview, 읽기 전용) (flat RankingAnswer[] 응답)
 * - optionsSource='table' + 그룹(isGroupedRankingQuestion): 그룹마다 독립 드롭다운 스택 + 헤딩
 *   (GroupedRankingAnswer 응답)
 */
export function RankingQuestion({ question, value, onChange }: RankingQuestionProps) {
  const config = question.rankingConfig;
  const isMobile = useMobileView();
  const isTableSource = config?.optionsSource === 'table';

  // 그룹 여부: 테이블 소스에서만 그룹이 존재 가능하다
  const isGrouped = isTableSource && isGroupedRankingQuestion(question);

  // 전체 옵션 (rawOptions) — 빈 상태 검사 + 설명 테이블/목록 표시에 사용
  // grouped 경로에서도 전체 셀 기준으로 빈 상태를 판단한다
  const rawOptions = useMemo(() => resolveRankingOptions(question), [question]);

  const requestedPositions = Math.max(1, config?.positions ?? 3);
  const positions = Math.min(requestedPositions, Math.max(rawOptions.length, 1));
  const allowDuplicates = config?.allowDuplicateRanks === true;
  // 셀-레벨 기타가 있으면 질문-레벨 synthetic 엔트리는 중복 방지 차원에서 추가하지 않음.
  const hasOtherCell = rawOptions.some((o) => o.value === RANKING_OTHER_VALUE);
  const allowOther = question.allowOtherOption === true && !hasOtherCell;

  // 비그룹 경로: flat RankingAnswer[] 로 정규화
  const answers = useMemo(() => parseRankingAnswers(value), [value]);

  // 그룹 경로: GroupedRankingAnswer 맵으로 추출
  const groupedMap = useMemo(
    () =>
      isGrouped && value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {},
    [isGrouped, value],
  );

  // 그룹 목록 (grouped 분기에서만 사용)
  const rankingGroups = useMemo(
    () => (isGrouped ? collectRankingGroups(question) : []),
    [isGrouped, question],
  );

  // 그룹별 응답 변경 핸들러: 해당 그룹 키만 갱신, 전체 해제 시 키 삭제
  function handleGroupChange(groupKey: string, next: RankingAnswer[]): void {
    const updated: GroupedRankingAnswer = {};
    for (const [k, v] of Object.entries(groupedMap)) {
      updated[k] = parseRankingAnswers(v);
    }
    if (next.length === 0) {
      delete updated[groupKey];
    } else {
      updated[groupKey] = next;
    }
    onChange(updated);
  }

  if (rawOptions.length === 0) {
    return (
      <div className="py-4 text-center text-gray-500">
        {isTableSource
          ? '설명 테이블에 "순위 옵션" 셀이 없습니다. 빌더에서 옵션으로 쓸 셀의 타입을 "순위 옵션"으로 설정하세요.'
          : '선택지가 없습니다.'}
      </div>
    );
  }

  const hasEmbeddedTable =
    isTableSource
    && question.tableColumns
    && question.tableColumns.length > 0
    && question.tableRowsData
    && question.tableRowsData.length > 0;

  // ── 그룹 경로: 그룹마다 헤딩 + 독립 드롭다운 스택 ──────────────────────
  if (isGrouped) {
    return (
      <div className="space-y-6">
        {rankingGroups.map((g) => {
          const groupOptions = resolveRankingOptionsFromCells(g.cells);
          const groupPositions = Math.min(requestedPositions, Math.max(groupOptions.length, 1));
          const groupAnswers = parseRankingAnswers(groupedMap[g.groupKey]);
          return (
            <div key={g.groupKey} className="space-y-2">
              <p className="text-sm font-medium text-gray-900">{g.label || g.groupKey}</p>
              <RankingDropdownStack
                answers={groupAnswers}
                options={groupOptions}
                positions={groupPositions}
                allowDuplicates={allowDuplicates}
                allowOther={false}
                onChange={(next) => handleGroupChange(g.groupKey, next)}
                columns={config?.positionsColumns}
              />
              {groupPositions < requestedPositions && (
                <p className="text-sm text-gray-500">
                  선택지가 {groupOptions.length}개라 최대 {groupPositions}순위까지 입력할 수 있습니다.
                </p>
              )}
            </div>
          );
        })}

        {/* 내장 테이블이 있으면 전체 테이블을 옵션 시각화 참조로 표시 */}
        {hasEmbeddedTable && (
          isMobile ? (
            <div className="space-y-2">
              {(question.tableRowsData ?? []).map((row) => {
                const optCell = row.cells.find((c) => c.type === 'ranking_opt' && !c.isHidden);
                if (!optCell) return null;
                const opt = rawOptions.find((o) => o.id === optCell.id);
                return (
                  <MobileOptionCard
                    key={row.id}
                    label={opt?.label ?? optCell.content ?? optCell.rankingLabel ?? '(라벨 없음)'}
                    cells={row.cells}
                  />
                );
              })}
            </div>
          ) : (
            <TablePreview
              {...(question.tableTitle !== undefined ? { tableTitle: question.tableTitle } : {})}
              {...(question.tableColumns !== undefined ? { columns: question.tableColumns } : {})}
              {...(question.tableRowsData !== undefined ? { rows: question.tableRowsData } : {})}
              {...(question.tableHeaderGrid !== undefined ? { tableHeaderGrid: question.tableHeaderGrid } : {})}
              {...(question.hideColumnLabels !== undefined ? { hideColumnLabels: question.hideColumnLabels } : {})}
            />
          )
        )}
      </div>
    );
  }

  // ── 비그룹 경로 (기존 단일 스택, 무수정) ───────────────────────────────
  return (
    <div className="space-y-4">
      <RankingDropdownStack
        answers={answers}
        options={rawOptions}
        positions={positions}
        allowDuplicates={allowDuplicates}
        allowOther={allowOther}
        onChange={onChange as (value: RankingAnswer[]) => void}
        columns={config?.positionsColumns}
      />

      {positions < requestedPositions && (
        <p className="text-sm text-gray-500">
          선택지가 {rawOptions.length}개라 최대 {positions}순위까지 입력할 수 있습니다.
        </p>
      )}

      {/* 내장 테이블이 있으면 테이블이 옵션을 시각화 — 아니면 선택지 목록으로 표시 */}
      {hasEmbeddedTable ? (
        isMobile ? (
          <div className="space-y-2">
            {(question.tableRowsData ?? []).map((row) => {
              const optCell = row.cells.find((c) => c.type === 'ranking_opt' && !c.isHidden);
              if (!optCell) return null;
              // resolveRankingOptions 는 항상 id=cell.id 를 부여(기타 셀 포함).
              // value 는 기타 셀일 때 RANKING_OTHER_VALUE 로 바뀌므로 id 로 매칭한다.
              const opt = rawOptions.find((o) => o.id === optCell.id);
              return (
                <MobileOptionCard
                  key={row.id}
                  label={opt?.label ?? optCell.content ?? optCell.rankingLabel ?? '(라벨 없음)'}
                  cells={row.cells}
                />
              );
            })}
          </div>
        ) : (
          <TablePreview
            {...(question.tableTitle !== undefined ? { tableTitle: question.tableTitle } : {})}
            {...(question.tableColumns !== undefined ? { columns: question.tableColumns } : {})}
            {...(question.tableRowsData !== undefined ? { rows: question.tableRowsData } : {})}
            {...(question.tableHeaderGrid !== undefined ? { tableHeaderGrid: question.tableHeaderGrid } : {})}
            {...(question.hideColumnLabels !== undefined ? { hideColumnLabels: question.hideColumnLabels } : {})}
          />
        )
      ) : (
        (() => {
          const layout = getOptionsLayout(question.optionsColumns);
          return (
            <div
              className={`rounded-md border border-gray-200 bg-gray-50/50 p-3 text-sm ${layout.className}`}
              style={layout.style}
            >
              {rawOptions.map((opt) => (
                <div
                  key={opt.id}
                  className="whitespace-pre-wrap text-gray-800 [overflow-wrap:anywhere]"
                >
                  {opt.label}
                </div>
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
}
