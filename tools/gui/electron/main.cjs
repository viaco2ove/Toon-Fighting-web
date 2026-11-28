// Toon-Fighting Electron 外壳主进程
//
// 由 serve.cjs 的 --gui 启动档 spawn：
//   electron.exe tools/gui/electron/main.cjs
// 端口/地址通过环境变量传入（TF_PORT / TF_URL），缺省 8100。
//
// 设计要点：
// - 内核与 Chrome 同源（Chromium），wasm / pointer lock / 手柄轮询 / 键盘注入都走默认能力，
//   不开 nodeIntegration，页面和浏览器里跑的是同一套逻辑。
// - F5 刷新、F11 全屏；菜单栏隐藏；外链交给系统默认浏览器。
const { app, BrowserWindow, shell } = require('electron');

const PORT = Number(process.env.TF_PORT) || 8100;
const URL_ = process.env.TF_URL || ('http://127.0.0.1:' + PORT + '/index.html');

app.setName('Toon Fighting');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Toon Fighting',
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 游戏页需要 Gamepad API / pointer lock / wasm —— Chromium 默认全开，无需额外开关
    },
  });
  win.setMenuBarVisibility(false);

  // 禁止在壳内开新窗口，外链丢给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(URL_);

  // F5 刷新 / F11 全屏（不拦截游戏键位：游戏只用方向键与 A/B/C/X/Y/Z/Enter/Esc 一类）
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') { win.webContents.reload(); e.preventDefault(); }
    else if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });

  win.on('closed', () => { win = null; });
}

app.whenReady().then(createWindow);
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('window-all-closed', () => app.quit());
