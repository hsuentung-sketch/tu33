/* SaaS Platform Admin Console */
(function () {
  'use strict';

  const API = '/api/platform';
  const $main = document.getElementById('main');
  const $nav = document.getElementById('nav');

  // ── Helpers ──────────────────────────────────────────────
  async function api(path) {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'className') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v);
    });
    children.flat(Infinity).forEach(c => {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function fmt(n) { return n == null ? '-' : Number(n).toLocaleString(); }
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('zh-TW') : '-'; }
  function fmtMoney(n) { return n == null ? '-' : `NT$ ${Number(n).toLocaleString()}`; }

  function badge(text, color) {
    return h('span', { className: `badge ${color}` }, text);
  }

  function statusBadge(isActive) {
    return isActive ? badge('啟用', 'green') : badge('停用', 'red');
  }

  function invoiceStatusBadge(status) {
    const map = { DRAFT: 'gray', ISSUED: 'blue', PAID: 'green', OVERDUE: 'red', CANCELLED: 'gray' };
    const label = { DRAFT: '草稿', ISSUED: '已開立', PAID: '已付款', OVERDUE: '逾期', CANCELLED: '已取消' };
    return badge(label[status] || status, map[status] || 'gray');
  }

  function render(el) {
    $main.innerHTML = '';
    $main.appendChild(el);
  }

  function section(title, count, ...children) {
    return h('div', { className: 'section' },
      h('div', { className: 'section-title' }, title,
        count != null ? h('span', { className: 'count' }, String(count)) : null),
      ...children
    );
  }

  function table(headers, rows) {
    return h('table', { className: 'data' },
      h('thead', null, h('tr', null, ...headers.map(hd => h('th', null, hd)))),
      h('tbody', null, ...rows)
    );
  }

  // ── Views ────────────────────────────────────────────────

  async function viewDashboard() {
    render(h('div', null, h('div', { className: 'empty loading' }, '載入中...')));
    try {
      const [dash, tenants] = await Promise.all([api('/dashboard'), api('/tenants')]);

      const container = h('div', null,
        h('h2', null, '平台總覽'),
        h('p', { className: 'page-sub' }, '所有租戶與計費的即時概況'),

        // KPI
        h('div', { className: 'kpi-grid' },
          kpiCard('租戶總數', dash.tenants.total, `啟用: ${dash.tenants.active}`, 'accent'),
          kpiCard('員工帳號', fmt(dash.employees), null, 'info'),
          kpiCard('客戶數', fmt(dash.customers), null, 'info'),
          kpiCard('訂閱數', fmt(dash.subscriptions), `方案: ${dash.plans}`, 'success'),
          kpiCard('MRR', fmtMoney(dash.mrr), '月經常性收入', 'warning'),
        ),

        // Recent tenants
        section('最近建立的租戶', tenants.length,
          table(['公司名稱', '統編', '狀態', '模組', '員工', '客戶', '訂單', '方案', '建立日期'],
            tenants.slice(0, 10).map(t => h('tr', null,
              h('td', null, h('strong', null, t.companyName || '-')),
              h('td', null, t.taxId || '-'),
              h('td', null, statusBadge(t.isActive)),
              h('td', null, (t.modules || []).map(m => badge(m, 'blue')).reduce((a, b) => {
                if (a.length) a.push(document.createTextNode(' '));
                a.push(b);
                return a;
              }, [])),
              h('td', null, fmt(t._count?.employees)),
              h('td', null, fmt(t._count?.customers)),
              h('td', null, fmt(t._count?.salesOrders)),
              h('td', null, t.billingSubscription?.plan?.name
                ? badge(t.billingSubscription.plan.name, 'blue')
                : badge('無', 'gray')),
              h('td', null, fmtDate(t.createdAt)),
            ))
          )
        )
      );
      render(container);
    } catch (err) {
      render(h('div', { className: 'empty' }, `載入失敗: ${err.message}`));
    }
  }

  function kpiCard(label, value, sub, type) {
    return h('div', { className: `kpi-card ${type || ''}` },
      h('div', { className: 'label' }, label),
      h('div', { className: 'value' }, String(value)),
      sub ? h('div', { className: 'sub' }, sub) : null
    );
  }

  async function viewTenants() {
    render(h('div', null, h('div', { className: 'empty loading' }, '載入中...')));
    try {
      const tenants = await api('/tenants');
      const container = h('div', null,
        h('h2', null, '租戶管理'),
        h('p', { className: 'page-sub' }, `共 ${tenants.length} 個租戶`),
        table(
          ['公司名稱', '統編', '聯絡', '狀態', '模組', '員工/客戶/訂單', '訂閱方案', '版本', '建立日期'],
          tenants.map(t => h('tr', null,
            h('td', null, h('strong', null, t.companyName || '-')),
            h('td', null, t.taxId || '-'),
            h('td', null,
              t.email ? h('div', { style: { fontSize: '12px' } }, t.email) : null,
              t.phone ? h('div', { style: { fontSize: '12px', color: '#6b7280' } }, t.phone) : null
            ),
            h('td', null, statusBadge(t.isActive)),
            h('td', null, (t.modules || []).map(m => badge(m, 'blue')).reduce((a, b) => {
              if (a.length) a.push(document.createTextNode(' '));
              a.push(b);
              return a;
            }, [])),
            h('td', null, `${t._count?.employees || 0} / ${t._count?.customers || 0} / ${t._count?.salesOrders || 0}`),
            h('td', null, tenantSubInfo(t)),
            h('td', null, tenantVersionInfo(t)),
            h('td', null, fmtDate(t.createdAt)),
          ))
        )
      );
      render(container);
    } catch (err) {
      render(h('div', { className: 'empty' }, `載入失敗: ${err.message}`));
    }
  }

  function tenantSubInfo(t) {
    const sub = t.billingSubscription;
    if (!sub) return badge('無訂閱', 'gray');
    const parts = [];
    parts.push(h('div', null, badge(sub.plan?.name || '?', 'blue')));
    if (sub.isInTrial) parts.push(h('div', null, badge('試用中', 'yellow')));
    if (sub.suspendedAt) parts.push(h('div', null, badge('已暫停', 'red')));
    if (sub.renewalDate) parts.push(h('div', { style: { fontSize: '11px', color: '#6b7280', marginTop: '2px' } }, `續約: ${fmtDate(sub.renewalDate)}`));
    return h('div', null, ...parts);
  }

  function tenantVersionInfo(t) {
    const v = t.versionSubscription;
    if (!v) return badge('-', 'gray');
    const parts = [h('div', { style: { fontSize: '12px' } }, `v${v.currentVersion}`)];
    if (v.latestVersion && v.latestVersion !== v.currentVersion) {
      parts.push(h('div', null, badge(`可升級 v${v.latestVersion}`, 'yellow')));
    }
    if (v.previousVersion) {
      parts.push(h('div', { style: { marginTop: '2px' } }, badge(`可退回 v${v.previousVersion}`, 'red')));
    }
    return h('div', null, ...parts);
  }

  async function viewPlans() {
    render(h('div', null, h('div', { className: 'empty loading' }, '載入中...')));
    try {
      const plans = await api('/plans');
      const container = h('div', null,
        h('h2', null, '計費方案'),
        h('p', { className: 'page-sub' }, `共 ${plans.length} 個方案`),
        h('div', { className: 'plan-grid' },
          ...plans.map(p => h('div', { className: 'plan-card' },
            h('h3', null, p.name, ' ', !p.isActive ? badge('停用', 'red') : null),
            h('div', { className: 'price' }, fmtMoney(p.monthlyPrice), h('small', null, ' /月')),
            p.annualPrice ? h('div', { style: { fontSize: '13px', color: '#6b7280' } }, `年繳: ${fmtMoney(p.annualPrice)}/年`) : null,
            p.trialDays ? h('div', { style: { fontSize: '12px', color: '#d97706', marginTop: '4px' } }, `試用 ${p.trialDays} 天`) : null,
            h('ul', { className: 'features' },
              ...(p.planFeatures || []).map(f =>
                h('li', { className: f.enabled ? 'on' : 'off' }, f.feature)
              )
            ),
            h('div', { className: 'meta' },
              `訂閱數: ${p._count?.subscriptions || 0}`,
              p.maxEmployees ? ` | 上限員工: ${p.maxEmployees}` : '',
              p.maxCustomers ? ` | 上限客戶: ${p.maxCustomers}` : '',
            ),
          ))
        )
      );
      render(container);
    } catch (err) {
      render(h('div', { className: 'empty' }, `載入失敗: ${err.message}`));
    }
  }

  async function viewSubscriptions() {
    render(h('div', null, h('div', { className: 'empty loading' }, '載入中...')));
    try {
      const subs = await api('/subscriptions');
      const container = h('div', null,
        h('h2', null, '訂閱管理'),
        h('p', { className: 'page-sub' }, `共 ${subs.length} 筆訂閱`),
        table(
          ['租戶', '方案', '計費週期', '月費', '狀態', '續約日', '最近發票'],
          subs.map(s => h('tr', null,
            h('td', null, h('strong', null, s.tenant?.companyName || '-')),
            h('td', null, badge(s.plan?.name || '?', 'blue')),
            h('td', null, s.billingCycle === 'MONTHLY' ? '月繳' : s.billingCycle === 'ANNUAL' ? '年繳' : s.billingCycle || '-'),
            h('td', null, fmtMoney(s.plan?.monthlyPrice)),
            h('td', null, subStatusBadges(s)),
            h('td', null, fmtDate(s.renewalDate)),
            h('td', null, recentInvoices(s.invoices)),
          ))
        )
      );
      render(container);
    } catch (err) {
      render(h('div', { className: 'empty' }, `載入失敗: ${err.message}`));
    }
  }

  function subStatusBadges(s) {
    const parts = [];
    if (s.suspendedAt) parts.push(badge('已暫停', 'red'));
    else if (s.isInTrial) parts.push(badge('試用中', 'yellow'));
    else parts.push(badge('正常', 'green'));
    return h('span', null, ...parts);
  }

  function recentInvoices(invoices) {
    if (!invoices || !invoices.length) return h('span', { style: { color: '#9ca3af', fontSize: '12px' } }, '無');
    return h('div', null,
      ...invoices.map(inv => h('div', { style: { fontSize: '12px', marginBottom: '2px' } },
        inv.invoiceNumber || inv.id.slice(0, 8),
        ' ',
        fmtMoney(inv.total),
        ' ',
        invoiceStatusBadge(inv.status),
      ))
    );
  }

  async function viewInvoices() {
    render(h('div', null, h('div', { className: 'empty loading' }, '載入中...')));
    try {
      const invoices = await api('/invoices');
      const container = h('div', null,
        h('h2', null, '發票紀錄'),
        h('p', { className: 'page-sub' }, `最近 ${invoices.length} 筆發票`),
        table(
          ['發票號', '租戶', '方案', '金額', '狀態', '開立日', '付款日'],
          invoices.map(inv => h('tr', null,
            h('td', null, h('strong', null, inv.invoiceNumber || inv.id.slice(0, 8))),
            h('td', null, inv.subscription?.tenant?.companyName || '-'),
            h('td', null, inv.subscription?.plan?.name || '-'),
            h('td', null, fmtMoney(inv.total)),
            h('td', null, invoiceStatusBadge(inv.status)),
            h('td', null, fmtDate(inv.issuedAt)),
            h('td', null, fmtDate(inv.paidAt)),
          ))
        )
      );
      render(container);
    } catch (err) {
      render(h('div', { className: 'empty' }, `載入失敗: ${err.message}`));
    }
  }

  function changeTypeBadge(type) {
    const map = { UPGRADE: 'blue', ROLLBACK: 'red', AUTO_UPGRADE: 'yellow' };
    const label = { UPGRADE: '手動升級', ROLLBACK: '退版', AUTO_UPGRADE: '自動升級' };
    return badge(label[type] || type, map[type] || 'gray');
  }

  function fmtDateTime(d) {
    if (!d) return '-';
    const dt = new Date(d);
    return dt.toLocaleDateString('zh-TW') + ' ' + dt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  }

  async function viewVersions() {
    render(h('div', null, h('div', { className: 'empty loading' }, '載入中...')));
    try {
      const data = await api('/versions');
      const container = h('div', null,
        h('h2', null, '版本管理'),
        h('p', { className: 'page-sub' }, '版本歷史、租戶版本狀態、升級歷程'),

        // 版本歷史
        section('版本歷史', data.versions?.length,
          data.versions?.length
            ? table(
              ['版本', '狀態', '發布日', '支援期限', '功能', '備註'],
              data.versions.map(v => h('tr', null,
                h('td', null, h('strong', null, `v${v.version}`)),
                h('td', null, statusBadge(v.isActive)),
                h('td', null, fmtDate(v.releaseDate)),
                h('td', null, fmtDate(v.supportedUntil)),
                h('td', null, (v.features || []).length
                  ? h('ul', { style: { margin: '0', paddingLeft: '16px', fontSize: '12px' } },
                      ...(v.features || []).map(f => h('li', null, f)))
                  : '-'),
                h('td', null, v.notes || '-'),
              ))
            )
            : h('div', { style: { color: '#9ca3af', fontSize: '13px' } }, '尚無版本紀錄')
        ),

        // 租戶版本狀態
        section('租戶版本狀態', data.tenantVersions?.length,
          data.tenantVersions?.length
            ? table(
              ['租戶', '目前版本', '可退回版本', '最新版本', '升級期限'],
              data.tenantVersions.map(tv => h('tr', null,
                h('td', null, h('strong', null, tv.tenant?.companyName || '-')),
                h('td', null, `v${tv.currentVersion}`),
                h('td', null, tv.previousVersion ? badge(`v${tv.previousVersion}`, 'yellow') : badge('-', 'gray')),
                h('td', null,
                  tv.latestVersion !== tv.currentVersion
                    ? badge(`v${tv.latestVersion}`, 'yellow')
                    : badge(`v${tv.latestVersion}`, 'green')
                ),
                h('td', null, fmtDate(tv.upgradeDeadline)),
              ))
            )
            : h('div', { style: { color: '#9ca3af', fontSize: '13px' } }, '尚無租戶版本資料')
        ),

        // 升級歷程
        section('升級歷程', data.upgradeLogs?.length,
          data.upgradeLogs?.length
            ? table(
              ['時間', '租戶', '變更類型', '從版本', '到版本', '原因'],
              data.upgradeLogs.map(log => h('tr', null,
                h('td', null, fmtDateTime(log.createdAt)),
                h('td', null, h('strong', null, log.tenant?.companyName || '-')),
                h('td', null, changeTypeBadge(log.changeType)),
                h('td', null, `v${log.fromVersion}`),
                h('td', null, `v${log.toVersion}`),
                h('td', null, log.reason || '-'),
              ))
            )
            : h('div', { style: { color: '#9ca3af', fontSize: '13px' } }, '尚無升級歷程')
        ),
      );
      render(container);
    } catch (err) {
      render(h('div', { className: 'empty' }, `載入失敗: ${err.message}`));
    }
  }

  // ── Features View ────────────────────────────────────────

  function usageBadge(u) {
    if (u.limit < 0) return badge('無限制', 'green');
    if (u.isExceeded) return badge(`${u.currentUsage}/${u.limit} 已滿`, 'red');
    if (u.percentUsed >= 80) return badge(`${u.currentUsage}/${u.limit} (${u.percentUsed}%)`, 'yellow');
    return badge(`${u.currentUsage}/${u.limit} (${u.percentUsed}%)`, 'green');
  }

  function metricLabel(type) {
    const labels = {
      employee_count: '員工數',
      customer_count: '客戶數',
      monthly_order_count: '月訂單數',
      monthly_invoice_count: '月發票數',
      product_count: '產品數',
    };
    return labels[type] || type;
  }

  async function viewFeatures() {
    render(h('div', null, h('div', { className: 'empty loading' }, '載入中...')));
    try {
      const data = await api('/features');
      const container = h('div', null,
        h('h2', null, '功能管理'),
        h('p', { className: 'page-sub' }, '各租戶的模組開關與用量狀態'),

        ...data.map(t => {
          const moduleSection = h('div', { style: { marginBottom: '8px' } },
            h('strong', { style: { fontSize: '13px' } }, '已啟用模組: '),
            ...t.enabledModules.map(m => badge(m, 'blue')).reduce((a, b) => {
              if (a.length) a.push(document.createTextNode(' '));
              a.push(b);
              return a;
            }, []),
          );

          const usageRows = t.usageLimits.map(u =>
            h('tr', null,
              h('td', null, metricLabel(u.metricType)),
              h('td', null, usageBadge(u)),
              h('td', null,
                u.limit < 0 ? '-'
                  : h('div', { className: 'usage-bar-wrap' },
                      h('div', { className: 'usage-bar', style: {
                        width: `${Math.min(100, u.percentUsed)}%`,
                        backgroundColor: u.isExceeded ? '#ef4444' : u.percentUsed >= 80 ? '#f59e0b' : '#22c55e',
                      } })
                    )
              ),
            )
          );

          return section(
            `${t.companyName} — ${t.planName}`, null,
            moduleSection,
            usageRows.length
              ? table(['用量指標', '使用狀態', '進度'], usageRows)
              : h('div', { style: { color: '#9ca3af', fontSize: '13px' } }, '此方案無用量限制')
          );
        }),

        data.length === 0
          ? h('div', { className: 'empty' }, '尚無租戶功能資料')
          : null,
      );
      render(container);
    } catch (err) {
      render(h('div', { className: 'empty' }, `載入失敗: ${err.message}`));
    }
  }

  // ── Router ───────────────────────────────────────────────
  const views = {
    dashboard: viewDashboard,
    tenants: viewTenants,
    plans: viewPlans,
    subscriptions: viewSubscriptions,
    invoices: viewInvoices,
    versions: viewVersions,
    features: viewFeatures,
  };

  function route() {
    const hash = (location.hash || '#dashboard').slice(1);
    const view = views[hash] || viewDashboard;

    // Update nav
    $nav.querySelectorAll('a').forEach(a => {
      a.classList.toggle('active', a.dataset.view === hash);
    });

    view();
  }

  window.addEventListener('hashchange', route);
  route();
})();
