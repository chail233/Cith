import axios from "axios";
import config from "../config.js";
import logger from "../utils/logger.js";

/**
 * NapCat HTTP API 客户端
 * 通过 HTTP 请求调用 NapCat 的 OneBot API
 * （部分操作如 get_image 只能通过 HTTP 完成）
 */

const BASE_URL = `http://${config.napcatHttpHost}`;

/** axios 实例，统一超时和鉴权头 */
const http = axios.create({
    baseURL: BASE_URL,
    timeout: 10000,
    headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
});

/**
 * 调用 NapCat HTTP API
 * @param {string} action OneBot 动作名
 * @param {object} params 参数
 * @param {boolean} [quiet] 可预期的失败只 warn，不打 error（如 QQ 侧未开通语音转写）
 * @returns {Promise<{status?: string, retcode?: number, data?: any}|null>} 响应体或 null
 */
async function callAPI(action, params, quiet = false) {
    try {
        const url = `/${action}`;
        const resp = await http.post(url, params);
        return resp.data;
    }
    catch (err) {
        const e = /** @type {{response?: {data?: unknown}, message?: string}} */ (err);
        const detail = e.response?.data || e.message;
        if (quiet) {
            logger.warn(`NapCat HTTP API 调用未成功 [${action}]:`, detail);
        }
        else {
            logger.error(`NapCat HTTP API 调用失败 [${action}]:`, detail);
        }
        return null;
    }
}

/**
 * 获取图片信息
 * @param {string} fileId NapCat 的图片 file 标识
 * @returns {Promise<{data?: {file?: string}}|null>} { data: { file, url, ... } } 或 null
 */
export async function getImage(fileId) {
    return callAPI("get_image", { file: fileId });
}

/**
 * 获取语音文件
 * 转码后 data.file / data.url 都指向本机转码产物，data.base64 是同一份数据
 * @param {string} file NapCat 的语音 file 标识（收到的 record 段 data.file）
 * @param {"mp3"|"amr"|"wma"|"m4a"|"spx"|"ogg"|"wav"|"flac"} [outFormat] 目标格式
 * @returns {Promise<{data?: {file?: string, url?: string, base64?: string}}|null>} 响应或 null
 */
export async function getRecord(file, outFormat = "mp3") {
    return callAPI("get_record", { file, out_format: outFormat });
}

/**
 * 语音转文字
 * 走 QQ 客户端原生转写（NapCat 的 fetch_ptt_text）
 * 只有「消息里确实有语音、且 QQ 侧已开通转写」时才有结果，因此失败只 warn
 * @param {string} messageId 语音所在消息的 message_id
 * @returns {Promise<string>} 转写文本；失败或消息不含语音时返回空串
 */
export async function fetchPttText(messageId) {
    if (!messageId) return "";
    const resp = await callAPI("fetch_ptt_text", { message_id: messageId }, true);
    const text = resp?.data?.text;
    return typeof text === "string" ? text : "";
}
