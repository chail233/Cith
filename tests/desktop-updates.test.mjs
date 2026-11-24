import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock, test } from "node:test";
import { mergeSettings } from "../packages/desktop/src/shared/settings.ts";

const app = { isPackaged: true };
const ipcMain = {};
const dialog = {};
const shell = {};
const autoUpdater = new EventEmitter();
let windows = [];

mock.module("electron", {
    namedExports: {
        app,
        ipcMain,
        dialog,
        shell,
        BrowserWindow: { getFocusedWindow: () => undefined, getAllWindows: () => windows },
    },
});
mock.module("electron-updater", { defaultExport: { autoUpdater } });
const { registerDesktopUpdates } = await import("../packages/desktop/src/main/updates.ts");

function setup(t, { portable = false, packaged = true, responses = [], downloadPromise = Promise.resolve() } = {}) {
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
    const handlers = new Map();
    const updates = [];
    app.isPackaged = packaged;
    ipcMain.handle = (name, handler) => handlers.set(name, handler);
    dialog.showMessageBox = async (...args) => {
        const options = args.at(-1);
        actions.push(options.buttons);
        return { response: responses.shift() ?? 0 };
    };
    shell.openExternal = async (url) => { actions.push(url); };
    autoUpdater.logger = { error() {} };
    autoUpdater.checkForUpdates = async () => {
        actions.push("检查");
        return { isUpdateAvailable: true, updateInfo: { version: "0.2.5" } };
    };
    autoUpdater.downloadUpdate = () => {
        actions.push("下载");
        return downloadPromise;
    };
    autoUpdater.quitAndInstall = (...args) => { actions.push(["安装", ...args]); };
    windows = [{
        isVisible: () => true,
        webContents: { send(channel, state) {
            assert.equal(channel, "app:update-status");
            updates.push(state.status);
        } },
    }];
    return {
        actions,
        updates,
        getStatus: () => handlers.get("app:update-state")().status,
        manualCheck: () => handlers.get("app:check-for-updates")(),
        manualDownload: () => handlers.get("app:download-update")(),
        manualInstall: () => handlers.get("app:install-update")(),
    };
}

test("安装版广播后台进度，稍后确认时先停止 Core 再安装", async (t) => {
    const download = Promise.withResolvers();
    const stopped = Promise.withResolvers();
    const { actions, updates, getStatus, manualCheck, manualDownload, manualInstall } = setup(t, {
        downloadPromise: download.promise,
        responses: [0, 1],
    });
    registerDesktopUpdates(() => {
        actions.push("停止");
        return stopped.promise;
    }, () => mergeSettings({}).autoDownloadUpdates);
    const pending = manualCheck();
    await new Promise(setImmediate);
    assert.equal(autoUpdater.autoInstallOnAppQuit, false);
    assert.deepEqual(actions, ["检查", "下载"]);
    const repeated = manualDownload();

    autoUpdater.emit("download-progress", { percent: 42.7 });
    assert.deepEqual(getStatus(), { phase: "downloading", version: "0.2.5", percent: 42 });
    assert.deepEqual(updates.at(-1), getStatus());

    download.resolve();
    await Promise.all([pending, repeated]);
    assert.deepEqual(getStatus(), { phase: "downloaded", version: "0.2.5" });
    assert.deepEqual(actions, ["检查", "下载", ["稍后", "重启更新"]]);

    const installing = manualInstall();
    await new Promise(setImmediate);
    assert.deepEqual(actions.slice(-2), [["稍后", "重启更新"], "停止"]);
    stopped.resolve();
    await installing;
    assert.deepEqual(actions.at(-1), ["安装", true, true]);
});

test("关闭自动下载后可以手动下载，下载失败可以重试", async (t) => {
    const { actions, getStatus, manualCheck, manualDownload } = setup(t);
    registerDesktopUpdates(async () => {}, () => mergeSettings({ autoDownloadUpdates: false }).autoDownloadUpdates);
    await manualCheck();
    assert.deepEqual(actions, ["检查"]);
    assert.deepEqual(getStatus(), { phase: "available", version: "0.2.5" });

    const downloadUpdate = autoUpdater.downloadUpdate;
    autoUpdater.downloadUpdate = async () => { throw new Error("网络断开"); };
    await manualDownload();
    assert.deepEqual(getStatus(), { phase: "available", version: "0.2.5", error: "下载失败：网络断开" });

    autoUpdater.downloadUpdate = downloadUpdate;
    await manualDownload();
    assert.equal(getStatus().phase, "downloaded");
    assert.deepEqual(actions, ["检查", "下载", ["稍后", "重启更新"]]);
});

test("开启自动下载后可下载已经发现的更新", async (t) => {
    const { actions, getStatus, manualCheck } = setup(t);
    let enabled = false;
    const downloadAvailableUpdate = registerDesktopUpdates(async () => {}, () => enabled);
    await manualCheck();
    assert.deepEqual(actions, ["检查"]);

    enabled = true;
    downloadAvailableUpdate();
    await new Promise(setImmediate);
    assert.equal(getStatus().phase, "downloaded");
    assert.deepEqual(actions, ["检查", "下载", ["稍后", "重启更新"]]);
});

test("便携版只在用户确认后打开对应 Release", async (t) => {
    const { actions, manualCheck } = setup(t, { portable: true, responses: [1] });
    registerDesktopUpdates(async () => { actions.push("停止"); }, () => true);
    await manualCheck();
    assert.deepEqual(actions, ["检查", ["稍后", "前往下载"], "https://github.com/chail233/Cith/releases/tag/desktop-v0.2.5"]);
});

test("开发模式不检查发布更新", (t) => {
    const { actions, manualCheck } = setup(t, { packaged: false });
    registerDesktopUpdates(async () => { actions.push("停止"); }, () => true);
    assert.throws(manualCheck, /Windows 发布版/);
    assert.deepEqual(actions, []);
});
