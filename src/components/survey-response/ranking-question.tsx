'use client';

import { type ReactNode, useMemo, useState } from 'react';

import { TablePreview } from '@/components/survey-builder/table-preview';
import { CellText, resolveCellTextHtml } from '@/components/survey/cell-text';
import { useMobileView } from '@/hooks/use-media-query';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import { Question, QuestionOption, RankingAnswer, TableCell } from '@/types/survey';
import {
  collectRankingGroups,
  GroupedRankingAnswer,
  isGroupedRankingQuestion,
} from '@/utils/choice-group-helpers';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import { rankOfOption } from '@/utils/ranking-click';
import { parseRankingAnswers, RANKING_OTHER_VALUE } from '@/utils/ranking-shared';
import { resolveRankingOptions, resolveRankingOptionsFromCells } from '@/utils/ranking-source';

import { MobileOptionCard } from './mobile-card-shared';
import {
  buildRankingClickHandle,
  RankingClickHandle,
  RankingClickList,
  RankingFullNotice,
  RankingOptionFace,
  RankingDetailRows,
  RankingRankBadge,
  RankingSummaryBar,
} from './ranking-click-select';
import { RankingDropdownStack } from './ranking-dropdown-stack';

interface RankingQuestionProps {
  question: Question;
  value: unknown;
  onChange: (value: RankingAnswer[] | GroupedRankingAnswer) => void;
}

/**
 * 표 소스 순위형에서 순위 옵션 셀 하나가 속한 입력 범위.
 * 비그룹은 범위가 하나(질문 전체), 그룹별 순위는 그룹마다 하나다.
 */
interface RankingScope {
  key: string;
  options: QuestionOption[];
  answers: RankingAnswer[];
  positions: number;
  handle: RankingClickHandle;
  /** 상세기재 검증 타깃 id 의 scope. 비그룹은 질문 id, 그룹은 `질문id:그룹키`. */
  detailTargetScopeId: string;
  /** 이월 표시 판정용 셀 id — 그룹별 순위는 그룹키로 저장돼 있다. 비그룹은 없음. */
  priorCellId: string | undefined;
}

/** 순위 옵션 셀의 라벨 노드 — 이미지가 있으면 위에, 글자는 셀 스타일대로. */
function cellLabelNode(
  cell: TableCell,
  opt: QuestionOption,
  label: string,
  attrs: Record<string, string>,
  quotes: Record<string, string>,
): ReactNode {
  return (
    <>
      {cell.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cell.imageUrl}
          alt={cell.content || cell.rankingLabel || '순위 옵션 이미지'}
          className="mb-1 h-20 w-full rounded object-cover"
        />
      )}
      <span className={getCellTextClassName(opt)} style={getCellTextStyle(opt)}>
        <CellText text={label} html={resolveCellTextHtml(cell, attrs, quotes)} />
      </span>
    </>
  );
}

/**
 * 순위형(ranking) 질문 응답 컴포넌트.
 * 입력 방식은 rankingConfig.inputMode 로 고른다 — 기본(undefined|'dropdown')은 순위마다 드롭다운,
 * 'click' 은 보기를 눌러 순위를 매긴다. 중복 순위 허용이면 클릭으로 표현할 수 없어 드롭다운이다.
 *
 * 클릭 방식:
 * - optionsSource='manual': question.options 를 보기 표로 (flat RankingAnswer[] 응답)
 * - optionsSource='table' + 비그룹: 내장 표의 ranking_opt 셀이 곧 누르는 보기 (flat 응답)
 * - optionsSource='table' + 그룹(isGroupedRankingQuestion): 그룹마다 요약 줄, 표는 하나
 *   (GroupedRankingAnswer 응답)
 */
