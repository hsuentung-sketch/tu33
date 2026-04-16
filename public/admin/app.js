// ERP 後台 SPA. Plain-JS hash router + small render helpers.

const api = {
  async req(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, opts);
    if (res.status === 401) {
      location.href = './login.html';
      throw new Error('unauth');
    }
    const ctype = res.headers.get('content-type') || '';
    const data = ctype.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || (typeof data === 'string' ? data : 'API error');
      throw new Error(msg);
    }
    return data;
  },
  get: (p) => api.req('GET', p),
  post: (p, b) => api.req('POST', p, b ?? {}),
  put: (p, b) => api.req('PUT', p, b ?? {}),
  del: (p) => api.req('DELETE', p),
};

const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
};

const fmtDate = (d) => { if (!d) return ''; try { return new Date(d).toLocaleDateString('zh-TW'); } catch { return String(d); } };
const fmtMoney = (n) => { if (n == null) return ''; const num = Number(n); return isNaN(num) ? String(n) : num.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };

function toast(msg, kind) {
  const t = el('div', { class: 'toast ' + (kind || '') }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function confirmBox(msg) { return window.confirm(msg); }

function openModal({ title, fields, initial = {}, onSubmit }) {
  const values = { ...initial };
  const errBox = el('div', { class: 'err' });
  const body = el('div', { class: 'body' });

  for (const f of fields) {
    if (f.type === 'row') {
      const row = el('div', { class: 'field row' });
      for (const sub of f.fields) row.append(buildField(sub, values));
      body.append(row);
    } else {
      body.append(buildField(f, values));
    }
  }

  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal' },
    el('h3', {}, title),
    body,
    errBox,
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onClick: () => backdrop.remove() }, '取消'),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          await onSubmit(values);
          backdrop.remove();
        } catch (e) { errBox.textContent = e.message; }
      } }, '儲存'),
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

function buildField(f, values) {
  const wrap = el('div', { class: 'field' });
  wrap.append(el('label', {}, f.label + (f.required ? ' *' : '')));
  let input;
  if (f.type === 'select') {
    input = el('select', {});
    for (const opt of f.options) {
      const o = el('option', { value: opt.value }, opt.label);
      if (String(values[f.name] ?? f.default ?? '') === String(opt.value)) o.selected = true;
      input.append(o);
    }
    input.addEventListener('change', () => { values[f.name] = input.value; });
    if (values[f.name] == null && f.default != null) values[f.name] = f.default;
  } else if (f.type === 'textarea') {
    input = el('textarea', { rows: '3' });
    input.value = values[f.name] ?? '';
    input.addEventListener('input', () => { values[f.name] = input.value; });
  } else {
    input = el('input', { type: f.type || 'text' });
    input.value = values[f.name] ?? '';
    input.addEventListener('input', () => {
      values[f.name] = f.type === 'number' ? (input.value === '' ? undefined : Number(input.value)) : input.value;
    });
  }
  wrap.append(input);
  return wrap;
}

// ------- Views -------

async function viewDashboard(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '總覽'));
  main.append(el('div', { class: 'page-sub' }, '系統目前狀況一覽。'));

  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px;' });
  main.append(grid);

  async function card(label, fetcher) {
    const box = el('div', { style: 'background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px;' },
      el('div', { style: 'color:var(--muted);font-size:12px;' }, label),
      el('div', { class: 'val', style: 'font-size:22px;font-weight:600;margin-top:4px;' }, '—'),
    );
    grid.append(box);
    try {
      const v = await fetcher();
      box.querySelector('.val').textContent = String(v);
    } catch { box.querySelector('.val').textContent = 'N/A'; }
  }

  await Promise.all([
    card('客戶數', async () => (await api.get('/customers')).length),
    card('產品數', async () => (await api.get('/products')).length),
    card('供應商數', async () => (await api.get('/suppliers')).length),
    card('逾期應收', async () => (await api.get('/receivables/overdue')).length),
  ]);

  main.append(el('div', { class: 'empty', style: 'text-align:left;' }, '左側選單切換各模組。'));
}

