/**
 * 语音消息段测试
 *
 * 覆盖四件事：
 * - 收到的 record 段归一化为 voice 段：转码后的 mp3 落进 core/data/voices/，QQ 原生转写文本一并带上
 * - 转码失败 / 转写失败都只降级，语音消息本身照样进上下文
 * - OneBot 发送 voice 段发出 record 段（本地文件转 file://，magic 变声）
 * - 微信能力集里没有 voice，模型根本看不到这个段
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** callAction 发出的动作帧按动作名在这里找回包；数组表示依次回多帧（模拟 async 受理后补终包），缺省回失败帧 */
let replies = {};
/** fetch_ptt_text 收到的 message_id */
const pttCalls = [];

const { OnebotServer } = await import("../core/bot/servers/OnebotServer.ts");
const { default: OnebotAdapter } = await import("../core/bot/adapters/OnebotAdapter.ts");
const { default: WechatBotAdapter } = await import("../core/bot/adapters/WechatBotAdapter.ts");

const noop = async () => {};
/** 不启动 WS 的服务器实例：socket 用替身顶上，toSegments / callAction 照常工作 */
const server = new OnebotServer(noop);
server.socket = {
    readyState: 1, // WebSocket.OPEN
    send: (payload) => {
        const frame = JSON.parse(payload);
        if (frame.action === "fetch_ptt_text") pttCalls.push(frame.params.message_id);
        const resp = replies[frame.action];
        const frames = Array.isArray(resp) ? resp : [resp ?? { status: "failed", retcode: 100 }];
        for (const respFrame of frames) {
            setTimeout(() => server.onRawMessage(JSON.stringify({ ...respFrame, echo: frame.echo })));
        }
    },
};

/** 本用例产生的临时文件，结束后删除 */
let created = [];

beforeEach(() => {
    replies = {};
    pttCalls.length = 0;
    created = [];
});

afterEach(async () => {
    for (const path of created) await rm(path, { force: true });
});

/** 构造一条带语音的消息事件 */
function recordEvent(data = {}) {
    return {
        post_type: "message",
        message_id: 1234,
        message: [{
            type: "record",
            data: { file: "abc.amr", url: "https://example.com/a.amr", duration: 3, ...data },
        }],
    };
}

/** 工具定义里可用的消息段类型（按声明顺序） */
function segmentTypes(tool) {
    const { items } = tool.definition.function.parameters.properties.segments;
    return items.oneOf.map((item) => item.properties.type.enum[0]);
}

// ---------------------------------------------------------------- 收：record → voice

test("语音：转码落地的 mp3 与 QQ 原生转写一起进 voice 段", async () => {
    const audio = "fake-mp3-bytes";
    replies = {
        get_record: {
            status: "ok", retcode: 0,
            data: {
                file: "C:/napcat/tmp/abc.mp3",
                url: "file:///C:/napcat/tmp/abc.mp3",
                base64: Buffer.from(audio).toString("base64"),
            },
        },
        fetch_ptt_text: { status: "ok", retcode: 0, data: { text: "明天见" } },
    };

    const [seg] = await server.toSegments(recordEvent());

    assert.equal(seg.type, "voice");
    assert.equal(seg.data.text, "明天见");
    assert.equal(seg.data.duration, 3);
    assert.equal(seg.data.media.uri, "https://example.com/a.amr", "原始链接保留");
    assert.deepEqual(pttCalls, ["1234"], "转写要带上 message_id");

    const localPath = seg.data.media.localPath;
    created.push(localPath);
    assert.match(localPath, /data[\\/]voices[\\/]voice-.*\.mp3$/, "落进 core/data/voices/");
    assert.equal(await readFile(localPath, "utf8"), audio, "落地内容与 base64 一致");
});

test("语音：转码失败时消息照样进上下文，只丢掉本地文件", async () => {
    replies = { fetch_ptt_text: { status: "ok", retcode: 0, data: { text: "晚安" } } };

    const [seg] = await server.toSegments(recordEvent());

    assert.equal(seg.type, "voice");
    assert.equal(seg.data.text, "晚安");
    assert.equal(seg.data.media.localPath, undefined);
    assert.equal(seg.data.media.uri, "https://example.com/a.amr");
});

test("语音：转写失败时只留段本身，duration 非法字段被丢弃", async () => {
    const [seg] = await server.toSegments(recordEvent({ duration: 0 }));

    assert.deepEqual(seg, { type: "voice", data: { media: { uri: "https://example.com/a.amr" } } });
});

test("语音：get_record 先回 async 受理帧时继续等，最终回包照常落地", async () => {
    const audio = "fake-mp3-bytes";
    replies = {
        get_record: [
            { status: "async", retcode: 1 },
            { status: "ok", retcode: 0, data: { base64: Buffer.from(audio).toString("base64") } },
        ],
    };

    const [seg] = await server.toSegments(recordEvent());

    assert.equal(seg.type, "voice");
    const localPath = seg.data.media.localPath;
    created.push(localPath);
    assert.match(localPath, /data[\\/]voices[\\/]voice-.*\.mp3$/, "落进 core/data/voices/");
    assert.equal(await readFile(localPath, "utf8"), audio, "落地内容与 base64 一致");
});

// ---------------------------------------------------------------- 发：voice → record

test("发送语音：本地文件转 record 段", async () => {
    const realFile = join(tmpdir(), `cith-voice-${Date.now()}.mp3`);
    await writeFile(realFile, "x");
    created.push(realFile);

    const sent = [];
    const adapter = new OnebotAdapter(noop, { send: (payload) => sent.push(JSON.parse(payload)) });
    await adapter.sendMsg({ from: "group", id: "10001", channel: "onebot" }, [
        { type: "voice", data: { media: { localPath: realFile } } },
    ]);

    assert.equal(sent.length, 1);
    const [seg] = sent[0].params.message;
    assert.equal(seg.type, "record");
    assert.match(seg.data.file, /^file:\/\//, "本地文件要转成 file:// URL");
});

test("发送语音：缺少可用媒体时整条消息跳过，不发残缺段", async () => {
    const sent = [];
    const adapter = new OnebotAdapter(noop, { send: (payload) => sent.push(JSON.parse(payload)) });

    await adapter.sendMsg({ from: "group", id: "10001", channel: "onebot" }, [
        { type: "voice", data: { media: { localPath: "data/voices/不存在.mp3" } } },
    ]);
    assert.equal(sent.length, 0);
});

test("语音只有 OneBot 能发，微信能力集里没有这个段", () => {
    const onebot = new OnebotAdapter(noop, { send() {} });
    const wechat = new WechatBotAdapter(noop, {});

    assert.deepEqual(segmentTypes(onebot.replyTool()), ["text", "image", "file", "voice", "mention", "reply"]);
    assert.ok(!segmentTypes(wechat.replyTool()).includes("voice"));
});
