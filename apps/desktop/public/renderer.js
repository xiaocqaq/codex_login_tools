const form = document.querySelector("#settingsForm");
const gatewayStatus = document.querySelector("#gatewayStatus");
const statusDetail = document.querySelector("#statusDetail");
const toggleGateway = document.querySelector("#toggleGateway");
const refreshConfig = document.querySelector("#refreshConfig");
const writeCodexConfig = document.querySelector("#writeCodexConfig");
const checkUpdates = document.querySelector("#checkUpdates");
const updateStatus = document.querySelector("#updateStatus");
const checkCodex = document.querySelector("#checkCodex");
const installCodex = document.querySelector("#installCodex");
const codexStatus = document.querySelector("#codexStatus");
const message = document.querySelector("#message");

let currentState;

window.codexDesktop.onStatus((status) => {
  currentState.gateway = status;
  render();
});

window.codexDesktop.getState().then((state) => {
  currentState = state;
  fillForm(state.settings);
  render();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = readForm();
  currentState = await window.codexDesktop.saveSettings(settings);
  showMessage(
    currentState.gateway.running
      ? "设置已保存。端口或模型变更需要重启代理后生效。"
      : "设置已保存。",
  );
  render();
});

toggleGateway.addEventListener("click", async () => {
  const status = currentState.gateway.running
    ? await window.codexDesktop.stopGateway()
    : await window.codexDesktop.startGateway();
  currentState.gateway = status;
  showMessage(status.running ? "代理已启动。" : "代理已停止。");
  render();
});

refreshConfig.addEventListener("click", async () => {
  currentState.gateway = await window.codexDesktop.refreshConfig();
  showMessage("已请求刷新远程配置。");
  render();
});

writeCodexConfig.addEventListener("click", async () => {
  await window.codexDesktop.writeCodexConfig();
  showMessage("已写入 Codex 配置。");
});

checkUpdates.addEventListener("click", async () => {
  const result = await window.codexDesktop.checkUpdates();
  updateStatus.textContent =
    result.status === "disabled"
      ? "开发模式下不启用自动更新。"
      : result.status === "checking"
        ? "正在检查更新。"
        : `检查更新失败：${result.message}`;
});

checkCodex.addEventListener("click", async () => {
  currentState.codex = await window.codexDesktop.checkCodex();
  renderCodex();
});

installCodex.addEventListener("click", async () => {
  installCodex.disabled = true;
  const result = await window.codexDesktop.installCodex();
  showMessage(result.message);
  window.setTimeout(async () => {
    currentState.codex = await window.codexDesktop.checkCodex();
    renderCodex();
  }, 5000);
});

function fillForm(settings) {
  form.configUrl.value = settings.configUrl;
  form.clientToken.value = settings.clientToken;
  form.gatewayPort.value = String(settings.gatewayPort);
  form.model.value = settings.model;
  form.providerId.value = settings.providerId;
  form.startOnLaunch.checked = settings.startOnLaunch;
  form.writeCodexConfigOnStart.checked = settings.writeCodexConfigOnStart;
}

function readForm() {
  return {
    ...currentState.settings,
    configUrl: form.configUrl.value,
    clientToken: form.clientToken.value,
    gatewayPort: Number(form.gatewayPort.value),
    model: form.model.value,
    providerId: form.providerId.value,
    startOnLaunch: form.startOnLaunch.checked,
    writeCodexConfigOnStart: form.writeCodexConfigOnStart.checked,
  };
}

function render() {
  const status = currentState.gateway;
  gatewayStatus.className = `status-pill ${status.error ? "error" : status.running ? "running" : ""}`;
  gatewayStatus.textContent = status.error ? "异常" : status.running ? "运行中" : "已停止";
  toggleGateway.textContent = status.running ? "停止代理" : "开启代理";
  statusDetail.textContent = status.error
    ? status.error
    : status.running
      ? `监听地址：${status.listenUrl ?? "127.0.0.1"}；配置：${status.hasConfig ? "已加载" : "未加载"}`
      : "本地代理未运行。";
  renderCodex();
}

function renderCodex() {
  const codex = currentState.codex;
  codexStatus.textContent = codex.installed
    ? `已检测到 Codex：${codex.command ?? "codex"}`
    : "未检测到 Codex CLI。可点击安装按钮，通过 OpenAI 官方脚本安装。";
  installCodex.disabled = Boolean(codex.installed);
}

function showMessage(text) {
  message.textContent = text;
  window.setTimeout(() => {
    if (message.textContent === text) {
      message.textContent = "";
    }
  }, 3500);
}
