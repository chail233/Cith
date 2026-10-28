/**
 * 配置页：get_config 查看脱敏快照 + set_config 白名单字段热改。
 * 白名单由 Bot 端控制且随迭代变化，前端不硬编码：对所有非脱敏字段开放编辑，
 * 非法修改（字段不存在 / 不在白名单）由 Bot 返回错误并在此展示。
 */
import { useState } from "react";
import { Badge, Card, EmptyState, ErrorBanner, Loading } from "../components/ui";
import { usePolling } from "../hooks/usePolling";
import { rpc } from "../api/client";
import type { ConfigSnapshot } from "../types";
import { formatValue } from "../utils/format";

/** 脱敏值固定为 "***"，不可编辑（避免把掩码原样写回覆盖真实配置） */
const MASK = "***";

interface Editing {
    key: string;
    draft: string;
}
interface Notice {
    tone: "ok" | "err";
    text: string;
}

export default function ConfigPage() {
    const { data, error, loading, refresh } = usePolling(() => rpc<ConfigSnapshot>("get_config"));
    const [editing, setEditing] = useState<Editing | null>(null);
    const [editError, setEditError] = useState<string | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [saving, setSaving] = useState(false);

    const snapshot: ConfigSnapshot = data ?? {};
    const keys = Object.keys(snapshot).sort();

    const startEdit = (key: string, value: unknown) => {
        setNotice(null);
        setEditError(null);
        setEditing({ key, draft: typeof value === "string" ? value : JSON.stringify(value) });
    };

    const save = async () => {
        if (!editing) return;
        const original = snapshot[editing.key];
        let value: unknown;
        if (typeof original === "string") {
            // 字符串字段原样提交：避免 "1744315424" 被 JSON.parse 解析成数字、"true" 变布尔
            value = editing.draft;
        } else {
            // 布尔/数字/数组等 JSON 值字段：必须输入合法 JSON
            try {
                value = JSON.parse(editing.draft);
            } catch {
                setEditError("该字段是 JSON 值，请输入合法 JSON，如 30、true、[\"a\",\"b\"]");
                return;
            }
            if (Array.isArray(original) && !Array.isArray(value)) {
                setEditError("该字段是数组，请输入 JSON 数组，如 [\"a\",\"b\"]");
                return;
            }
        }
        setEditError(null);
        setSaving(true);
        try {
            await rpc("set_config", { key: editing.key, value });
            setNotice({ tone: "ok", text: `已热改配置项 ${editing.key}` });
            setEditing(null);
            await refresh();
        } catch (err) {
            // 失败原因直接显示在编辑行内，页面顶部同步提示（表长时顶部提示容易被忽略）
            const text = err instanceof Error ? err.message : String(err);
            setEditError(text);
            setNotice({ tone: "err", text });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="page">
            {notice && <div className={`notice notice-${notice.tone}`}>{notice.text}</div>}
            {error && <ErrorBanner message={`获取配置失败：${error}`} onRetry={refresh} />}

            <Card
                title="配置快照（脱敏）"
                extra={
                    <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>
                        刷新
                    </button>
                }
            >
                <p className="text-muted config-hint">
                    字符串字段输入什么就存什么；布尔/数字/数组字段需输入 JSON 值（如 true、30、["a","b"]）。
                    敏感字段（key/token/secret/password/pem 等）已由 Bot 端脱敏，不可编辑。
                    不在 Bot 白名单内的字段会被拒绝并提示原因。
                </p>
                {loading && !data ? (
                    <Loading text="正在获取配置..." />
                ) : keys.length === 0 ? (
                    <EmptyState text="配置快照为空" />
                ) : (
                    <div className="table-wrap">
                        <table className="config-table">
                            <thead>
                                <tr>
                                    <th>配置项</th>
                                    <th>当前值</th>
                                    <th className="col-actions">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {keys.map((key) => {
                                    const value = snapshot[key];
                                    const masked = value === MASK;
                                    return (
                                        <tr key={key}>
                                            <td className="mono config-key">{key}</td>
                                            <td className="mono config-value">
                                                {editing?.key === key ? (
                                                    <div>
                                                        <input
                                                            className="input mono"
                                                            autoFocus
                                                            value={editing.draft}
                                                            onChange={(e) => setEditing({ key, draft: e.target.value })}
                                                            onKeyDown={(e) => {
                                                                if (e.key === "Enter") void save();
                                                                if (e.key === "Escape") setEditing(null);
                                                            }}
                                                        />
                                                        {editError && <div className="notice notice-err">{editError}</div>}
                                                    </div>
                                                ) : (
                                                    <span title={formatValue(value, 1000)}>
                                                        {masked ? <Badge tone="warn">已脱敏</Badge> : null}
                                                        {masked ? "" : formatValue(value)}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="col-actions">
                                                {editing?.key === key ? (
                                                    <div className="btn-row">
                                                        <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
                                                            {saving ? "保存中..." : "保存"}
                                                        </button>
                                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                                                            取消
                                                        </button>
                                                    </div>
                                                ) : masked ? (
                                                    <span className="text-muted">不可改</span>
                                                ) : (
                                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(key, value)}>
                                                        编辑
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
