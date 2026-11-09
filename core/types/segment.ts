export interface MediaRef {
    uri: string;
    localPath?: string;
}


export interface MsgSegment {
    text: { text: string };
    image: { media: MediaRef; alt?: string };
    file: { media: MediaRef; name?: string };
    mention: { id: string; name?: string; isSelf?: boolean };
    reply: { id: string; excerpt?: string };
    link_card: { title: string; url?: string; description?: string };
    tool_approval: ToolApprovalData;
}

/**
 * 工具门禁挂起的确认询问
 * 只由代码构造、只在发送方向存在：模型词表里没有它，也不会进入对话记忆
 */
export interface ToolApprovalData {
    /** 待确认操作编号 */
    id: string;
    /** 被挂起的工具名 */
    toolName: string;
    /** 发起人 ID（群聊里适配器可 @ 他） */
    requestedBy: string;
    /** 发起人昵称 */
    requestedByName: string;
    /** 挂起原因（guard 判定 / 未配置 guard 模型等） */
    reason?: string;
    /** 被挂起的调用参数摘要（已截断） */
    summary?: string;
}

