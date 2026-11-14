/**
 * 模型价格页：给每个模型填「元 / 百万 tokens」单价，用量页的金额按此处价目现算。
 * 保存是整体替换：把整张表提交给 Bot；缓存价留空表示与输入价相同。
 */
import { useEffect, useRef, useState } from "react";
import { Badge, Card, EmptyState, ErrorBanner, Loading } from "../components/ui";
import { usePolling } from "../hooks/usePolling";
import { rpc } from "../api/client";
import type { ModelPrice, ModelPricingInfo, TokenUsageSummary } from "../types";

/** 一行草稿：价格按字符串编辑，保存时再转数字（空串表示未填） */
interface PriceRow {
    name: string;
    input: string;
    cachedInput: string;
    output: string;
}

interface Notice {
    tone: "ok" | "err";
    text: string;
}

const EMPTY_ROW: PriceRow = { name: "", input: "", cachedInput: "", output: "" };

const SEEN_MODELS_ID = "pricing-seen-models";

export default function PricingPage() {
    const { data, error, loading, refresh } = usePolling(() => rpc<ModelPricingInfo>("get_model_pricing"));
    // 未定价模型来自用量统计，与能改价的模型列表合在一起展示
    const { data: usage, refresh: refreshUsage } = usePolling(
        () => rpc<TokenUsageSummary>("get_token_usage", { days: 7 }),
        60_000,
    );
    const [rows, setRows] = useState<PriceRow[]>([]);
    const [newRow, setNewRow] = useState<PriceRow>(EMPTY_ROW);
    /** 有未保存修改时不用服务端数据覆盖草稿，避免刷新冲掉输入 */
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);
    /** 已同步过的服务端快照：同一份数据只灌一次草稿，避免保存后重新拉取前被旧值闪回 */
    const syncedRef = useRef<ModelPricingInfo | null>(null);

    useEffect(() => {
        if (!data || data === syncedRef.current || dirty) return;
        syncedRef.current = data;
        setRows(Object.entries(data.models).map(([name, price]) => toRow(name, price)));
    }, [data, dirty]);

    const unpriced = usage?.total.unpricedModels ?? [];
    const seenModels = data?.seenModels ?? [];

    const update = (index: number, patch: Partial<PriceRow>) => {
        setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
        setDirty(true);
        setNotice(null);
    };

    const remove = (index: number) => {
        setRows((prev) => prev.filter((_, i) => i !== index));
        setDirty(true);
        setNotice(null);
    };

    const addNamed = (name: string) => {
        if (name === "" || rows.some((row) => row.name.trim() === name)) return;
        setRows((prev) => [...prev, { ...EMPTY_ROW, name }]);
        setDirty(true);
        setNotice(null);
    };

    const addFromInput = () => {
        const name = newRow.name.trim();
        if (name === "") {
            setNotice({ tone: "err", text: "请先填写要新增的模型 ID" });
            return;
        }
        if (rows.some((row) => row.name.trim() === name)) {
            setNotice({ tone: "err", text: `模型 ID 已存在：${name}` });
            return;
        }
        addNamed(name);
        setNewRow(EMPTY_ROW);
    };

    const save = async () => {
        let models: Record<string, ModelPrice>;
        try {
            models = buildModels(rows);
        } catch (err) {
            setNotice({ tone: "err", text: err instanceof Error ? err.message : String(err) });
            return;
        }
        setSaving(true);
        try {
            await rpc("set_model_pricing", { models });
            setDirty(false);
            setNotice({ tone: "ok", text: "价格表已保存，用量金额按新价重算" });
            await refresh();
            await refreshUsage();
        } catch (err) {
            setNotice({ tone: "err", text: err instanceof Error ? err.message : String(err) });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="page">
            {notice && <div className={`notice notice-${notice.tone}`}>{notice.text}</div>}
            {error && <ErrorBanner message={`获取模型价格失败：${error}`} onRetry={refresh} />}

            <Card
                title="模型价格"
                extra={
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
                        刷新
                    </button>
                }
            >
                <p className="text-muted config-hint">
                    单价单位：元 / 百万 tokens（填 2 表示 ¥2 / 百万 tokens）。
                    金额在读取用量时按此处价目现算，改价后历史记录会自动按新价重算；
                    缓存价留空表示与输入价相同。价格表单独保存在 Bot 的
                    <span className="mono"> data/model-pricing.json</span>，不写进 config.json。
                </p>

                {unpriced.length > 0 && (
                    <p className="text-muted config-hint">
                        <Badge tone="warn">未计价</Badge>
                        用量里出现但价格表中没有的模型（点一下加进来）：
                        {unpriced.map((name) => (
                            <button
                                key={name}
                                type="button"
                                className="btn btn-ghost btn-sm mono"
                                onClick={() => addNamed(name)}
                            >
                                + {name}
                            </button>
                        ))}
                    </p>
                )}

                {loading && !data ? (
                    <Loading text="正在获取模型价格..." />
                ) : (
                    <>
                        {rows.length === 0 ? (
                            <EmptyState text="还没有定价条目，用下方「新增模型」把正在用的模型加进来" />
                        ) : (
                            <div className="table-wrap">
                                <table className="config-table pricing-table">
                                    <thead>
                                        <tr>
                                            <th>模型 ID</th>
                                            <th>输入价</th>
                                            <th>缓存命中价</th>
                                            <th>输出价</th>
                                            <th className="col-actions">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row, index) => (
                                            <tr key={index}>
                                                <td>
                                                    <input
                                                        className="input mono"
                                                        value={row.name}
                                                        list={SEEN_MODELS_ID}
                                                        placeholder="模型 ID"
                                                        onChange={(e) => update(index, { name: e.target.value })}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        className="input mono"
                                                        value={row.input}
                                                        placeholder="必填"
                                                        onChange={(e) => update(index, { input: e.target.value })}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        className="input mono"
                                                        value={row.cachedInput}
                                                        placeholder="留空=输入价"
                                                        onChange={(e) => update(index, { cachedInput: e.target.value })}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        className="input mono"
                                                        value={row.output}
                                                        placeholder="必填"
                                                        onChange={(e) => update(index, { output: e.target.value })}
                                                    />
                                                </td>
                                                <td className="col-actions">
                                                    <button
                                                        type="button"
                                                        className="btn btn-ghost btn-sm"
                                                        onClick={() => remove(index)}
                                                    >
                                                        删除
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <div className="pricing-toolbar">
                            <input
                                className="input mono"
                                value={newRow.name}
                                list={SEEN_MODELS_ID}
                                placeholder="新增模型 ID，可从用过的模型里选"
                                onChange={(e) => setNewRow({ ...EMPTY_ROW, name: e.target.value })}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") addFromInput();
                                }}
                            />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={addFromInput}>
                                新增模型
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={saving || !dirty}
                                onClick={() => void save()}
                            >
                                {saving ? "保存中..." : dirty ? "保存价格表" : "无改动"}
                            </button>
                        </div>

                        <datalist id={SEEN_MODELS_ID}>
                            {seenModels.map((name) => (
                                <option key={name} value={name} />
                            ))}
                        </datalist>
                    </>
                )}
            </Card>
        </div>
    );
}

