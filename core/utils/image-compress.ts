/**
 * 识图前的图片压缩
 * 手机原图动辄几千万像素，直接 base64 丢给视觉模型既贵又慢，先缩到视觉模型划算的边长再发
 */
import { Jimp } from "jimp";
import logger from "./logger.js";

/** 视觉模型侧可接受的图片类型（gif 在工具入口处就被拦下） */
export type VisionImageType = "jpg" | "png" | "webp";

/** 缩放后的最长边（像素）：再大对识别精度几乎没有增益，token 却按面积涨 */
const MAX_EDGE = 1568;

/** 体积上限：超过就重编码一次（尺寸没超但文件很大，通常是编码太糙） */
const MAX_BYTES = 1.5 * 1024 * 1024;

/** jpg 重编码质量 */
const JPEG_QUALITY = 85;

export interface CompressedImage {
    buf: Buffer;
    type: VisionImageType;
    /** 是否真的做了缩放/重编码 */
    compressed: boolean;
    /** 压缩前后的对比说明，未压缩时为 undefined */
    detail?: string;
}

/** 人类可读的体积 */
function kb(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}

/**
 * 按需压缩图片，返回可直接送给视觉模型的内容
 * 尺寸与体积都在范围内就原样返回——缩图与重编码都会损失细节，小图不值得付这个代价；
 * 解码失败也回退原图，让视觉模型自己去判断
 * @param buf 原始图片内容
 * @param type 图片类型（由魔数校验得出）
 */
export async function compressForVision(buf: Buffer, type: VisionImageType): Promise<CompressedImage> {
    // jimp 不含 webp 解码器；webp 本来也比 jpg 紧凑，原样发送
    if (type === "webp") return { buf, type, compressed: false };

    let image;
    try {
        image = await Jimp.fromBuffer(buf);
    }
    catch (err) {
        logger.warn("图片解码失败，按原图送视觉模型:", err instanceof Error ? err.message : err);
        return { buf, type, compressed: false };
    }

    const before = { width: image.bitmap.width, height: image.bitmap.height };
    const tooBig = Math.max(before.width, before.height) > MAX_EDGE;
    const tooHeavy = buf.length > MAX_BYTES;
    if (!tooBig && !tooHeavy) return { buf, type, compressed: false };

    if (tooBig) image.scaleToFit({ w: MAX_EDGE, h: MAX_EDGE });

    // png 保住透明通道；jpg 走重编码压体积
    const out = type === "png"
        ? await image.getBuffer("image/png")
        : await image.getBuffer("image/jpeg", { quality: JPEG_QUALITY });

    // 只压体积时，重编码反而更大说明原图编码已经够好，保留原图
    if (!tooBig && out.length >= buf.length) return { buf, type, compressed: false };

    const after = { width: image.bitmap.width, height: image.bitmap.height };
    return {
        buf: out,
        type,
        compressed: true,
        detail: `${before.width}x${before.height} ${kb(buf.length)} → ${after.width}x${after.height} ${kb(out.length)}`,
    };
}
