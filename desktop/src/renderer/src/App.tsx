import { useEffect, useState } from 'react'

function App() {
    const [version, setVersion] = useState('')

    useEffect(() => {
        window.desktop.getVersion().then(setVersion)
    }, [])

    return (
        <div className="app">
            <main className="card">
                <h1 className="title">Cith</h1>
                <p className="subtitle">桌面客户端</p>
                <div className="status">
                    <span className="dot" />
                    后端连接尚未接入（协议待定）
                </div>
            </main>
            {version && <footer className="footer">v{version}</footer>}
        </div>
    )
}

export default App
