import BaseAdapter from "./BaseAdapter.ts";
import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";
import logger from "../../utils/logger.js";
import { mediaBasename, resolveSendablePath } from "../../utils/segment-media.ts";
import { renderApprovalNotice, toApprovalData } from "../../utils/approval-notice.ts";
import { pathToFileURL } from "node:url";
import { fileCap, imageCap, textCap } from "./reply-segment-caps.ts";
import type { ReplySegmentCap } from "./reply-tool.ts";

/**
 * 本适配器支持的消息段能力
 * 只声明 OneBot 发得出去的段
 */
const ONEBOT_CAPS: ReplySegmentCap[] = [
    textCap(),
    imageCap(),
    fileCap(),
    {
        type: "mention",
        description: "@ 某人：id 取历史消息里可见的发送者 ID，填 all 表示全体成员",
        data: {
            type: "object",
            properties: { id: { type: "string", description: "被 @ 的用户 ID，或 all" } },
            required: ["id"],
            additionalProperties: false,
        },
        parse(data) {
            const id = typeof data.id === "string" ? data.id.trim() : "";
            if (id === "") return { error: "data.id 为空" };
            return { segment: { type: "mention", data: { id } } };
        },
    },
    {
        type: "reply",
        description: "引用回复一条消息；其后必须紧跟要发送的内容段",
        data: {
            type: "object",
            properties: { id: { type: "string", description: "被回复消息的 messageId" } },
            required: ["id"],
            additionalProperties: false,
        },
        parse(data) {
            const id = typeof data.id === "string" ? data.id.trim() : "";
            if (id === "") return { error: "data.id 为空" };
            return { segment: { type: "reply", data: { id } } };
        },
    },
];

export default class OnebotAdapter extends BaseAdapter{
    private ws: any;
    constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>, ws: any) {
        super(pipeline);
        this.ws = ws;
    }

    protected replyCapabilities(): ReplySegmentCap[] {
        return ONEBOT_CAPS;
    }

    sendAction(actionObj: Action) {
        const payload = JSON.stringify(actionObj);
        logger.debug("onebot发送动作:", actionObj.action);
        this.ws.send(payload);
    }

    async sendMsg(space:Space, message: string | MessageSegment | MessageSegment[]) {
        const isGroup = space.from === "group";
        const segments = (Array.isArray(message) ? message : [message])
            .flatMap((seg) => {
                const onebotSegment = this.toOnebotSegment(seg, isGroup);
                if (onebotSegment === null) return [];
                return Array.isArray(onebotSegment) ? onebotSegment : [onebotSegment];
            });
        if (segments.length === 0) return;
        this.sendAction({
            action: "send_msg",
            params: {
                message_type: space.from==="group" ? "group" : "private",
                group_id: space.from==="group"? space.id : null,
                user_id: space.from==="user"?space.id : null,
                message: segments
            },
        });
    }

    /**
     * 统一消息段 → OneBot v11 发送段；不支持/缺资源的类型返回 null 跳过
     * @param isGroup 群聊为 true，用于 tool_approval 段是否附带 @ 发起人
     * @returns 单个发送段，或需拆分发送的段数组（如 @ + 文本）
     */
    private toOnebotSegment(message: string | MessageSegment, isGroup: boolean): object | object[] | null {
        // 字符串是 text 段的书写糖
        if (typeof message === "string") {
            return { type: "text", data: { text: message } };
        }
        switch (message.type) {
            case "text":
                return { type: "text", data: { text: message.data.text ?? "" } };

            case "image": {
                const media = (message.data as { media?: MediaLike }).media;
                const file = toOnebotFile(media);
                if (!file) {
                    logger.warn("OnebotAdapter 发送图片缺少 uri/localPath，跳过");
                    return null;
                }
                return { type: "image", data: { file } };
            }

            case "file": {
                const media = (message.data as { media?: MediaLike }).media;
                const file = toOnebotFile(media);
                if (!file) {
                    logger.warn("OnebotAdapter 发送文件缺少 uri/localPath，跳过");
                    return null;
                }
                const name = (message.data as { name?: string }).name;
                return { type: "file", data: { file, name: name ?? mediaBasename(media) } };
            }

            case "mention": {
                const id = (message.data as { id?: string }).id ?? "";
                if (id === "") return null;
                return { type: "at", data: { qq: id } };
            }

            case "reply": {
                // OneBot reply 段：id 为被回复消息的 ID，需与内容段同消息发送
                const id = (message.data as { id?: string }).id ?? "";
                if (id === "") return null;
                return { type: "reply", data: { id } };
            }

            case "tool_approval": {
                // 门禁询问：群聊里先 @ 发起人，方便管理员对上号；私聊与非法 QQ 号只发文本
                const data = toApprovalData(message.data);
                const text = { type: "text", data: { text: renderApprovalNotice(data) } };
                if (isGroup && /^\d+$/.test(data.requestedBy)) {
                    return [{ type: "at", data: { qq: data.requestedBy } }, text];
                }
                return text;
            }

            default:
                logger.warn("OnebotAdapter 暂不支持发送该消息段类型:", message.type);
                return null;
        }
    }
}

interface Action{
    action: string;
    params?: any;
    echo?: string;
}

interface MediaLike {
    uri?: string;
    localPath?: string;
}

/** 媒体引用 → OneBot file 字段值：本地路径转绝对路径后转 file:// URL，http(s) 链接直传 */
function toOnebotFile(media: MediaLike | undefined | null): string | null {
    if (media?.localPath) {
        const localPath = resolveSendablePath(media.localPath);
        return localPath ? pathToFileURL(localPath).href : null;
    }
    if (media?.uri && /^https?:\/\//.test(media.uri)) return media.uri;
    return null;
}
