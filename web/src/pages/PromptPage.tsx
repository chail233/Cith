/**
 * 系统提示词页：直接编辑 core/prompts/system.md
 *
 * 保存即写回文件，下一回合生效（无需重启）；有未保存修改时轮询结果不覆盖草稿。
 */
import { useEffect, useRef, useState } from "react";
import { Card, ErrorBanner, Loading } from "../components/ui";
import { usePolling } from "../hooks/usePolling";
import { rpc } from "../api/client";
import type { PromptDoc } from "../types";

interface Notice {
    tone: "ok" | "err";
    text: string;
}

export default function PromptPage() {
    const { data, error, loading, refresh } = usePolling(() => rpc<PromptDoc>("get_prompt"));
    const [draft, setDraft] = useState("");
    /** 有未保存修改时不用服务端数据覆盖草稿，避免刷新冲掉输入 */
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);
    /** 已灌过草稿的服务端快照：同一份数据只灌一次 */
    const syncedRef = useRef<PromptDoc | null>(null);

    useEffect(() => {
        if (!data || data === syncedRef.current || dirty) return;
        syncedRef.current = data;
        setDraft(data.text);
    }, [data, dirty]);

    const save = async () => {
        setSaving(true);
        setNotice(null);
        try {
            const doc = await rpc<PromptDoc>("set_prompt", { text: draft });
            syncedRef.current = doc;
            setDraft(doc.text);
            setDirty(false);
            setNotice({ tone: "ok", text: `已保存到 ${doc.path}，下一回合生效` });
            await refresh();
        }
        catch (err) {
            setNotice({ tone: "err", text: err instanceof Error ? err.message : String(err) });
        }
        finally {
            setSaving(false);
        }
    };

    return (
        <div className="page">
            {notice && <div className={`notice notice-${notice.tone}`}>{notice.text}</div>}
            {error && <ErrorBanner message={`获取系统提示词失败：${error}`} onRetry={refresh} />}

            <Card
                title="系统提示词"
                extra={
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
                        读取磁盘
                    </button>
                }
            >
                <p className="text-muted config-hint">
                    提示词只存在于 <span className="mono">{data?.path ?? "prompts/system.md"}</span>：
                    保存后直接写回该文件，下一回合立即生效，不需要重启进程，也不用再手写 config.json 的转义字符串。
                </p>

                <div className="prompt-meta">
                    <span>更新时间：{data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : "文件不存在"}</span>
                    <span>字符数：{draft.length}</span>
                    <span>体积：{new TextEncoder().encode(draft).length} 字节</span>
                    {dirty && <span>有未保存修改</span>}
                </div>

                {loading && !data ? (
                    <Loading text="正在读取系统提示词..." />
                ) : (
                    <>
                        <textarea
                            className="prompt-editor"
                            value={draft}
                            spellCheck={false}
                            onChange={(e) => {
                                setDraft(e.target.value);
                                setDirty(true);
                                setNotice(null);
                            }}
                        />
                        <div className="prompt-toolbar">
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={!dirty || saving}
                                onClick={() => {
                                    setDraft(data?.text ?? "");
                                    setDirty(false);
                                    setNotice(null);
                                }}
                            >
                                放弃修改
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={saving || !dirty}
                                onClick={() => void save()}
                            >
                                {saving ? "保存中..." : dirty ? "保存并生效" : "无改动"}
                            </button>
                        </div>
                    </>
                )}
            </Card>
        </div>
    );
}