// Customers
async function viewCustomers(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '客戶管理'));
  main.append(el('div', { class: 'page-sub' }, '建立、編輯、停用客戶。'));

  const search = el('input', { type: 'text', placeholder: '搜尋公司/聯絡人…' });
  const includeInactive = el('input', { type: 'checkbox', id: 'ci_cust' });
  const tbody = el('tbody');
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '公司'),
      el('th', {}, '聯絡人'),
      el('th', {}, '電話'),
      el('th', {}, '統編'),
      el('th', { class: 'num' }, '付款天數'),
      el('th', {}, '等級'),
      el('th', {}, '狀態'),
      el('th', {}, '操作'),
    )),
    tbody,
  );

  async function reload() {
    const q = search.value.trim();
    const url = q ? `/customers?q=${encodeURIComponent(q)}` : `/customers${includeInactive.checked ? '?includeInactive=true' : ''}`;
    const list = await api.get(url);
    tbody.innerHTML = '';
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '8', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const c of list) {
      tbody.append(el('tr', {},
        el('td', {}, c.name),
        el('td', {}, c.contactName || ''),
        el('td', {}, c.phone || ''),
        el('td', {}, c.taxId || ''),
        el('td', { class: 'num' }, c.paymentDays ?? ''),
        el('td', {}, c.grade || ''),
        el('td', {}, el('span', { class: 'badge ' + (c.isActive === false ? 'mute' : 'ok') }, c.isActive === false ? '停用' : '啟用')),
        el('td', { class: 'actions' },
          el('button', { class: 'btn small', onClick: () => editCustomer(c, reload) }, '編輯'),
          ' ',
          c.isActive !== false
            ? el('button', { class: 'btn small danger', onClick: async () => {
                if (!confirmBox(`停用客戶「${c.name}」？`)) return;
                try { await api.del('/customers/' + c.id); toast('已停用', 'ok'); reload(); }
                catch (e) { toast(e.message, 'err'); }
              } }, '停用')
            : null,
        ),
      ));
    }
  }

  function editCustomer(c, done) {
    openModal({
      title: c ? '編輯客戶' : '新增客戶',
      initial: c ? { ...c } : { paymentDays: 30, grade: 'B' },
      fields: [
        { name: 'name', label: '公司名稱', required: true },
        { type: 'row', fields: [
          { name: 'contactName', label: '聯絡人' },
          { name: 'phone', label: '電話' },
        ]},
        { type: 'row', fields: [
          { name: 'taxId', label: '統一編號' },
          { name: 'email', label: 'Email', type: 'email' },
        ]},
        { type: 'row', fields: [
          { name: 'zipCode', label: '郵遞區號' },
          { name: 'paymentDays', label: '付款天數', type: 'number' },
        ]},
        { name: 'address', label: '地址' },
        { name: 'grade', label: '等級', type: 'select', options: [{value:'A',label:'A'},{value:'B',label:'B'},{value:'C',label:'C'}], default: 'B' },
      ],
      onSubmit: async (v) => {
        const body = cleanObj(v, ['name','contactName','phone','taxId','email','zipCode','address','paymentDays','grade']);
        if (!body.name) throw new Error('公司名稱必填');
        if (c) await api.put('/customers/' + c.id, body);
        else await api.post('/customers', body);
        toast(c ? '已更新' : '已新增', 'ok');
        done();
      },
    });
  }

  const toolbar = el('div', { class: 'toolbar' },
    search,
    el('button', { class: 'btn', onClick: reload }, '搜尋'),
    el('label', { style: 'font-size:12px;color:var(--muted);' }, includeInactive, ' 含停用'),
    el('div', { style: 'flex:1;' }),
    el('button', { class: 'btn primary', onClick: () => editCustomer(null, reload) }, '+ 新增客戶'),
  );
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); reload(); } });
  includeInactive.addEventListener('change', reload);
  main.append(toolbar, table);
  reload();
}

