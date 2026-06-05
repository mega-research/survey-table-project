/**
 * Excel export 공용 헤더 스타일
 *
 * raw / split 워크북의 헤더 행에 적용하는 ExcelJS 스타일 상수.
 */
import type ExcelJS from 'exceljs';

export const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF4472C4' },
};

export const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 10,
};

export const HEADER_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF2F5496' } },
  bottom: { style: 'thin', color: { argb: 'FF2F5496' } },
  left: { style: 'thin', color: { argb: 'FF2F5496' } },
  right: { style: 'thin', color: { argb: 'FF2F5496' } },
};
