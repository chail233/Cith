// @ts-check

import getRandomInt from "../utils/random.js";

/**
 * 孙巴二娘图片 URL 列表
 */

const IMAGE_URLS = [
    "https://img.tofaka.com/autoupload/f/8d522/20260817/myLT/2048X2048/0.png",
    "https://img.tofaka.com/autoupload/f/8d522/20260817/lLLd/2048X2048/1.png",
    "https://img.tofaka.com/autoupload/f/8d522/20260817/70dM/2048X2048/2.png",
    "https://img.tofaka.com/autoupload/f/8d522/20260817/goJB/2048X2048/3.png",
    "https://img.tofaka.com/autoupload/f/8d522/20260817/nAFc/2048X2048/4.png",
    "https://img.tofaka.com/autoupload/f/8d522/20260817/OEzX/2048X2048/5.png",
    "https://img.tofaka.com/autoupload/f/8d522/20260817/x67e/2048X2048/6.png",
    "https://img.tofaka.com/autoupload/f/8d522/20260817/6idA/2048X2048/7.png",
    "https://img.tofaka.com/autoupload/f/8d522/20260817/bt7E/2048X2048/8.png",
    "https://img.tofaka.com/autoupload/f/8d522/20260817/ae99/1061X1059/9.png",
];

/**
 * 随机获取一张孙巴二娘图片 URL
 * @returns {string}
 */
export default function getRandomSunbatwoGirl() {
    const idx = getRandomInt(0, IMAGE_URLS.length - 1);
    return IMAGE_URLS[idx];
}