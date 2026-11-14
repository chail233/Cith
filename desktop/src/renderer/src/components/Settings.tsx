import { useState } from 'react'
import { defaultSettings, type UiSettings } from '../settings'
import './Settings.css'

const CATEGORIES = [
    { id: 'interface', label: '界面', hint: '' },
    { id: 'general', label: '通用', hint: '语言、开机自启、窗口与托盘行为' },
    { id: 'chats', label: '会话', hint: '会话管理、历史与本地缓存清理' },
    { id: 'notifications', label: '通知', hint: '系统通知与审批提醒的规则' },
    { id: 'backend', label: '后端连接', hint: 'DesktopServer 地址、token 与连接状态' },
    { id: 'about', label: '关于', hint: '' },
]

type Props = {
    settings: UiSettings
    onChange: (patch: Partial<UiSettings>) => void
    version: string
}

export function SettingsView({ settings, onChange, version }: Props) {
    const [active, setActive] = useState('interface')
    const cat = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0]

    return (
        <main className="settings">
            <header className="settings-head">
                <h1 className="settings-title">设置</h1>
            </header>
            <div className="settings-body">
                <nav className="settings-nav">
                    {CATEGORIES.map((c) => (
                        <button
                            key={c.id}
                            className={`set-cat${c.id === active ? ' active' : ''}`}
                            onClick={() => setActive(c.id)}
                        >
                            <span>{c.label}</span>
                            {!['interface', 'about'].includes(c.id) && <span className="set-cat-soon">未开放</span>}
                        </button>
                    ))}
                </nav>

                <section className="settings-pane" key={active}>
                    {cat.id === 'interface' && <InterfacePane settings={settings} onChange={onChange} />}
                    {cat.id === 'about' && <AboutPane version={version} />}
                    {!['interface', 'about'].includes(cat.id) && <ReservedPane label={cat.label} hint={cat.hint} />}
                </section>
            </div>
        </main>
    )
}

function InterfacePane({ settings, onChange }: { settings: UiSettings; onChange: (p: Partial<UiSettings>) => void }) {
    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">界面</h2>
                <p className="pane-desc">阅读体验即时生效，保存在本机。</p>
            </header>

            <div className="pane-card">
                <SliderRow
                    label="文字大小"
                    value={settings.fontSize}
                    min={12}
                    max={18}
                    step={1}
                    format={(v) => `${v} px`}
                    onChange={(v) => onChange({ fontSize: v })}
                />
                <SliderRow
                    label="行距"
                    value={settings.lineHeight}
                    min={1.5}
                    max={2.1}
                    step={0.05}
                    format={(v) => v.toFixed(2)}
                    onChange={(v) => onChange({ lineHeight: v })}
                />
                <SliderRow
                    label="段落间距"
                    value={settings.paraGap}
                    min={0}
                    max={20}
                    step={1}
                    format={(v) => `${v} px`}
                    onChange={(v) => onChange({ paraGap: v })}
                />
                <SliderRow
                    label="消息间距"
                    value={settings.msgGap}
                    min={16}
                    max={40}
                    step={1}
                    format={(v) => `${v} px`}
                    onChange={(v) => onChange({ msgGap: v })}
                />
                <SliderRow
                    label="内容宽度"
                    value={settings.contentWidth}
                    min={520}
                    max={1100}
                    step={10}
                    format={(v) => `${v} px`}
                    onChange={(v) => onChange({ contentWidth: v })}
                />
            </div>

            <div className="preview-card">
                <div className="preview-label">实时预览</div>
                <div className="preview-col">
                    <div className="msg user">
                        <div className="msg-segs">
                            <p className="msg-para">帮我看看构建日志里的报错</p>
                        </div>
                    </div>
                    <div className="msg agent">
                        <div className="msg-segs">
                            <div className="msg-text">
                                <p className="msg-para">这是预览文本。拖动上面的滑块，字号、行距和段落间距会即时变化。</p>
                                <p className="msg-para">第二段用来观察段落间距——琥珀色的工具痕迹以后也会留在消息流里，陪你看着 Agent 干活。</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="pane-foot">
                <button className="reset-btn" onClick={() => onChange(defaultSettings)}>
                    恢复默认
                </button>
            </div>
        </>
    )
}

function SliderRow({ label, value, min, max, step, format, onChange }: {
    label: string
    value: number
    min: number
    max: number
    step: number
    format: (v: number) => string
    onChange: (v: number) => void
}) {
    const pct = ((value - min) / (max - min)) * 100
    return (
        <div className="slider-row">
            <div className="slider-head">
                <span className="slider-label">{label}</span>
                <span className="slider-value">{format(value)}</span>
            </div>
            <input
                type="range"
                className="range"
                min={min}
                max={max}
                step={step}
                value={value}
                style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-3) ${pct}%)` }}
                onChange={(e) => onChange(Number(e.target.value))}
            />
        </div>
    )
}

function ReservedPane({ label, hint }: { label: string; hint: string }) {
    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">{label}</h2>
                <p className="pane-desc">这一类设置随后端协议与打包能力一起到来。</p>
            </header>
            <div className="reserved">
                <span className="reserved-mark" />
                <span>{hint ? `预留位置：${hint}。` : '预留位置。'}</span>
            </div>
        </>
    )
}

function AboutPane({ version }: { version: string }) {
    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">关于</h2>
            </header>
            <div className="reserved about">
                <span className="reserved-mark" />
                <div>
                    <div className="about-name">Cith 桌面客户端</div>
                    <div className="about-line">v{version || '0.1.0'} · Electron + React</div>
                    <div className="about-line">与 core 后端完全解耦，仅经 WS 协议通信——协议接入中，当前为演示构建。</div>
                </div>
            </div>
        </>
    )
}