// Products
async function viewProducts(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '產品管理'));
  main.append(el('div', { class: 'page-sub' }, '管理產品主檔：售價、進價。'));

  const search = el('input', { type: 'text', placeholder: '搜尋編號/名稱…' });
  const includeInactive = el('input', { type: 'checkbox' });
  const tbody = el('tbody');
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '編號'),
      el('th', {}, '名稱'),
      el('th', {}, '類別'),
      el('th', { class: 'num' }, '售價'),
      el('th', { class: 'num' }, '進價'),
      el('th', {}, '狀態'),
      el('th', {}, '操作'),
    )),
    tbody,
  );

  async function reload() {
    const q = search.value.trim();
    const url = q ? `/products?q=${encodeURIComponent(q)}` : `/products${includeInactive.checked ? '?includeInactive=true' : ''}`;
    const list = await api.get(url);
    tbody.innerHTML = '';
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '7', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const p of list) {
      tbody.append(el('tr', {},
        el('td', {}, p.code),
        el('td', {}, p.name),
        el('td', {}, p.category || ''),
        el('td', { class: 'num' }, fmtMoney(p.salePrice)),
        el('td', { class: 'num' }, fmtMoney(p.costPrice)),
        el('td', {}, el('span', { class: 'badge ' + (p.isActive === false ? 'mute' : 'ok') }, p.isActive === false ? '停用' : '啟用')),
        el('td', { class: 'actions' },
          el('button', { class: 'btn small', onClick: () => edit(p) }, '編輯'),
          ' ',
          p.isActive !== false ? el('button', { class: 'btn small danger', onClick: async () => {
            if (!confirmBox(`停用產品「${p.name}」？`)) return;
            try { await api.del('/products/' + p.id); toast('已停用', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
          } }, '停用') : null,
        ),
      ));
    }
  }

  function edit(p) {
    openModal({
      title: p ? '編輯產品' : '新增產品',
      initial: p ? { ...p, salePrice: Number(p.salePrice), costPrice: Number(p.costPrice) } : { salePrice: 0, costPrice: 0 },
      fields: [
        { name: 'code', label: '產品編號', required: true },
        { name: 'name', label: '產品名稱', required: true },
        { name: 'category', label: '類別' },
        { type: 'row', fields: [
          { name: 'salePrice', label: '售價', type: 'number', required: true },
          { name: 'costPrice', label: '進價', type: 'number', required: true },
        ]},
        { name: 'note', label: '備註', type: 'textarea' },
      ],
      onSubmit: async (v) => {
        if (!v.code || !v.name) throw new Error('編號/名稱必填');
        const body = cleanObj(v, ['code','name','category','salePrice','costPrice','note']);
        if (p) { delete body.code; await api.put('/products/' + p.id, body); }
        else await api.post('/products', body);
        toast(p ? '已更新' : '已新增', 'ok');
        reload();
      },
    });
  }

  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); reload(); } });
  includeInactive.addEventListener('change', reload);
  main.append(el('div', { class: 'toolbar' },
    search,
    el('button', { class: 'btn', onClick: reload }, '搜尋'),
    el('label', { style: 'font-size:12px;color:var(--muted);' }, includeInactive, ' 含停用'),
    el('div', { style: 'flex:1;' }),
    el('button', { class: 'btn primary', onClick: () => edit(null) }, '+ 新增產品'),
  ), table);
  reload();
}

