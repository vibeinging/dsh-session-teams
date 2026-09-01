/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'copy.label': '复制会话链接',
  'copy.success': '会话链接已复制',
  'copy.failure': '无法复制会话链接',
} satisfies Record<string, string>

/** Window-link namespace key union. */
export type WindowLinkKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'copy.label': 'Copy session link',
  'copy.success': 'Session link copied',
  'copy.failure': 'Could not copy session link',
} satisfies Record<WindowLinkKey, string>
