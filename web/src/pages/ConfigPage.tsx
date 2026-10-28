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
    const [notice, setNotice] = useState<Notice | null>(null);
    const [saving, setSaving] = useState(false);

    const snapshot: ConfigSnapshot = data ?? {};
    const keys = Object.keys(snapshot).sort();

    const startEdit = (key: string, value: unknown) => {
        setNotice(null);
        setEditing({ key, draft: typeof value === "string" ? value : JSON.stringify(value) });
    };

    const save = async () => {
        if (!editing) return;
        let value: unknown;
        try {
            value = JSON.parse(editing.draft);
        } catch {
            value = editing.draft; // 非法 JSON 按原始字符串提交（字符串字段无需手写引号）
        }
        setSaving(true);
        try {
            await rpc("set_config", { key: editing.key, value });
            setNotice({ tone: "ok", text: `已热改配置项 ${editing.key}` });
            setEditing(null);
            await refresh();
        } catch (err) {
            setNotice({ tone: "err", text: err instanceof Error ? err.message : String(err) });
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
                    敏感字段（key/token/secret/password/pem 等）已由 Bot 端脱敏，不可编辑。
                    其余字段点击「编辑」尝试热改；不在 Bot 白名单内的字段会被拒绝并提示原因。
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