// Suppliers
async function viewSuppliers(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '供應商管理'));
  main.append(el('div', { class: 'page-sub' }, '管理供應商主檔。'));

  const includeInactive = el('input', { type: 'checkbox' });
  const tbody = el('tbody');
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '供應商'),
      el('th', {}, '類型'),
      el('th', {}, '聯絡人'),
      el('th', {}, '電話'),
      el('th', {}, '統編'),
      el('th', { class: 'num' }, '付款天數'),
      el('th', {}, '狀態'),
      el('th', {}, '操作'),
    )),
    tbody,
  );

  async function reload() {
    const list = await api.get('/suppliers' + (includeInactive.checked ? '?includeInactive=true' : ''));
    tbody.innerHTML = '';
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '8', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const s of list) {
      tbody.append(el('tr', {},
        el('td', {}, s.name),
        el('td', {}, s.type || ''),
        el('td', {}, s.contactName || ''),
        el('td', {}, s.phone || ''),
        el('td', {}, s.taxId || ''),
        el('td', { class: 'num' }, s.paymentDays ?? ''),
        el('td', {}, el('span', { class: 'badge ' + (s.isActive === false ? 'mute' : 'ok') }, s.isActive === false ? '停用' : '啟用')),
        el('td', { class: 'actions' },
          el('button', { class: 'btn small', onClick: () => edit(s) }, '編輯'),
          ' ',
          s.isActive !== false ? el('button', { class: 'btn small danger', onClick: async () => {
            if (!confirmBox(`停用供應商「${s.name}」？`)) return;
            try { await api.del('/suppliers/' + s.id); toast('已停用', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
          } }, '停用') : null,
        ),
      ));
    }
  }

  function edit(s) {
    openModal({
      title: s ? '編輯供應商' : '新增供應商',
      initial: s ? { ...s } : { paymentDays: 60 },
      fields: [
        { name: 'name', label: '供應商名稱', required: true },
        { type: 'row', fields: [
          { name: 'type', label: '類型' },
          { name: 'contactName', label: '聯絡人' },
        ]},
        { type: 'row', fields: [
          { name: 'phone', label: '電話' },
          { name: 'taxId', label: '統編' },
        ]},
        { type: 'row', fields: [
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'paymentDays', label: '付款天數', type: 'number' },
        ]},
        { name: 'zipCode', label: '郵遞區號' },
        { name: 'address', label: '地址' },
      ],
      onSubmit: async (v) => {
        if (!v.name) throw new Error('名稱必填');
        const body = cleanObj(v, ['name','type','contactName','phone','taxId','email','zipCode','address','paymentDays']);
        if (s) await api.put('/suppliers/' + s.id, body);
        else await api.post('/suppliers', body);
        toast(s ? '已更新' : '已新增', 'ok');
        reload();
      },
    });
  }

  includeInactive.addEventListener('change', reload);
  main.append(el('div', { class: 'toolbar' },
    el('label', { style: 'font-size:12px;color:var(--muted);' }, includeInactive, ' 含停用'),
    el('div', { style: 'flex:1;' }),
    el('button', { class: 'btn primary', onClick: () => edit(null) }, '+ 新增供應商'),
  ), table);
  reload();
}

