import { createPinia, defineStore } from "pinia";
import {
  NAlert,
  NButton,
  NCard,
  NConfigProvider,
  NDataTable,
  NEmpty,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NInputNumber,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NMessageProvider,
  NModal,
  NPopconfirm,
  NSpace,
  NStatistic,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  createDiscreteApi,
  darkTheme,
} from "naive-ui";
import { createApp, computed, h, reactive, ref } from "vue";
import type { DataTableColumns } from "naive-ui";
import "./style.css";

interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
}

interface RouteConfig {
  id: string;
  providerId: string;
  matchModel: string;
  upstreamModel: string;
  enabled: boolean;
  priority: number;
}

interface RemoteConfig {
  version: 1;
  pollIntervalSeconds: number;
  providers: ProviderConfig[];
  routes: RouteConfig[];
  defaultRouteId: string;
}

interface TokenRow {
  id: string;
  name: string;
  note: string;
  tokenValue: string;
  tokenPreview: string;
  enabled: boolean;
  lastUsedAt?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
}

interface Dashboard {
  totals: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
    requestCount: number;
    successCount: number;
    failureCount: number;
  };
  tokens: TokenRow[];
}

interface InstallerStatus {
  uploaded: boolean;
  hasFile?: boolean;
  hasUrl?: boolean;
  preferred?: "url" | "file";
  fileName?: string;
  size?: number;
  updatedAt?: string;
  downloadUrl?: string;
  file?: InstallerStatus;
  url?: InstallerStatus;
}

interface ClientReleaseStatus extends InstallerStatus {
  version?: string;
}

const { message } = createDiscreteApi(["message"]);

