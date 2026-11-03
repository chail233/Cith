/**
 * 长期记忆容量淘汰策略
 *
 */

/** 容量淘汰只需要的最小记录视图（rememori 的 MemoryRecord 子集） */
export interface EvictableRecord {
    id: string;
    importance: number;
    createdAt: number;
}

/** 新写入记忆的保护期：刚写入的记忆不参与淘汰，避免边写边删 */
export const EVICT_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * 选出需要淘汰的记录 id
 *
 * 超出容量的部分按 importance 升序、创建时间升序淘汰（最弱、最旧的先删）；
 * 保护期内的记录即使超出容量也不删，因此实际条数可能短时高于容量。
 *
 * @param records 当前全部记录
 * @param capacity 容量上限，<=0 表示不限
 * @param now 当前时间戳（测试可注入）
 * @returns 待删除的 id 列表
 */
export function selectEvictions(
    records: readonly EvictableRecord[],
    capacity: number,
    now: number = Date.now(),
): string[] {
    const overflow = records.length - capacity;
    if (!(capacity > 0) || overflow <= 0) return [];
    const cutoff = now - EVICT_GRACE_MS;
    return records
        .filter((r) => r.createdAt < cutoff)
        .sort((a, b) => a.importance - b.importance || a.createdAt - b.createdAt)
        .slice(0, overflow)
        .map((r) => r.id);
}
