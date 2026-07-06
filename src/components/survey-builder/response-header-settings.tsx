'use client';

import { ChevronDown, ImageIcon } from 'lucide-react';

import { CellImageEditor } from '@/components/survey-builder/cell-image-editor';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DEFAULT_STATISTIC_NOTICE,
  normalizeResponseHeaderConfig,
  responseHeaderButtonClass,
} from '@/lib/survey/response-header-config';
import type {
  ResponseHeaderLogoAlign,
  ResponseHeaderTitleAlign,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';
import type { SurveySettings } from '@/types/survey';

interface ResponseHeaderSettingsProps {
  settings: SurveySettings;
  onChange: (config: SurveyResponseHeaderConfig) => void;
}

export function ResponseHeaderSettings({ settings, onChange }: ResponseHeaderSettingsProps) {
  const normalized = normalizeResponseHeaderConfig(settings.responseHeader);
  // composed(v2) 설정 UI 는 후속 태스크에서 도입 — 그때까지 v1 기본형으로 폴백한다 (과도기 심)
  const config = normalized.style === 'composed'
    ? ({ style: 'plain', titleSize: 'auto', titleAlign: 'left' } as const)
    : normalized;

  const setPlain = () =>
    onChange({ style: 'plain', titleSize: config.titleSize ?? 'auto', titleAlign: config.titleAlign ?? 'left' });
  const setLogoTitle = () =>
    onChange({
      style: 'logo-title',
      titleSize: config.titleSize ?? 'auto',
      titleAlign: config.titleAlign ?? 'center',
      logo: {
        imageUrl: config.style === 'plain' ? '' : config.logo.imageUrl,
        altText: config.style === 'plain' ? '' : config.logo.altText ?? '',
        size: config.style === 'plain' ? 'md' : config.logo.size ?? 'md',
      },
      logoTitle: {
        logoPosition:
          config.style === 'logo-title' ? config.logoTitle?.logoPosition ?? 'left' : 'left',
      },
    });
  const setOfficialBand = () =>
    onChange({
      style: 'official-band',
      titleSize: config.titleSize ?? 'auto',
      titleAlign: config.titleAlign ?? 'center',
      logo: {
        imageUrl: config.style === 'plain' ? '' : config.logo.imageUrl,
        altText: config.style === 'plain' ? '' : config.logo.altText ?? '',
        size: config.style === 'plain' ? 'md' : config.logo.size ?? 'md',
      },
      officialBand: {
        arrangement:
          config.style === 'official-band'
            ? config.officialBand?.arrangement ?? 'stat-left-logo-right'
            : 'stat-left-logo-right',
        logoAlign:
          config.style === 'official-band' ? config.officialBand?.logoAlign ?? 'top' : 'top',
        statisticNotice:
          config.style === 'official-band'
            ? {
                title:
                  config.officialBand?.statisticNotice?.title ?? DEFAULT_STATISTIC_NOTICE.title,
                body: config.officialBand?.statisticNotice?.body ?? DEFAULT_STATISTIC_NOTICE.body,
                width: config.officialBand?.statisticNotice?.width ?? 'md',
              }
            : {
                ...DEFAULT_STATISTIC_NOTICE,
                width: 'md',
              },
      },
    });

  const updateLogoUrl = (imageUrl: string) => {
    if (config.style === 'plain') return;
    onChange({
      ...config,
      logo: {
        ...config.logo,
        imageUrl,
      },
    });
  };

  const updateLogoPosition = (logoPosition: 'left' | 'right') => {
    if (config.style !== 'logo-title') return;
    onChange({
      ...config,
      logoTitle: { logoPosition },
    });
  };

  const updateArrangement = (
    arrangement: 'stat-left-logo-right' | 'logo-left-stat-right',
  ) => {
    if (config.style !== 'official-band') return;
    onChange({
      ...config,
      officialBand: {
        ...config.officialBand,
        arrangement,
      },
    });
  };

  const updateStatisticNotice = (field: 'title' | 'body', value: string) => {
    if (config.style !== 'official-band') return;
    onChange({
      ...config,
      officialBand: {
        ...config.officialBand,
        statisticNotice: {
          title: config.officialBand?.statisticNotice?.title ?? DEFAULT_STATISTIC_NOTICE.title,
          body: config.officialBand?.statisticNotice?.body ?? DEFAULT_STATISTIC_NOTICE.body,
          width: config.officialBand?.statisticNotice?.width ?? 'md',
          [field]: value,
        },
      },
    });
  };

  const updateLogoSize = (size: 'sm' | 'md' | 'lg') => {
    if (config.style === 'plain') return;
    onChange({
      ...config,
      logo: {
        ...config.logo,
        size,
      },
    });
  };

  const updateTitleSize = (titleSize: 'auto' | 'md' | 'lg') => {
    onChange({
      ...config,
      titleSize,
    });
  };

  const updateTitleAlign = (titleAlign: ResponseHeaderTitleAlign) => {
    onChange({ ...config, titleAlign });
  };

  const updateLogoAlign = (logoAlign: ResponseHeaderLogoAlign) => {
    if (config.style !== 'official-band') return;
    onChange({
      ...config,
      officialBand: {
        ...config.officialBand,
        logoAlign,
      },
    });
  };

  const updateNoticeWidth = (width: 'sm' | 'md' | 'lg') => {
    if (config.style !== 'official-band') return;
    onChange({
      ...config,
      officialBand: {
        ...config.officialBand,
        statisticNotice: {
          title: config.officialBand?.statisticNotice?.title ?? DEFAULT_STATISTIC_NOTICE.title,
          body: config.officialBand?.statisticNotice?.body ?? DEFAULT_STATISTIC_NOTICE.body,
          width,
        },
      },
    });
  };

  return (
    <section className="space-y-4 border-t border-gray-200 pt-6">
      <div>
        <h4 className="text-sm font-medium text-gray-700">응답 페이지 헤더</h4>
        <p className="mt-1 text-xs text-gray-400">설문지 원본과 비슷한 머리말을 표시합니다.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={config.style === 'plain'}
          className={responseHeaderButtonClass(config.style === 'plain')}
          onClick={setPlain}
        >
          기본형
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={config.style === 'logo-title'}
          className={responseHeaderButtonClass(config.style === 'logo-title')}
          onClick={setLogoTitle}
        >
          제목 옆 로고형
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={config.style === 'official-band'}
          className={responseHeaderButtonClass(config.style === 'official-band') + ' col-span-2'}
          onClick={setOfficialBand}
        >
          양끝 정보형
        </Button>
      </div>

      <PresetButtonGroup
        label="제목 정렬"
        value={config.titleAlign ?? 'center'}
        options={[
          ['left', '왼쪽'],
          ['center', '중앙'],
          ['right', '오른쪽'],
        ]}
        onChange={updateTitleAlign}
      />

      {config.style !== 'plain' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs text-gray-600">
              <ImageIcon className="mr-1 inline h-3.5 w-3.5" />
              로고 이미지
            </Label>
            <CellImageEditor imageUrl={config.logo.imageUrl} onImageUrlChange={updateLogoUrl} />
          </div>

          {config.style === 'logo-title' && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-600">로고 위치</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={config.logoTitle?.logoPosition !== 'right'}
                  className={responseHeaderButtonClass(config.logoTitle?.logoPosition !== 'right')}
                  onClick={() => updateLogoPosition('left')}
                >
                  왼쪽
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={config.logoTitle?.logoPosition === 'right'}
                  className={responseHeaderButtonClass(config.logoTitle?.logoPosition === 'right')}
                  onClick={() => updateLogoPosition('right')}
                >
                  오른쪽
                </Button>
              </div>
            </div>
          )}

          {config.style === 'official-band' && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs text-gray-600">양끝 배치</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={config.officialBand?.arrangement !== 'logo-left-stat-right'}
                    className={responseHeaderButtonClass(
                      config.officialBand?.arrangement !== 'logo-left-stat-right',
                    )}
                    onClick={() => updateArrangement('stat-left-logo-right')}
                  >
                    통계법 왼쪽
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={config.officialBand?.arrangement === 'logo-left-stat-right'}
                    className={responseHeaderButtonClass(
                      config.officialBand?.arrangement === 'logo-left-stat-right',
                    )}
                    onClick={() => updateArrangement('logo-left-stat-right')}
                  >
                    로고 왼쪽
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-gray-600">로고 세로 정렬</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button type="button" variant="outline" size="sm" aria-pressed={config.officialBand?.logoAlign === 'top' || !config.officialBand?.logoAlign} className={responseHeaderButtonClass(config.officialBand?.logoAlign === 'top' || !config.officialBand?.logoAlign)} onClick={() => updateLogoAlign('top')}>
                    위
                  </Button>
                  <Button type="button" variant="outline" size="sm" aria-pressed={config.officialBand?.logoAlign === 'center'} className={responseHeaderButtonClass(config.officialBand?.logoAlign === 'center')} onClick={() => updateLogoAlign('center')}>
                    중앙
                  </Button>
                  <Button type="button" variant="outline" size="sm" aria-pressed={config.officialBand?.logoAlign === 'bottom'} className={responseHeaderButtonClass(config.officialBand?.logoAlign === 'bottom')} onClick={() => updateLogoAlign('bottom')}>
                    아래
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="response-header-stat-title" className="text-xs text-gray-600">
                  통계법 제목
                </Label>
                <Input
                  id="response-header-stat-title"
                  value={
                    config.officialBand?.statisticNotice?.title ?? DEFAULT_STATISTIC_NOTICE.title
                  }
                  onChange={(event) => updateStatisticNotice('title', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="response-header-stat-body" className="text-xs text-gray-600">
                  통계법 문구
                </Label>
                <Textarea
                  id="response-header-stat-body"
                  value={
                    config.officialBand?.statisticNotice?.body ?? DEFAULT_STATISTIC_NOTICE.body
                  }
                  onChange={(event) => updateStatisticNotice('body', event.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="w-full justify-between">
            세부 조정
            <ChevronDown className="h-4 w-4" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          {config.style !== 'plain' && (
            <PresetButtonGroup
              label="로고 크기"
              value={config.logo.size ?? 'md'}
              options={[
                ['sm', '작게'],
                ['md', '보통'],
                ['lg', '크게'],
              ]}
              onChange={updateLogoSize}
            />
          )}
          <PresetButtonGroup
            label="제목 크기"
            value={config.titleSize ?? 'auto'}
            options={[
              ['auto', '자동'],
              ['md', '보통'],
              ['lg', '크게'],
            ]}
            onChange={updateTitleSize}
          />
          {config.style === 'official-band' && (
            <PresetButtonGroup
              label="통계법 박스 폭"
              value={config.officialBand?.statisticNotice?.width ?? 'md'}
              options={[
                ['sm', '좁게'],
                ['md', '보통'],
                ['lg', '넓게'],
              ]}
              onChange={updateNoticeWidth}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function PresetButtonGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-gray-600">{label}</Label>
      <div className="grid grid-cols-3 gap-2">
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
