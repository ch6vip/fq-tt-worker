import type { DevicePoolStore, StatsStore } from '../platform.js';

export async function handleDashboard(
  stats: StatsStore, pool: DevicePoolStore
): Promise<Response> {
  const [totalCalls, todayCalls, readyCount, deviceGroups, deviceFailures, apiHealth, lastCronRun, firstRun] = await Promise.all([
    stats.totalCalls(),
    stats.todayCalls(),
    pool.countReady(),
    pool.groupStats(),
    stats.deviceFailureSummary(5),
    stats.apiHealthSummary(24, 8),
    stats.getMeta('last_cron_run'),
    stats.getMeta('first_run'),
  ]);

  const dashboardData = JSON.stringify({
    totalCalls,
    todayCalls,
    readyCount,
    deviceGroups,
    deviceFailures,
    apiHealth,
    lastCronRun,
    firstRun,
    ts: Date.now(),
  });

  const html = buildHtml(dashboardData);
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

function buildHtml(dataJson: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>fq-tt-worker · API 监控</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js"><\/script>
<style>
[x-cloak]{display:none!important}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.fade-in{animation:fadeIn .4s ease-out both}
</style>
</head>
<body class="bg-gray-50 min-h-screen">
<div x-data="dashboard()" x-init="init()" x-cloak class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6">

<!-- Header -->
<div class="mb-8 fade-in">
  <h1 class="text-2xl sm:text-3xl font-bold text-gray-800">内容 API 监控面板</h1>
  <p class="text-sm text-gray-500 mt-1">服务运行状态一览</p>
</div>

<!-- 4 Stat Cards -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
  <!-- Card 1: Total Calls -->
  <div class="relative overflow-hidden rounded-2xl p-5 sm:p-6 min-h-[140px] flex flex-col justify-between shadow-lg hover:shadow-xl transition-shadow duration-300" style="background:linear-gradient(135deg,#4dd0e1 0%,#0097a7 100%)">
    <div class="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10"></div>
    <div class="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-white/15"></div>
    <div class="flex items-center justify-between relative z-10">
      <div class="text-sm font-medium text-white/90">总调用次数</div>
      <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-white/25">
        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/></svg>
      </div>
    </div>
    <div class="relative z-10 mt-3">
      <div class="text-3xl sm:text-4xl font-bold text-white" x-text="formatNum(data.totalCalls)">—</div>
      <div class="text-xs sm:text-sm text-white/70 mt-1">累计</div>
    </div>
  </div>
  <!-- Card 2: Today Calls -->
  <div class="relative overflow-hidden rounded-2xl p-5 sm:p-6 min-h-[140px] flex flex-col justify-between shadow-lg hover:shadow-xl transition-shadow duration-300" style="background:linear-gradient(135deg,#66bb6a 0%,#2e7d32 100%)">
    <div class="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10"></div>
    <div class="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-white/15"></div>
    <div class="flex items-center justify-between relative z-10">
      <div class="text-sm font-medium text-white/90">今日调用</div>
      <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-white/25">
        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
      </div>
    </div>
    <div class="relative z-10 mt-3">
      <div class="text-3xl sm:text-4xl font-bold text-white" x-text="formatNum(data.todayCalls)">—</div>
      <div class="text-xs sm:text-sm text-white/70 mt-1">UTC 0:00 起</div>
    </div>
  </div>
  <!-- Card 3: Uptime -->
  <div class="relative overflow-hidden rounded-2xl p-5 sm:p-6 min-h-[140px] flex flex-col justify-between shadow-lg hover:shadow-xl transition-shadow duration-300" style="background:linear-gradient(135deg,#60a5fa 0%,#1d4ed8 100%)">
    <div class="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10"></div>
    <div class="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-white/15"></div>
    <div class="flex items-center justify-between relative z-10">
      <div class="text-sm font-medium text-white/90">已运行</div>
      <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-white/25">
        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      </div>
    </div>
    <div class="relative z-10 mt-3">
      <div class="text-3xl sm:text-4xl font-bold text-white" x-text="uptimeMain()">—</div>
      <div class="text-xs sm:text-sm text-white/70 mt-1" x-text="uptimeSub()">自首次启动</div>
    </div>
  </div>
  <!-- Card 4: Healthy Devices + Cron Health -->
  <div class="relative overflow-hidden rounded-2xl p-5 sm:p-6 min-h-[140px] flex flex-col justify-between shadow-lg hover:shadow-xl transition-shadow duration-300" :style="{background: cronCardGradient()}">
    <div class="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10"></div>
    <div class="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-white/15"></div>
    <div class="flex items-center justify-between relative z-10">
      <div class="text-sm font-medium text-white/90">健康设备数</div>
      <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-white/25">
        <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 23a11 11 0 1 0 0-22 11 11 0 0 0 0 22Zm5.88-13.18-6.2 7.6a1.5 1.5 0 0 1-2.37 0l-3.5-4a1.5 1.5 0 1 1 2.37-1.84l2.3 2.46L15.5 8a1.5 1.5 0 1 1 2.38 1.82Z"/></svg>
      </div>
    </div>
    <div class="relative z-10 mt-3">
      <div class="text-3xl sm:text-4xl font-bold text-white" x-text="data.readyCount">—</div>
      <div class="text-xs sm:text-sm text-white/70 mt-1">设备池就绪</div>
      <div class="flex items-center gap-1.5 mt-2">
        <span class="inline-block w-2 h-2 rounded-full" :style="{background: cronDotColor()}" :title="cronStatusLabel()"></span>
        <span class="text-[11px] sm:text-xs text-white/80" x-text="'Cron ' + cronRelativeLabel()"></span>
      </div>
    </div>
    <div class="mt-6 pt-5 border-t border-gray-100">
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-medium text-gray-600">设备池诊断</div>
        <div class="text-xs text-gray-400">失败原因 Top 5</div>
      </div>
      <template x-if="(data.deviceFailures || []).length === 0">
        <div class="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 text-sm text-gray-500">暂无失败记录</div>
      </template>
      <div class="space-y-2" x-show="(data.deviceFailures || []).length > 0">
        <template x-for="f in (data.deviceFailures || [])" :key="f.reason">
          <div class="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-medium text-gray-700 break-all" x-text="f.reason"></div>
                <div class="text-xs text-gray-400 mt-1" x-text="'最后出现: ' + formatTime(f.last_seen)"></div>
              </div>
              <div class="shrink-0 text-sm font-semibold text-red-600" x-text="formatNum(f.fail_count)"></div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</div>

<!-- API Health -->
<div class="grid grid-cols-1 gap-4 sm:gap-6 mb-8">
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
    <div class="flex items-center justify-between mb-4">
      <div class="text-sm font-medium text-gray-600">接口健康度</div>
      <div class="text-xs text-gray-400">最近 24 小时</div>
    </div>
    <template x-if="(data.apiHealth || []).length === 0">
      <div class="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 text-sm text-gray-500">暂无接口统计</div>
    </template>
    <div class="overflow-x-auto" x-show="(data.apiHealth || []).length > 0">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 border-b border-gray-100">
            <th class="py-2 pr-3 font-medium">API</th>
            <th class="py-2 px-3 font-medium text-right">成功</th>
            <th class="py-2 px-3 font-medium text-right">失败</th>
            <th class="py-2 pl-3 font-medium text-right">失败率</th>
          </tr>
        </thead>
        <tbody>
          <template x-for="row in (data.apiHealth || [])" :key="row.api">
            <tr class="border-b border-gray-50 last:border-0">
              <td class="py-2 pr-3 font-medium text-gray-700" x-text="row.api"></td>
              <td class="py-2 px-3 text-right text-green-700" x-text="formatNum(row.success_count)"></td>
              <td class="py-2 px-3 text-right" :class="row.fail_count > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'" x-text="formatNum(row.fail_count)"></td>
              <td class="py-2 pl-3 text-right text-gray-600" x-text="formatPercent(row.fail_rate)"></td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Device Pool Status -->
<div class="grid grid-cols-1 gap-4 sm:gap-6 mb-8">
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
    <div class="text-sm font-medium text-gray-600 mb-4">设备池状态</div>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
      <template x-for="g in (data.deviceGroups || [])" :key="g.status">
        <div class="rounded-xl p-4" :class="g.status==='ready' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'">
          <div class="text-2xl font-bold" :class="g.status==='ready' ? 'text-green-700' : 'text-red-700'" x-text="g.count"></div>
          <div class="text-xs mt-1" :class="g.status==='ready' ? 'text-green-600' : 'text-red-600'" x-text="g.status==='ready' ? '就绪' : '失败'"></div>
          <div class="text-xs text-gray-400 mt-2" x-text="'最早: ' + new Date(g.oldest).toLocaleDateString('zh-CN')"></div>
        </div>
      </template>
      <div class="rounded-xl p-4 bg-blue-50 border border-blue-200">
        <div class="text-2xl font-bold text-blue-700" x-text="data.readyCount"></div>
        <div class="text-xs text-blue-600 mt-1">可用设备</div>
        <div class="text-xs text-gray-400 mt-2">LRU 调度</div>
      </div>
    </div>
  </div>
</div>

<!-- Footer -->
<div class="text-center text-xs text-gray-400 py-4">
  <span x-text="'数据更新于 ' + new Date(data.ts).toLocaleString('zh-CN')"></span>
  <span class="mx-2">|</span>
  <span x-text="'缓存刷新倒计时 ' + refreshCountdown()"></span>
  <span class="mx-2">|</span>
  <span>fq-tt-worker 监控面板</span>
</div>

</div>
<script>
const __DATA__ = ${dataJson};

function dashboard() {
  return {
    data: {},
    tick: Date.now(),
    init() {
      this.data = __DATA__;
      setInterval(() => { this.tick = Date.now(); }, 1000);
    },
    formatNum(n) {
      if (n==null) return '—';
      if (n>=1e9) return (n/1e9).toFixed(1)+'B';
      if (n>=1e6) return (n/1e6).toFixed(1)+'M';
      if (n>=1e3) return (n/1e3).toFixed(1)+'K';
      return String(n);
    },
    formatTime(ts) {
      if (!ts) return '—';
      return new Date(ts).toLocaleString('zh-CN');
    },
    formatPercent(rate) {
      if (rate == null) return '—';
      return (rate * 100).toFixed(rate > 0 && rate < 0.01 ? 2 : 1) + '%';
    },
    // --- Uptime helpers ---
    uptimeMs() {
      if (!this.data.firstRun) return null;
      return Math.max(0, Date.now() - this.data.firstRun);
    },
    uptimeMain() {
      const ms = this.uptimeMs();
      if (ms === null) return '—';
      const days = Math.floor(ms / 86400000);
      const hours = Math.floor((ms % 86400000) / 3600000);
      const minutes = Math.floor((ms % 3600000) / 60000);
      if (days > 0) return days + 'd ' + hours + 'h';
      if (hours > 0) return hours + 'h ' + minutes + 'm';
      return minutes + 'm';
    },
    uptimeSub() {
      if (!this.data.firstRun) return '尚未启动';
      return '自 ' + new Date(this.data.firstRun).toLocaleDateString('zh-CN');
    },
    // --- Cron card helpers ---
    cronAgeMinutes() {
      if (!this.data.lastCronRun) return null;
      return (Date.now() - this.data.lastCronRun) / 60000;
    },
    cronLevel() {
      const m = this.cronAgeMinutes();
      if (m === null) return 'unknown';
      // Cron fires every 10 min. Give some slack for clock drift / cold starts.
      if (m < 15) return 'ok';
      if (m < 30) return 'warn';
      return 'down';
    },
    cronCardGradient() {
      const l = this.cronLevel();
      if (l === 'warn') return 'linear-gradient(135deg,#fbbf24 0%,#b45309 100%)';
      if (l === 'down') return 'linear-gradient(135deg,#f87171 0%,#991b1b 100%)';
      return 'linear-gradient(135deg,#5eead4 0%,#0f766e 100%)';
    },
    cronDotColor() {
      const l = this.cronLevel();
      if (l === 'warn') return '#fde68a';
      if (l === 'down') return '#fecaca';
      if (l === 'unknown') return '#d1d5db';
      return '#bbf7d0';
    },
    cronStatusLabel() {
      const l = this.cronLevel();
      if (l === 'warn') return 'Cron 延迟';
      if (l === 'down') return 'Cron 可能停了';
      if (l === 'unknown') return 'Cron 未运行';
      return 'Cron 正常';
    },
    cronRelativeLabel() {
      const m = this.cronAgeMinutes();
      if (m === null) return '尚无注册';
      if (m < 1) return '刚刚';
      if (m < 60) return Math.round(m) + ' 分钟前';
      const h = m / 60;
      if (h < 24) return h.toFixed(1) + ' 小时前';
      return Math.round(h / 24) + ' 天前';
    },
    refreshCountdown() {
      if (!this.data.ts) return '—';
      const remaining = Math.max(0, this.data.ts + 21600000 - this.tick);
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      return String(hours).padStart(2, '0') + ':' +
        String(minutes).padStart(2, '0') + ':' +
        String(seconds).padStart(2, '0');
    }
  };
}
<\/script>
</body>
</html>`;
}