export function RankingQuestion({ question, value, onChange }: RankingQuestionProps) {
  const config = question.rankingConfig;
  const isMobile = useMobileView();
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
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
  // grouped 경로에서는 allowOther 를 사용하지 않는다.
  // 질문 레벨 allowOtherOption synthetic 기타는 grouped 에서 비활성:
  // 어느 그룹에 붙일지 모호하기 때문. 기타는 셀 레벨(isOtherRankingCell)로만 처리되며,
  // 해당 셀이 소속된 그룹 옵션에 포함된다.
  const allowOther = question.allowOtherOption === true && !hasOtherCell;

  // 비그룹 경로: flat RankingAnswer[] 로 정규화
  const answers = useMemo(() => parseRankingAnswers(value), [value]);

  // 그룹 경로: GroupedRankingAnswer 맵으로 추출
  // legacy flat 배열(rnk1 이식 전 진행중 응답)은 맵이 아니므로 빈 상태에서 재입력 — 알려진 엣지
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

  // "순위가 다 찼습니다" 안내를 띄울 범위 키. 표 하나를 그룹 여럿이 나눠 쓰므로 훅 대신
  // 범위 키 하나로 든다. 비그룹은 질문 id.
  const [fullNoticeKey, setFullNoticeKey] = useState<string | null>(null);

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

  // ── 드롭다운(기본) — inputMode 가 'click' 이 아니거나 중복 순위 허용이면 ─────
  if (config?.inputMode !== 'click' || allowDuplicates) {
    return (
      <RankingDropdown
        question={question}
        rawOptions={rawOptions}
        answers={answers}
        groupedMap={groupedMap}
        rankingGroups={rankingGroups}
        isGrouped={isGrouped}
        positions={positions}
        requestedPositions={requestedPositions}
        allowOther={allowOther}
        hasEmbeddedTable={!!hasEmbeddedTable}
        isMobile={isMobile}
        allowDuplicates={allowDuplicates}
        onChange={onChange}
        onGroupChange={handleGroupChange}
      />
    );
  }

  // ── 수동 보기: 보기 표 자체가 입력 ────────────────────────────────────
  if (!isTableSource) {
    return (
      <div className="space-y-4">
        <RankingClickList
          answers={answers}
          options={rawOptions}
          positions={positions}
          allowOther={allowOther}
          onChange={onChange}
          columns={question.optionsColumns}
          detailTargetScopeId={question.id}
          questionId={question.id}
        />
        {positions < requestedPositions && (
          <p className="text-sm text-gray-500">
            선택지가 {rawOptions.length}개라 최대 {positions}순위까지 입력할 수 있습니다.
          </p>
        )}
      </div>
    );
  }

  // ── 표 소스: 순위 옵션 셀이 곧 누르는 보기 ─────────────────────────────
  // 비그룹은 범위 하나, 그룹별 순위는 그룹마다 범위 하나. 셀 id → 범위로 찾는다.
  const scopes: RankingScope[] = isGrouped
    ? rankingGroups.map((g) => {
        const options = resolveRankingOptionsFromCells(g.cells);
        const groupPositions = Math.min(requestedPositions, Math.max(options.length, 1));
        const groupAnswers = parseRankingAnswers(groupedMap[g.groupKey]);
        return {
          key: g.groupKey,
          options,
          answers: groupAnswers,
          positions: groupPositions,
          handle: buildRankingClickHandle({
            answers: groupAnswers,
            positions: groupPositions,
            onChange: (next) => handleGroupChange(g.groupKey, next),
            onFull: (full) => setFullNoticeKey(full ? g.groupKey : null),
          }),
          detailTargetScopeId: `${question.id}:${g.groupKey}`,
          priorCellId: g.groupKey,
        };
      })
    : [
        {
          key: question.id,
          options: rawOptions,
          answers,
          positions,
          handle: buildRankingClickHandle({
            answers,
            positions,
            onChange,
            onFull: (full) => setFullNoticeKey(full ? question.id : null),
          }),
          detailTargetScopeId: question.id,
          priorCellId: undefined,
        },
      ];
  const scopeOfCell = new Map<string, RankingScope>();
  for (const scope of scopes) {
    for (const opt of scope.options) scopeOfCell.set(opt.id, scope);
  }

  // 열 정의가 없는(표를 그릴 수 없는) 표 소스 — 셀에서 뽑은 보기를 수동 보기처럼 목록으로 그린다.
  // 그룹별 순위도 그룹마다 목록 하나씩이라 응답 모양(그룹 맵)이 그대로 유지된다.
  if (!hasEmbeddedTable) {
    return (
      <div className="space-y-6">
        {scopes.map((scope) => {
          const group = isGrouped ? rankingGroups.find((g) => g.groupKey === scope.key) : undefined;
          return (
            <div key={scope.key} className="space-y-2">
              {group && (
                <p className="text-sm font-medium text-gray-900">
                  {substituteTokens(group.label || group.groupKey, attrs, quotes)}
                </p>
              )}
              <RankingClickList
                answers={scope.answers}
                options={scope.options}
                positions={scope.positions}
                allowOther={false}
                onChange={(next) =>
                  isGrouped ? handleGroupChange(scope.key, next) : onChange(next)
                }
                columns={question.optionsColumns}
                detailTargetScopeId={scope.detailTargetScopeId}
                questionId={question.id}
                cellId={scope.priorCellId}
              />
              {scope.positions < requestedPositions && (
                <p className="text-sm text-gray-500">
                  선택지가 {scope.options.length}개라 최대 {scope.positions}순위까지 입력할 수 있습니다.
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const summaries = (
    <div className="space-y-4">
      {scopes.map((scope) => {
        const group = isGrouped ? rankingGroups.find((g) => g.groupKey === scope.key) : undefined;
        return (
          <div key={scope.key} className="space-y-2">
            {group && (
              <p className="text-sm font-medium text-gray-900">
                {substituteTokens(group.label || group.groupKey, attrs, quotes)}
              </p>
            )}
            <RankingSummaryBar
              answers={scope.answers}
              options={scope.options}
              positions={scope.positions}
              onReset={scope.handle.reset}
              questionId={question.id}
              cellId={scope.priorCellId}
            />
            {fullNoticeKey === scope.key && <RankingFullNotice positions={scope.positions} />}
            {scope.positions < requestedPositions && (
              <p className="text-sm text-gray-500">
                선택지가 {scope.options.length}개라 최대 {scope.positions}순위까지 입력할 수 있습니다.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderCell = (cell: TableCell): ReactNode => {
    if (cell.type !== 'ranking_opt' || cell.isHidden) return undefined;
    const scope = scopeOfCell.get(cell.id);
    const opt = scope?.options.find((o) => o.id === cell.id);
    if (!scope || !opt) return undefined;
    return (
      <RankingOptionFace
        bare
        option={opt}
        rank={rankOfOption(scope.answers, opt.value)}
        handle={scope.handle}
        labelNode={cellLabelNode(cell, opt, substituteTokens(opt.label, attrs, quotes), attrs, quotes)}
        questionId={question.id}
        cellId={scope.priorCellId}
      />
    );
  };

  // 순위가 매겨진 기타·상세기재 보기의 입력 줄 — 범위(그룹)마다 한 묶음, 표/카드 아래.
  const detailRows = scopes.map((scope) => (
    <RankingDetailRows
      key={`detail-${scope.key}`}
      answers={scope.answers}
      options={scope.options}
      handle={scope.handle}
      detailTargetScopeId={scope.detailTargetScopeId}
      questionId={question.id}
      cellId={scope.priorCellId}
    />
  ));

  if (isMobile) {
    return (
      <div className="space-y-4">
        {summaries}
        <div className="space-y-2">
          {(question.tableRowsData ?? []).flatMap((row) => {
            // 한 행에 순위 옵션 셀이 여럿일 수 있다(수집기가 행의 모든 셀을 보기로 친다).
            // 셀마다 카드 하나. 행의 표시 셀(text/image/video)은 첫 카드에만 붙인다.
            const optCells = row.cells.filter(
              (c: TableCell) => c.type === 'ranking_opt' && !c.isHidden,
            );
            return optCells.map((optCell, idx) => {
              const scope = scopeOfCell.get(optCell.id);
              const opt = scope?.options.find((o) => o.id === optCell.id);
              if (!scope || !opt) return null;
              const rank = rankOfOption(scope.answers, opt.value);
              const label = substituteTokens(opt.label, attrs, quotes);
              const toggle = () => scope.handle.toggle(opt.value);
              return (
                <MobileOptionCard
                  key={optCell.id}
                  label={
                    <span className={cn(getCellTextClassName(opt))} style={getCellTextStyle(opt)}>
                      <CellText text={label} html={resolveCellTextHtml(optCell, attrs, quotes)} />
                    </span>
                  }
                  cells={idx === 0 ? row.cells : []}
                  // 카드 헤더는 div 라 포커스·키보드가 없다. 배지를 진짜 버튼으로 두어
                  // 탭·키보드·aria-pressed 를 모두 여기서 받는다(control 래퍼는 전파를 막는다).
                  control={
                    <button
                      type="button"
                      aria-label={label}
                      aria-pressed={rank !== undefined}
                      onClick={toggle}
                      className="rounded focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none"
                    >
                      <RankingRankBadge rank={rank} />
                    </button>
                  }
                  selected={rank !== undefined}
                  onToggle={toggle}
                />
              );
            });
          })}
        </div>
        {/* 기타·상세기재 입력 줄은 카드 목록 아래 — 표 아래에 두는 데스크톱과 같은 자리 */}
        {detailRows}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summaries}
      <TablePreview
        {...(question.tableTitle !== undefined ? { tableTitle: question.tableTitle } : {})}
        {...(question.tableColumns !== undefined ? { columns: question.tableColumns } : {})}
        {...(question.tableRowsData !== undefined ? { rows: question.tableRowsData } : {})}
        {...(question.tableHeaderGrid ? { tableHeaderGrid: question.tableHeaderGrid } : {})}
        {...(question.hideColumnLabels !== undefined ? { hideColumnLabels: question.hideColumnLabels } : {})}
        {...(question.stickyColumnCount !== undefined ? { stickyColumnCount: question.stickyColumnCount } : {})}
        renderCell={renderCell}
      />
      {detailRows}
    </div>
  );
}

// ── 드롭다운 (기본 입력 방식) ────────────────────────────────────────────────

interface RankingDropdownProps {
  question: Question;
  rawOptions: QuestionOption[];
  answers: RankingAnswer[];
  groupedMap: Record<string, unknown>;
  rankingGroups: ReturnType<typeof collectRankingGroups>;
  isGrouped: boolean;
  positions: number;
  requestedPositions: number;
  allowOther: boolean;
  hasEmbeddedTable: boolean;
  isMobile: boolean;
  allowDuplicates: boolean;
  onChange: (value: RankingAnswer[] | GroupedRankingAnswer) => void;
  onGroupChange: (groupKey: string, next: RankingAnswer[]) => void;
}

/**
 * 순위마다 드롭다운 — 기본 입력 방식. 드롭다운 스택 위·아래에 설명(보기 목록 | 내장 표)을 둔다.
 */
function RankingDropdown({
  question,
  rawOptions,
  answers,
  groupedMap,
  rankingGroups,
  isGrouped,
  positions,
  requestedPositions,
  allowOther,
  hasEmbeddedTable,
  isMobile,
  allowDuplicates,
  onChange,
  onGroupChange,
}: RankingDropdownProps) {
  const config = question.rankingConfig;
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();

  const embeddedTable = hasEmbeddedTable ? (
    isMobile ? (
      <div className="space-y-2">
        {(question.tableRowsData ?? []).flatMap((row) => {
          // 한 행에 순위 옵션 셀이 여럿일 수 있다(항목 열이 둘인 표). 셀마다 카드 하나,
          // 행의 표시 셀(분류 라벨 등)은 첫 카드에만 붙인다. 첫 셀만 그리면 오른쪽 열이 통째로 빠진다.
          const optCells = row.cells.filter(
            (c: TableCell) => c.type === 'ranking_opt' && !c.isHidden,
          );
          return optCells.map((optCell, idx) => {
            const opt = rawOptions.find((o) => o.id === optCell.id);
            const rawLabel = opt?.label ?? optCell.content ?? optCell.rankingLabel ?? '(라벨 없음)';
            return (
              <MobileOptionCard
                key={optCell.id}
                label={
                  <span
                    className={getCellTextClassName(opt ?? optCell)}
                    style={getCellTextStyle(opt ?? optCell)}
                  >
                    <CellText
                      text={substituteTokens(rawLabel, attrs, quotes)}
                      html={resolveCellTextHtml(optCell, attrs, quotes)}
                    />
                  </span>
                }
                cells={idx === 0 ? row.cells : []}
              />
            );
          });
        })}
      </div>
    ) : (
      <TablePreview
        {...(question.tableTitle !== undefined ? { tableTitle: question.tableTitle } : {})}
        {...(question.tableColumns !== undefined ? { columns: question.tableColumns } : {})}
        {...(question.tableRowsData !== undefined ? { rows: question.tableRowsData } : {})}
        {...(question.tableHeaderGrid ? { tableHeaderGrid: question.tableHeaderGrid } : {})}
        {...(question.hideColumnLabels !== undefined ? { hideColumnLabels: question.hideColumnLabels } : {})}
        {...(question.stickyColumnCount !== undefined ? { stickyColumnCount: question.stickyColumnCount } : {})}
      />
    )
  ) : null;

  if (isGrouped) {
    return (
      <div className="space-y-6">
        {rankingGroups.map((g) => {
          const groupOptions = resolveRankingOptionsFromCells(g.cells);
          const groupPositions = Math.min(requestedPositions, Math.max(groupOptions.length, 1));
          const groupAnswers = parseRankingAnswers(groupedMap[g.groupKey]);
          return (
            <div key={g.groupKey} className="space-y-2">
              <p className="text-sm font-medium text-gray-900">
                {substituteTokens(g.label || g.groupKey, attrs, quotes)}
              </p>
              <RankingDropdownStack
                answers={groupAnswers}
                options={groupOptions}
                positions={groupPositions}
                allowDuplicates={allowDuplicates}
                allowOther={false}
                onChange={(next) => onGroupChange(g.groupKey, next)}
                columns={config?.positionsColumns}
                detailTargetScopeId={`${question.id}:${g.groupKey}`}
                questionId={question.id}
                cellId={g.groupKey}
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

  return (
    <div className="space-y-4">
      <RankingDropdownStack
        answers={answers}
        options={rawOptions}
        positions={positions}
        allowDuplicates={allowDuplicates}
        allowOther={allowOther}
        onChange={onChange}
        columns={config?.positionsColumns}
        detailTargetScopeId={question.id}
        questionId={question.id}
      />
      {positions < requestedPositions && (
        <p className="text-sm text-gray-500">
          선택지가 {rawOptions.length}개라 최대 {positions}순위까지 입력할 수 있습니다.
        </p>
      )}
      {embeddedTable ?? (
        <div className="rounded-md border border-gray-200 bg-gray-50/50 p-3 text-sm">
          {rawOptions.map((opt) => (
            <div key={opt.id} className="whitespace-pre-wrap text-gray-800 [overflow-wrap:anywhere]">
              {substituteTokens(opt.label, attrs, quotes)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
