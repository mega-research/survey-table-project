'use client';

import React from 'react';

import { ListOrdered, Settings, Table as TableIcon } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Question, RankingConfig } from '@/types/survey';
import { collectRankingOptCells } from '@/utils/ranking-source';

import { OptionsLayoutSelector } from './options-layout-selector';

const MIN_POSITIONS = 1;
const DEFAULT_POSITIONS = 3;

interface RankingConfigEditorProps {
  value: RankingConfig | undefined;
  onChange: (next: RankingConfig) => void;
  /** 수동 옵션(options) 개수 — positions 초과 경고용 */
  optionsCount?: number;
  /** 자체 tableRowsData 의 ranking_opt 셀 개수 — optionsSource='table' 일 때 positions 초과 경고용 */
  tableOptionsCount?: number;
  /** true 면 optionsSource 토글과 인터랙션 모드, branchRank 블록 노출 (질문 레벨에서만). 기본 false (셀 레벨은 비노출). */
  showQuestionLevelOptions?: boolean;
}

/**
 * 순위형(ranking) 설정 에디터.
 * - positions: 매길 순위 개수 (1~10)
 * - allowDuplicateRanks / requireAllPositions
 * - 질문 레벨 전용: optionsSource 토글, interactionMode, branchRankPosition
 * - 셀 레벨(ranking 셀) 용도에서는 showQuestionLevelOptions=false
 */
export function RankingConfigEditor({
  value,
  onChange,
  optionsCount = 0,
  tableOptionsCount = 0,
  showQuestionLevelOptions = false,
}: RankingConfigEditorProps) {
  const config: RankingConfig = value ?? { positions: DEFAULT_POSITIONS };
  const isTableSource = config.optionsSource === 'table';
  const effectiveOptionsCount = isTableSource ? tableOptionsCount : optionsCount;
  const exceedsOptions = !config.allowDuplicateRanks && config.positions > effectiveOptionsCount;

  const updateConfig = (patch: Partial<RankingConfig>) => {
    onChange({ ...config, ...patch });
  };

  const handlePositionsChange = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.max(parsed, MIN_POSITIONS);
    const patch: Partial<RankingConfig> = { positions: clamped };
    if (config.branchRankPosition !== undefined && config.branchRankPosition > clamped) {
      patch.branchRankPosition = clamped;
    }
    updateConfig(patch);
  };

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
      <Label className="flex items-center space-x-2">
        <ListOrdered className="h-4 w-4" />
        <span>순위형 설정</span>
      </Label>

      {/* 질문 레벨 옵션 소스 토글 — 이 질문 내부에 설명 테이블 사용 여부 */}
      {showQuestionLevelOptions && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between gap-4">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <TableIcon className="h-4 w-4" />
              질문 내장 테이블 사용
            </Label>
            <Switch
              checked={isTableSource}
              onCheckedChange={(v) =>
                updateConfig({ optionsSource: v ? 'table' : 'manual' })
              }
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="ranking-positions" className="text-sm font-medium">
          매길 순위 개수
        </Label>
        <Input
          id="ranking-positions"
          type="number"
          min={MIN_POSITIONS}
          value={config.positions}
          onChange={(e) => handlePositionsChange(e.target.value)}
          className="w-32"
        />
        {exceedsOptions && (
          <p className="text-sm text-amber-600">
            순위 개수({config.positions})가 선택지 개수({effectiveOptionsCount})보다 많습니다. 중복 허용이
            꺼져 있으면 응답 시 자동으로 {effectiveOptionsCount}순위까지만 표시됩니다.
          </p>
        )}
      </div>

      {config.positions >= 2 && (
        <OptionsLayoutSelector
          value={config.positionsColumns}
          onChange={(next) => updateConfig({ positionsColumns: next })}
          label="순위 드롭다운 배치:"
        />
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label className="flex items-center gap-2 text-sm font-medium">
            <Settings className="h-4 w-4" />
            중복 선택 허용
          </Label>
          <p className="text-xs text-gray-500">
            OFF: 같은 선택지를 여러 순위에 선택 불가 (일반적인 순위형 관행)
          </p>
        </div>
        <Switch
          checked={config.allowDuplicateRanks === true}
          onCheckedChange={(v) => updateConfig({ allowDuplicateRanks: v })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">모든 순위 입력 필수</Label>
          <p className="text-xs text-gray-500">
            ON: 1~{config.positions}순위 전체를 선택해야 제출 가능. OFF: 1순위만 필수(필수 응답 체크
            시).
          </p>
        </div>
        <Switch
          checked={config.requireAllPositions === true}
          onCheckedChange={(v) => updateConfig({ requireAllPositions: v })}
        />
      </div>

      {/* 조건부 분기 판정 순위 (수동 옵션에서만 의미 있음 — 테이블 옵션은 cell.id 가 value 라 기존 branchRule 매칭 불가) */}
      {showQuestionLevelOptions && !isTableSource && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
          <Label htmlFor="branch-rank-position" className="text-sm font-medium">
            조건부 분기 판정 순위
          </Label>
          <Input
            id="branch-rank-position"
            type="number"
            min={MIN_POSITIONS}
            max={config.positions}
            value={config.branchRankPosition ?? 1}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isNaN(v)) return;
              const clamped = Math.min(Math.max(v, 1), config.positions);
              updateConfig({ branchRankPosition: clamped });
            }}
            className="w-24"
          />
          <p className="text-xs text-gray-500">
            응답자가 이 순위로 선택한 옵션에 설정된 분기 규칙을 평가합니다. 각 옵션의 분기 규칙은
            위 &quot;선택 옵션&quot; 섹션에서 &quot;조건부 분기&quot; 토글을 켜고 설정하세요.
          </p>
        </div>
      )}

    </div>
  );
}

interface RankingConfigEditorForQuestionProps {
  formData: Partial<Question>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Question>>>;
}

/** 질문 레벨 어댑터 — 자체 tableRowsData 내 ranking_opt 셀 개수를 실시간 계산. */
export function RankingConfigEditorForQuestion({
  formData,
  setFormData,
}: RankingConfigEditorForQuestionProps) {
  const tableOptionsCount = React.useMemo(
    () => collectRankingOptCells(formData.tableRowsData).length,
    [formData.tableRowsData],
  );

  return (
    <RankingConfigEditor
      value={formData.rankingConfig}
      onChange={(next) => setFormData((prev) => ({ ...prev, rankingConfig: next }))}
      optionsCount={formData.options?.length ?? 0}
      tableOptionsCount={tableOptionsCount}
      showQuestionLevelOptions
    />
  );
}
