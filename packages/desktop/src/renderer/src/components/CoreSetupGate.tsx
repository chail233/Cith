import type { CoreSetupState } from '../../../shared/core-types.ts'
import './CoreSetupGate.css'

/** 首启解压的全屏加载界面：extracting 显示进度，error 显示原因与重试 */
export function CoreSetupGate({ state, onRetry }: { state: CoreSetupState; onRetry: () => void }) {
    if (state.phase !== 'extracting' && state.phase !== 'error') return null

    const pct = state.phase === 'extracting' && state.filesTotal > 0
        ? Math.min(100, Math.round((state.filesDone / state.filesTotal) * 100))
        : null

    return (
        <div className="setup-gate" role="alertdialog" aria-modal="true" aria-label="内置核心初始化">
            <div className="setup-card">
                <span className="setup-ring" aria-hidden="true" />
                {state.phase === 'extracting' ? (
                    <>
                        <h1 className="setup-title">正在准备内置核心</h1>
                        <p className="setup-hint">首次启动需要解压核心依赖（约两万个文件），大概需要一两分钟，请稍候</p>
                        <div className="setup-track">
                            <div className={pct !== null ? 'setup-fill' : 'setup-fill setup-fill-indeterminate'} style={pct !== null ? { width: `${pct}%` } : undefined} />
                        </div>
                        <p className="setup-progress">
                            {pct !== null ? `${pct}% · ${state.filesDone} / ${state.filesTotal} 个文件` : '解压中…'}
                        </p>
                    </>
                ) : (
                    <>
                        <h1 className="setup-title">内置核心初始化失败</h1>
                        <p className="setup-error">{state.message}</p>
                        <button className="setup-retry" onClick={onRetry}>重试</button>
                    </>
                )}
            </div>
        </div>
    )
}
