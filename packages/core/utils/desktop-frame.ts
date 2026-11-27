type FrameSegment = { type: string; data?: Record<string, unknown> };

export function isDesktopMediaSegment(type: string): boolean {
    return type === "image" || type === "file" || type === "voice";
}

/** 二进制帧由大端头长、UTF-8 JSON 头部和按消息段顺序拼接的媒体字节组成。 */
export function encodeDesktopFrame(frame: unknown, payloads: readonly Uint8Array[]): string | Buffer {
    const json = JSON.stringify(frame);
    if (payloads.length === 0) return json;
    const header = Buffer.from(json, "utf8");
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(header.byteLength);
    return Buffer.concat([prefix, header, ...payloads]);
}

export function decodeDesktopBinaryFrame(buffer: Buffer): { type: "message"; segments: FrameSegment[] } | null {
    if (buffer.byteLength <= 4) return null;
    const headerLength = buffer.readUInt32BE(0);
    let offset = 4 + headerLength;
    if (headerLength === 0 || offset > buffer.byteLength) return null;

    const frame = JSON.parse(buffer.toString("utf8", 4, offset));
    if (frame?.type !== "message" || !Array.isArray(frame.segments)) return null;
    let hasPayload = false;
    for (const segment of frame.segments as FrameSegment[]) {
        if (typeof segment?.type !== "string") return null;
        if (!segment.data || !Object.hasOwn(segment.data, "binaryLength")) continue;
        const { binaryLength, ...data } = segment.data;
        if (!isDesktopMediaSegment(segment.type) || typeof binaryLength !== "number" || !Number.isSafeInteger(binaryLength)
            || binaryLength < 0 || (binaryLength === 0 && segment.type !== "file") || binaryLength > buffer.byteLength - offset) return null;

        const end = offset + binaryLength;
        segment.data = { ...data, size: binaryLength, bytes: buffer.subarray(offset, end) };
        offset = end;
        hasPayload = true;
    }
    return hasPayload && offset === buffer.byteLength ? frame : null;
}
