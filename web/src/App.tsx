/**
 * 面板主框架：hash 路由 + 侧边栏布局 + 顶栏连接状态。
 * - 会话探测：BFF 启用密码登录时先进入登录页，登录后挂载全局事件流；
 * - 顶栏状态灯：Bot 连接（/api/health 轮询）与 SSE 事件流连接。
 */
import { useEffect, useState } from "react";
import Dashboard from "./pages/Dashboard";
import ConfigPage from "./pages/ConfigPage";
import LogsPage from "./pages/LogsPage";
import ActionsPage from "./pages/ActionsPage";
import Login from "./components/Login";
import { StatusDot } from "./components/ui";
import { EventStreamProvider, useEventStream } from "./hooks/event-stream";
import { usePolling } from "./hooks/usePolling";
import { fetchHealth, fetchSession } from "./api/client";
import type { HealthInfo, SessionInfo } from "./types";

type Route = "dashboard" | "config" | "logs" | "actions";

const NAV: { id: Route; label: string; icon: string }[] = [
    { id: "dashboard", label: "运行状态", icon: "◉" },
    { id: "config", label: "配置管理", icon: "⚙" },
    { id: "logs", label: "事件日志", icon: "☰" },
    { id: "actions", label: "能力清单", icon: "⚡" },
];

const PAGE_TITLES: Record<Route, string> = {
    dashboard: "运行状态",
    config: "配置管理",
    logs: "事件日志",
    actions: "能力清单",
};

/** 极简 hash 路由（避免为此引入 react-router 依赖） */
function useHashRoute(): [Route, (r: Route) => void] {
    const parse = (): Route => {
        const h = window.location.hash.replace(/^#\/?/, "");
        return NAV.some((n) => n.id === h) ? (h as Route) : "dashboard";
    };
    const [route, setRoute] = useState<Route>(parse);
    useEffect(() => {
        const onHash = () => setRoute(parse());
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);
    const navigate = (r: Route) => {
        window.location.hash = `/${r}`;
    };
    return [route, navigate];
}

export default function App() {
    const [session, setSession] = useState<SessionInfo | null>(null);
    const [sessionError, setSessionError] = useState<string | null>(null);

    useEffect(() => {
        fetchSession()
            .then(setSession)
            .catch((err) => {
                setSessionError(err instanceof Error ? err.message : String(err));
                setSession({ required: false, authed: true });
            });
    }, []);

    if (!session) {
        return <div className="boot">{sessionError ?? "正在连接面板服务..."}</div>;
    }
    if (session.required && !session.authed) {
        return <Login onLogin={() => setSession({ required: true, authed: true })} />;
    }
    return (
        <EventStreamProvider>
            <Shell />
        </EventStreamProvider>
    );
}

function Shell() {
    const [route, navigate] = useHashRoute();
    // BFF 不可达时 health 为 null，状态灯转为灰色/红色提示
    const { data: health } = usePolling<HealthInfo>(fetchHealth, 5000);
    const { connected: streamConnected } = useEventStream();

    return (
        <div className="shell">
            <aside className="sidebar">
                <div className="brand">
                    <span className="brand-dot" />
                    Cith
                </div>
                <nav className="nav">
                    {NAV.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`nav-item ${route === item.id ? "is-active" : ""}`}
                            onClick={() => navigate(item.id)}
                        >
                            <span className="nav-icon">{item.icon}</span>
                            {item.label}
                        </button>
                    ))}
                </nav>
                <div className="sidebar-foot text-muted">面板 · 本地模式</div>
            </aside>

            <div className="main">
                <header className="topbar">
                    <h1 className="topbar-title">{PAGE_TITLES[route]}</h1>
                    <div className="topbar-status">
                        <StatusDot ok={!!health} label="BFF" />
                        <StatusDot ok={!!health?.bot.authenticated} label="Bot" />
                        <StatusDot ok={streamConnected} label="事件流" />
                    </div>
                </header>
                <main className="content">
                    {route === "dashboard" && <Dashboard />}
                    {route === "config" && <ConfigPage />}
                    {route === "logs" && <LogsPage />}
                    {route === "actions" && <ActionsPage />}
                </main>
            </div>
        </div>
    );
}
