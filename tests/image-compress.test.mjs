/**
 * 识图前压缩测试
 *
 * 覆盖四件事：
 * - 超过最长边的图被等比缩小到 1568 以内（png 保透明、jpg 走重编码）
 * - 尺寸与体积都在范围内的图原样返回，不做多余的编码损失
 * - webp 不解码（jimp 没有 webp 解码器），原样交给视觉模型
 * - 压缩后仍是视觉模型认得的类型
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Jimp } from "jimp";

import { compressForVision } from "../core/utils/image-compress.ts";

/** 造一张纯色图 */
async function makeImage(width, height, mime, options) {
    const image = new Jimp({ width, height, color: 0x3366ccff });
    return Buffer.from(await image.getBuffer(mime, options));
}

test("超尺寸 png：等比缩小到最长边 1568，仍发 png", async () => {
    const src = await makeImage(2000, 1000, "image/png");

    const out = await compressForVision(src, "png");

    assert.equal(out.compressed, true);
    assert.equal(out.type, "png");
    const meta = await Jimp.fromBuffer(out.buf);
    assert.equal(Math.max(meta.bitmap.width, meta.bitmap.height), 1568);
    assert.equal(meta.bitmap.width, 1568, "保持比例");
    assert.equal(meta.bitmap.height, 784);
    assert.match(out.detail, /2000x1000 .* → 1568x784 /);
});

test("超尺寸 jpg：缩小并重编码，体积明显下降", async () => {
    const src = await makeImage(2000, 1000, "image/jpeg", { quality: 100 });

    const out = await compressForVision(src, "jpg");

    assert.equal(out.compressed, true);
    assert.equal(out.type, "jpg");
    assert.ok(out.buf.length < src.length, "重编码后应更小");
    const meta = await Jimp.fromBuffer(out.buf);
    assert.equal(meta.bitmap.width, 1568);
});

test("小图原样返回：不缩放、不重编码", async () => {
    const src = await makeImage(300, 200, "image/png");

    const out = await compressForVision(src, "png");

    assert.equal(out.compressed, false);
    assert.equal(out.buf, src, "不做多余的编码损失");
    assert.equal(out.detail, undefined);
});

test("webp 原样返回：jimp 不解码 webp", async () => {
    // 内容不必是真 webp——压缩层根本不该尝试解码它
    const src = Buffer.from("RIFF\0\0\0\0WEBPVP8 ");

    const out = await compressForVision(src, "webp");

    assert.equal(out.compressed, false);
    assert.equal(out.buf, src);
    assert.equal(out.type, "webp");
});
