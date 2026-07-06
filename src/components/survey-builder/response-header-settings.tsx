'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

import { Trash2 } from 'lucide-react';

import { CellImageEditor } from '@/components/survey-builder/cell-image-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  applyResponseHeaderPreset,
  coerceBlocksForInlineLayout,
  createHeaderBlock,
  normalizeResponseHeaderConfig,
  noticeFormatPatch,
  responseHeaderButtonClass,
} from '@/lib/survey/response-header-config';
import type {
  NormalizedHeaderImageBlock,
  NormalizedHeaderNoticeBlock,
  NormalizedResponseHeaderBlock,
  NormalizedResponseHeaderConfig,
  ResponseHeaderPresetKey,
} from '@/lib/survey/response-header-config';
import { cn } from '@/lib/utils';
import type {
  ResponseHeaderBlockPos,
  ResponseHeaderBlockSize,
  ResponseHeaderLayout,
  ResponseHeaderTitleAlign,
  ResponseHeaderVAlign,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';
import type { SurveySettings } from '@/types/survey';

interface ResponseHeaderSettingsProps {
  title: string; // 설문 제목 (단일 소스)
  onTitleChange: (title: string) => void; // 모달이 updateSurveyTitle 연결
  settings: SurveySettings;
  onChange: (config: SurveyResponseHeaderConfig) => void; // 항상 composed 방출
}

// 블록 패치 — 타입별 필드를 전부 optional 로 합쳐 patchBlock 이 어떤 블록 타입이든
// 부분 갱신 객체를 받을 수 있게 한다 (Partial<유니언> 은 공통 키로만 좁혀져 사용 불가).
// discriminant(type)는 마크/로고('mark'|'logo')와 문구('notice')가 서로 겹치지 않아
// 교집합 자체가 성립하지 않으므로 패치 대상에서 제외한다 (블록 타입은 애초에 패치 불필요).
type BlockPatch = Partial<Omit<NormalizedHeaderImageBlock, 'type'>> & Partial<Omit<NormalizedHeaderNoticeBlock, 'type'>>;

const PRESET_OPTIONS: Array<{ key: ResponseHeaderPresetKey; label: string }> = [
  { key: 'gov', label: '국가통계형' },
  { key: 'band', label: '컬러 밴드형' },
  { key: 'title', label: '타이틀 중심형' },
];

const BAND_COLORS = ['#f0f0f0', '#ffffff', '#cfe0ad', '#dbe7f5', '#fbe9c8', '#ecdff0'];

const ALIGN_OPTIONS: Array<[ResponseHeaderTitleAlign, string]> = [
  ['left', '왼쪽'],
  ['center', '중앙'],
  ['right', '오른쪽'],
];

const VALIGN_OPTIONS: Array<[ResponseHeaderVAlign, string]> = [
  ['top', '위'],
  ['center', '중앙'],
  ['bottom', '아래'],
];

const SIZE_OPTIONS: Array<[ResponseHeaderBlockSize, string]> = [
  ['sm', '작게'],
  ['md', '보통'],
  ['lg', '크게'],
];

export function ResponseHeaderSettings({ title, onTitleChange, settings, onChange }: ResponseHeaderSettingsProps) {
  const config = normalizeResponseHeaderConfig(settings.responseHeader);

  const patch = (p: Partial<NormalizedResponseHeaderConfig>) => onChange({ ...config, ...p });
  const patchBlock = (id: string, p: BlockPatch) =>
    patch({ blocks: config.blocks.map((b) => (b.id === id ? ({ ...b, ...p } as NormalizedResponseHeaderBlock) : b)) });
  const removeBlock = (id: string) => patch({ blocks: config.blocks.filter((b) => b.id !== id) });
  const addBlock = (type: 'mark' | 'logo' | 'notice') => patch({ blocks: [...config.blocks, createHeaderBlock(type)] });
  const setLayout = (layout: ResponseHeaderLayout) =>
    patch(layout === 'inline' ? { layout, blocks: coerceBlocksForInlineLayout(config.blocks) } : { layout });
  const applyPreset = (key: ResponseHeaderPresetKey) => onChange(applyResponseHeaderPreset(key, config));

  return (
    <div className="space-y-6">
      {/* 1. 프리셋 */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-600">프리셋</Label>
        <div className="grid grid-cols-2 gap-2">
          {PRESET_OPTIONS.map(({ key, label }) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="sm"
              aria-label={`프리셋 ${label}`}
              className={cn(responseHeaderButtonClass(false), 'h-auto flex-col items-stretch gap-2 py-3')}
              onClick={() => applyPreset(key)}
            >
              <PresetThumbnail preset={key} />
              <span>{label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* 2. 구성 요소 */}
      <div className="space-y-3 border-t border-gray-200 pt-4">
        <Label className="text-xs text-gray-600">구성 요소</Label>
        {config.blocks.length === 0 && (
          <p className="text-xs text-gray-400">추가된 블록이 없습니다. 아래에서 블록을 추가하세요.</p>
        )}
        {config.blocks.map((block) => (
          <BlockCard
            key={block.id}
            block={block}
            layout={config.layout}
            onPatch={(p) => patchBlock(block.id, p)}
            onRemove={() => removeBlock(block.id)}
          />
        ))}

        {/* 3. 추가 버튼 행 */}
        <div className="grid grid-cols-3 gap-2">
          <Button type="button" variant="outline" size="sm" className="border-dashed" onClick={() => addBlock('logo')}>
            + 로고
          </Button>
          <Button type="button" variant="outline" size="sm" className="border-dashed" onClick={() => addBlock('mark')}>
            + 국가통계
          </Button>
          <Button type="button" variant="outline" size="sm" className="border-dashed" onClick={() => addBlock('notice')}>
            + OO법 문구
          </Button>
        </div>
      </div>

      {/* 4. 배치 */}
      <div className="space-y-3 border-t border-gray-200 pt-4">
        <PresetButtonGroup
          label="배치"
          value={config.layout}
          options={[
            ['stacked', '제목 위 배치'],
            ['inline', '제목 옆 배치'],
          ]}
          columns={2}
          onChange={setLayout}
        />
        {config.layout === 'stacked' && (
          <>
            <PresetButtonGroup
              label="로고 정렬"
              value={config.vAlignLogo}
              options={VALIGN_OPTIONS}
              columns={3}
              onChange={(vAlignLogo) => patch({ vAlignLogo })}
            />
            <PresetButtonGroup
              label="문구 정렬"
              value={config.vAlignNotice}
              options={VALIGN_OPTIONS}
              columns={3}
              onChange={(vAlignNotice) => patch({ vAlignNotice })}
            />
          </>
        )}
      </div>

      {/* 5. 제목 */}
      <div className="space-y-3 border-t border-gray-200 pt-4">
        <div className="space-y-2">
          <Label htmlFor="header-title" className="text-xs text-gray-600">
            제목
          </Label>
          <Input id="header-title" value={title} onChange={(e) => onTitleChange(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="header-subtitle" className="text-xs text-gray-600">
            부제목
          </Label>
          <Input
            id="header-subtitle"
            value={config.subtitle}
            placeholder="부제목 (비우면 숨김)"
            onChange={(e) => patch({ subtitle: e.target.value })}
          />
        </div>
        <PresetButtonGroup
          label="위치"
          value={config.titleAlign}
          options={ALIGN_OPTIONS}
          columns={3}
          onChange={(titleAlign) => patch({ titleAlign })}
        />
        <PresetButtonGroup
          label="텍스트 정렬"
          value={config.titleTextAlign}
          options={ALIGN_OPTIONS}
          columns={3}
          onChange={(titleTextAlign) => patch({ titleTextAlign })}
        />
        <PresetButtonGroup
          label="세로 위치"
          value={config.titleVAlign}
          options={VALIGN_OPTIONS}
          columns={3}
          onChange={(titleVAlign) => patch({ titleVAlign })}
        />
        <PresetButtonGroup
          label="크기"
          value={config.titlePx !== null ? null : config.titleScale}
          options={SIZE_OPTIONS}
          columns={3}
          onChange={(titleScale) => patch({ titleScale, titlePx: null })}
        />
        <div className="space-y-2">
          <Label htmlFor="header-title-px" className="text-xs text-gray-600">
            제목 크기 직접 지정 (px)
          </Label>
          <div className="flex items-center gap-2">
            <ClampedNumberInput
              id="header-title-px"
              min={14}
              max={72}
              value={config.titlePx}
              onCommit={(titlePx) => patch({ titlePx })}
              className="w-24"
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => patch({ titlePx: null })}>
              자동
            </Button>
          </div>
        </div>
      </div>

      {/* 6. 제목 밴드 */}
      <div className="space-y-3 border-t border-gray-200 pt-4">
        <PresetButtonGroup
          label="제목 밴드 스타일"
          value={config.bandStyle}
          options={[
            ['band', '상하 괘선'],
            ['boxed', '테두리 박스'],
            ['rule', '밑줄만'],
            ['plain', '없음'],
          ]}
          columns={2}
          onChange={(bandStyle) => patch({ bandStyle })}
        />
        <div className="space-y-2">
          <Label className="text-xs text-gray-600">밴드 배경</Label>
          <div className="flex flex-wrap items-center gap-2">
            {BAND_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`밴드 배경 ${color}`}
                aria-pressed={config.bandBg === color}
                className={cn(
                  'h-8 w-8 rounded-full border border-gray-300',
                  config.bandBg === color && 'ring-2 ring-offset-1 ring-blue-500',
                )}
                style={{ backgroundColor: color }}
                onClick={() => patch({ bandBg: color })}
              />
            ))}
            <input
              type="color"
              value={config.bandBg}
              onChange={(e) => patch({ bandBg: e.target.value })}
              aria-label="밴드 배경 직접 선택"
              className="h-8 w-10 cursor-pointer rounded border border-gray-200"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetThumbnail({ preset }: { preset: ResponseHeaderPresetKey }) {
  // 목업 참고 미니 스키매틱 — 단순 div 조합 (과한 장식 없이 형태만 암시)
  if (preset === 'gov') {
    return (
      <div className="flex h-10 w-full flex-col justify-between border-t-2 border-b-2 border-gray-400 bg-gray-50 px-2 py-1">
        <div className="h-1 w-8 rounded-full bg-gray-300" />
        <div className="mx-auto h-1.5 w-12 rounded-full bg-gray-500" />
      </div>
    );
  }
  if (preset === 'band') {
    return (
      <div className="flex h-10 w-full divide-x divide-gray-400 border border-gray-400 bg-gray-50">
        <div className="w-4 bg-gray-300" />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-1.5 w-10 rounded-full bg-gray-500" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-10 w-full flex-col justify-center gap-1 bg-gray-50 px-2">
      <div className="h-1.5 w-14 rounded-full bg-gray-500" />
      <div className="h-1.5 w-9 rounded-full bg-gray-300" />
    </div>
  );
}

function blockName(block: NormalizedResponseHeaderBlock): string {
  // 'notice' 를 먼저 양성 판별해야 나머지 분기에서 image 유니언 멤버가 확실히 배제된다
  // (mark|logo 처럼 판별값이 리터럴 유니언인 멤버는 순차 소거만으로는 좁혀지지 않는다).
  if (block.type === 'notice') {
    const prefix = block.title.slice(0, 20);
    return prefix || '문구';
  }
  if (block.type === 'mark') return '국가통계 마크';
  return `로고 · ${block.altText || '자리표시자'}`;
}

function BlockCard({
  block,
  layout,
  onPatch,
  onRemove,
}: {
  block: NormalizedResponseHeaderBlock;
  layout: ResponseHeaderLayout;
  onPatch: (p: BlockPatch) => void;
  onRemove: () => void;
}) {
  const isLineNotice = block.type === 'notice' && block.format === 'line';
  const posOptions: Array<[ResponseHeaderBlockPos, string]> = isLineNotice
    ? [
        ['above', '제목 위'],
        ['below', '제목 아래'],
      ]
    : layout === 'inline'
      ? [
          ['left', '좌'],
          ['right', '우'],
        ]
      : [
          ['left', '좌'],
          ['center', '중'],
          ['right', '우'],
          ['title-left', '제목 좌'],
          ['title-right', '제목 우'],
        ];
  const posColumns = isLineNotice || layout === 'inline' ? 2 : 5;

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-gray-700">{blockName(block)}</span>
        <Button type="button" variant="ghost" size="sm" aria-label={`${blockName(block)} 삭제`} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <PresetButtonGroup label="위치" value={block.pos} options={posOptions} columns={posColumns} onChange={(pos) => onPatch({ pos })} />
      <PresetButtonGroup label="크기" value={block.size} options={SIZE_OPTIONS} columns={3} onChange={(size) => onPatch({ size })} />

      {(block.type === 'mark' || block.type === 'logo') && (
        <>
          <PresetButtonGroup
            label="이미지 선"
            value={block.frame}
            options={[
              ['none', '없음'],
              ['line', '테두리'],
              ['wrap', '컨테이너'],
            ]}
            columns={3}
            onChange={(frame) => onPatch({ frame })}
          />
          <div className="space-y-2">
            <Label className="text-xs text-gray-600">이미지</Label>
            <CellImageEditor imageUrl={block.imageUrl} onImageUrlChange={(imageUrl) => onPatch({ imageUrl })} />
          </div>
        </>
      )}

      {block.type === 'notice' && (
        <>
          <PresetButtonGroup
            label="형식"
            value={block.format}
            options={[
              ['box', '박스형'],
              ['line', '한줄형'],
            ]}
            columns={2}
            onChange={(format) => onPatch(noticeFormatPatch(block, format))}
          />
          <PresetButtonGroup
            label="텍스트 정렬"
            value={block.format === 'box' ? block.alignBox : block.alignLine}
            options={ALIGN_OPTIONS}
            columns={3}
            onChange={(align) => onPatch(block.format === 'box' ? { alignBox: align } : { alignLine: align })}
          />
          <div className="space-y-2">
            <Label htmlFor={`header-notice-title-${block.id}`} className="text-xs text-gray-600">
              문구 제목
            </Label>
            <Input
              id={`header-notice-title-${block.id}`}
              value={block.title}
              onChange={(e) => onPatch({ title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`header-notice-box-${block.id}`} className="text-xs text-gray-600">
              박스형 문구
            </Label>
            <Textarea
              id={`header-notice-box-${block.id}`}
              rows={3}
              value={block.boxBody}
              onChange={(e) => onPatch({ boxBody: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`header-notice-line-${block.id}`} className="text-xs text-gray-600">
              한줄형 문구 (모바일 전환 시 사용)
            </Label>
            <Textarea
              id={`header-notice-line-${block.id}`}
              rows={2}
              value={block.lineBody}
              onChange={(e) => onPatch({ lineBody: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`header-notice-font-size-${block.id}`} className="text-xs text-gray-600">
              글자 크기
            </Label>
            <div className="flex items-center gap-2">
              <ClampedNumberInput
                id={`header-notice-font-size-${block.id}`}
                min={9}
                max={28}
                step={0.5}
                value={block.fontSize}
                onCommit={(fontSize) => onPatch({ fontSize })}
                className="w-24"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => onPatch({ fontSize: null })}>
                자동
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// 클램프가 필요한 숫자 입력(제목 크기 직접 지정 / 문구 글자 크기) 전용 — keystroke마다
// store에 commit하면 normalize 클램프가 즉시 되돌아와("3" 입력 즉시 14로 강제 등) 다자리
// 값을 타이핑으로 완성할 수 없다. 로컬 draft로 타이핑을 받고 blur/Enter에서만 파싱·클램프해
// commit한다. 외부에서 값이 바뀌면(자동 버튼, 프리셋 적용 등) draft를 재동기화하되, 포커스
// 중에는 덮어쓰지 않는다(패널 내 여러 인스턴스가 각자 로컬 state로 격리되어 서로 간섭하지 않음).
type ClampedNumberInputProps = {
  id?: string;
  value: number | null;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number | null) => void;
  className?: string;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'value' | 'min' | 'max' | 'step' | 'className' | 'type' | 'onChange' | 'onBlur' | 'onKeyDown'
>;

function ClampedNumberInput({
  id,
  value,
  min,
  max,
  step,
  onCommit,
  className,
  ...aria
}: ClampedNumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value === null ? '' : String(value));

  // document.activeElement(외부 시스템인 브라우저 포커스 상태)를 읽어야만 "타이핑 중" 여부를
  // 판단할 수 있어 effect가 필요하다 — 포커스 중엔 외부 value 변경으로 draft를 덮어쓰지 않는다.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(value === null ? '' : String(value));
    }
  }, [value]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const commit = () => {
    if (draft === '') {
      onCommit(null);
      return;
    }
    const parsed = Number(draft);
    if (Number.isNaN(parsed)) {
      setDraft(value === null ? '' : String(value)); // 파싱 불가 시 마지막 commit 값으로 되돌림
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    onCommit(clamped);
  };

  return (
    <Input
      ref={inputRef}
      id={id}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
      className={className}
      {...aria}
    />
  );
}

function PresetButtonGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 3,
}: {
  label: string;
  value: T | null;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  columns?: number;
}) {
  const grid = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }[columns] ?? 'grid-cols-3';
  return (
    <div className="space-y-2">
      <Label className="text-xs text-gray-600">{label}</Label>
      <div className={`grid ${grid} gap-2`}>
        {options.map(([optionValue, optionLabel]) => (
          <Button
            key={optionValue}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={value === optionValue}
            className={responseHeaderButtonClass(value === optionValue)}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </Button>
        ))}
      </div>
    </div>
  );
}
