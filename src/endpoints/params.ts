import { badRequest } from './base.js';

const DIGIT_LIST_PATTERN = /^\d+(,\d+)*$/;

export function normalizeDigitId(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  return /^\d+$/.test(normalized) ? normalized : null;
}

export function parseDigitIdList(
  raw: string | null,
  name: string,
  maxItems: number,
): { ids: string[]; value: string } | { response: Response } {
  if (!raw) return { response: badRequest(`缺少${name}参数`) };
  const value = raw.replace(/\s+/g, '').replace(/^,+|,+$/g, '');
  if (!DIGIT_LIST_PATTERN.test(value)) {
    return { response: badRequest(`${name}参数格式不正确`, '逗号分隔的数字ID') };
  }
  const ids = value.split(',');
  if (ids.length > maxItems) {
    return { response: badRequest(`${name}一次最多允许${maxItems}个ID`) };
  }
  return { ids, value };
}

export function parseBoundedIntParam(
  raw: string | null,
  name: string,
  fallback: number,
  min: number,
  max: number,
): { value: number; text: string } | { response: Response } {
  const text = raw?.trim() ?? '';
  if (!text) return { value: fallback, text: String(fallback) };
  if (!/^\d+$/.test(text)) return { response: badRequest(`${name}参数必须是数字`) };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return { response: badRequest(`${name}参数范围必须是 ${min}-${max}`) };
  }
  return { value, text: String(value) };
}

export function validateTextLength(
  value: string,
  name: string,
  maxLength: number,
): Response | null {
  if (value.length > maxLength) {
    return badRequest(`${name}长度不能超过${maxLength}个字符`);
  }
  return null;
}
