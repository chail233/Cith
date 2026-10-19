// @ts-check

/**
 * 简单队列实现
 */
export default class Queue {
    constructor() {
        this.items = {};
        this.head = 0;
        this.tail = 0;
    }

    push(v) {
        this.items[this.tail++] = v;
    }

    pop() {
        if (this.isEmpty()) return undefined;
        const v = this.items[this.head];
        delete this.items[this.head++];
        return v;
    }

    front() {
        return this.items[this.head];
    }

    isEmpty() {
        return this.head === this.tail;
    }

    size() {
        return this.tail - this.head;
    }
}