
/**
 * OneBot 动作构建器
 * 每个函数构建一个 OneBot 动作对象，供 adapter.sendAction() 发送
 */

/**
 * 构建一个 OneBot 动作对象
 * @param {string} action 动作名
 * @param {object} params 参数
 * @param {string} [echo] 回显标识
 * @returns {{action: string, params: object, echo?: string}}
 */
export function buildAction(action, params, echo) {
    return { action, params, ...(echo ? { echo } : {}) };
}

/**
 * 构建图片消息段
 * @param {string} file 图片URL或文件路径
 * @returns {{type: "image", data: {file: string}}}
 */
export function imageSegment(file) {
    return { type: "image", data: { file } };
}

/**
 * 构建文本消息段
 * @param {string} text
 * @returns {{type: "text", data: {text: string}}}
 */
export function textSegment(text) {
    return { type: "text", data: { text } };
}