// Employees + binding-code action
async function viewEmployees(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '員工管理'));
  main.append(el('div', { class: 'page-sub' }, '新增員工並發送 LINE 綁定碼。'));

  const includeInactive = el('input', { type: 'checkbox' });
  const tbody = el('tbody');
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '員工編號'),
      el('th', {}, '姓名'),
      el('th', {}, '角色'),
      el('th', {}, '電話'),
      el('th', {}, 'Email'),
      el('th', {}, 'LINE'),
      el('th', {}, '狀態'),
      el('th', {}, '操作'),
    )),
    tbody,
  );

  async function reload() {
    const list = await api.get('/employees' + (includeInactive.checked ? '?includeInactive=true' : ''));
    tbody.innerHTML = '';
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '8', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const e of list) {
      tbody.append(el('tr', {},
        el('td', {}, e.employeeId),
        el('td', {}, e.name),
        el('td', {}, el('span', { class: 'badge mute' }, e.role)),
        el('td', {}, e.phone || ''),
        el('td', {}, e.email || ''),
        el('td', {}, e.lineUserId
          ? el('span', { class: 'badge ok' }, '已綁定')
          : el('span', { class: 'badge warn' }, '未綁定')),
        el('td', {}, el('span', { class: 'badge ' + (e.isActive === false ? 'mute' : 'ok') }, e.isActive === false ? '停用' : '啟用')),
        el('td', { class: 'actions' },
          el('button', { class: 'btn small', onClick: () => edit(e) }, '編輯'),
          ' ',
          !e.lineUserId ? el('button', { class: 'btn small', onClick: () => issueCode(e) }, '綁定碼') : null,
          ' ',
          e.isActive !== false ? el('button', { class: 'btn small danger', onClick: async () => {
            if (!confirmBox(`停用員工「${e.name}」？`)) return;
            try { await api.del('/employees/' + e.id); toast('已停用', 'ok'); reload(); } catch (err) { toast(err.message, 'err'); }
          } }, '停用') : null,
        ),
      ));
    }
  }

  async function issueCode(emp) {
    try {
      const r = await api.post('/auth/bind/code', { employeeId: emp.id });
      const mins = r.expiresAt ? Math.max(0, Math.round((new Date(r.expiresAt).getTime() - Date.now()) / 60000)) : '—';
      alert(`綁定碼：${r.code}\n有效時間：${mins} 分鐘\n\n請該員工在 LINE 輸入：\n綁定 ${r.code}`);
    } catch (err) { toast(err.message, 'err'); }
  }

  function edit(emp) {
    openModal({
      title: emp ? '編輯員工' : '新增員工',
      initial: emp ? { ...emp } : { role: 'VIEWER' },
      fields: [
        { type: 'row', fields: [
          { name: 'employeeId', label: '員工編號', required: !emp },
          { name: 'name', label: '姓名', required: true },
        ]},
        { name: 'role', label: '角色', type: 'select', options: [
          { value: 'ADMIN', label: 'ADMIN（管理員）' },
          { value: 'SALES', label: 'SALES（業務）' },
          { value: 'PURCHASING', label: 'PURCHASING（採購）' },
          { value: 'ACCOUNTING', label: 'ACCOUNTING（會計）' },
          { value: 'VIEWER', label: 'VIEWER（檢視）' },
        ]},
        { type: 'row', fields: [
          { name: 'phone', label: '電話' },
          { name: 'email', label: 'Email', type: 'email' },
        ]},
        { name: 'address', label: '地址' },
      ],
      onSubmit: async (v) => {
        if (!v.name) throw new Error('姓名必填');
        if (!emp && !v.employeeId) throw new Error('員工編號必填');
        const body = cleanObj(v, ['name','role','phone','email','address'].concat(emp ? [] : ['employeeId']));
        if (emp) await api.put('/employees/' + emp.id, body);
        else await api.post('/employees', body);
        toast(emp ? '已更新' : '已新增', 'ok');
        reload();
      },
    });
  }

  includeInactive.addEventListener('change', reload);
  main.append(el('div', { class: 'toolbar' },
    el('label', { style: 'font-size:12px;color:var(--muted);' }, includeInactive, ' 含停用'),
    el('div', { style: 'flex:1;' }),
    el('button', { class: 'btn primary', onClick: () => edit(null) }, '+ 新增員工'),
  ), table);
  reload();
}

// ----- Read-only views (transactions) -----

