import { describe, expect, it } from 'vitest';

import {
  buildAttachmentMetaText,
  formatFileSize,
  resolveFileTypeLabel,
} from './file-attachment-format';

describe('resolveFileTypeLabel', () => {
  it('파일명의 확장자를 대문자로 쓴다', () => {
    expect(resolveFileTypeLabel('협조 요청 공문.pdf', 'application/pdf')).toBe('PDF');
    expect(resolveFileTypeLabel('명단.xlsx', null)).toBe('XLSX');
  });

  it('확장자가 화이트리스트에 없어도 그대로 올린다 (heic 등 image/* 우회 경로)', () => {
    expect(resolveFileTypeLabel('사진.heic', 'image/heic')).toBe('HEIC');
  });

  it('점이 여럿이면 마지막 확장자만 본다', () => {
    expect(resolveFileTypeLabel('2026.실태조사.최종.hwp', null)).toBe('HWP');
  });

  it('확장자가 없으면 MIME 으로 판정한다', () => {
    expect(resolveFileTypeLabel('공문', 'application/pdf')).toBe('PDF');
    expect(resolveFileTypeLabel(null, 'application/vnd.hancom.hwp')).toBe('HWP');
    expect(resolveFileTypeLabel(null, 'application/haansofthwpx')).toBe('HWPX');
  });

  it('image/* MIME 은 서브타입을 대문자로 쓴다', () => {
    expect(resolveFileTypeLabel(null, 'image/jpeg')).toBe('JPEG');
    expect(resolveFileTypeLabel(null, 'image/svg+xml')).toBe('SVG');
  });

  it('확장자처럼 보이지 않는 꼬리는 확장자로 치지 않는다', () => {
    expect(resolveFileTypeLabel('시스템반도체 팹리스 산업 실태조사', null)).toBe('');
    expect(resolveFileTypeLabel('보고서.최종본', null)).toBe('');
  });

  it('둘 다 없으면 빈 문자열', () => {
    expect(resolveFileTypeLabel(null, null)).toBe('');
    expect(resolveFileTypeLabel('', '')).toBe('');
  });
});

describe('buildAttachmentMetaText', () => {
  it('원본 파일명을 빼고 타입과 크기만 낸다', () => {
    expect(buildAttachmentMetaText('협조 요청 공문.pdf', 230400, 'application/pdf')).toBe(
      'PDF · 225 KB',
    );
  });

  it('타입을 못 알아보면 크기만 낸다', () => {
    expect(buildAttachmentMetaText('공문', null, null)).toBe('');
    expect(buildAttachmentMetaText('공문', 2048, null)).toBe('2 KB');
  });

  it('크기가 없으면 타입만 낸다', () => {
    expect(buildAttachmentMetaText('명단.xlsx', null, null)).toBe('XLSX');
    expect(buildAttachmentMetaText('명단.xlsx', 0, null)).toBe('XLSX');
  });

  it('둘 다 없으면 빈 문자열 (메타 줄 자체가 안 그려진다)', () => {
    expect(buildAttachmentMetaText(null, null, null)).toBe('');
  });

  it('size 가 문자열이어도 읽는다 (parseHTML 이 data-size 를 문자열로 준다)', () => {
    expect(buildAttachmentMetaText('공문.pdf', '230400', null)).toBe('PDF · 225 KB');
  });
});

describe('formatFileSize', () => {
  it('단위를 경계에서 바꾼다', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('없거나 유효하지 않으면 빈 문자열', () => {
    expect(formatFileSize(null)).toBe('');
    expect(formatFileSize(0)).toBe('');
    expect(formatFileSize('abc')).toBe('');
  });
});
