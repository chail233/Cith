import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock, test } from "node:test";

const app = { isPackaged: true };
const ipcMain = {};
const dialog = {};
const shell = {};
const autoUpdater = new EventEmitter();

mock.module("electron", {
    namedExports: {
        app,
        ipcMain,
        dialog,
        shell,
        BrowserWindow: { getFocusedWindow: () => undefined, getAllWindows: () => [] },
    },
});
mock.module("electron-updater", { defaultExport: { autoUpdater } });
const { registerDesktopUpdates } = await import("../packages/desktop/src/main/updates.ts");

function setup(t, { portable = false, packaged = true, response = 0, downloadPromise = Promise.resolve() } = {}) {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const portablePath = process.env.PORTABLE_EXECUTABLE_FILE;
    Object.defineProperty(process, "platform", { value: "win32" });
    if (portable) process.env.PORTABLE_EXECUTABLE_FILE = "portable.exe";
    else delete process.env.PORTABLE_EXECUTABLE_FILE;
    t.after(() => {
        Object.defineProperty(process, "platform", platform);
        if (portablePath === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE;
        else process.env.PORTABLE_EXECUTABLE_FILE = portablePath;
        autoUpdater.removeAllListeners();
    });

    const actions = [];
    let manualCheck;
    app.isPackaged = packaged;
    ipcMain.handle = (name, handler) => {
        assert.equal(name, "app:check-for-updates");
        manualCheck = handler;
    };
    dialog.showMessageBox = async (options) => {
        actions.push(options.buttons);
        return { response };
    };
    shell.openExternal = async (url) => { actions.push(url); };
    autoUpdater.logger = { error() {} };
    autoUpdater.checkForUpdates = async () => {
        actions.push("检查");
        return { isUpdateAvailable: true, updateInfo: { version: "0.2.5" }, downloadPromise };
    };
    autoUpdater.quitAndInstall = (...args) => { actions.push(["安装", ...args]); };
    return { actions, manualCheck: () => manualCheck() };
}

test("安装版从后台下载，等下载完成再确认，选择稍后时不停止 Core", async (t) => {
    const download = Promise.withResolvers();
    const { actions, manualCheck } = setup(t, { downloadPromise: download.promise });
    registerDesktopUpdates(async () => { actions.push("停止"); });
    const pending = manualCheck();
    assert.equal(autoUpdater.autoDownload, true);
    assert.equal(autoUpdater.autoInstallOnAppQuit, false);
    assert.deepEqual(actions, ["检查"]);

    download.resolve();
    await pending;
    assert.deepEqual(actions, ["检查", ["稍后", "重启更新"]]);
});

test("确认更新后等本地 Core 停止，再安装并重启应用", async (t) => {
    const stopping = Promise.withResolvers();
    const stopped = Promise.withResolvers();
    const { actions, manualCheck } = setup(t, { response: 1 });
    registerDesktopUpdates(() => {
        actions.push("停止");
        stopping.resolve();
        return stopped.promise;
    });
    const pending = manualCheck();
    await stopping.promise;
    assert.deepEqual(actions, ["检查", ["稍后", "重启更新"], "停止"]);

    stopped.resolve();
    await pending;
    assert.deepEqual(actions.at(-1), ["安装", true, true]);
});

test("便携版只在用户确认后打开对应 Release", async (t) => {
    const { actions, manualCheck } = setup(t, { portable: true, response: 1, downloadPromise: null });
    registerDesktopUpdates(async () => { actions.push("停止"); });
    await manualCheck();
    assert.equal(autoUpdater.autoDownload, false);
    assert.deepEqual(actions, ["检查", ["稍后", "前往下载"], "https://github.com/chail233/Cith/releases/tag/desktop-v0.2.5"]);
});

test("开发模式不检查发布更新", (t) => {
    const { actions, manualCheck } = setup(t, { packaged: false });
    registerDesktopUpdates(async () => { actions.push("停止"); });
    assert.throws(manualCheck, /Windows 发布版/);
    assert.deepEqual(actions, []);
});
