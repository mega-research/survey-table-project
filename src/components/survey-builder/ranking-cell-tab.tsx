'use client';

import { ListOrdered } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { QuestionOption, RankingConfig } from '@/types/survey';
import { buildRankVarName } from '@/utils/table-cell-code-generator';

import { RankingConfigEditor } from './ranking-config-editor';
import { RankingOptionsEditor } from './ranking-options-editor';

interface RankingCellTabProps {
  cellCode: string;
  rankingOptions: QuestionOption[];
  onRankingOptionsChange: (opts: QuestionOption[]) => void;
  rankingConfig: RankingConfig | undefined;
  onRankingConfigChange: (cfg: RankingConfig) => void;
  allowOtherOption: boolean;
  onAllowOtherOptionChange: (v: boolean) => void;
  rankSuffixPattern: string;
  onRankSuffixPatternChange: (v: string) => void;
  rankVarNames: string[];
  onRankVarNamesChange: (v: string[]) => void;
}

/**
 * cell-content-modal 의 '순위형' (Case 3) 탭 내용.
 * 옵션 에디터 + 랭킹 설정 + 기타 토글 + SPSS 접미사/순위별 변수명 오버라이드.
 */
export function RankingCellTab({
  cellCode,
  rankingOptions,
  onRankingOptionsChange,
  rankingConfig,
  onRankingConfigChange,
  allowOtherOption,
  onAllowOtherOptionChange,
  rankSuffixPattern,
  onRankSuffixPatternChange,
  rankVarNames,
  onRankVarNamesChange,
}: RankingCellTabProps) {
  const positions = Math.max(1, rankingConfig?.positions ?? 3);
  const baseVar = cellCode || 'Q1_r1_c1';

  // 각 순위의 최종 변수명(오버라이드 > 자동) 계산 — 중복 감지용
  const finalNames = Array.from({ length: positions }, (_, i) => {
    const k = i + 1;
    const override = (rankVarNames[i] ?? '').trim();
    return override.length > 0 ? override : buildRankVarName(baseVar, rankSuffixPattern, k);
  });
  const countMap = finalNames.reduce<Record<string, number>>((acc, n) => {
    const key = n.toLowerCase();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-start gap-2">
          <ListOrdered className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-900">순위형 셀 (Case 3)</p>
            <p className="mt-1 text-xs text-blue-700">
              셀 내부에 자체 옵션 리스트와 순위 설정을 가진 독립 랭킹 입력입니다. 응답은{' '}
              <code className="rounded bg-white px-1">_rk1, _rk2, ...</code> 변수로 내보내기됩니다.
            </p>
          </div>
        </div>
      </div>

      <RankingOptionsEditor options={rankingOptions} onChange={onRankingOptionsChange} />

      <div className="flex items-center justify-between gap-4 rounded-md border border-gray-200 p-3">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">기타 옵션 허용</Label>
          <p className="text-xs text-gray-500">
            ON: 순위 드롭다운에 &quot;기타 (직접 입력)&quot; 옵션과 텍스트 필드가 표시됩니다.
          </p>
        </div>
        <Switch checked={allowOtherOption} onCheckedChange={onAllowOtherOptionChange} />
      </div>

      <RankingConfigEditor
        value={rankingConfig}
        onChange={onRankingConfigChange}
        optionsCount={rankingOptions.length}
      />

      {/* SPSS 변수명 설정 */}
      <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
        <div className="space-y-2">
          <Label htmlFor="rank-suffix-pattern" className="text-sm font-medium">
            자동 변수명 접미사 패턴 (선택)
          </Label>
          <Input
            id="rank-suffix-pattern"
            value={rankSuffixPattern}
            onChange={(e) => onRankSuffixPatternChange(e.target.value)}
            placeholder="_rk{k}"
            className="font-mono text-sm"
          />
          <p className="text-xs text-gray-500">
            <code className="rounded bg-white px-1">{'{k}'}</code> 는 순위 번호(1, 2, 3…)로 치환.
            비워두면 기본값 <code className="rounded bg-white px-1">_rk{'{k}'}</code> 사용 (SPSS는
            대소문자 미구분이라 소문자 사용). 아래에서 각 순위를 직접 입력하면 패턴을 덮어씁니다.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">순위별 SPSS 변수명 (직접 입력)</Label>
          <p className="text-xs text-gray-500">
            SPSS 변수명은 대소문자를 구분하지 않습니다. 각 순위의 변수명을 비워두면 위 패턴으로 자동
            생성됩니다. 한글/공백/하이픈은 저장 시 자동으로 언더스코어로 치환됩니다.
          </p>
          <div className="space-y-1.5">
            {Array.from({ length: positions }, (_, i) => i + 1).map((rank) => {
              const auto = buildRankVarName(baseVar, rankSuffixPattern, rank);
              const override = rankVarNames[rank - 1] ?? '';
              const finalName = finalNames[rank - 1];
              const isDup = countMap[finalName.toLowerCase()] > 1;
              return (
                <div key={rank} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-xs font-medium text-gray-600">
                      {rank}순위
                    </span>
                    <Input
                      value={override}
                      onChange={(e) => {
                        const next = [...rankVarNames];
                        while (next.length < rank) next.push('');
                        next[rank - 1] = e.target.value;
                        onRankVarNamesChange(next);
                      }}
                      placeholder={auto}
                      className={`font-mono text-sm ${
                        isDup ? 'border-red-400 focus-visible:ring-red-400' : ''
                      }`}
                    />
                  </div>
                  {isDup && (
                    <p className="ml-14 text-xs text-red-600">
                      ⚠ 다른 순위와 변수명이 같습니다 (
                      <code className="rounded bg-white px-1">{finalName}</code>). SPSS 에서
                      충돌합니다.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {rankVarNames.some((n) => n.trim().length > 0) && (
            <button
              type="button"
              onClick={() => onRankVarNamesChange([])}
              className="text-xs text-blue-600 hover:underline"
            >
              모두 비우기 (자동 생성으로 복원)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
