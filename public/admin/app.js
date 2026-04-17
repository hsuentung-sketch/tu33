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
      el('th', {}, 'Email'),
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
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '9', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const c of list) {
      tbody.append(el('tr', {},
        el('td', {}, c.name),
        el('td', {}, c.contactName || ''),
        el('td', {}, c.phone || ''),
        el('td', { style: 'font-size:12px;color:#555;' }, c.email || ''),
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
          el('button', { class: 'btn small', onClick: () => openProductDocs(p) }, '文件'),
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

// -------- Product documents modal --------

const DOC_TYPE_LABEL = { PDS: 'PDS', SDS: 'SDS', DM: 'DM', OTHER: '其他' };

function openProductDocs(product) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const listBox = el('div', {});
  const errBox = el('div', { class: 'err' });

  const typeSelect = el('select', {});
  for (const t of ['PDS', 'SDS', 'DM', 'OTHER']) {
    typeSelect.append(el('option', { value: t }, DOC_TYPE_LABEL[t]));
  }
  const fileInput = el('input', { type: 'file', accept: 'application/pdf,image/*' });
  const uploadBtn = el('button', { class: 'btn primary' }, '上傳');

  const modal = el('div', { class: 'modal' },
    el('h3', {}, `文件管理：${product.name}`),
    el('div', { class: 'body' },
      el('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:10px;' },
        '支援 PDF 或圖片（≤ 10MB）。上傳後可在 LINE 上讓使用者下載。'),
      el('div', { class: 'toolbar' }, typeSelect, fileInput, uploadBtn),
      el('div', { style: 'font-weight:600;font-size:13px;margin:14px 0 6px;' }, '已上傳文件'),
      listBox,
      errBox,
    ),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onClick: () => backdrop.remove() }, '關閉'),
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);

  async function refresh() {
    errBox.textContent = '';
    listBox.innerHTML = '載入中…';
    try {
      const docs = await api.get(`/products/${product.id}/documents`);
      listBox.innerHTML = '';
      if (!docs.length) {
        listBox.append(el('div', { class: 'empty', style: 'padding:16px;font-size:13px;' }, '尚未上傳任何文件'));
        return;
      }
      const tbl = el('table', { class: 'data' },
        el('thead', {}, el('tr', {},
          el('th', {}, '類別'),
          el('th', {}, '檔名'),
          el('th', { class: 'num' }, '大小'),
          el('th', {}, '上傳時間'),
          el('th', {}, ''),
        )),
      );
      const tb = el('tbody');
      for (const d of docs) {
        const kb = (d.fileSize / 1024).toFixed(0);
        const sizeLabel = d.fileSize > 1024 * 1024
          ? `${(d.fileSize / 1024 / 1024).toFixed(1)} MB`
          : `${kb} KB`;
        tb.append(el('tr', {},
          el('td', {}, el('span', { class: 'badge ok' }, DOC_TYPE_LABEL[d.type] || d.type)),
          el('td', { style: 'font-size:12px;word-break:break-all;' }, d.fileName),
          el('td', { class: 'num' }, sizeLabel),
          el('td', { style: 'font-size:12px;' }, fmtDate(d.createdAt)),
          el('td', { class: 'actions' },
            el('button', { class: 'btn small danger', onClick: async () => {
              if (!confirmBox(`刪除「${d.fileName}」？`)) return;
              try {
                await api.del(`/products/${product.id}/documents/${d.id}`);
                toast('已刪除', 'ok');
                refresh();
              } catch (e) { toast(e.message, 'err'); }
            } }, '刪除'),
          ),
        ));
      }
      tbl.append(tb);
      listBox.append(tbl);
    } catch (e) {
      listBox.innerHTML = '';
      errBox.textContent = e.message;
    }
  }

  uploadBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    const f = fileInput.files?.[0];
    if (!f) { errBox.textContent = '請先選擇檔案'; return; }
    if (f.size > 10 * 1024 * 1024) { errBox.textContent = '檔案超過 10 MB'; return; }
    uploadBtn.disabled = true;
    uploadBtn.textContent = '上傳中…';
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('type', typeSelect.value);
      const res = await fetch(`/api/products/${product.id}/documents`, {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      if (res.status === 401) { location.href = './login.html'; return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || '上傳失敗');
      toast('上傳完成', 'ok');
      fileInput.value = '';
      refresh();
    } catch (e) {
      errBox.textContent = e.message;
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = '上傳';
    }
  });

  refresh();
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

// ----- Transaction views (quotation / sales / purchase) -----

/**
 * Can the current employee edit this order?
 * Mirrors server rule: ADMIN or createdBy.
 */
function canEditOrder(order) {
  const me = window.__session?.employee;
  if (!me) return false;
  if (me.role === 'ADMIN') return true;
  return order.createdBy === me.id;
}

/**
 * Shared order editor modal. kind ∈ 'quotation' | 'sales' | 'purchase'.
 * Fetches full order (with items), shows editable form + items table.
 */
