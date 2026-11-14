/** 能力清单页：list_actions 动态展示 Bot 当前支持的 action */
import { Badge, Card, EmptyState, ErrorBanner, Loading } from "../components/ui";
import { usePolling } from "../hooks/usePolling";
import { rpc } from "../api/client";
import { ACTION_DESCRIPTIONS, type ActionsInfo } from "../types";

export default function ActionsPage() {
    const { data, error, loading, refresh } = usePolling(() => rpc<ActionsInfo>("list_actions"), 30_000);
    const actions = data?.actions ?? [];

    return (
        <div className="page">
            {error && <ErrorBanner message={`获取能力清单失败：${error}`} onRetry={refresh} />}
            <Card
                title="Bot 可用 Action"
                extra={
                    <div className="card-extra">
                        <span className="text-muted">每 30 秒刷新</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>
                            刷新
                        </button>
                    </div>
                }
            >
                <p className="text-muted config-hint">
                    清单来自 Bot 的 list_actions 动作。所有请求经 BFF 白名单转发，未列出的 action 无法调用。
                </p>
                {loading && actions.length === 0 ? (
                    <Loading text="正在获取能力清单..." />
                ) : actions.length === 0 ? (
                    <EmptyState text="暂无可用 action" />
                ) : (
                    <div className="action-grid">
                        {actions.map((name) => {
                            const desc = ACTION_DESCRIPTIONS[name];
                            return (
                                <div key={name} className="action-card">
                                    <div className="action-head">
                                        <code className="mono action-name">{name}</code>
                                        <Badge tone={desc ? "ok" : "warn"}>{desc ? "已支持" : "未知能力"}</Badge>
                                    </div>
                                    <p className="action-desc">{desc ?? "Bot 端新增的 action，本面板尚未收录说明。"}</p>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>
        </div>
    );
}