const useAdminStore = defineStore("admin", () => {
  const adminToken = ref(localStorage.getItem("adminToken") ?? "");
  const config = ref<RemoteConfig | null>(null);
  const dashboard = ref<Dashboard>({
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
    },
    tokens: [],
  });
  const installer = ref<InstallerStatus>({ uploaded: false });
  const clientRelease = ref<ClientReleaseStatus>({ uploaded: false });

  const authed = computed(() => Boolean(adminToken.value));

  async function login(username: string, password: string) {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "登录失败");
    adminToken.value = body.token;
    localStorage.setItem("adminToken", body.token);
    await loadAll();
  }

  function logout() {
    adminToken.value = "";
    localStorage.removeItem("adminToken");
  }

  async function loadAll() {
    if (!adminToken.value) return;
    const [nextConfig, nextDashboard, nextInstaller, nextClientRelease] = await Promise.all([
      api<RemoteConfig>("/api/admin/config"),
      api<Dashboard>("/api/admin/dashboard"),
      api<InstallerStatus>("/api/admin/codex-desktop-installer"),
      api<ClientReleaseStatus>("/api/admin/client-release"),
    ]);
    config.value = nextConfig;
    dashboard.value = nextDashboard;
    installer.value = nextInstaller;
    clientRelease.value = nextClientRelease;
  }

  async function api<T>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${adminToken.value}` };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || body.message || "请求失败");
    return body as T;
  }

  return { adminToken, authed, config, dashboard, installer, clientRelease, login, logout, loadAll, api };
});

const App = {
  setup() {
    const store = useAdminStore();
    const activeTab = ref("overview");
    const storedTheme = localStorage.getItem("adminTheme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    const themeMode = ref<"light" | "dark">(storedTheme === "light" || storedTheme === "dark" ? storedTheme : prefersDark ? "dark" : "light");
    const naiveTheme = computed(() => themeMode.value === "dark" ? darkTheme : null);
    const loginForm = reactive({ username: "admin", password: "" });
    const tokenForm = reactive({ name: "", note: "" });
    const newToken = ref("");
    const showTokenModal = ref(false);
    const expandedProviderIds = ref<string[]>([]);
    const clientReleaseVersion = ref("");
    const installerDownloadUrl = ref("");
    const installerFileName = ref("");
    const clientReleaseDownloadUrl = ref("");
    const clientReleaseFileName = ref("");
    const installerUploadProgress = ref(0);
    const clientReleaseUploadProgress = ref(0);
    const enabledTokenCount = computed(() => store.dashboard.tokens.filter((token) => token.enabled).length);
    const disabledTokenCount = computed(() => store.dashboard.tokens.filter((token) => !token.enabled).length);
    const enabledProviderCount = computed(() => store.config?.providers.filter((provider) => provider.enabled).length ?? 0);
    const enabledRouteCount = computed(() => {
      if (!store.config) return 0;
      return store.config.routes.filter((route) => {
        const provider = store.config?.providers.find((item) => item.id === route.providerId);
        return route.enabled && provider?.enabled;
      }).length;
    });
    const primaryRoutes = computed(() => {
      if (!store.config) return [];
      return [...store.config.routes]
        .filter((route) => {
          const provider = store.config?.providers.find((item) => item.id === route.providerId);
          return route.enabled && provider?.enabled;
        })
        .sort((left, right) => right.priority - left.priority)
        .slice(0, 4)
        .map((route) => {
          const provider = store.config?.providers.find((item) => item.id === route.providerId);
          return {
            id: route.id,
            label: `${route.matchModel || "*"} -> ${route.upstreamModel || "未填写实际模型"}`,
            providerName: provider?.name || route.providerId,
            priority: route.priority,
          };
        });
    });
    const clientReleaseSourceText = computed(() => packageSourceText(store.clientRelease));
    const installerSourceText = computed(() => packageSourceText(store.installer));
    const clientReleaseHealth = computed(() => {
      if (!store.clientRelease.uploaded) {
        return {
          type: "error" as const,
          title: "未配置客户端更新包",
          detail: "0.1.11 客户端无法发现新版本。请上传 exe 或填写下载地址。",
        };
      }

      if (!store.clientRelease.version) {
        return {
          type: "warning" as const,
          title: "更新包缺少版本号",
          detail: "客户端只会在服务端版本号高于本机版本时更新。",
        };
      }

      return {
        type: "success" as const,
        title: `已发布 ${store.clientRelease.version}`,
        detail: `下载来源：${clientReleaseSourceText.value}。启用令牌可检查并下载此版本。`,
      };
    });
    const tokenHealth = computed(() => {
      if (!store.dashboard.tokens.length) {
        return {
          type: "warning" as const,
          title: "还没有客户端令牌",
          detail: "客户端没有可填写的 Token，无法启动代理。",
        };
      }

      if (!enabledTokenCount.value) {
        return {
          type: "error" as const,
          title: "所有令牌均已停用",
          detail: "客户端请求会返回 token disabled，无法启动代理。",
        };
      }

      if (disabledTokenCount.value) {
        return {
          type: "warning" as const,
          title: `${disabledTokenCount.value} 个令牌已停用`,
          detail: "这些客户端无法正常启动代理请求。",
        };
      }

      return {
        type: "success" as const,
        title: `${enabledTokenCount.value} 个令牌可用`,
        detail: "启用令牌可以启动代理并访问已授权模型。",
      };
    });

    document.documentElement.dataset.theme = themeMode.value;

    function toggleTheme() {
      themeMode.value = themeMode.value === "dark" ? "light" : "dark";
      localStorage.setItem("adminTheme", themeMode.value);
      document.documentElement.dataset.theme = themeMode.value;
    }
    const routeHealth = computed(() => {
      if (!enabledProviderCount.value) {
        return {
          type: "error" as const,
          title: "没有启用的服务商",
          detail: "客户端即使启动代理，也没有可用上游。",
        };
      }

      if (!enabledRouteCount.value) {
        return {
          type: "error" as const,
          title: "没有启用的模型映射",
          detail: "请至少启用一条模型映射，例如 codex-best -> 实际上游模型。",
        };
      }

      return {
        type: "success" as const,
        title: `${enabledProviderCount.value} 个服务商 / ${enabledRouteCount.value} 条映射可用`,
        detail: "客户端请求会按优先级选择启用的模型映射。",
      };
    });

    async function doLogin() {
      try {
        await store.login(loginForm.username, loginForm.password);
        message.success("已登录");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "登录失败");
      }
    }

    async function refresh() {
      try {
        await store.loadAll();
        message.success("数据已刷新");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "刷新失败");
      }
    }

    function addProvider() {
      if (!store.config) return;
      const index = store.config.providers.length + 1;
      const id = createUniqueId("provider", store.config.providers.map((provider) => provider.id), index);
      store.config.providers.push({
        id,
        name: `服务商 ${index}`,
        baseUrl: "https://api.example.com/v1",
        apiKey: "",
        enabled: true,
      });
      expandedProviderIds.value = [id];
    }

    function deleteProvider(provider: ProviderConfig) {
      if (!store.config) return;
      store.config.providers = store.config.providers.filter((item) => item.id !== provider.id);
      store.config.routes = store.config.routes.filter((route) => route.providerId !== provider.id);
      if (store.config.defaultRouteId && !store.config.routes.some((route) => route.id === store.config?.defaultRouteId)) {
        store.config.defaultRouteId = store.config.routes[0]?.id ?? "";
      }
    }

    function addRoute(providerId?: string) {
      if (!store.config) return;
      const targetProviderId = providerId ?? store.config.providers[0]?.id;
      if (!targetProviderId) {
        message.warning("请先新增一个服务商");
        activeTab.value = "providers";
        return;
      }
      const index = store.config.routes.length + 1;
      store.config.routes.push({
        id: createUniqueId("route", store.config.routes.map((route) => route.id), index),
        providerId: targetProviderId,
        matchModel: "codex-best",
        upstreamModel: "",
        enabled: true,
        priority: 100,
      });
      expandProvider(targetProviderId);
    }

    function deleteRoute(route: RouteConfig) {
      if (!store.config) return;
      store.config.routes = store.config.routes.filter((item) => item.id !== route.id);
      if (store.config.defaultRouteId === route.id) {
        store.config.defaultRouteId = store.config.routes[0]?.id ?? "";
      }
    }

    function routesForProvider(providerId: string) {
      return (store.config?.routes ?? []).filter((route) => route.providerId === providerId);
    }

    function formatWan(value: number) {
      return `${(value / 10000).toFixed(2)} 万`;
    }

    function toggleProvider(providerId: string) {
      expandedProviderIds.value = toggleId(expandedProviderIds.value, providerId);
    }

    function isProviderExpanded(providerId: string) {
      return expandedProviderIds.value.includes(providerId);
    }

    function expandProvider(providerId: string) {
      if (!expandedProviderIds.value.includes(providerId)) {
        expandedProviderIds.value = [...expandedProviderIds.value, providerId];
      }
    }

    function openProviderModels(providerId: string) {
      activeTab.value = "providers";
      expandProvider(providerId);
    }

    async function saveConfig() {
      if (!store.config) return;
      const error = validateConfig(store.config);
      if (error) {
        message.error(error);
        return;
      }

      const enabledRoutes = store.config.routes.filter((route) => {
        const provider = store.config?.providers.find((item) => item.id === route.providerId);
        return route.enabled && provider?.enabled;
      });

      try {
        const result = await store.api<{ config: RemoteConfig }>("/api/admin/config", {
          method: "PUT",
          body: {
            version: 1,
            pollIntervalSeconds: store.config.pollIntervalSeconds,
            providers: store.config.providers,
            routes: store.config.routes,
            defaultRouteId: enabledRoutes[0]?.id ?? store.config.defaultRouteId,
          },
        });
        store.config = result.config;
        expandedProviderIds.value = [];
        message.success("配置已保存");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "保存失败");
      }
    }

    async function createToken() {
      try {
        const result = await store.api<{ tokenValue: string }>("/api/admin/tokens", {
          method: "POST",
          body: { name: tokenForm.name, note: tokenForm.note },
        });
        newToken.value = result.tokenValue;
        showTokenModal.value = true;
        tokenForm.name = "";
        tokenForm.note = "";
        await store.loadAll();
      } catch (error) {
        message.error(error instanceof Error ? error.message : "创建失败");
      }
    }

    async function setTokenEnabled(row: TokenRow, enabled: boolean) {
      try {
        await store.api(`/api/admin/tokens/${row.id}`, {
          method: "PATCH",
          body: { enabled },
        });
        await store.loadAll();
      } catch (error) {
        message.error(error instanceof Error ? error.message : "操作失败");
      }
    }

    async function deleteToken(row: TokenRow) {
      try {
        await store.api(`/api/admin/tokens/${row.id}`, { method: "DELETE" });
        await store.loadAll();
      } catch (error) {
        message.error(error instanceof Error ? error.message : "删除失败");
      }
    }

    async function copy(value: string) {
      await navigator.clipboard.writeText(value);
      message.success("已复制");
    }

    async function uploadInstaller(event: Event) {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;

      try {
        installerUploadProgress.value = 1;
        const body = await uploadBinaryWithProgress(
          "/api/admin/codex-desktop-installer",
          file,
          {
            authorization: `Bearer ${store.adminToken}`,
            "content-type": "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
          },
          (value) => {
            installerUploadProgress.value = value;
          },
        );
        store.installer = body.installer;
        message.success("安装包已上传");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "上传失败");
      } finally {
        installerUploadProgress.value = 0;
      }
    }

    async function saveInstallerUrl() {
      if (!installerDownloadUrl.value.trim()) {
        message.error("请填写 Codex 桌面版 GitHub 下载地址");
        return;
      }

      try {
        const body = await store.api<{ installer: InstallerStatus }>("/api/admin/codex-desktop-installer-url", {
          method: "PUT",
          body: {
            downloadUrl: installerDownloadUrl.value.trim(),
            fileName: installerFileName.value.trim(),
          },
        });
        store.installer = body.installer;
        message.success("Codex 桌面版下载地址已保存");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "保存失败");
      }
    }

    async function deleteInstaller(source = "") {
      try {
        await store.api(`/api/admin/codex-desktop-installer${source ? `?source=${source}` : ""}`, { method: "DELETE" });
        store.installer = await store.api<InstallerStatus>("/api/admin/codex-desktop-installer");
        message.success("安装包已删除");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "删除失败");
      }
    }

    async function uploadClientRelease(event: Event) {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      if (!clientReleaseVersion.value.trim()) {
        message.error("请先填写客户端版本号");
        return;
      }

      try {
        clientReleaseUploadProgress.value = 1;
        const body = await uploadBinaryWithProgress(
          "/api/admin/client-release",
          file,
          {
            authorization: `Bearer ${store.adminToken}`,
            "content-type": "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
            "x-version": clientReleaseVersion.value.trim(),
          },
          (value) => {
            clientReleaseUploadProgress.value = value;
          },
        );
        store.clientRelease = body.release;
        message.success("客户端更新包已上传");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "上传失败");
      } finally {
        clientReleaseUploadProgress.value = 0;
      }
    }

    async function saveClientReleaseUrl() {
      if (!clientReleaseVersion.value.trim()) {
        message.error("请先填写客户端版本号");
        return;
      }
      if (!clientReleaseDownloadUrl.value.trim()) {
        message.error("请填写客户端 exe GitHub 下载地址");
        return;
      }

      try {
        const body = await store.api<{ release: ClientReleaseStatus }>("/api/admin/client-release-url", {
          method: "PUT",
          body: {
            version: clientReleaseVersion.value.trim(),
            downloadUrl: clientReleaseDownloadUrl.value.trim(),
            fileName: clientReleaseFileName.value.trim(),
          },
        });
        store.clientRelease = body.release;
        message.success("客户端更新下载地址已保存");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "保存失败");
      }
    }

    async function deleteClientRelease(source = "") {
      try {
        await store.api(`/api/admin/client-release${source ? `?source=${source}` : ""}`, { method: "DELETE" });
        store.clientRelease = await store.api<ClientReleaseStatus>("/api/admin/client-release");
        message.success("客户端更新包已删除");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "删除失败");
      }
    }

    const overviewColumns: DataTableColumns<TokenRow> = [
      { title: "名称", key: "name" },
      {
        title: "状态",
        key: "enabled",
        render: (row) => h(NTag, { type: row.enabled ? "success" : "error" }, () => row.enabled ? "启用" : "停用"),
      },
      { title: "Total（万）", key: "totalTokens", sorter: "default", render: (row) => formatWan(row.totalTokens) },
      { title: "请求", key: "requestCount", sorter: "default" },
      { title: "最后使用", key: "lastUsedAt", render: (row) => formatDate(row.lastUsedAt) },
    ];

    const tokenColumns: DataTableColumns<TokenRow> = [
      { title: "名称", key: "name" },
      {
        title: "完整 Token",
        key: "tokenValue",
        render: (row) => h("span", { class: "token-code" }, row.tokenValue),
      },
      {
        title: "状态",
        key: "enabled",
        render: (row) => h(NTag, { type: row.enabled ? "success" : "error" }, () => row.enabled ? "启用" : "停用"),
      },
      { title: "备注", key: "note" },
      {
        title: "操作",
        key: "actions",
        render: (row) =>
          h(NSpace, null, () => [
            h(NButton, { size: "small", onClick: () => copy(row.tokenValue) }, () => "复制"),
            h(NButton, { size: "small", onClick: () => setTokenEnabled(row, !row.enabled) }, () => row.enabled ? "停用" : "启用"),
            h(
              NPopconfirm,
              {
                positiveText: "确认",
                negativeText: "取消",
                onPositiveClick: () => deleteToken(row),
              },
              {
                trigger: () => h(NButton, { size: "small", type: "error" }, () => "删除"),
                default: () => `确认删除令牌「${row.name || row.tokenPreview}」？`,
              },
            ),
          ]),
      },
    ];

    const usageColumns: DataTableColumns<TokenRow> = [
      { title: "名称", key: "name" },
      { title: "Total（万）", key: "totalTokens", sorter: "default", render: (row) => formatWan(row.totalTokens) },
      { title: "输入（万）", key: "inputTokens", sorter: "default", render: (row) => formatWan(row.inputTokens) },
      { title: "输出（万）", key: "outputTokens", sorter: "default", render: (row) => formatWan(row.outputTokens) },
      { title: "缓存读（万）", key: "cachedInputTokens", sorter: "default", render: (row) => formatWan(row.cachedInputTokens) },
      { title: "请求", key: "requestCount", sorter: "default" },
      { title: "成功", key: "successCount", sorter: "default" },
      { title: "失败", key: "failureCount", sorter: "default" },
    ];

    if (store.authed) store.loadAll().catch(() => store.logout());

    return {
      activeTab,
      addProvider,
      addRoute,
      copy,
      createToken,
      deleteProvider,
      deleteRoute,
      deleteClientRelease,
      clientReleaseVersion,
      installerDownloadUrl,
      installerFileName,
      clientReleaseDownloadUrl,
      clientReleaseFileName,
      clientReleaseHealth,
      clientReleaseSourceText,
      installerUploadProgress,
      installerSourceText,
      clientReleaseUploadProgress,
      deleteToken,
      doLogin,
      disabledTokenCount,
      enabledProviderCount,
      enabledRouteCount,
      enabledTokenCount,
      expandedProviderIds,
      loginForm,
      naiveTheme,
      newToken,
      overviewColumns,
      primaryRoutes,
      refresh,
      routeHealth,
      routesForProvider,
      saveConfig,
      setTokenEnabled,
      showTokenModal,
      store,
      tokenColumns,
      tokenForm,
      tokenHealth,
      themeMode,
      toggleProvider,
      toggleTheme,
      isProviderExpanded,
      openProviderModels,
      uploadInstaller,
      saveInstallerUrl,
      uploadClientRelease,
      saveClientReleaseUrl,
      deleteInstaller,
      formatBytes,
      formatDate,
      formatWan,
      usageColumns,
    };
  },
  template: `
    <n-config-provider :theme="naiveTheme">
      <n-message-provider>
        <n-layout class="app-shell">
          <n-layout-header class="header">
            <div class="brand-title">管理端</div>
            <n-space align="center" class="header-actions">
              <n-button secondary @click="toggleTheme">{{ themeMode === 'dark' ? '亮色' : '暗色' }}</n-button>
              <span class="status">{{ store.authed ? '已登录' : '未登录' }}</span>
              <n-button v-if="store.authed" secondary @click="refresh">刷新数据</n-button>
              <n-button v-if="store.authed" tertiary @click="store.logout()">退出</n-button>
            </n-space>
          </n-layout-header>

          <n-layout-content class="content">
            <div v-if="!store.authed" class="login-screen">
              <n-card class="login-card" title="登录">
                <n-form :model="loginForm" label-placement="top">
                  <n-form-item label="管理员账号">
                    <n-input v-model:value="loginForm.username" />
                  </n-form-item>
                  <n-form-item label="管理员密码">
                    <n-input v-model:value="loginForm.password" type="password" @keyup.enter="doLogin" />
                  </n-form-item>
                  <n-button type="primary" block @click="doLogin">登录后台</n-button>
                </n-form>
              </n-card>
            </div>

            <template v-else>
              <n-tabs v-model:value="activeTab" type="segment" animated>
                <n-tab-pane name="overview" tab="总览">
                  <n-grid cols="1 s:2 m:4" :x-gap="12" :y-gap="12" responsive="screen">
                    <n-grid-item><n-card><n-statistic label="总 Token（万）" :value="formatWan(store.dashboard.totals.totalTokens)" /></n-card></n-grid-item>
                    <n-grid-item><n-card><n-statistic label="请求数" :value="store.dashboard.totals.requestCount" /></n-card></n-grid-item>
                    <n-grid-item><n-card><n-statistic label="输入 Token（万）" :value="formatWan(store.dashboard.totals.inputTokens)" /></n-card></n-grid-item>
                    <n-grid-item><n-card><n-statistic label="输出 Token（万）" :value="formatWan(store.dashboard.totals.outputTokens)" /></n-card></n-grid-item>
                  </n-grid>
                  <n-grid class="ops-grid" cols="1 m:3" :x-gap="12" :y-gap="12" responsive="screen">
                    <n-grid-item>
                      <n-card class="ops-card">
                        <div class="ops-card__head">
                          <span>客户端更新</span>
                          <n-tag :type="clientReleaseHealth.type">{{ clientReleaseHealth.type === 'success' ? '正常' : '需处理' }}</n-tag>
                        </div>
                        <strong>{{ clientReleaseHealth.title }}</strong>
                        <p>{{ clientReleaseHealth.detail }}</p>
                        <div class="ops-meta">
                          <span>来源：{{ clientReleaseSourceText }}</span>
                          <span>安装包：{{ installerSourceText }}</span>
                        </div>
                        <n-button text type="primary" @click="activeTab = 'installer'">查看安装包</n-button>
                      </n-card>
                    </n-grid-item>
                    <n-grid-item>
                      <n-card class="ops-card">
                        <div class="ops-card__head">
                          <span>Token 诊断</span>
                          <n-tag :type="tokenHealth.type">{{ tokenHealth.type === 'success' ? '可用' : '需处理' }}</n-tag>
                        </div>
                        <strong>{{ tokenHealth.title }}</strong>
                        <p>{{ tokenHealth.detail }}</p>
                        <div class="ops-meta">
                          <span>启用：{{ enabledTokenCount }}</span>
                          <span>停用：{{ disabledTokenCount }}</span>
                        </div>
                        <n-button text type="primary" @click="activeTab = 'tokens'">查看令牌</n-button>
                      </n-card>
                    </n-grid-item>
                    <n-grid-item>
                      <n-card class="ops-card">
                        <div class="ops-card__head">
                          <span>代理路由</span>
                          <n-tag :type="routeHealth.type">{{ routeHealth.type === 'success' ? '可用' : '需处理' }}</n-tag>
                        </div>
                        <strong>{{ routeHealth.title }}</strong>
                        <p>{{ routeHealth.detail }}</p>
                        <div class="ops-meta">
                          <span>服务商：{{ enabledProviderCount }}</span>
                          <span>映射：{{ enabledRouteCount }}</span>
                        </div>
                        <n-button text type="primary" @click="activeTab = 'models'">查看模型</n-button>
                      </n-card>
                    </n-grid-item>
                  </n-grid>
                  <n-card v-if="primaryRoutes.length" class="section-card" title="当前可用模型映射">
                    <div class="route-digest">
                      <div v-for="route in primaryRoutes" :key="route.id" class="route-digest__item">
                        <strong>{{ route.label }}</strong>
                        <span>{{ route.providerName }}，优先级 {{ route.priority }}</span>
                      </div>
                    </div>
                  </n-card>
                  <n-card class="section-card" title="用量最高令牌">
                    <n-data-table :columns="overviewColumns" :data="store.dashboard.tokens.slice(0, 8)" />
                  </n-card>
                </n-tab-pane>

                <n-tab-pane name="providers" tab="服务商配置">
                  <n-card title="服务商">
                    <template #header-extra>
                      <n-space align="center" class="provider-toolbar">
                        <div v-if="store.config" class="top-setting">
                          <span>刷新间隔</span>
                          <n-input-number v-model:value="store.config.pollIntervalSeconds" :min="5" :max="3600" size="small" />
                          <span>秒</span>
                        </div>
                        <n-button secondary @click="addProvider">新增服务商</n-button>
                        <n-button type="primary" @click="saveConfig">保存配置</n-button>
                      </n-space>
                    </template>
                    <n-space v-if="store.config.providers.length" vertical size="large">
                      <n-card v-for="provider in store.config.providers" :key="provider.id" embedded class="compact-provider-card">
                        <n-space justify="space-between" align="center" class="card-title-row">
                          <div class="provider-summary provider-summary--compact">
                            <h3>{{ provider.name || '未命名服务商' }}</h3>
                          </div>
                          <n-space align="center">
                            <n-switch v-model:value="provider.enabled"><template #checked>启用</template><template #unchecked>停用</template></n-switch>
                            <n-button secondary @click="toggleProvider(provider.id)">
                              {{ isProviderExpanded(provider.id) ? '收起' : '展开编辑' }}
                            </n-button>
                            <n-popconfirm positive-text="确认" negative-text="取消" @positive-click="deleteProvider(provider)">
                              <template #trigger><n-button tertiary type="error">删除</n-button></template>
                              删除服务商会同时删除关联的模型映射。
                            </n-popconfirm>
                          </n-space>
                        </n-space>
                        <div v-if="isProviderExpanded(provider.id)" class="fold-body">
                          <n-grid :cols="2" :x-gap="12" responsive="screen">
                            <n-grid-item><n-form-item label="服务商名称"><n-input v-model:value="provider.name" placeholder="例如 DeepSeek" /></n-form-item></n-grid-item>
                            <n-grid-item><n-form-item label="Base URL"><n-input v-model:value="provider.baseUrl" placeholder="https://api.example.com/v1" /></n-form-item></n-grid-item>
                          </n-grid>
                          <n-form-item label="API Key">
                            <n-input v-model:value="provider.apiKey" type="password" show-password-on="click" placeholder="sk-..." />
                          </n-form-item>
                          <div class="provider-model-editor">
                            <n-space justify="space-between" align="center" class="route-edit-title">
                              <strong>该服务商的模型</strong>
                              <n-button secondary size="small" @click="addRoute(provider.id)">新增模型</n-button>
                            </n-space>
                            <n-empty v-if="!routesForProvider(provider.id).length" description="该服务商暂无模型映射" />
                            <n-space v-else vertical size="small">
                              <div v-for="route in routesForProvider(provider.id)" :key="route.id" class="route-row">
                                <div class="route-detail-body route-detail-body--compact">
                                  <div class="route-inline-field">
                                    <span>客户端</span>
                                    <n-input v-model:value="route.matchModel" placeholder="codex-best 或 *" />
                                  </div>
                                  <div class="route-inline-field">
                                    <span>实际模型</span>
                                    <n-input v-model:value="route.upstreamModel" placeholder="例如 deepseek-reasoner" />
                                  </div>
                                  <n-space align="center" class="route-row-actions">
                                    <n-switch v-model:value="route.enabled"><template #checked>启用</template><template #unchecked>停用</template></n-switch>
                                    <n-popconfirm positive-text="确认" negative-text="取消" @positive-click="deleteRoute(route)">
                                      <template #trigger><n-button tertiary type="error">删除</n-button></template>
                                      删除这条模型映射？
                                    </n-popconfirm>
                                  </n-space>
                                </div>
                              </div>
                            </n-space>
                          </div>
                        </div>
                      </n-card>
                    </n-space>
                    <n-empty v-else description="暂无服务商，请先新增服务商" />
                  </n-card>
                </n-tab-pane>

                <n-tab-pane name="models" tab="模型配置">
                  <n-card title="模型映射">
                    <template #header-extra>
                      <n-space>
                        <n-button type="primary" @click="saveConfig">保存配置</n-button>
                      </n-space>
                    </template>
                    <n-alert type="info" title="映射规则" class="compact-alert">
                      模型详情现在在服务商配置里维护；这里只控制模型是否启用和当前优先级顺序。
                    </n-alert>
                    <n-space v-if="store.config.providers.length" vertical size="large">
                      <n-card v-for="provider in store.config.providers" :key="provider.id" embedded class="provider-model-card">
                        <n-space justify="space-between" align="center" class="card-title-row provider-model-top">
                          <div class="provider-summary provider-summary--compact">
                            <h3>{{ provider.name || '未命名服务商' }}</h3>
                          </div>
                          <div v-if="routesForProvider(provider.id).length" class="provider-route-strip">
                            <div v-for="route in routesForProvider(provider.id)" :key="route.id" class="provider-route-inline">
                              <span class="inline-priority-label">优先级</span>
                              <n-input-number v-model:value="route.priority" size="small" style="width: 88px" />
                              <n-switch v-model:value="route.enabled"><template #checked>启用</template><template #unchecked>停用</template></n-switch>
                            </div>
                          </div>
                          <n-space align="center">
                            <n-button secondary @click="openProviderModels(provider.id)">编辑模型详情</n-button>
                          </n-space>
                        </n-space>
                      </n-card>
                    </n-space>
                    <n-empty v-else description="暂无服务商，请先新增服务商" />
                  </n-card>
                </n-tab-pane>

                <n-tab-pane name="tokens" tab="令牌管理">
                  <n-card title="创建客户端令牌">
                    <n-grid :cols="2" :x-gap="12" responsive="screen">
                      <n-grid-item><n-form-item label="名称"><n-input v-model:value="tokenForm.name" placeholder="例如 小王电脑" /></n-form-item></n-grid-item>
                      <n-grid-item><n-form-item label="备注"><n-input v-model:value="tokenForm.note" placeholder="可选" /></n-form-item></n-grid-item>
                    </n-grid>
                    <n-button type="primary" @click="createToken">生成令牌</n-button>
                  </n-card>
                  <n-card class="section-card" title="令牌列表">
                    <n-data-table :columns="tokenColumns" :data="store.dashboard.tokens" />
                  </n-card>
                </n-tab-pane>

                <n-tab-pane name="usage" tab="使用量">
                  <n-card title="使用量排行">
                    <n-data-table :columns="usageColumns" :data="store.dashboard.tokens" />
                  </n-card>
                </n-tab-pane>

                <n-tab-pane name="installer" tab="安装包">
                  <n-card title="Codex 桌面版安装包">
                    <template #header-extra>
                      <n-space>
                        <label class="upload-button">
                          上传安装包
                          <input type="file" @change="uploadInstaller" />
                        </label>
                        <n-popconfirm
                          v-if="store.installer.uploaded"
                          positive-text="确认"
                          negative-text="取消"
                          @positive-click="deleteInstaller"
                        >
                          <template #trigger><n-button tertiary type="error">删除安装包</n-button></template>
                          删除后，客户端将无法从服务端安装 Codex 桌面版。
                        </n-popconfirm>
                      </n-space>
                    </template>
                    <n-alert type="info" title="使用方式" class="compact-alert">
                      推荐填写 GitHub Release 下载地址，客户端会自动轮询内置加速通道下载，不占用服务器带宽；也可以继续上传文件到服务器作为兜底。
                    </n-alert>
                    <n-grid :cols="24" :x-gap="12" responsive="screen">
                      <n-grid-item :span="14">
                        <n-form-item label="GitHub 下载地址">
                          <n-input
                            v-model:value="installerDownloadUrl"
                            placeholder="https://github.com/owner/repo/releases/download/.../Codex-Windows-x64.msix"
                          />
                        </n-form-item>
                      </n-grid-item>
                      <n-grid-item :span="6">
                        <n-form-item label="文件名">
                          <n-input v-model:value="installerFileName" placeholder="可选" />
                        </n-form-item>
                      </n-grid-item>
                      <n-grid-item :span="4">
                        <n-form-item label=" ">
                          <n-button type="primary" block @click="saveInstallerUrl">保存地址</n-button>
                        </n-form-item>
                      </n-grid-item>
                    </n-grid>
                    <div v-if="installerUploadProgress" class="upload-progress">
                      <div class="upload-progress__meta">
                        <span>正在上传</span>
                        <strong>{{ installerUploadProgress }}%</strong>
                      </div>
                      <progress :value="installerUploadProgress" max="100"></progress>
                    </div>
                    <n-card v-if="store.installer.uploaded" embedded class="installer-card">
                      <n-grid :cols="3" :x-gap="12" responsive="screen">
                        <n-grid-item>
                          <p class="muted-line">文件名</p>
                          <strong>{{ store.installer.fileName }}</strong>
                        </n-grid-item>
                        <n-grid-item>
                          <p class="muted-line">来源</p>
                          <strong>{{ store.installer.downloadUrl ? 'GitHub URL' : '服务端文件' }}</strong>
                        </n-grid-item>
                        <n-grid-item>
                          <p class="muted-line">更新时间</p>
                          <strong>{{ formatDate(store.installer.updatedAt) }}</strong>
                        </n-grid-item>
                      </n-grid>
                      <n-space class="source-row">
                        <n-tag v-if="store.installer.hasUrl" type="success">GitHub 地址已配置</n-tag>
                        <n-tag v-if="store.installer.hasFile" type="info">服务端文件已上传</n-tag>
                      </n-space>
                      <p v-if="store.installer.url?.downloadUrl" class="muted-line url-line">{{ store.installer.url.downloadUrl }}</p>
                      <p v-if="store.installer.file" class="muted-line">服务端文件：{{ store.installer.file.fileName }}，{{ formatBytes(store.installer.file.size) }}</p>
                      <n-space>
                        <n-popconfirm v-if="store.installer.hasUrl" positive-text="确认" negative-text="取消" @positive-click="deleteInstaller('url')">
                          <template #trigger><n-button tertiary type="error">删除 GitHub 地址</n-button></template>
                          只删除 GitHub 下载地址，已上传到服务器的安装包会保留。
                        </n-popconfirm>
                        <n-popconfirm v-if="store.installer.hasFile" positive-text="确认" negative-text="取消" @positive-click="deleteInstaller('file')">
                          <template #trigger><n-button tertiary type="error">删除服务端文件</n-button></template>
                          只删除手动上传的安装包，GitHub 下载地址会保留。
                        </n-popconfirm>
                      </n-space>
                    </n-card>
                    <n-empty v-else description="暂未配置 Codex 桌面版安装包" />
                  </n-card>

                  <n-card class="section-card" title="客户端热更新包">
                    <template #header-extra>
                      <n-space align="center">
                        <n-input
                          v-model:value="clientReleaseVersion"
                          placeholder="版本号，例如 0.2.0"
                          style="width: 180px"
                        />
                        <label class="upload-button">
                          上传客户端 exe
                          <input type="file" accept=".exe" @change="uploadClientRelease" />
                        </label>
                        <n-popconfirm
                          v-if="store.clientRelease.uploaded"
                          positive-text="确认"
                          negative-text="取消"
                          @positive-click="deleteClientRelease"
                        >
                          <template #trigger><n-button tertiary type="error">删除更新包</n-button></template>
                          删除后，客户端将无法自动更新。
                        </n-popconfirm>
                      </n-space>
                    </template>
                    <n-alert type="info" title="热更新规则" class="compact-alert">
                      客户端启动后会用令牌查询服务端版本；当服务端版本更高时，优先按 GitHub 地址下载新版 exe，退出旧进程并替换自身。
                    </n-alert>
                    <n-grid :cols="24" :x-gap="12" responsive="screen">
                      <n-grid-item :span="10">
                        <n-form-item label="GitHub 下载地址">
                          <n-input
                            v-model:value="clientReleaseDownloadUrl"
                            placeholder="https://github.com/owner/repo/releases/download/.../Codex.exe"
                          />
                        </n-form-item>
                      </n-grid-item>
                      <n-grid-item :span="5">
                        <n-form-item label="版本号">
                          <n-input v-model:value="clientReleaseVersion" placeholder="0.1.5" />
                        </n-form-item>
                      </n-grid-item>
                      <n-grid-item :span="5">
                        <n-form-item label="文件名">
                          <n-input v-model:value="clientReleaseFileName" placeholder="可选" />
                        </n-form-item>
                      </n-grid-item>
                      <n-grid-item :span="4">
                        <n-form-item label=" ">
                          <n-button type="primary" block @click="saveClientReleaseUrl">保存地址</n-button>
                        </n-form-item>
                      </n-grid-item>
                    </n-grid>
                    <div v-if="clientReleaseUploadProgress" class="upload-progress">
                      <div class="upload-progress__meta">
                        <span>正在上传</span>
                        <strong>{{ clientReleaseUploadProgress }}%</strong>
                      </div>
                      <progress :value="clientReleaseUploadProgress" max="100"></progress>
                    </div>
                    <n-card v-if="store.clientRelease.uploaded" embedded class="installer-card">
                      <n-grid :cols="4" :x-gap="12" responsive="screen">
                        <n-grid-item>
                          <p class="muted-line">版本号</p>
                          <strong>{{ store.clientRelease.version }}</strong>
                        </n-grid-item>
                        <n-grid-item>
                          <p class="muted-line">文件名</p>
                          <strong>{{ store.clientRelease.fileName }}</strong>
                        </n-grid-item>
                        <n-grid-item>
                          <p class="muted-line">来源</p>
                          <strong>{{ store.clientRelease.downloadUrl ? 'GitHub URL' : '服务端文件' }}</strong>
                        </n-grid-item>
                        <n-grid-item>
                          <p class="muted-line">更新时间</p>
                          <strong>{{ formatDate(store.clientRelease.updatedAt) }}</strong>
                        </n-grid-item>
                      </n-grid>
                      <n-space class="source-row">
                        <n-tag v-if="store.clientRelease.hasUrl" type="success">GitHub 地址已配置</n-tag>
                        <n-tag v-if="store.clientRelease.hasFile" type="info">服务端文件已上传</n-tag>
                      </n-space>
                      <p v-if="store.clientRelease.url?.downloadUrl" class="muted-line url-line">{{ store.clientRelease.url.downloadUrl }}</p>
                      <p v-if="store.clientRelease.file" class="muted-line">服务端文件：{{ store.clientRelease.file.fileName }}，{{ formatBytes(store.clientRelease.file.size) }}</p>
                      <n-space>
                        <n-popconfirm v-if="store.clientRelease.hasUrl" positive-text="确认" negative-text="取消" @positive-click="deleteClientRelease('url')">
                          <template #trigger><n-button tertiary type="error">删除 GitHub 地址</n-button></template>
                          只删除 GitHub 下载地址，已上传到服务器的更新包会保留。
                        </n-popconfirm>
                        <n-popconfirm v-if="store.clientRelease.hasFile" positive-text="确认" negative-text="取消" @positive-click="deleteClientRelease('file')">
                          <template #trigger><n-button tertiary type="error">删除服务端文件</n-button></template>
                          只删除手动上传的更新包，GitHub 下载地址会保留。
                        </n-popconfirm>
                      </n-space>
                    </n-card>
                    <n-empty v-else description="暂未配置客户端更新包" />
                  </n-card>
                </n-tab-pane>
              </n-tabs>
            </template>
          </n-layout-content>
        </n-layout>

        <n-modal v-model:show="showTokenModal" preset="card" title="客户端令牌" style="max-width: 720px">
          <n-alert type="warning" title="请复制给客户端填写">{{ newToken }}</n-alert>
          <n-button class="save-button" type="primary" @click="copy(newToken)">复制令牌</n-button>
        </n-modal>
      </n-message-provider>
    </n-config-provider>
  `,
};

function createUniqueId(prefix: string, existingIds: string[], startIndex: number): string {
  let index = startIndex;
  let id = `${prefix}_${index}`;
  while (existingIds.includes(id)) {
    index += 1;
    id = `${prefix}_${index}`;
  }
  return id;
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function validateConfig(config: RemoteConfig): string | null {
  if (!config.providers.length) return "至少需要一个服务商";
  if (!config.routes.length) return "至少需要一个模型映射";

  for (const provider of config.providers) {
    if (!provider.name.trim()) return "服务商名称不能为空";
    if (!provider.baseUrl.trim()) return `服务商 ${provider.name || "未命名"} 的 Base URL 不能为空`;
    if (!provider.apiKey.trim()) return `服务商 ${provider.name || "未命名"} 的 API Key 不能为空`;
  }

  for (const route of config.routes) {
    if (!route.matchModel.trim()) return "客户端模型名不能为空";
    if (!route.upstreamModel.trim()) return `模型 ${route.matchModel || "未命名"} 的实际模型不能为空`;
    if (!config.providers.some((provider) => provider.id === route.providerId)) {
      return `模型 ${route.matchModel || "未命名"} 需要选择服务商`;
    }
  }

  const hasEnabledRoute = config.routes.some((route) => {
    const provider = config.providers.find((item) => item.id === route.providerId);
    return route.enabled && provider?.enabled;
  });
  if (!hasEnabledRoute) return "至少保留一条启用模型映射，并选择启用的服务商";

  return null;
}

function formatBytes(value: number): string {
  if (!value) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function packageSourceText(status: InstallerStatus | ClientReleaseStatus): string {
  if (!status.uploaded) return "未配置";
  if (status.hasUrl && status.hasFile) return status.preferred === "file" ? "服务端文件优先" : "GitHub URL 优先";
  if (status.hasUrl || status.downloadUrl) return "GitHub URL";
  if (status.hasFile) return "服务端文件";
  return "状态异常";
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function uploadBinaryWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (value: number) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [key, value] of Object.entries(headers)) {
      request.setRequestHeader(key, value);
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100))));
    };
    request.onload = () => {
      let body: any = {};
      try {
        body = request.responseText ? JSON.parse(request.responseText) : {};
      } catch {
        body = {};
      }

      if (request.status < 200 || request.status >= 300) {
        reject(new Error(body.error || body.message || `上传失败：${request.status}`));
        return;
      }

      onProgress(100);
      resolve(body);
    };
    request.onerror = () => reject(new Error("上传失败，请检查网络"));
    request.onabort = () => reject(new Error("上传已取消"));
    request.send(file);
  });
}

createApp(App)
  .use(createPinia())
  .component("NAlert", NAlert)
  .component("NButton", NButton)
  .component("NCard", NCard)
  .component("NConfigProvider", NConfigProvider)
  .component("NDataTable", NDataTable)
  .component("NEmpty", NEmpty)
  .component("NForm", NForm)
  .component("NFormItem", NFormItem)
  .component("NGrid", NGrid)
  .component("NGridItem", NGridItem)
  .component("NInput", NInput)
  .component("NInputNumber", NInputNumber)
  .component("NLayout", NLayout)
  .component("NLayoutContent", NLayoutContent)
  .component("NLayoutHeader", NLayoutHeader)
  .component("NMessageProvider", NMessageProvider)
  .component("NModal", NModal)
  .component("NPopconfirm", NPopconfirm)
  .component("NSpace", NSpace)
  .component("NStatistic", NStatistic)
  .component("NSwitch", NSwitch)
  .component("NTabPane", NTabPane)
  .component("NTabs", NTabs)
  .component("NTag", NTag)
  .mount("#app");