/** 服务端价格 → 草稿行；缓存价与输入价相同时留空，减少重复维护 */
function toRow(name: string, price: ModelPrice): PriceRow {
    return {
        name,
        input: String(price.input),
        cachedInput: price.cachedInput === price.input ? "" : String(price.cachedInput),
        output: String(price.output),
    };
}

/**
 * 草稿行 → 提交给 Bot 的价格表
 * @throws 模型 ID 为空/重复、价格非法时抛错，错误文案直接展示给用户
 */
function buildModels(rows: PriceRow[]): Record<string, ModelPrice> {
    const models: Record<string, ModelPrice> = {};
    for (const row of rows) {
        const name = row.name.trim();
        if (name === "") throw new Error("有一行的模型 ID 为空，请填写或删除该行");
        if (models[name]) throw new Error(`模型 ID 重复：${name}`);
        const input = parsePrice(row.input, name, "输入价");
        const output = parsePrice(row.output, name, "输出价");
        const cachedInput = row.cachedInput.trim() === ""
            ? input
            : parsePrice(row.cachedInput, name, "缓存命中价");
        models[name] = { input, cachedInput, output };
    }
    return models;
}

function parsePrice(text: string, model: string, label: string): number {
    const trimmed = text.trim();
    const n = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(n) || n < 0) {
        throw new Error(`${model} 的${label}无效，请填 0 以上的数字`);
    }
    return n;
}