async function viewQuotations(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '報價單'));
  main.append(el('div', { class: 'page-sub' }, '報價單建立、成交轉銷貨單由 LIFF 表單/LINE 完成，這裡可查詢與修改狀態。'));
  const tbody = el('tbody');
  main.append(el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '單號'), el('th', {}, '客戶'), el('th', {}, '業務'),
      el('th', { class: 'num' }, '總額'), el('th', {}, '狀態'),
      el('th', {}, '建立日'), el('th', {}, '操作'),
    )),
    tbody,
  ));
  try {
    const list = await api.get('/quotations');
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '7', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const q of list) {
      tbody.append(el('tr', {},
        el('td', {}, q.quotationNo),
        el('td', {}, q.customer?.name || q.customerId),
        el('td', {}, q.salesPerson),
        el('td', { class: 'num' }, fmtMoney(q.totalAmount)),
        el('td', {}, el('span', { class: 'badge ' + badgeForStatus(q.status) }, q.status)),
        el('td', {}, fmtDate(q.createdAt)),
        el('td', { class: 'actions' },
          el('a', { class: 'btn small', href: `/api/quotations/${q.id}/pdf`, target: '_blank' }, 'PDF'),
        ),
      ));
    }
  } catch (e) { main.append(el('div', { class: 'err' }, e.message)); }
}

async function viewSalesOrders(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '銷貨單'));
  main.append(el('div', { class: 'page-sub' }, '銷貨紀錄。'));
  const tbody = el('tbody');
  main.append(el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '單號'), el('th', {}, '客戶'), el('th', {}, '業務'),
      el('th', { class: 'num' }, '總額'), el('th', {}, '狀態'),
      el('th', {}, '開單日'), el('th', {}, '送貨日'),
    )),
    tbody,
  ));
  try {
    const list = await api.get('/sales-orders');
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '7', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const o of list) {
      tbody.append(el('tr', {},
        el('td', {}, o.orderNo),
        el('td', {}, o.customer?.name || o.customerId),
        el('td', {}, o.salesPerson),
        el('td', { class: 'num' }, fmtMoney(o.totalAmount)),
        el('td', {}, el('span', { class: 'badge ' + badgeForStatus(o.status) }, o.status)),
        el('td', {}, fmtDate(o.orderDate)),
        el('td', {}, fmtDate(o.deliveryDate)),
      ));
    }
  } catch (e) { main.append(el('div', { class: 'err' }, e.message)); }
}

async function viewPurchaseOrders(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '進貨單'));
  main.append(el('div', { class: 'page-sub' }, '進貨紀錄。'));
  const tbody = el('tbody');
  main.append(el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '單號'), el('th', {}, '供應商'), el('th', {}, '內勤'),
      el('th', { class: 'num' }, '總額'), el('th', {}, '狀態'),
      el('th', {}, '開單日'), el('th', {}, '收貨日'),
    )),
    tbody,
  ));
  try {
    const list = await api.get('/purchase-orders');
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '7', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const o of list) {
      tbody.append(el('tr', {},
        el('td', {}, o.orderNo),
        el('td', {}, o.supplier?.name || o.supplierId),
        el('td', {}, o.internalStaff),
        el('td', { class: 'num' }, fmtMoney(o.totalAmount)),
        el('td', {}, el('span', { class: 'badge ' + badgeForStatus(o.status) }, o.status)),
        el('td', {}, fmtDate(o.orderDate)),
        el('td', {}, fmtDate(o.receivedDate)),
      ));
    }
  } catch (e) { main.append(el('div', { class: 'err' }, e.message)); }
}

async function viewReceivables(main) { await viewAccount(main, 'receivables', '應收帳款', '客戶'); }
async function viewPayables(main) { await viewAccount(main, 'payables', '應付帳款', '供應商'); }