async function openOrderEditor(kind, orderId, onSaved) {
  const urlBase = kind === 'quotation' ? '/quotations'
                : kind === 'sales' ? '/sales-orders'
                : '/purchase-orders';
  let order;
  try { order = await api.get(`${urlBase}/${orderId}`); }
  catch (e) { toast(e.message, 'err'); return; }

  const isQuote = kind === 'quotation';
  const isPurchase = kind === 'purchase';
  const partyKey = isPurchase ? 'supplierId' : 'customerId';
  const staffKey = isPurchase ? 'internalStaff' : 'salesPerson';
  const staffPhoneKey = isPurchase ? 'staffPhone' : 'salesPhone';

  // Load candidate parties (customers / suppliers) for the selector.
  const parties = isPurchase
    ? await api.get('/suppliers').catch(() => [])
    : await api.get('/customers').catch(() => []);

  const state = {
    [partyKey]: order[partyKey],
    [staffKey]: order[staffKey] ?? '',
    [staffPhoneKey]: order[staffPhoneKey] ?? '',
    deliveryNote: order.deliveryNote ?? '',
    supplyTime: order.supplyTime ?? '',
    paymentTerms: order.paymentTerms ?? '',
    validUntil: order.validUntil ?? '',
    note: order.note ?? '',
    items: (order.items || []).map((it) => ({
      productName: it.productName,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
      note: it.note ?? '',
    })),
    reason: '',
  };

  const lockedByPaid = isPurchase ? order.payable?.isPaid : order.receivable?.isPaid;
  const nonPendingStatus = !['PENDING', 'DRAFT', 'SENT'].includes(order.status);
  const closedStatus = ['WON', 'LOST', 'CANCELLED'].includes(order.status) && isQuote;

  // --- Build modal body ---
  const body = el('div', { class: 'body' });
  const errBox = el('div', { class: 'err' });

  // Party selector
  const partyWrap = el('div', { class: 'field' });
  partyWrap.append(el('label', {}, isPurchase ? '供應商' : '客戶'));
  const partySelect = el('select', {});
  for (const p of parties) {
    const o = el('option', { value: p.id }, p.name);
    if (p.id === state[partyKey]) o.selected = true;
    partySelect.append(o);
  }
  partySelect.addEventListener('change', () => { state[partyKey] = partySelect.value; });
  partyWrap.append(partySelect);
  body.append(partyWrap);

  // Staff + phone row
  const staffRow = el('div', { class: 'field row' });
  const staffInp = el('input', { type: 'text' }); staffInp.value = state[staffKey];
  staffInp.addEventListener('input', () => { state[staffKey] = staffInp.value; });
  const staffWrap = el('div', { class: 'field' },
    el('label', {}, isPurchase ? '內勤' : '業務'), staffInp,
  );
  const phoneInp = el('input', { type: 'text' }); phoneInp.value = state[staffPhoneKey];
  phoneInp.addEventListener('input', () => { state[staffPhoneKey] = phoneInp.value; });
  const phoneWrap = el('div', { class: 'field' }, el('label', {}, '電話'), phoneInp);
  staffRow.append(staffWrap, phoneWrap);
  body.append(staffRow);

  // Quotation-specific terms
  if (isQuote) {
    const r = el('div', { class: 'field row' });
    const fieldOf = (label, key) => {
      const inp = el('input', { type: 'text' }); inp.value = state[key];
      inp.addEventListener('input', () => { state[key] = inp.value; });
      return el('div', { class: 'field' }, el('label', {}, label), inp);
    };
    r.append(fieldOf('可供貨時間', 'supplyTime'), fieldOf('付款期限', 'paymentTerms'), fieldOf('有效日期', 'validUntil'));
    body.append(r);
    const noteInp = el('textarea', { rows: '2' }); noteInp.value = state.note;
    noteInp.addEventListener('input', () => { state.note = noteInp.value; });
    body.append(el('div', { class: 'field' }, el('label', {}, '備註'), noteInp));
  } else {
    const dn = el('textarea', { rows: '2' }); dn.value = state.deliveryNote;
    dn.addEventListener('input', () => { state.deliveryNote = dn.value; });
    body.append(el('div', { class: 'field' }, el('label', {}, '送貨備註'), dn));
  }

  // Items table
  const itemsBox = el('div', { class: 'field' }, el('label', {}, '品項'));
  const itemsTable = el('table', { class: 'data', style: 'font-size:12px;' });
  const itemsHead = el('thead', {}, el('tr', {},
    el('th', {}, '品名'),
    el('th', { class: 'num' }, '數量'),
    el('th', { class: 'num' }, '單價'),
    el('th', { class: 'num' }, '小計'),
    el('th', {}, '備註'),
    el('th', {}, ''),
  ));
  const itemsBody = el('tbody');
  itemsTable.append(itemsHead, itemsBody);
  itemsBox.append(itemsTable);

  const totalsDiv = el('div', { style: 'text-align:right;font-size:13px;margin-top:6px;color:#555;' });

  function renderItems() {
    itemsBody.innerHTML = '';
    let sub = 0;
    state.items.forEach((it, idx) => {
      const nameInp = el('input', { type: 'text', style: 'width:100%;' });
      nameInp.value = it.productName;
      nameInp.addEventListener('input', () => { it.productName = nameInp.value; });
      const qtyInp = el('input', { type: 'number', step: '1', style: 'width:70px;text-align:right;' });
      qtyInp.value = String(it.quantity);
      qtyInp.addEventListener('input', () => { it.quantity = Number(qtyInp.value) || 0; renderItems(); });
      const priceInp = el('input', { type: 'number', step: '0.01', style: 'width:90px;text-align:right;' });
      priceInp.value = String(it.unitPrice);
      priceInp.addEventListener('input', () => { it.unitPrice = Number(priceInp.value) || 0; renderItems(); });
      const noteInp = el('input', { type: 'text', style: 'width:100%;' });
      noteInp.value = it.note || '';
      noteInp.addEventListener('input', () => { it.note = noteInp.value; });
      const removeBtn = el('button', { class: 'btn small danger', onClick: () => {
        state.items.splice(idx, 1); renderItems();
      } }, '刪');
      const line = (it.quantity || 0) * (it.unitPrice || 0);
      sub += line;
      itemsBody.append(el('tr', {},
        el('td', {}, nameInp),
        el('td', { class: 'num' }, qtyInp),
        el('td', { class: 'num' }, priceInp),
        el('td', { class: 'num' }, fmtMoney(line)),
        el('td', {}, noteInp),
        el('td', {}, removeBtn),
      ));
    });
    const tax = Math.round(sub * 0.05);
    totalsDiv.textContent = `小計 ${fmtMoney(sub)}　營業稅 ${fmtMoney(tax)}　總計 ${fmtMoney(sub + tax)}`;
  }
  renderItems();
  const addBtn = el('button', { class: 'btn small', onClick: () => {
    state.items.push({ productName: '', quantity: 1, unitPrice: 0, note: '' }); renderItems();
  } }, '+ 新增一列');
  itemsBox.append(addBtn, totalsDiv);
  body.append(itemsBox);

  // Reason textarea (required if non-PENDING / non-DRAFT)
  if (nonPendingStatus && !closedStatus) {
    const rInp = el('textarea', { rows: '2', placeholder: '此狀態修改需填寫原因' });
    rInp.addEventListener('input', () => { state.reason = rInp.value; });
    body.append(el('div', { class: 'field' },
      el('label', {}, '修改原因 *'), rInp,
    ));
  }

  // Disable save entirely if paid or closed (view-only)
  const locked = lockedByPaid || closedStatus || order.isDeleted;
  if (locked) {
    errBox.textContent = order.isDeleted ? '⛔ 此單已刪除' :
                         closedStatus ? `⛔ 狀態 ${order.status} 不可修改` :
                                        '⛔ 對應帳款已入帳/付款，無法修改';
  }

  // --- Mount modal ---
  const backdrop = el('div', { class: 'modal-backdrop' });
  const saveBtn = el('button', { class: 'btn primary' }, '儲存');
  saveBtn.disabled = locked;
  saveBtn.addEventListener('click', async () => {
    try {
      if (nonPendingStatus && !closedStatus && !state.reason.trim()) {
        throw new Error('請填寫修改原因');
      }
      if (!state.items.length) throw new Error('至少需要一個品項');
      const body = isQuote ? {
        customerId: state.customerId,
        salesPerson: state.salesPerson || null,
        salesPhone: state.salesPhone || null,
        supplyTime: state.supplyTime || null,
        paymentTerms: state.paymentTerms || null,
        validUntil: state.validUntil || null,
        note: state.note || null,
        items: state.items,
        reason: state.reason || undefined,
      } : isPurchase ? {
        supplierId: state.supplierId,
        internalStaff: state.internalStaff || null,
        staffPhone: state.staffPhone || null,
        deliveryNote: state.deliveryNote || null,
        items: state.items,
        reason: state.reason || undefined,
      } : {
        customerId: state.customerId,
        salesPerson: state.salesPerson || null,
        salesPhone: state.salesPhone || null,
        deliveryNote: state.deliveryNote || null,
        items: state.items,
        reason: state.reason || undefined,
      };
      await api.put(`${urlBase}/${orderId}`, body);
      toast('已儲存', 'ok');
      backdrop.remove();
      onSaved?.();
    } catch (e) { errBox.textContent = e.message; }
  });
  const deleteBtn = el('button', { class: 'btn danger', onClick: async () => {
    if (!confirmBox('確定刪除此單？連動的應收/應付及庫存會自動沖銷。')) return;
    try {
      await api.del(`${urlBase}/${orderId}`);
      toast('已刪除', 'ok');
      backdrop.remove();
      onSaved?.();
    } catch (e) { errBox.textContent = e.message; }
  } }, '刪除');
  deleteBtn.disabled = locked;
  const modal = el('div', { class: 'modal', style: 'max-width:820px;width:92%;' },
    el('h3', {}, `編輯 ${isQuote ? '報價單' : isPurchase ? '進貨單' : '銷貨單'}  ${order.quotationNo || order.orderNo}`),
    body,
    errBox,
    el('div', { class: 'actions', style: 'justify-content:space-between;' },
      deleteBtn,
      el('div', {},
        el('button', { class: 'btn', onClick: () => backdrop.remove() }, '取消'),
        ' ', saveBtn,
      ),
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

async function viewQuotations(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '報價單'));
  main.append(el('div', { class: 'page-sub' }, '可修改/刪除：ADMIN 或建單人；刪除為軟刪除。'));
  const tbody = el('tbody');
  main.append(el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '單號'), el('th', {}, '客戶'), el('th', {}, '業務'),
      el('th', { class: 'num' }, '總額'), el('th', {}, '狀態'),
      el('th', {}, '建立日'), el('th', {}, '操作'),
    )),
    tbody,
  ));
  async function reload() {
    tbody.innerHTML = '';
    try {
      const list = await api.get('/quotations');
      if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '7', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
      for (const q of list) {
        const canEdit = canEditOrder(q);
        tbody.append(el('tr', {},
          el('td', {}, q.quotationNo),
          el('td', {}, q.customer?.name || q.customerId),
          el('td', {}, q.salesPerson),
          el('td', { class: 'num' }, fmtMoney(q.totalAmount)),
          el('td', {}, el('span', { class: 'badge ' + badgeForStatus(q.status) }, q.status)),
          el('td', {}, fmtDate(q.createdAt)),
          el('td', { class: 'actions' },
            canEdit
              ? el('button', { class: 'btn small', onClick: () => openOrderEditor('quotation', q.id, reload) }, '編輯')
              : el('span', { style: 'color:#bbb;font-size:11px;' }, '—'),
          ),
        ));
      }
    } catch (e) { main.append(el('div', { class: 'err' }, e.message)); }
  }
  await reload();
}

