// @ts-check

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
 * @returns {Promise<object|null>} 响应 data 或 null
 */
async function callAPI(action, params) {
    try {
        const url = `/${action}`;
        const resp = await http.post(url, params);
        return resp.data;
    } catch (err) {
        logger.error(`NapCat HTTP API 调用失败 [${action}]:`, err.response?.data || err.message);
        return null;
    }
}

/**
 * 获取图片信息
 * @param {string} fileId NapCat 的图片 file 标识
 * @returns {Promise<object|null>} { file, url, ... } 或 null
 */
export async function getImage(fileId) {
    return callAPI("get_image", { file: fileId });
}

/**
 * 通过 HTTP 发送群消息（备用方式，通常走 WebSocket 更高效）
 * @param {string|number} groupId
 * @param {string|object|Array} message
 * @returns {Promise<object|null>}
 */
export async function sendGroupMsg(groupId, message) {
    return callAPI("send_group_msg", { group_id: groupId, message });
}