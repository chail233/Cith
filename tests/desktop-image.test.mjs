import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import DesktopAdapter from "../packages/core/bot/adapters/DesktopAdapter.ts";
import { BackendConnection } from "../packages/desktop/src/main/backend.ts";
import { restoreSessions, snapshotOf } from "../packages/desktop/src/renderer/src/sessionSnapshot.ts";

test("桌面回复单帧混发文字、图片和音频，二进制负载按段顺序解包", { timeout: 5000 }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "cith-desktop-image-"));
    const firstPath = join(dir, "第一张.png");
    const secondPath = join(dir, "second.gif");
    const voicePath = join(dir, "voice.wav");
    const first = Buffer.from([0x89, 0x50, 0x00, 0xff]);
    const second = Buffer.from([0x47, 0x49, 0x46]);
    const voice = Buffer.from([0x52, 0x49, 0x46, 0x46, 0xff]);
    t.after(async () => {
        await Promise.all([firstPath, secondPath, voicePath].map((path) => unlink(path)));
        await rmdir(dir);
    });
    await Promise.all([writeFile(firstPath, first), writeFile(secondPath, second), writeFile(voicePath, voice)]);

    const connected = Promise.withResolvers();
    const received = [];
    const client = {};
    t.mock.method(globalThis, "WebSocket", function () {
        queueMicrotask(() => client.onopen());
        return client;
    });
    const connection = new BackendConnection({
        onStatus(status) {
            if (status.state === "connected") connected.resolve();
        },
        onMessage(frame) {
            received.push(frame);
        },
    });
    connection.apply({ url: "ws://localhost", token: "" });
    await connected.promise;
    assert.equal(client.binaryType, "arraybuffer");

    const sentTypes = [];
    const socket = {
        readyState: WebSocket.OPEN,
        send(payload) {
            sentTypes.push(typeof payload);
            client.onmessage({ data: Buffer.isBuffer(payload) ? Uint8Array.from(payload).buffer : payload });
        },
    };
    const adapter = new DesktopAdapter(async () => {}, socket);
    const space = { from: "user", id: "desktop", channel: "desktop", conversationId: "聊天" };
    const remote = { type: "image", data: { media: { uri: "https://example.com/picture.png" }, name: "picture.png" } };
    const remoteVoice = { type: "voice", data: { media: { uri: "https://example.com/voice.ogg" }, name: "voice.ogg" } };
    const remoteAudioFile = { type: "file", data: { media: { uri: "https://example.com/clip.m4a" }, name: "录音" } };

    // 损坏的二进制消息不应影响后续完整回复。
    socket.send(Buffer.from([0, 0, 0, 100, 1]));
    const delivery = await adapter.sendReply(space, [
        { type: "text", data: { text: "两张图" } },
        { type: "image", data: { media: { localPath: firstPath } } },
        { type: "voice", data: { media: { localPath: voicePath }, text: "转写示例" } },
        remote,
        { type: "image", data: { media: { localPath: secondPath } } },
    ]);
    assert.deepEqual(delivery, { attempts: 1, failures: [] });
    const linked = await adapter.replyTool().execute({ segments: [remoteVoice, remoteAudioFile] }, { adapter, space });
    assert.equal(linked.receipt, "消息已发送");

    assert.deepEqual(sentTypes, ["object", "object", "string"]);
    assert.equal(received.length, 2);
    const reply = received[0];
    assert.equal(reply.space.conversationId, "聊天");
    const [text, png, wav, url, gif] = reply.segments;
    assert.equal(text.data.text, "两张图");
    assert.deepEqual(url, remote);
    assert.equal(png.data.name, "第一张.png");
    assert.equal(png.data.mime, "image/png");
    assert.equal(png.data.size, first.length);
    assert.equal(png.data.base64, undefined);
    assert.deepEqual(Buffer.from(png.data.bytes), first);
    assert.equal(wav.type, "voice");
    assert.equal(wav.data.name, "voice.wav");
    assert.equal(wav.data.mime, "audio/wav");
    assert.equal(wav.data.text, "转写示例");
    assert.deepEqual(Buffer.from(wav.data.bytes), voice);
    assert.equal(gif.data.mime, "image/gif");
    assert.deepEqual(Buffer.from(gif.data.bytes), second);
    assert.deepEqual(received[1].segments, [remoteVoice, { ...remoteAudioFile, data: { ...remoteAudioFile.data, mime: "audio/mp4" } }]);
});

test("二进制图片和音频沿用历史快照的缓存大小限制", () => {
    const bytes = Uint8Array.of(0x00, 0xff, 0xf0).buffer;
    const image = { type: "image", data: { bytes, mime: "image/png", name: "小图.png" } };
    const large = { type: "image", data: { bytes: new ArrayBuffer(2 * 1024 * 1024), name: "大图.png" } };
    const voice = { type: "voice", data: { bytes, mime: "audio/wav", name: "录音.wav", text: "转写" } };
    const longVoice = { type: "voice", data: { bytes: large.data.bytes, name: "长录音.wav", text: "长录音转写" } };
    const conversation = {
        id: "聊天", title: "聊天", updated: "刚刚",
        messages: [{ id: "消息", role: "agent", time: "00:00", segments: [image, large, voice, longVoice] }],
    };

    const snapshot = snapshotOf({ conversations: [conversation], archived: [], activeId: conversation.id });
    const restored = restoreSessions(JSON.parse(JSON.stringify(snapshot)));
    const [cached, uncached, cachedVoice, uncachedVoice] = restored.conversations[0].messages[0].segments;
    assert.deepEqual(cached.data, { base64: "AP/w", mime: "image/png", name: "小图.png" });
    assert.deepEqual(uncached.data, { name: "大图.png" });
    assert.equal(image.data.bytes, bytes);
    assert.deepEqual(cachedVoice, { type: "voice", data: { name: "录音.wav", mime: "audio/wav", base64: "AP/w", text: "转写" } });
    assert.deepEqual(uncachedVoice, { type: "voice", data: { name: "长录音.wav", text: "长录音转写" } });
    assert.equal(voice.data.bytes, bytes);
});