async function viewSalesOrders(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '銷貨單'));
  main.append(el('div', { class: 'page-sub' }, '可修改/刪除：ADMIN 或建單人；已入帳者鎖定。'));
  const tbody = el('tbody');
  main.append(el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '單號'), el('th', {}, '客戶'), el('th', {}, '業務'),
      el('th', { class: 'num' }, '總額'), el('th', {}, '狀態'),
      el('th', {}, '開單日'), el('th', {}, '送貨日'), el('th', {}, '操作'),
    )),
    tbody,
  ));
  async function reload() {
    tbody.innerHTML = '';
    try {
      const list = await api.get('/sales-orders');
      if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '8', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
      for (const o of list) {
        const canEdit = canEditOrder(o);
        tbody.append(el('tr', {},
          el('td', {}, o.orderNo),
          el('td', {}, o.customer?.name || o.customerId),
          el('td', {}, o.salesPerson),
          el('td', { class: 'num' }, fmtMoney(o.totalAmount)),
          el('td', {}, el('span', { class: 'badge ' + badgeForStatus(o.status) }, o.status)),
          el('td', {}, fmtDate(o.orderDate)),
          el('td', {}, fmtDate(o.deliveryDate)),
          el('td', { class: 'actions' },
            canEdit
              ? el('button', { class: 'btn small', onClick: () => openOrderEditor('sales', o.id, reload) }, '編輯')
              : el('span', { style: 'color:#bbb;font-size:11px;' }, '—'),
          ),
        ));
      }
    } catch (e) { main.append(el('div', { class: 'err' }, e.message)); }
  }
  await reload();
}

