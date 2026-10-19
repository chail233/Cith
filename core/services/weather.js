// @ts-check

import axios from "axios";
import config from "../config.js";
import logger from "../utils/logger.js";

const KEY = config.qweatherKEY;
const BASE_URL = config.QW_BASE_URL;
const GEO_BASE = config.QW_GEO_BASE;

/** axios 实例，统一超时 */
const api = axios.create({ timeout: 8000 });

/**
 * 获取城市 locationId
 * @param {string} cityName 城市名
 * @returns {Promise<string|null>}
 */
export async function getLocationId(cityName) {
    try {
        const resp = await api.get(`${GEO_BASE}/city/lookup`, {
            params: { location: cityName, key: KEY },
        });
        const json = resp.data;
        if (json.code !== "200") return null;
        return json.location[0].id;
    } catch (e) {
        logger.error("获取城市ID失败:", e.response?.status, e.response?.data);
        return null;
    }
}

/**
 * 获取实时天气
 * @param {string} locationId
 * @returns {Promise<object|null>}
 */
export async function getNowWeather(locationId) {
    try {
        const resp = await api.get(`${BASE_URL}/weather/now`, {
            params: { location: locationId, key: KEY },
        });
        const json = resp.data;
        if (json.code !== "200") return null;
        return json.now;
    } catch (e) {
        logger.error("获取实时天气失败:", e.message);
        return null;
    }
}

/**
 * 获取 7 天预报
 * @param {string} locationId
 * @returns {Promise<Array|null>}
 */
export async function get7dWeather(locationId) {
    try {
        const resp = await api.get(`${BASE_URL}/weather/7d`, {
            params: { location: locationId, key: KEY },
        });
        const json = resp.data;
        if (json.code !== "200") return null;
        return json.daily;
    } catch (e) {
        logger.error("获取7天预报失败:", e.message);
        return null;
    }
}

/**
 * 一键获取城市天气（含实时+7天预报）
 * @param {string} cityName
 * @returns {Promise<{now?: object, daily7d?: Array, error?: string}>}
 */
export async function getWeatherByCity(cityName) {
    const lid = await getLocationId(cityName);
    if (!lid) return { error: "找不到该城市" };
    const now = await getNowWeather(lid);
    const daily7d = await get7dWeather(lid);
    if (!now || !daily7d) return { error: "天气接口请求异常" };
    return { now, daily7d };
}

/**
 * 格式化天气数据为聊天文本
 * @param {{now?: object, daily7d?: Array, error?: string}} weatherRes
 * @param {string} cityName
 * @returns {string}
 */
export function formatWeatherText(weatherRes, cityName) {
    if (weatherRes.error) {
        return weatherRes.error;
    }
    const { now, daily7d } = weatherRes;

    const nowStr = `🌤 ${cityName} 实时天气
${now.text}｜${now.temp}℃
体感：${now.feelsLike}℃
风向：${now.windDir} ${now.windScale}级
湿度：${now.humidity}%`;

    const today = daily7d[0];
    const todayStr = `
📅今日(${today.fxDate})
白天：${today.textDay}  ${today.tempMin}~${today.tempMax}℃
夜间：${today.textNight}
紫外线：${today.uvIndex}`;

    const day1 = daily7d[1];
    const day2 = daily7d[2];
    const futureStr = `
📆${day1.fxDate}：${day1.textDay} ${day1.tempMin}~${day1.tempMax}℃
📆${day2.fxDate}：${day2.textDay} ${day2.tempMin}~${day2.tempMax}℃`;

    return nowStr + todayStr + futureStr;
}

/**
 * 获取城市天气文本（一键接口）
 * @param {string} city
 * @returns {Promise<string>}
 */
export async function getWeatherText(city) {
    const weather = await getWeatherByCity(city);
    return formatWeatherText(weather, city);
}