async function viewAccount(main, path, title, partyLabel) {
  main.innerHTML = '';
  main.append(el('h2', {}, title));
  main.append(el('div', { class: 'page-sub' }, `月結對帳。可標記已結案並填入發票號碼。`));

  const showOverdue = el('input', { type: 'checkbox' });
  const tbody = el('tbody');
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, partyLabel),
      el('th', {}, '單號'),
      el('th', {}, '請款月份'),
      el('th', { class: 'num' }, '金額'),
      el('th', {}, '到期日'),
      el('th', {}, '狀態'),
      el('th', {}, '發票'),
      el('th', {}, '操作'),
    )),
    tbody,
  );

  async function reload() {
    const list = await api.get(`/${path}${showOverdue.checked ? '/overdue' : ''}`);
    tbody.innerHTML = '';
    if (!list.length) {
      tbody.append(el('tr', {}, el('td', { colspan: '8', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
      return;
    }

    // Group by party + billingYear + billingMonth so the user can see each
    // month's total per customer/supplier. Subtotal row is appended after
    // each group's detail rows.
    const groups = new Map();
    for (const a of list) {
      const partyName = (a.customer?.name || a.supplier?.name) ?? '(未知)';
      const key = `${partyName}__${a.billingYear}__${a.billingMonth}`;
      if (!groups.has(key)) {
        groups.set(key, { partyName, billingYear: a.billingYear, billingMonth: a.billingMonth, items: [] });
      }
      groups.get(key).items.push(a);
    }

    const sortedGroups = [...groups.values()].sort((g1, g2) => {
      if (g1.partyName !== g2.partyName) return g1.partyName.localeCompare(g2.partyName, 'zh-Hant');
      if (g1.billingYear !== g2.billingYear) return g2.billingYear - g1.billingYear;
      return g2.billingMonth - g1.billingMonth;
    });

    for (const group of sortedGroups) {
      group.items.sort((x, y) => new Date(x.dueDate).getTime() - new Date(y.dueDate).getTime());

      let subtotal = 0;
      let paidCount = 0;
      let unpaidCount = 0;
      let overdueCount = 0;

      for (const a of group.items) {
        const isOverdue = !a.isPaid && a.dueDate && new Date(a.dueDate) < new Date();
        subtotal += Number(a.amount) || 0;
        if (a.isPaid) paidCount++;
        else { unpaidCount++; if (isOverdue) overdueCount++; }

        tbody.append(el('tr', {},
          el('td', {}, group.partyName),
          el('td', {}, a.salesOrder?.orderNo || a.purchaseOrder?.orderNo || ''),
          el('td', {}, `${a.billingYear}/${String(a.billingMonth).padStart(2, '0')}`),
          el('td', { class: 'num' }, fmtMoney(a.amount)),
          el('td', {}, fmtDate(a.dueDate)),
          el('td', {}, a.isPaid
            ? el('span', { class: 'badge ok' }, '已結案')
            : (isOverdue ? el('span', { class: 'badge bad' }, '已逾期') : el('span', { class: 'badge warn' }, '未收款'))),
          el('td', {}, a.invoiceNo || ''),
          el('td', { class: 'actions' },
            !a.isPaid ? el('button', { class: 'btn small primary', onClick: () => markPaid(a) }, '標記已付') : null,
          ),
        ));
      }

      const statusParts = [];
      if (unpaidCount) statusParts.push(`${unpaidCount} 未收款${overdueCount ? `（含 ${overdueCount} 逾期）` : ''}`);
      if (paidCount) statusParts.push(`${paidCount} 已結案`);

      const monthLabel = `${group.billingYear}/${String(group.billingMonth).padStart(2, '0')}`;
      tbody.append(el('tr', { class: 'subtotal-row' },
        el('td', { colspan: '3', style: 'text-align:right;font-weight:600;background:#eef2ff;color:#1e3a8a;' },
          `${group.partyName} ${monthLabel} 小計（${group.items.length} 筆）`),
        el('td', { class: 'num', style: 'font-weight:600;background:#eef2ff;color:#1e3a8a;' }, fmtMoney(subtotal)),
        el('td', { colspan: '4', style: 'font-size:12px;color:#475569;background:#eef2ff;' }, statusParts.join('　/　')),
      ));
    }
  }

  function markPaid(a) {
    openModal({
      title: '標記為已結案',
      initial: { paidDate: new Date().toISOString().slice(0, 10) },
      fields: [
        { name: 'paidDate', label: '入帳日', type: 'date', required: true },
        { name: 'invoiceNo', label: '發票號碼' },
        { name: 'note', label: '備註', type: 'textarea' },
      ],
      onSubmit: async (v) => {
        await api.post(`/${path}/${a.id}/pay`, cleanObj(v, ['paidDate','invoiceNo','note']));
        toast('已標記', 'ok');
        reload();
      },
    });
  }

  showOverdue.addEventListener('change', reload);
  main.append(el('div', { class: 'toolbar' },
    el('label', { style: 'font-size:12px;color:var(--muted);' }, showOverdue, ' 僅逾期'),
  ), table);
  reload();
}

async function viewInventory(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '庫存'));
  main.append(el('div', { class: 'page-sub' }, '目前庫存量與再訂購點。'));
  const tbody = el('tbody');
  main.append(el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '產品編號'), el('th', {}, '產品名稱'),
      el('th', { class: 'num' }, '庫存量'), el('th', { class: 'num' }, '再訂購點'),
      el('th', {}, '狀態'),
    )),
    tbody,
  ));
  try {
    const list = await api.get('/inventory');
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '5', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const inv of list) {
      const low = inv.reorderPoint > 0 && inv.quantity <= inv.reorderPoint;
      tbody.append(el('tr', {},
        el('td', {}, inv.product?.code || ''),
        el('td', {}, inv.product?.name || ''),
        el('td', { class: 'num' }, inv.quantity),
        el('td', { class: 'num' }, inv.reorderPoint),
        el('td', {}, low ? el('span', { class: 'badge bad' }, '低於再訂購點') : el('span', { class: 'badge ok' }, '正常')),
      ));
    }
  } catch (e) { main.append(el('div', { class: 'err' }, e.message)); }
}