async function viewPurchaseOrders(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '進貨單'));
  main.append(el('div', { class: 'page-sub' }, '可修改/刪除：ADMIN 或建單人；已付款者鎖定。'));
  const tbody = el('tbody');
  main.append(el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '單號'), el('th', {}, '供應商'), el('th', {}, '內勤'),
      el('th', { class: 'num' }, '總額'), el('th', {}, '狀態'),
      el('th', {}, '開單日'), el('th', {}, '收貨日'), el('th', {}, '操作'),
    )),
    tbody,
  ));
  async function reload() {
    tbody.innerHTML = '';
    try {
      const list = await api.get('/purchase-orders');
      if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '8', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
      for (const o of list) {
        const canEdit = canEditOrder(o);
        tbody.append(el('tr', {},
          el('td', {}, o.orderNo),
          el('td', {}, o.supplier?.name || o.supplierId),
          el('td', {}, o.internalStaff),
          el('td', { class: 'num' }, fmtMoney(o.totalAmount)),
          el('td', {}, el('span', { class: 'badge ' + badgeForStatus(o.status) }, o.status)),
          el('td', {}, fmtDate(o.orderDate)),
          el('td', {}, fmtDate(o.receivedDate)),
          el('td', { class: 'actions' },
            canEdit
              ? el('button', { class: 'btn small', onClick: () => openOrderEditor('purchase', o.id, reload) }, '編輯')
              : el('span', { style: 'color:#bbb;font-size:11px;' }, '—'),
          ),
        ));
      }
    } catch (e) { main.append(el('div', { class: 'err' }, e.message)); }
  }
  await reload();
}

