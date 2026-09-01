/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'copy.label': '跟另一个窗口对话',
  'copy.success': '已复制，粘贴到另一个窗口',
  'copy.failure': '复制失败，请重试',
} satisfies Record<string, string>

/** Window-link namespace key union. */
export type WindowLinkKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'copy.label': 'Talk to another window',
  'copy.success': 'Copied. Paste into another window',
  'copy.failure': 'Could not copy. Try again',
} satisfies Record<WindowLinkKey, string>
