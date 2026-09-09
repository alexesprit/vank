import { object } from '../../shared/schema.ts';
export interface DiscoveryItem {
  id: string;
  recognizableAs: string;
  purpose: 'familiar' | 'verification';
}
export const discoverySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'recognizableAs', 'purpose'],
        properties: {
          id: { type: 'string' },
          recognizableAs: { type: 'string', minLength: 1 },
          purpose: { type: 'string', enum: ['familiar', 'verification'] },
        },
      },
    },
  },
};
export function parseDiscovery(value: unknown, ids: string[]): DiscoveryItem[] {
  const r = object(value),
    found = new Set<string>();
  if (!Array.isArray(r.items) || Object.keys(r).some((k) => k !== 'items'))
    throw new Error('Invalid discovery result');
  return r.items.map((value) => {
    const item = object(value);
    if (
      typeof item.id !== 'string' ||
      !ids.includes(item.id) ||
      found.has(item.id) ||
      typeof item.recognizableAs !== 'string' ||
      !item.recognizableAs.trim() ||
      !['familiar', 'verification'].includes(String(item.purpose)) ||
      Object.keys(item).some(
        (k) => !['id', 'recognizableAs', 'purpose'].includes(k),
      )
    )
      throw new Error('Invalid discovery candidate');
    found.add(item.id);
    return item as unknown as DiscoveryItem;
  });
}
