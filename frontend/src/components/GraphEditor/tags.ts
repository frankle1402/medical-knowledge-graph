/**
 * Tags 兼容层：v2 起 `Node.tags` 落库为 JSON 对象（承载 step_order / phase / aliases 等
 * LLM 输出的扩展字段），但仓库里仍存在大量 v1 时代 `tags: string[]` 的 fixture/数据。
 *
 * `asTagsObject` 把任意输入收敛为前端可安全消费的 `Record<string, unknown>`：
 *   - `null` / `undefined`        → `{}`
 *   - 数组（旧形态）             → `{}`（不再保留，由 NodeForm/NodePanel 通过 `_legacy` 分支显式处理）
 *   - 对象                        → 原样返回
 *   - 其他原始值（string / number 等异常输入）→ `{}`
 */
export function asTagsObject(tags: unknown): Record<string, unknown> {
  if (tags === null || tags === undefined) return {};
  if (Array.isArray(tags)) return {};
  if (typeof tags === 'object') return tags as Record<string, unknown>;
  return {};
}
