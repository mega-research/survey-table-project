import type { PiiFieldType } from './pii-fields';

/**
 * 컨택 목록의 PII 마스킹 표시. 앞부분만 노출하고 뒤는 "..." 으로 가린다.
 * - email: 'asd...@nav...' (local 앞 3 + domain 앞 3)
 * - mobile (010-): '010-22...' (앞 5자리)
 * - phone (일반): '02-345...' / '031-555...' (앞 6자리)
 * - biz_number: '123-45...' (앞 5자리, 표준 XXX-XX-XXXXX 형식 일부)
 * - name / representative: '김**' (첫 글자 + ** )
 * - address: '서울특별시' (첫 단어)
 */
export function maskHint(fieldType: PiiFieldType, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  switch (fieldType) {
    case 'email': {
      const at = trimmed.lastIndexOf('@');
      if (at <= 0 || at === trimmed.length - 1) return '';
      const local = trimmed.slice(0, at);
      const domain = trimmed.slice(at + 1).toLowerCase();
      const localShown = local.slice(0, Math.min(3, local.length));
      const dotIdx = domain.indexOf('.');
      const domainHead = dotIdx > 0 ? domain.slice(0, dotIdx) : domain;
      const domainShown = domainHead.slice(0, Math.min(3, domainHead.length));
      return `${localShown}...@${domainShown}...`;
    }
    case 'mobile': {
      const digits = trimmed.replace(/[^0-9]/g, '');
      if (digits.length < 5) return '';
      if (digits.startsWith('010') && digits.length === 11) {
        return `010-${digits.slice(3, 5)}...`;
      }
      // 011/016/017/018/019 류
      return `${digits.slice(0, 3)}-${digits.slice(3, 5)}...`;
    }
    case 'phone': {
      const digits = trimmed.replace(/[^0-9]/g, '');
      if (digits.length < 5) return '';
      // 02-XXX... (서울)
      if (digits.startsWith('02') && digits.length >= 9) {
        return `02-${digits.slice(2, 5)}...`;
      }
      // 0XX-XXX... (지역번호 3자리)
      if (digits.length >= 10) {
        return `${digits.slice(0, 3)}-${digits.slice(3, 6)}...`;
      }
      return `${digits.slice(0, 5)}...`;
    }
    case 'biz_number': {
      const digits = trimmed.replace(/[^0-9]/g, '');
      if (digits.length < 5) return '';
      // 표준 XXX-XX-XXXXX → 앞 5자리(XXX-XX) 노출
      return `${digits.slice(0, 3)}-${digits.slice(3, 5)}...`;
    }
    case 'name':
    case 'representative': {
      const first = [...trimmed][0];
      return first ? `${first}**` : '';
    }
    case 'address': {
      const first = trimmed.split(/\s+/)[0];
      return first ?? '';
    }
  }
}
