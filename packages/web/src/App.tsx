/**
 * 面板主框架：hash 路由 + 侧边栏布局 + 顶栏连接状态。
 * - 会话探测：BFF 启用密码登录时先进入登录页，登录后挂载全局事件流；
 * - 顶栏状态灯：Bot 连接（/api/health 轮询）与 SSE 事件流连接。
 */
import { useEffect, useState, type ReactNode } from "react";
import Dashboard from "./pages/Dashboard";
import PricingPage from "./pages/PricingPage";
import ConfigPage from "./pages/ConfigPage";
import PromptPage from "./pages/PromptPage";
import LogsPage from "./pages/LogsPage";
import ActionsPage from "./pages/ActionsPage";
import Login from "./components/Login";
import { StatusDot } from "./components/ui";
import { BrandMark } from "@cith/ui";
import { IconCoins, IconList, IconPulse, IconQuill, IconTune, IconZap } from "./components/icons";
import { EventStreamProvider, useEventStream } from "./hooks/event-stream";
import { usePolling } from "./hooks/usePolling";
import { fetchHealth, fetchSession } from "./api/client";
import type { HealthInfo, SessionInfo } from "./types";

type Route = "dashboard" | "pricing" | "prompt" | "config" | "logs" | "actions";

const NAV: { id: Route; label: string; icon: ReactNode }[] = [
    { id: "dashboard", label: "运行状态", icon: <IconPulse /> },
    { id: "pricing", label: "模型价格", icon: <IconCoins /> },
    { id: "prompt", label: "系统提示词", icon: <IconQuill /> },
    { id: "config", label: "配置管理", icon: <IconTune /> },
    { id: "logs", label: "事件日志", icon: <IconList /> },
    { id: "actions", label: "能力清单", icon: <IconZap /> },
];

const PAGE_TITLES: Record<Route, string> = {
    dashboard: "运行状态",
    pricing: "模型价格",
    prompt: "系统提示词",
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
            <nav className="dock">
                <div className="brand">
                    <BrandMark size={26} />
                    Cith
                </div>
                {NAV.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={`dock-item ${route === item.id ? "is-active" : ""}`}
                        aria-label={item.label}
                        onClick={() => navigate(item.id)}
                    >
                        <span className="dock-icon">{item.icon}</span>
                        <span className="dock-label">{item.label}</span>
                    </button>
                ))}
            </nav>

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
                    {route === "pricing" && <PricingPage />}
                    {route === "prompt" && <PromptPage />}
                    {route === "config" && <ConfigPage />}
                    {route === "logs" && <LogsPage />}
                    {route === "actions" && <ActionsPage />}
                </main>
            </div>
        </div>
    );
}
