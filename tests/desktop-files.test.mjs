import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BackendConnection } from "../packages/desktop/src/main/backend.ts";
import { decodeDesktopBinaryFrame } from "../packages/core/utils/desktop-frame.ts";

test("桌面混合上传仅图片编码为 base64，附件双向保留原始字节", { timeout: 5000 }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "cith-desktop-files-"));
    const config = join(dir, "config.json");
    const uploads = join(dir, "data", "desktop");
    const token = "desktop-test-token";
    process.env.CITH_DATA = dir;
    process.env.CITH_CONFIG = config;
    await mkdir(join(dir, "skills"));
    await writeFile(config, JSON.stringify({ desktopPort: 0, token }));
    t.after(async () => {
        for (const name of await readdir(uploads).catch(() => [])) await unlink(join(uploads, name));
        await rmdir(uploads).catch(() => {});
        await rmdir(join(dir, "data")).catch(() => {});
        await rmdir(join(dir, "skills"));
        await unlink(config);
        await rmdir(dir);
    });

    const { startDesktopServer } = await import("../packages/core/bot/servers/DesktopServer.ts");
    const processed = Promise.withResolvers();
    const processedLegacy = Promise.withResolvers();
    const server = startDesktopServer(async (event) => {
        if (event.messageId === "legacy") {
            processedLegacy.resolve(event);
            return;
        }
        processed.resolve(event);
        await event.adapter.sendMsg(event.space, event.message);
    });
    const upload = Promise.withResolvers();
    server.on("connection", (socket) => socket.once("message", (data, isBinary) => upload.resolve({ data, isBinary })));
    await once(server, "listening");

    const ready = Promise.withResolvers();
    const reply = Promise.withResolvers();
    const connection = new BackendConnection({
        onStatus(status) { if (status.state === "connected") ready.resolve(); },
        onMessage(frame) { reply.resolve(frame); },
    });
    t.after(() => {
        connection.apply({ url: "", token: "" });
        for (const socket of server.clients) socket.terminate();
        server.close();
    });
    const url = `ws://127.0.0.1:${server.address().port}`;
    connection.apply({ url, token });
    await ready.promise;

    const image = Uint8Array.of(0x89, 0x00, 0xff);
    const file = Uint8Array.of(0xff, 0x03, 0x00, 0x05);
    assert.ok(connection.send({ type: "message", messageId: "1", userId: "desktop", conversationId: "会话", segments: [
        { type: "text", data: { text: "附件" } },
        { type: "image", data: { name: "示例.png", bytes: image.buffer } },
        { type: "file", data: { name: "资料.bin", bytes: file.buffer } },
        { type: "file", data: { name: "空文件.txt", bytes: new ArrayBuffer(0) } },
    ] }));

    const incoming = await upload.promise;
    assert.equal(incoming.isBinary, true);
    const [, wireImage, wireFile, wireEmpty] = decodeDesktopBinaryFrame(incoming.data).segments;
    assert.equal(wireImage.data.base64, Buffer.from(image).toString("base64"));
    assert.equal(wireFile.data.base64, undefined);
    assert.deepEqual(wireFile.data.bytes, Buffer.from(file));
    assert.equal(wireEmpty.data.bytes.length, 0);

    const event = await processed.promise;
    const media = event.message.slice(1);
    assert.equal((await readdir(uploads)).length, media.length);
    for (const [index, expected] of [image, file, new Uint8Array(0)].entries()) {
        assert.deepEqual(await readFile(media[index].data.media.localPath), Buffer.from(expected));
        assert.equal(media[index].data.bytes, undefined);
        assert.equal(media[index].data.base64, undefined);
    }
    const received = await reply.promise;
    assert.equal(received.space.conversationId, "会话");
    assert.deepEqual(received.segments.slice(1).map((segment) => segment.data.bytes), [image.buffer, file.buffer, new ArrayBuffer(0)]);
    assert.ok(received.segments.every((segment) => segment.data.base64 === undefined));

    const legacy = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    await once(legacy, "open");
    const text = { type: "text", data: { text: "旧格式附件只保留正文" } };
    legacy.send(JSON.stringify({ type: "message", messageId: "legacy", segments: [
        text, { type: "file", data: { name: "旧附件.bin", base64: "AP/w" } },
    ] }));
    assert.deepEqual((await processedLegacy.promise).message, [text]);
    assert.equal((await readdir(uploads)).length, media.length);
});
