import type { ReactNode } from 'react';

import {
  getLogoAlignClass,
  getLogoSizeClass,
  getNoticeWidthClass,
  getTitleAlignClass,
  getTitleSizeClass,
  normalizeResponseHeaderConfig,
} from '@/lib/survey/response-header-config';
import { cn, isEmptyHtml } from '@/lib/utils';
import type {
  ResponseHeaderTitleAlign,
  SurveyResponseHeaderConfig,
} from '@/db/schema/schema-types';

interface SurveyResponseHeaderProps {
  title: string;
  description?: string | null | undefined;
  responseHeader?: SurveyResponseHeaderConfig | null | undefined;
  sideMeta?: ReactNode;
}

export function SurveyResponseHeader({
  title,
  description,
  responseHeader,
  sideMeta,
}: SurveyResponseHeaderProps) {
  const config = normalizeResponseHeaderConfig(responseHeader);

  if (config.style === 'logo-title') {
    const logo = <HeaderLogo config={config.logo} />;
    const titleBlock = (
      <TitleBlock title={title} description={description} titleSize={config.titleSize} align={config.titleAlign ?? 'center'} />
    );
    const logoPosition = config.logoTitle?.logoPosition ?? 'left';

    return (
      <div
        data-testid="logo-title-layout"
        data-logo-position={logoPosition}
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
          {logoPosition === 'left' ? logo : titleBlock}
          {logoPosition === 'left' ? titleBlock : logo}
        </div>
        {sideMeta && (
          <div className="hidden text-right text-sm text-gray-500 md:block">{sideMeta}</div>
        )}
      </div>
    );
  }

  if (config.style === 'official-band') {
    const arrangement = config.officialBand?.arrangement ?? 'stat-left-logo-right';
    const notice = config.officialBand?.statisticNotice;
    const logo = <HeaderLogo config={config.logo} />;
    const noticeBox = (
      <div
        className={cn(
          'w-full border border-gray-900 bg-white text-center',
          getNoticeWidthClass(notice?.width ?? 'md'),
        )}
      >
        <div className="bg-black px-1.5 py-1.5 text-xs font-semibold text-white">{notice?.title}</div>
        <div className="px-1.5 py-2 text-[11px] leading-snug text-gray-600">{notice?.body}</div>
      </div>
    );

    return (
      <div data-testid="official-band-layout" data-arrangement={arrangement} className="space-y-6">
        <div
          data-testid="official-band-row"
          data-logo-align={config.officialBand?.logoAlign ?? 'top'}
          className={cn(
            'flex flex-col gap-4 md:flex-row md:justify-between',
            getLogoAlignClass(config.officialBand?.logoAlign ?? 'top'),
          )}
        >
          {arrangement === 'stat-left-logo-right' ? noticeBox : logo}
          {arrangement === 'stat-left-logo-right' ? logo : noticeBox}
        </div>
        <TitleBlock title={title} description={description} titleSize={config.titleSize} align={config.titleAlign ?? 'center'} />
        {sideMeta && (
          <div className="hidden text-right text-sm text-gray-500 md:block">{sideMeta}</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <TitleBlock title={title} description={description} titleSize={config.titleSize} align={config.titleAlign ?? 'left'} />
      {sideMeta && (
        <div className="hidden self-start text-sm text-gray-500 md:block md:self-auto">
          {sideMeta}
        </div>
      )}
    </div>
  );
}

function TitleBlock({
  title,
  description,
  titleSize,
  align = 'center',
}: {
  title: string;
  description?: string | null | undefined;
  titleSize: SurveyResponseHeaderConfig['titleSize'];
  align?: ResponseHeaderTitleAlign;
}) {
  return (
    <div data-testid="title-block" data-title-align={align} className={getTitleAlignClass(align)}>
      <h1 className={cn('font-semibold leading-tight text-gray-900', getTitleSizeClass(titleSize ?? 'auto'))}>
        {title}
      </h1>
      {!isEmptyHtml(description) && (
        <p
          className={cn(
            'mt-1 text-base text-gray-600 md:text-sm',
            align === 'center' ? 'mx-auto max-w-3xl' : '',
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}

function HeaderLogo({
  config,
}: {
  config: {
    imageUrl: string;
    altText?: string;
    size?: 'sm' | 'md' | 'lg';
  };
}) {
  if (!config.imageUrl) {
    return (
      <div
        className={cn(
          // 고정 높이만으로는 width 가 0 이 되므로 placeholder 에 명시 폭을 준다.
          'w-40 rounded border border-dashed border-gray-300 bg-gray-50',
          getLogoSizeClass(config.size ?? 'md'),
        )}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={config.imageUrl}
      alt={config.altText || '설문 로고'}
      className={cn('w-auto object-contain', getLogoSizeClass(config.size ?? 'md'))}
    />
  );
}