async function viewReceivables(main) { await viewAccount(main, 'receivables', '應收帳款', '客戶'); }
async function viewPayables(main) { await viewAccount(main, 'payables', '應付帳款', '供應商'); }

async function viewAccount(main, path, title, partyLabel) {
  main.innerHTML = '';
  main.append(el('h2', {}, title));
  main.append(el('div', { class: 'page-sub' }, `月結對帳。發票號碼、付款日期與結案狀態可隨時編輯。`));

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
      el('th', {}, '付款日'),
      el('th', {}, '操作'),
    )),
    tbody,
  );

  async function reload() {
    const list = await api.get(`/${path}${showOverdue.checked ? '/overdue' : ''}`);
    tbody.innerHTML = '';
    if (!list.length) {
      tbody.append(el('tr', {}, el('td', { colspan: '9', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
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
          el('td', {}, fmtDate(a.paidDate)),
          el('td', { class: 'actions' },
            el('button', { class: 'btn small', onClick: () => editAccount(a) }, '編輯'),
            !a.isPaid ? ' ' : null,
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
        el('td', { colspan: '5', style: 'font-size:12px;color:#475569;background:#eef2ff;' }, statusParts.join('　/　')),
      ));
    }
  }

  function markPaid(a) {
    openModal({
      title: '標記為已結案',
      initial: { paidDate: new Date().toISOString().slice(0, 10) },
      fields: [
        { name: 'paidDate', label: '付款/入帳日', type: 'date', required: true },
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

  /**
   * Edit 發票號碼 / 付款日期 / 已結案 — 任何狀態都可改。
   * 走 PUT /api/{receivables|payables}/:id（partial update）。
   */
  function editAccount(a) {
    const isPayable = path === 'payables';
    openModal({
      title: `編輯${isPayable ? '應付' : '應收'}帳款`,
      initial: {
        isPaid: !!a.isPaid,
        paidDate: a.paidDate ? new Date(a.paidDate).toISOString().slice(0, 10) : '',
        invoiceNo: a.invoiceNo || '',
        note: a.note || '',
      },
      fields: [
        { name: 'invoiceNo', label: '發票號碼' },
        { name: 'paidDate', label: isPayable ? '付款日期' : '入帳日期', type: 'date' },
        { name: 'isPaid', label: '已結案（勾選＝已付／已收）', type: 'select', options: [
          { value: 'false', label: '未結案' },
          { value: 'true', label: '已結案' },
        ]},
        { name: 'note', label: '備註', type: 'textarea' },
      ],
      onSubmit: async (v) => {
        const body = {
          isPaid: v.isPaid === 'true' || v.isPaid === true,
          paidDate: v.paidDate ? v.paidDate : null,
          invoiceNo: v.invoiceNo ? v.invoiceNo : null,
          note: v.note ? v.note : null,
        };
        await api.put(`/${path}/${a.id}`, body);
        toast('已儲存', 'ok');
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

// ----- 公司資料 (ADMIN only) -----

async function viewCompany(main) {
  if (window.__session?.employee?.role !== 'ADMIN') {
    main.innerHTML = '';
    main.append(el('h2', {}, '公司資料'));
    main.append(el('div', { class: 'empty' }, '僅 ADMIN 可檢視此頁。'));
    return;
  }

  main.innerHTML = '';
  main.append(el('h2', {}, '公司資料'));
  main.append(el('div', { class: 'page-sub' }, '公司抬頭、統一編號等會顯示在報價單／銷貨單／進貨單 PDF 上。'));

  const form = el('form', { class: 'card', style: 'padding:16px;max-width:640px;' });
  const errBox = el('div', { class: 'err', style: 'margin-top:8px;' });

  function field(name, label, opts = {}) {
    const input = el('input', { name, type: opts.type || 'text', style: 'width:100%;' });
    if (opts.readonly) input.readOnly = true;
    const row = el('div', { style: 'margin-bottom:12px;' },
      el('label', { style: 'display:block;font-size:12px;color:#666;margin-bottom:4px;' }, label),
      input,
    );
    form.append(row);
    return input;
  }

  const companyName = field('companyName', '公司名稱 *');
  const taxId = field('taxId', '統一編號（8 碼）');
  const phone = field('phone', '電話');
  const email = field('email', 'Email', { type: 'email' });
  const address = field('address', '地址');

  const saveBtn = el('button', { type: 'submit', class: 'btn primary' }, '儲存');
  form.append(saveBtn, errBox);
  main.append(form);

  // Load current
  let current = null;
  try {
    current = await api.get('/tenant/me');
    companyName.value = current.companyName || '';
    taxId.value = current.taxId || '';
    phone.value = current.phone || '';
    email.value = current.email || '';
    address.value = current.address || '';
  } catch (e) {
    errBox.textContent = '讀取失敗：' + e.message;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errBox.textContent = '';
    saveBtn.disabled = true;
    try {
      const body = {
        companyName: companyName.value.trim(),
        taxId: taxId.value.trim() || null,
        phone: phone.value.trim() || null,
        email: email.value.trim() || null,
        address: address.value.trim() || null,
      };
      if (!body.companyName) throw new Error('公司名稱必填');
      await api.put('/tenant/me', body);
      toast('已儲存', 'ok');
    } catch (e) {
      errBox.textContent = e.message;
    } finally {
      saveBtn.disabled = false;
    }
  });
}

// ----- Audit log (ADMIN only) -----

const AUDIT_ACTION_LABEL = {
  CREATE_CUSTOMER: '建立客戶',
  UPDATE_CUSTOMER: '修改客戶',
  DELETE_CUSTOMER: '停用客戶',
  CREATE_PRODUCT: '建立產品',
  UPDATE_PRODUCT: '修改產品',
  DELETE_PRODUCT: '停用產品',
  CREATE_SUPPLIER: '建立供應商',
  UPDATE_SUPPLIER: '修改供應商',
  DELETE_SUPPLIER: '停用供應商',
  CREATE_EMPLOYEE: '建立員工',
  UPDATE_EMPLOYEE: '修改員工',
  DELETE_EMPLOYEE: '停用員工',
  CREATE_QUOTATION: '建立報價單',
  UPDATE_QUOTATION: '修改報價單',
  CREATE_SALESORDER: '建立銷貨單',
  UPDATE_SALESORDER: '修改銷貨單',
  CREATE_PURCHASEORDER: '建立進貨單',
  UPDATE_PURCHASEORDER: '修改進貨單',
  UPDATE_ACCOUNTRECEIVABLE: '更新應收帳款',
  UPDATE_ACCOUNTPAYABLE: '更新應付帳款',
  WEB_LOGIN: '後台登入',
  WEB_LOGIN_FAILED: '後台登入失敗',
  WEB_LOGOUT: '後台登出',
  LINE_BIND_CODE_CREATED: '產生 LINE 綁定碼',
  LINE_BIND_SUCCESS: 'LINE 綁定成功',
};

async function viewAuditLogs(main) {
  if (window.__session?.employee?.role !== 'ADMIN') {
    main.innerHTML = '';
    main.append(el('h2', {}, '操作紀錄'));
    main.append(el('div', { class: 'empty' }, '僅 ADMIN 可檢視此頁。'));
    return;
  }

  main.innerHTML = '';
  main.append(el('h2', {}, '操作紀錄'));
  main.append(el('div', { class: 'page-sub' }, '系統操作稽核日誌（ADMIN 限定）。'));

  const state = {
    from: '', to: '', userId: '', entity: '', action: '', q: '',
    page: 1, pageSize: 50, total: 0,
  };

  const fromInput = el('input', { type: 'date', placeholder: '起日' });
  const toInput = el('input', { type: 'date', placeholder: '迄日' });
  const userSelect = el('select', {});
  userSelect.append(el('option', { value: '' }, '— 所有使用者 —'));
  const entitySelect = el('select', {});
  for (const o of [
    { v: '', t: '— 所有模組 —' },
    { v: 'Customer', t: '客戶' },
    { v: 'Product', t: '產品' },
    { v: 'Supplier', t: '供應商' },
    { v: 'Employee', t: '員工' },
    { v: 'Quotation', t: '報價單' },
    { v: 'SalesOrder', t: '銷貨單' },
    { v: 'PurchaseOrder', t: '進貨單' },
    { v: 'AccountReceivable', t: '應收' },
    { v: 'AccountPayable', t: '應付' },
  ]) entitySelect.append(el('option', { value: o.v }, o.t));
  const searchInput = el('input', { type: 'text', placeholder: '關鍵字（動作/ID/詳情）' });
  const refreshBtn = el('button', { class: 'btn primary' }, '查詢');

  const toolbar = el('div', { class: 'toolbar' },
    fromInput, toInput, userSelect, entitySelect, searchInput, refreshBtn,
  );
  main.append(toolbar);

  const meta = el('div', { class: 'page-sub' });
  main.append(meta);
  const tbody = el('tbody');
  main.append(el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '時間'),
      el('th', {}, '操作者'),
      el('th', {}, '動作'),
      el('th', {}, '模組'),
      el('th', {}, '對象 ID'),
      el('th', {}, '詳情'),
    )),
    tbody,
  ));
  const pager = el('div', { class: 'toolbar', style: 'justify-content:flex-end;' });
  main.append(pager);

  // Prefill users dropdown by calling employees API (ADMIN can see all)
  try {
    const emps = await api.get('/employees?includeInactive=true');
    for (const e of emps) {
      userSelect.append(el('option', { value: e.id }, `${e.employeeId} ${e.name}`));
    }
  } catch { /* non-fatal */ }

  async function load() {
    state.from = fromInput.value;
    state.to = toInput.value;
    state.userId = userSelect.value;
    state.entity = entitySelect.value;
    state.q = searchInput.value.trim();

    const qs = new URLSearchParams();
    for (const k of ['from', 'to', 'userId', 'entity', 'action', 'q']) {
      if (state[k]) qs.set(k, state[k]);
    }
    qs.set('page', String(state.page));
    qs.set('pageSize', String(state.pageSize));

    tbody.innerHTML = '';
    pager.innerHTML = '';
    meta.textContent = '載入中…';
    try {
      const data = await api.get('/audit-logs?' + qs.toString());
      state.total = data.total;
      const usersById = new Map((data.users || []).map((u) => [u.id, u]));
      meta.textContent = `共 ${data.total} 筆，第 ${data.page} 頁（每頁 ${data.pageSize}）`;
      if (!data.items.length) {
        tbody.append(el('tr', {}, el('td', { colspan: '6', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
      } else {
        for (const row of data.items) {
          const u = usersById.get(row.userId);
          const userLabel = u ? `${u.employeeId} ${u.name}` : (row.userId || '—');
          const action = AUDIT_ACTION_LABEL[row.action] || row.action;
          const time = new Date(row.createdAt).toLocaleString('zh-TW');
          const detailCell = el('td', { style: 'max-width:360px;font-size:11px;color:#555;word-break:break-all;' });
          if (row.detail) {
            const short = row.detail.length > 80 ? row.detail.slice(0, 80) + '…' : row.detail;
            const pre = el('span', { title: row.detail }, short);
            detailCell.append(pre);
          } else {
            detailCell.append(el('span', { style: 'color:#aaa;' }, '—'));
          }
          tbody.append(el('tr', {},
            el('td', { style: 'white-space:nowrap;' }, time),
            el('td', {}, userLabel),
            el('td', {}, action),
            el('td', {}, row.entity),
            el('td', { style: 'font-family:monospace;font-size:11px;color:#666;' }, row.entityId),
            detailCell,
          ));
        }
      }
      // Pagination controls
      const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
      const prev = el('button', { class: 'btn small' }, '上一頁');
      prev.disabled = state.page <= 1;
      prev.addEventListener('click', () => { state.page = Math.max(1, state.page - 1); load(); });
      const next = el('button', { class: 'btn small' }, '下一頁');
      next.disabled = state.page >= totalPages;
      next.addEventListener('click', () => { state.page = Math.min(totalPages, state.page + 1); load(); });
      pager.append(prev, el('span', { style: 'font-size:12px;color:#666;' }, ` ${state.page} / ${totalPages} `), next);
    } catch (e) {
      meta.textContent = '';
      tbody.append(el('tr', {}, el('td', { colspan: '6' }, el('div', { class: 'err' }, e.message))));
    }
  }

  refreshBtn.addEventListener('click', () => { state.page = 1; load(); });
  searchInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { state.page = 1; load(); } });

  await load();
}

// ----- Error log (ADMIN only) -----

async function viewErrorLogs(main) {
  if (window.__session?.employee?.role !== 'ADMIN') {
    main.innerHTML = '';
    main.append(el('h2', {}, '異常紀錄'));
    main.append(el('div', { class: 'empty' }, '僅 ADMIN 可檢視此頁。'));
    return;
  }

  main.innerHTML = '';
  main.append(el('h2', {}, '異常紀錄'));
  main.append(el('div', { class: 'page-sub' }, '系統執行期例外與警告，協助排錯。'));

  const state = {
    from: '', to: '', userId: '', source: '', level: '', q: '',
    page: 1, pageSize: 50, total: 0,
  };

  const fromInput = el('input', { type: 'date', placeholder: '起日' });
  const toInput = el('input', { type: 'date', placeholder: '迄日' });
  const userSelect = el('select', {});
  userSelect.append(el('option', { value: '' }, '— 所有使用者 —'));
  const levelSelect = el('select', {});
  for (const o of [
    { v: '', t: '— 全部等級 —' },
    { v: 'error', t: 'error' },
    { v: 'warn', t: 'warn' },
  ]) levelSelect.append(el('option', { value: o.v }, o.t));
  const sourceInput = el('input', { type: 'text', placeholder: '來源 (e.g. line.webhook)' });
  const searchInput = el('input', { type: 'text', placeholder: '關鍵字（訊息/路由/requestId）' });
  const refreshBtn = el('button', { class: 'btn primary' }, '查詢');

  const toolbar = el('div', { class: 'toolbar' },
    fromInput, toInput, userSelect, levelSelect, sourceInput, searchInput, refreshBtn,
  );
  main.append(toolbar);

  const meta = el('div', { class: 'page-sub' });
  main.append(meta);
  const tbody = el('tbody');
  main.append(el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '時間'),
      el('th', {}, '等級'),
      el('th', {}, '來源'),
      el('th', {}, '路由'),
      el('th', {}, '訊息'),
      el('th', {}, '操作者'),
      el('th', {}, 'requestId'),
    )),
    tbody,
  ));
  const pager = el('div', { class: 'toolbar', style: 'justify-content:flex-end;' });
  main.append(pager);

  try {
    const emps = await api.get('/employees?includeInactive=true');
    for (const e of emps) {
      userSelect.append(el('option', { value: e.id }, `${e.employeeId} ${e.name}`));
    }
  } catch { /* non-fatal */ }

  async function load() {
    state.from = fromInput.value;
    state.to = toInput.value;
    state.userId = userSelect.value;
    state.level = levelSelect.value;
    state.source = sourceInput.value.trim();
    state.q = searchInput.value.trim();

    const qs = new URLSearchParams();
    for (const k of ['from', 'to', 'userId', 'level', 'source', 'q']) {
      if (state[k]) qs.set(k, state[k]);
    }
    qs.set('page', String(state.page));
    qs.set('pageSize', String(state.pageSize));

    tbody.innerHTML = '';
    pager.innerHTML = '';
    meta.textContent = '載入中…';
    try {
      const data = await api.get('/error-logs?' + qs.toString());
      state.total = data.total;
      const usersById = new Map((data.users || []).map((u) => [u.id, u]));
      meta.textContent = `共 ${data.total} 筆，第 ${data.page} 頁（每頁 ${data.pageSize}）`;
      if (!data.items.length) {
        tbody.append(el('tr', {}, el('td', { colspan: '7', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
      } else {
        for (const row of data.items) {
          const u = row.userId ? usersById.get(row.userId) : null;
          const userLabel = u ? `${u.employeeId} ${u.name}` : (row.userId || '—');
          const time = new Date(row.createdAt).toLocaleString('zh-TW');
          const levelBadge = row.level === 'warn'
            ? el('span', { class: 'badge warn' }, 'warn')
            : el('span', { class: 'badge bad' }, 'error');
          const msgCell = el('td', { style: 'max-width:420px;font-size:12px;word-break:break-all;' });
          const shortMsg = (row.message || '').length > 120 ? row.message.slice(0, 120) + '…' : (row.message || '');
          const msgSpan = el('span', { title: row.message || '' }, shortMsg);
          msgCell.append(msgSpan);
          if (row.stack) {
            const toggle = el('a', { href: 'javascript:void(0)', style: 'margin-left:8px;font-size:11px;color:#1565C0;' }, '[stack]');
            const stackBox = el('pre', { style: 'display:none;margin-top:6px;padding:8px;background:#f8f8f8;border:1px solid #eee;font-size:11px;white-space:pre-wrap;max-height:240px;overflow:auto;' }, row.stack);
            toggle.addEventListener('click', () => {
              stackBox.style.display = stackBox.style.display === 'none' ? 'block' : 'none';
            });
            msgCell.append(toggle, stackBox);
          }
          const tr = el('tr', {},
            el('td', { style: 'white-space:nowrap;' }, time),
            el('td', {}, levelBadge),
            el('td', { style: 'font-family:monospace;font-size:11px;' }, row.source || '—'),
            el('td', { style: 'font-family:monospace;font-size:11px;color:#666;' }, row.route || '—'),
            msgCell,
            el('td', {}, userLabel),
            el('td', { style: 'font-family:monospace;font-size:10px;color:#999;' }, row.requestId ? row.requestId.slice(0, 8) : '—'),
          );
          tbody.append(tr);
        }
      }
      const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
      const prev = el('button', { class: 'btn small' }, '上一頁');
      prev.disabled = state.page <= 1;
      prev.addEventListener('click', () => { state.page = Math.max(1, state.page - 1); load(); });
      const next = el('button', { class: 'btn small' }, '下一頁');
      next.disabled = state.page >= totalPages;
      next.addEventListener('click', () => { state.page = Math.min(totalPages, state.page + 1); load(); });
      pager.append(prev, el('span', { style: 'font-size:12px;color:#666;' }, ` ${state.page} / ${totalPages} `), next);
    } catch (e) {
      meta.textContent = '';
      tbody.append(el('tr', {}, el('td', { colspan: '7' }, el('div', { class: 'err' }, e.message))));
    }
  }

  refreshBtn.addEventListener('click', () => { state.page = 1; load(); });
  searchInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { state.page = 1; load(); } });
  sourceInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { state.page = 1; load(); } });

  await load();
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
  'audit-logs': viewAuditLogs,
  'error-logs': viewErrorLogs,
  company: viewCompany,
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

  window.__session = session;
  document.getElementById('brandSub').textContent = session.tenant?.companyName || '';
  document.getElementById('meLabel').textContent = `${session.employee?.name}（${session.employee?.role}）`;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await fetch('/api/auth/web/logout', { method: 'POST' }); } catch {}
    location.href = './login.html';
  });
  // Hide ADMIN-only nav links from non-admins.
  if (session.employee?.role !== 'ADMIN') {
    for (const a of document.querySelectorAll('#nav a[data-admin-only]')) {
      a.style.display = 'none';
    }
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
