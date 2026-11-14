/** 面板登录页：仅在 BFF 设置了 WEB_PASSWORD 时出现 */
import { useState, type FormEvent } from "react";
import { login } from "../api/client";

export default function Login({ onLogin }: { onLogin: () => void }) {
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await login(password);
            onLogin();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="login-wrap">
            <form className="login-card" onSubmit={(e) => void submit(e)}>
                <div className="brand">
                    <span className="brand-dot" />
                    Cith
                </div>
                <h1 className="login-title">面板登录</h1>
                <input
                    className="input"
                    type="password"
                    placeholder="访问密码（WEB_PASSWORD）"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
                {error && <div className="notice notice-err">{error}</div>}
                <button className="btn btn-primary btn-block" type="submit" disabled={busy || !password}>
                    {busy ? "登录中..." : "进入面板"}
                </button>
            </form>
        </div>
    );
}