// ----- Utilities -----

function cleanObj(src, keys) {
  const out = {};
  for (const k of keys) {
    const v = src[k];
    if (v === undefined || v === '' || v === null) continue;
    out[k] = v;
  }
  return out;
}

function badgeForStatus(s) {
  const ok = ['WON','COMPLETED','DELIVERED','RECEIVED','PAID'];
  const warn = ['SENT','TRACKING','PENDING','DRAFT'];
  const bad = ['LOST','CANCELLED'];
  if (ok.includes(s)) return 'ok';
  if (warn.includes(s)) return 'warn';
  if (bad.includes(s)) return 'bad';
  return 'mute';
}

const views = {
  dashboard: viewDashboard,
  customers: viewCustomers,
  products: viewProducts,
  suppliers: viewSuppliers,
  employees: viewEmployees,
  quotations: viewQuotations,
  'sales-orders': viewSalesOrders,
  'purchase-orders': viewPurchaseOrders,
  receivables: viewReceivables,
  payables: viewPayables,
  inventory: viewInventory,
};

async function route() {
  const hash = (location.hash || '#dashboard').slice(1);
  const main = document.getElementById('main');
  for (const a of document.querySelectorAll('#nav a')) {
    a.classList.toggle('active', a.dataset.view === hash);
  }
  const fn = views[hash] || viewDashboard;
  try { await fn(main); } catch (e) { main.innerHTML = ''; main.append(el('div', { class: 'err' }, e.message)); }
}

async function boot() {
  let session;
  try {
    const r = await fetch('/api/auth/web/session');
    if (!r.ok) { location.href = './login.html'; return; }
    session = await r.json();
  } catch { location.href = './login.html'; return; }

  document.getElementById('brandSub').textContent = session.tenant?.companyName || '';
  document.getElementById('meLabel').textContent = `${session.employee?.name}（${session.employee?.role}）`;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await fetch('/api/auth/web/logout', { method: 'POST' }); } catch {}
    location.href = './login.html';
  });
  window.addEventListener('hashchange', route);
  route();
}

boot();
