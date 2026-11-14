/**
 * 环形缓冲（Ring Buffer）：固定容量、覆盖式写入，保留最近 N 条记录
 */
export class RingBuffer<T> {
    private readonly capacity: number;
    private readonly buffer: (T | undefined)[];
    /** 下一个写入位置 */
    private head = 0;
    /** 当前有效元素数量 */
    private count = 0;

    constructor(capacity: number) {
        this.capacity = capacity > 0 ? capacity : 1;
        this.buffer = new Array(this.capacity);
    }

    /** 写入一条记录，超出容量时覆盖最旧的一条 */
    push(item: T): void {
        this.buffer[this.head] = item;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) {
            this.count++;
        }
    }


    toArray(): T[] {
        const result: T[] = [];
        // 最旧元素的位置：head 已指向下一个写入位，往前推 count 个即起点
        let start = (this.head - this.count + this.capacity * 2) % this.capacity;
        for (let i = 0; i < this.count; i++) {
            result.push(this.buffer[start] as T);
            start = (start + 1) % this.capacity;
        }
        return result;
    }

    size(): number {
        return this.count;
    }

    clear(): void {
        this.head = 0;
        this.count = 0;
        this.buffer.fill(undefined);
    }
}
