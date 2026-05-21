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

// Employee 選單快取（給 customer / visit-log 等 select 共用，避免每開 modal 都打 API）
let _employeeOptionsCache = null;
let _employeeOptionsAt = 0;
async function loadEmployeeOptions() {
  const now = Date.now();
  if (_employeeOptionsCache && (now - _employeeOptionsAt) < 60000) return _employeeOptionsCache;
  try {
    const list = await api.get('/employees');
    _employeeOptionsCache = (list || []).filter((e) => e.isActive !== false);
    _employeeOptionsAt = now;
    return _employeeOptionsCache;
  } catch (e) {
    return [];
  }
}

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
    const attrs = { type: f.type || 'text' };
    if (f.list) attrs.list = f.list;
    input = el('input', attrs);
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
      el('th', {}, '職稱'),
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
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '10', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const c of list) {
      tbody.append(el('tr', {},
        el('td', {}, c.name),
        el('td', {}, c.contactName || ''),
        el('td', {}, c.title || ''),
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

  async function editCustomer(c, done, prefill) {
    const employees = await loadEmployeeOptions();
    const employeeOptions = [{ value: '', label: '— 未指定 —' }].concat(
      employees.map((e) => ({ value: e.id, label: `${e.employeeId} ${e.name}` })),
    );
    const initial = c
      ? { ...c }
      : {
        paymentDays: 30,
        grade: 'B',
        name: prefill?.companyName || '',
        contactName: prefill?.contactName || '',
        title: prefill?.title || '',
        phone: prefill?.phone || '',
        taxId: prefill?.taxId || '',
        email: prefill?.email || '',
        address: prefill?.address || '',
      };
    openModal({
      title: c ? '編輯客戶' : '新增客戶',
      initial,
      fields: [
        { name: 'name', label: '公司名稱', required: true },
        { type: 'row', fields: [
          { name: 'contactName', label: '聯絡人' },
          { name: 'title', label: '職稱' },
        ]},
        { type: 'row', fields: [
          { name: 'phone', label: '電話' },
          { name: 'taxId', label: '統一編號' },
        ]},
        { type: 'row', fields: [
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'zipCode', label: '郵遞區號' },
        ]},
        { type: 'row', fields: [
          { name: 'paymentDays', label: '付款天數', type: 'number' },
          { name: 'statementDay', label: '結帳日（1-31）', type: 'number' },
        ]},
        { type: 'row', fields: [
          { name: 'fixedPaymentDay', label: '固定付款日（1-31）', type: 'number' },
          { name: 'grade', label: '等級', type: 'select', options: [{value:'A',label:'A'},{value:'B',label:'B'},{value:'C',label:'C'}], default: 'B' },
        ]},
        { type: 'row', fields: [
          { name: 'paymentMethod', label: '付款方式', type: 'select', options: [
            { value: '', label: '未指定' },
            { value: 'check', label: '開票' },
            { value: 'cash', label: '現金' },
            { value: 'transfer', label: '轉帳' },
          ] },
          { name: 'createdByEmployeeId', label: '建立業務', type: 'select', options: employeeOptions },
        ]},
        { name: 'address', label: '地址' },
        { type: 'row', fields: [
          { name: 'bankCode', label: '匯款銀行代號' },
          { name: 'bankName', label: '匯款銀行名稱' },
        ]},
        { name: 'bankAccountLast5', label: '匯款帳號末五碼' },
      ],
      onSubmit: async (v) => {
        const body = cleanObj(v, ['name','contactName','title','phone','taxId','email','zipCode','address','paymentDays','statementDay','fixedPaymentDay','paymentMethod','createdByEmployeeId','grade','bankCode','bankName','bankAccountLast5']);
        if (!body.name) throw new Error('公司名稱必填');
        // 空字串 select → null
        if (body.paymentMethod === '') body.paymentMethod = null;
        if (body.createdByEmployeeId === '') body.createdByEmployeeId = null;
        // 數字欄位
        for (const k of ['paymentDays','statementDay','fixedPaymentDay']) {
          if (body[k] === '' || body[k] == null) { if (k !== 'paymentDays') body[k] = null; else delete body[k]; }
          else body[k] = Number(body[k]);
        }
        if (body.statementDay != null && (body.statementDay < 1 || body.statementDay > 31)) throw new Error('結帳日須介於 1-31');
        if (body.fixedPaymentDay != null && (body.fixedPaymentDay < 1 || body.fixedPaymentDay > 31)) throw new Error('固定付款日須介於 1-31');
        if (c) await api.put('/customers/' + c.id, body);
        else await api.post('/customers', body);
        toast(c ? '已更新' : '已新增', 'ok');
        done();
      },
    });
  }

  // 名片辨識上傳：避開 LINE 拍照壓縮
  const ocrFile = el('input', {
    type: 'file', accept: 'image/jpeg,image/png,image/heic,image/webp',
    style: 'display:none;',
  });
  ocrFile.addEventListener('change', async () => {
    const f = ocrFile.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('檔案超過 5MB', 'err'); ocrFile.value = ''; return; }
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch('/api/customers/ocr', {
        method: 'POST', credentials: 'same-origin', body: fd,
      });
      if (res.status === 401) { location.href = './login.html'; return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'OCR 失敗');
      const fields = [];
      if (data.companyName) fields.push(`公司：${data.companyName}`);
      if (data.contactName) fields.push(`聯絡人：${data.contactName}`);
      if (data.title) fields.push(`職稱：${data.title}`);
      if (data.phone) fields.push(`電話：${data.phone}`);
      if (data.taxId) fields.push(`統編：${data.taxId}`);
      toast(`📇 已辨識：${fields.join('；') || '欄位皆空，請手動輸入'}`, fields.length ? 'ok' : 'warn');
      editCustomer(null, reload, data);
    } catch (err) { toast(err.message, 'err'); }
    finally { ocrFile.value = ''; }
  });

  const toolbar = el('div', { class: 'toolbar' },
    search,
    el('button', { class: 'btn', onClick: reload }, '搜尋'),
    el('label', { style: 'font-size:12px;color:var(--muted);' }, includeInactive, ' 含停用'),
    el('div', { style: 'flex:1;' }),
    el('button', { class: 'btn', onClick: () => ocrFile.click() }, '📇 名片辨識上傳'),
    el('button', { class: 'btn primary', onClick: () => editCustomer(null, reload) }, '+ 新增客戶'),
    ocrFile,
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
  main.append(el('div', { class: 'page-sub' },
    isSales() ? '產品主檔（業務帳號為唯讀）。' : '管理產品主檔：售價、進價。'));
  const canEdit = !isSales();

  const search = el('input', { type: 'text', placeholder: '搜尋編號/名稱…' });
  const includeInactive = el('input', { type: 'checkbox' });
  const showCost = !isSales();
  const tbody = el('tbody');
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '編號'),
      el('th', {}, '名稱'),
      el('th', {}, '類別'),
      el('th', { class: 'num' }, '售價'),
      showCost ? el('th', { class: 'num' }, '進價') : null,
      el('th', {}, '狀態'),
      el('th', {}, '操作'),
    )),
    tbody,
  );
  const colspan = showCost ? 7 : 6;

  async function reload() {
    const q = search.value.trim();
    const url = q ? `/products?q=${encodeURIComponent(q)}` : `/products${includeInactive.checked ? '?includeInactive=true' : ''}`;
    const list = await api.get(url);
    tbody.innerHTML = '';
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: String(colspan), style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const p of list) {
      tbody.append(el('tr', {},
        el('td', {}, p.code),
        el('td', {}, p.name),
        el('td', {}, p.category || ''),
        el('td', { class: 'num' }, fmtMoney(p.salePrice)),
        showCost ? el('td', { class: 'num' }, fmtMoney(p.costPrice)) : null,
        el('td', {}, el('span', { class: 'badge ' + (p.isActive === false ? 'mute' : 'ok') }, p.isActive === false ? '停用' : '啟用')),
        el('td', { class: 'actions' },
          canEdit ? el('button', { class: 'btn small', onClick: () => edit(p) }, '編輯') : null,
          canEdit ? ' ' : null,
          el('button', { class: 'btn small', onClick: () => openProductDocs(p) }, '文件'),
          canEdit && p.isActive !== false ? ' ' : null,
          canEdit && p.isActive !== false ? el('button', { class: 'btn small danger', onClick: async () => {
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
    canEdit ? el('button', { class: 'btn primary', onClick: () => edit(null) }, '+ 新增產品') : null,
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
          el('button', { class: 'btn small', onClick: () => openSupplierDocs(s) }, '文件'),
          ' ',
          s.isActive !== false ? el('button', { class: 'btn small danger', onClick: async () => {
            if (!confirmBox(`停用供應商「${s.name}」？`)) return;
            try { await api.del('/suppliers/' + s.id); toast('已停用', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
          } }, '停用') : null,
        ),
      ));
    }
  }

  function edit(s, prefill) {
    const initial = s
      ? { ...s }
      : {
        paymentDays: 60,
        name: prefill?.companyName || '',
        contactName: prefill?.contactName || '',
        phone: prefill?.phone || '',
        taxId: prefill?.taxId || '',
        email: prefill?.email || '',
        address: prefill?.address || '',
      };
    openModal({
      title: s ? '編輯供應商' : '新增供應商',
      initial,
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
        { type: 'row', fields: [
          { name: 'bankCode', label: '銀行代號' },
          { name: 'bankName', label: '銀行名稱' },
        ]},
        { type: 'row', fields: [
          { name: 'bankBranch', label: '分行' },
          { name: 'bankAccountName', label: '戶名' },
        ]},
        { name: 'bankAccount', label: '匯款帳號' },
      ],
      onSubmit: async (v) => {
        if (!v.name) throw new Error('名稱必填');
        const body = cleanObj(v, ['name','type','contactName','phone','taxId','email','zipCode','address','paymentDays','bankCode','bankName','bankBranch','bankAccount','bankAccountName']);
        if (s) await api.put('/suppliers/' + s.id, body);
        else await api.post('/suppliers', body);
        toast(s ? '已更新' : '已新增', 'ok');
        reload();
      },
    });
  }

  // 名片辨識上傳
  const ocrFile = el('input', {
    type: 'file', accept: 'image/jpeg,image/png,image/heic,image/webp',
    style: 'display:none;',
  });
  ocrFile.addEventListener('change', async () => {
    const f = ocrFile.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('檔案超過 5MB', 'err'); ocrFile.value = ''; return; }
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch('/api/suppliers/ocr', {
        method: 'POST', credentials: 'same-origin', body: fd,
      });
      if (res.status === 401) { location.href = './login.html'; return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'OCR 失敗');
      const fields = [];
      if (data.companyName) fields.push(`公司：${data.companyName}`);
      if (data.contactName) fields.push(`聯絡人：${data.contactName}`);
      if (data.phone) fields.push(`電話：${data.phone}`);
      if (data.taxId) fields.push(`統編：${data.taxId}`);
      toast(`📇 已辨識：${fields.join('；') || '欄位皆空，請手動輸入'}`, fields.length ? 'ok' : 'warn');
      edit(null, data);
    } catch (err) { toast(err.message, 'err'); }
    finally { ocrFile.value = ''; }
  });

  includeInactive.addEventListener('change', reload);
  main.append(el('div', { class: 'toolbar' },
    el('label', { style: 'font-size:12px;color:var(--muted);' }, includeInactive, ' 含停用'),
    el('div', { style: 'flex:1;' }),
    el('button', { class: 'btn', onClick: () => ocrFile.click() }, '📇 名片辨識上傳'),
    el('button', { class: 'btn primary', onClick: () => edit(null) }, '+ 新增供應商'),
    ocrFile,
  ), table);
  reload();
}

// -------- Supplier documents modal（銀行存摺 / 合約 / 其他）--------

const SUPPLIER_DOC_TYPE_LABEL = { BANKBOOK: '銀行存摺', CONTRACT: '合約', OTHER: '其他' };

function openSupplierDocs(supplier) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const listBox = el('div', {});
  const errBox = el('div', { class: 'err' });

  const typeSelect = el('select', {});
  for (const t of ['BANKBOOK', 'CONTRACT', 'OTHER']) {
    typeSelect.append(el('option', { value: t }, SUPPLIER_DOC_TYPE_LABEL[t]));
  }
  const fileInput = el('input', { type: 'file', accept: 'application/pdf,image/*' });
  const uploadBtn = el('button', { class: 'btn primary' }, '上傳');

  const modal = el('div', { class: 'modal' },
    el('h3', {}, `文件管理：${supplier.name}`),
    el('div', { class: 'body' },
      el('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:10px;' },
        '銀行存摺等文件，供匯款核對用。支援 PDF 或圖片（≤ 10MB）。'),
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
      const docs = await api.get(`/suppliers/${supplier.id}/documents`);
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
          el('td', {}, el('span', { class: 'badge ok' }, SUPPLIER_DOC_TYPE_LABEL[d.type] || d.type)),
          el('td', { style: 'font-size:12px;word-break:break-all;' }, d.fileName),
          el('td', { class: 'num' }, sizeLabel),
          el('td', { style: 'font-size:12px;' }, fmtDate(d.createdAt)),
          el('td', { class: 'actions' },
            el('button', { class: 'btn small danger', onClick: async () => {
              if (!confirmBox(`刪除「${d.fileName}」？`)) return;
              try {
                await api.del(`/suppliers/${supplier.id}/documents/${d.id}`);
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
      const res = await fetch(`/api/suppliers/${supplier.id}/documents`, {
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

// Employees + binding-code action
/**
 * Employee editor modal with password section.
 *
 * We render a custom modal (not openModal) because the password block
 * has conditional UI: shows the last-set timestamp when one exists,
 * exposes a "移除密碼" action, and requires two-field confirmation.
 * For non-ADMIN callers the password section is hidden entirely.
 */
function openEmployeeEditor(emp, onSaved) {
  const isEdit = !!emp;
  const isAdmin = window.__session?.employee?.role === 'ADMIN';
  const state = isEdit
    ? { ...emp }
    : { role: 'VIEWER' };
  // pwMode: 'keep' (edit, no change) | 'set' (new or reset) | 'remove' (edit, clear)
  let pwMode = isEdit ? 'keep' : 'set';
  let pwValue = '';
  let pwConfirm = '';

  const errBox = el('div', { class: 'err' });

  function field(label, input, required) {
    return el('div', { class: 'field' },
      el('label', {}, label + (required ? ' *' : '')),
      input,
    );
  }
  function textInput(key, type = 'text', opts = {}) {
    const input = el('input', Object.assign({ type }, opts));
    input.value = state[key] ?? '';
    input.addEventListener('input', () => { state[key] = input.value; });
    return input;
  }
  function selectRole() {
    const sel = el('select', {});
    const roles = [
      ['ADMIN', 'ADMIN（管理員）'],
      ['SALES', 'SALES（業務）'],
      ['PURCHASING', 'PURCHASING（採購）'],
      ['ACCOUNTING', 'ACCOUNTING（會計）'],
      ['VIEWER', 'VIEWER（檢視）'],
    ];
    for (const [v, l] of roles) {
      const o = el('option', { value: v }, l);
      if (String(state.role || 'VIEWER') === v) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => { state.role = sel.value; });
    return sel;
  }

  // --- Password section ---
  const pwSection = el('div', { style: 'margin-top:8px;padding:12px;border:1px solid var(--border);border-radius:6px;background:#fafafa;' });
  function renderPwSection() {
    pwSection.innerHTML = '';
    const header = el('div', { style: 'font-size:13px;font-weight:600;margin-bottom:6px;' }, '後台登入密碼');
    pwSection.append(header);

    if (!isAdmin) {
      pwSection.append(el('div', { style: 'color:var(--muted);font-size:12px;' }, '（僅 ADMIN 可管理密碼）'));
      return;
    }

    if (isEdit) {
      const status = emp.hasPassword
        ? `🔒 已設定（最後設定：${emp.passwordSetAt ? fmtDate(emp.passwordSetAt) : '—'}）`
        : '❌ 未設定（該員工目前無後台登入權）';
      pwSection.append(el('div', { style: 'font-size:12px;color:#555;margin-bottom:8px;' }, status));

      const btnRow = el('div', { style: 'display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;' });
      btnRow.append(el('button', {
        type: 'button',
        class: 'btn small' + (pwMode === 'keep' ? ' primary' : ''),
        onClick: () => { pwMode = 'keep'; pwValue = ''; pwConfirm = ''; renderPwSection(); },
      }, '不變更'));
      btnRow.append(el('button', {
        type: 'button',
        class: 'btn small' + (pwMode === 'set' ? ' primary' : ''),
        onClick: () => { pwMode = 'set'; renderPwSection(); },
      }, emp.hasPassword ? '重設密碼' : '設定密碼'));
      if (emp.hasPassword) {
        btnRow.append(el('button', {
          type: 'button',
          class: 'btn small' + (pwMode === 'remove' ? ' danger' : ''),
          onClick: () => { pwMode = 'remove'; pwValue = ''; pwConfirm = ''; renderPwSection(); },
        }, '移除密碼'));
      }
      pwSection.append(btnRow);

      if (pwMode === 'remove') {
        pwSection.append(el('div', { style: 'color:#b00;font-size:12px;' }, '⚠ 儲存後此員工將無法登入後台（LINE 綁定不受影響）'));
      }
    }

    if (pwMode === 'set' || (!isEdit && isAdmin)) {
      const newInput = el('input', { type: 'password', placeholder: '至少 8 碼', autocomplete: 'new-password' });
      newInput.value = pwValue;
      newInput.addEventListener('input', () => { pwValue = newInput.value; });
      const confirmInput = el('input', { type: 'password', placeholder: '再次輸入確認', autocomplete: 'new-password' });
      confirmInput.value = pwConfirm;
      confirmInput.addEventListener('input', () => { pwConfirm = confirmInput.value; });
      pwSection.append(
        field('新密碼', newInput, !isEdit ? false : true),
        field('確認密碼', confirmInput, !isEdit ? false : true),
      );
      if (!isEdit) {
        pwSection.append(el('div', { style: 'color:var(--muted);font-size:12px;' }, '可留空 — 之後再於此頁設定。'));
      }
    }
  }
  renderPwSection();

  const body = el('div', { class: 'body' },
    el('div', { class: 'field row' },
      field('員工編號', textInput('employeeId', 'text', isEdit ? { disabled: 'disabled' } : {}), !isEdit),
      field('姓名', textInput('name'), true),
    ),
    field('角色', selectRole()),
    el('div', { class: 'field row' },
      field('電話', textInput('phone')),
      field('Email', textInput('email', 'email')),
    ),
    field('地址', textInput('address')),
    pwSection,
  );

  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal' },
    el('h3', {}, isEdit ? '編輯員工' : '新增員工'),
    body,
    errBox,
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onClick: () => backdrop.remove() }, '取消'),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          errBox.textContent = '';
          if (!state.name) throw new Error('姓名必填');
          if (!isEdit && !state.employeeId) throw new Error('員工編號必填');

          const body = {
            name: state.name,
            role: state.role || 'VIEWER',
            phone: state.phone || undefined,
            email: state.email || undefined,
            address: state.address || undefined,
          };
          if (!isEdit) body.employeeId = state.employeeId;

          // Password handling
          if (isAdmin) {
            if (pwMode === 'set') {
              if (pwValue || pwConfirm || !isEdit) {
                if (!pwValue && !isEdit) {
                  // Create with no password — omit the field entirely.
                } else {
                  if (pwValue.length < 8) throw new Error('密碼至少 8 碼');
                  if (pwValue !== pwConfirm) throw new Error('兩次密碼輸入不一致');
                  body.password = pwValue;
                }
              }
            } else if (pwMode === 'remove') {
              body.password = null;
            }
          }

          if (isEdit) await api.put('/employees/' + emp.id, body);
          else await api.post('/employees', body);
          toast(isEdit ? '已更新' : '已新增', 'ok');
          backdrop.remove();
          await onSaved?.();
        } catch (e) {
          errBox.textContent = e.message;
        }
      } }, '儲存'),
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

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
      el('th', {}, '後台登入'),
      el('th', {}, '狀態'),
      el('th', {}, '操作'),
    )),
    tbody,
  );

  async function reload() {
    const list = await api.get('/employees' + (includeInactive.checked ? '?includeInactive=true' : ''));
    tbody.innerHTML = '';
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: '9', style: 'text-align:center;color:var(--muted);padding:24px;' }, '無資料')));
    for (const e of list) {
      const pwdBadge = e.hasPassword
        ? el('span', { class: 'badge ok', title: e.passwordSetAt ? `最後設定：${fmtDate(e.passwordSetAt)}` : '已設定' }, '已設定')
        : el('span', { class: 'badge mute' }, '未設定');
      tbody.append(el('tr', {},
        el('td', {}, e.employeeId),
        el('td', {}, e.name),
        el('td', {}, el('span', { class: 'badge mute' }, e.role)),
        el('td', {}, e.phone || ''),
        el('td', {}, e.email || ''),
        el('td', {}, e.lineUserId
          ? el('span', { class: 'badge ok' }, '已綁定')
          : el('span', { class: 'badge warn' }, '未綁定')),
        el('td', {}, pwdBadge),
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
    openEmployeeEditor(emp, reload);
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
 * Inline delete (list row). kind ∈ 'quotation' | 'sales' | 'purchase'.
 * Confirms, calls soft-delete endpoint, then reloads the list.
 * Server enforces the rule that paid AR/AP blocks deletion; we surface
 * the resulting error message in the toast.
 */
async function deleteOrderInline(kind, order, reload) {
  const urlBase = kind === 'quotation' ? '/quotations'
                : kind === 'sales' ? '/sales-orders'
                : '/purchase-orders';
  const label = kind === 'quotation' ? '報價單' : kind === 'sales' ? '銷貨單' : '進貨單';
  const no = order.quotationNo || order.orderNo;
  const extra = kind === 'sales' ? '連動的應收帳款與庫存會自動沖銷。'
              : kind === 'purchase' ? '連動的應付帳款與庫存會自動沖銷。'
              : '';
  if (!confirmBox(`確定刪除${label} ${no}？${extra}此動作為軟刪除，可由後端查詢。`)) return;
  try {
    await api.del(`${urlBase}/${order.id}`);
    toast('已刪除', 'ok');
    await reload();
  } catch (e) {
    toast(e.message || '刪除失敗', 'err');
  }
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

/**
 * Read-only order viewer — any authenticated user can open.
 * Shows header, items table, totals, delivery note + PDF download link.
 */
async function openOrderViewer(kind, orderId) {
  const urlBase = kind === 'quotation' ? '/quotations'
                : kind === 'sales' ? '/sales-orders'
                : '/purchase-orders';
  let order;
  try { order = await api.get(`${urlBase}/${orderId}`); }
  catch (e) { toast(e.message, 'err'); return; }

  const isQuote = kind === 'quotation';
  const isPurchase = kind === 'purchase';
  const partyName = isPurchase ? (order.supplier?.name || '') : (order.customer?.name || '');
  const staffName = isPurchase ? order.internalStaff : order.salesPerson;
  const staffLabel = isPurchase ? '內勤' : '業務';
  const no = order.quotationNo || order.orderNo;

  function row(label, value) {
    return el('div', { style: 'display:flex;gap:10px;padding:4px 0;font-size:13px;' },
      el('div', { style: 'min-width:88px;color:#888;' }, label),
      el('div', { style: 'flex:1;color:#333;word-break:break-all;' }, value || '—'),
    );
  }

  const header = el('div', {},
    row('單號', no),
    row(isPurchase ? '供應商' : '客戶', partyName),
    row(staffLabel, staffName),
    row('狀態', order.status || '—'),
    row('開單日', fmtDate(order.orderDate || order.createdAt)),
    isQuote ? row('報價期限', order.validUntil || '—') : null,
    row('送貨備註', order.deliveryNote || order.note || '—'),
    order.isDeleted ? row('⚠ 狀態', '此單已刪除') : null,
  );

  const itemsBody = el('tbody');
  (order.items || []).forEach((it, idx) => {
    itemsBody.append(el('tr', {},
      el('td', {}, String(idx + 1)),
      el('td', {}, it.productName),
      el('td', { class: 'num' }, it.quantity),
      el('td', { class: 'num' }, fmtMoney(it.unitPrice)),
      el('td', { class: 'num' }, fmtMoney(it.amount)),
      el('td', { style: 'font-size:11px;color:#666;' }, it.note || ''),
    ));
  });
  const itemsTable = el('table', { class: 'data', style: 'font-size:12px;margin-top:12px;' },
    el('thead', {}, el('tr', {},
      el('th', {}, '#'),
      el('th', {}, '品名'),
      el('th', { class: 'num' }, '數量'),
      el('th', { class: 'num' }, '單價'),
      el('th', { class: 'num' }, '小計'),
      el('th', {}, '備註'),
    )),
    itemsBody,
  );

  const totalsDiv = el('div', { style: 'text-align:right;margin-top:10px;font-size:13px;color:#555;' },
    `小計 ${fmtMoney(order.subtotal)}　　營業稅 ${fmtMoney(order.taxAmount)}　　總計 ${fmtMoney(order.totalAmount)}`,
  );

  const pdfKind = kind === 'quotation' ? 'quotation' : kind === 'sales' ? 'sales-order' : 'purchase-order';
  const pdfBtn = el('a', {
    class: 'btn primary',
    href: `/api/${pdfKind === 'quotation' ? 'quotations' : pdfKind === 'sales-order' ? 'sales-orders' : 'purchase-orders'}/${orderId}/pdf`,
    target: '_blank',
    style: 'text-decoration:none;',
  }, '📄 下載 PDF');
  // Above URL is not used — our PDF endpoint is /pdf/:kind/:id?token=... which
  // needs a signed token. Easier: ask server to produce short URL on demand.
  // For now we'll wire via /api/statements proxy? Actually simplest: don't
  // bother generating a fresh token in the viewer — we already show all data.
  pdfBtn.style.display = 'none'; // hide until we add a backend shortlink fetch

  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal', style: 'max-width:820px;width:92%;' },
    el('h3', {}, `檢視 ${isQuote ? '報價單' : isPurchase ? '進貨單' : '銷貨單'}  ${no}`),
    el('div', { class: 'body' }, header, itemsTable, totalsDiv),
    el('div', { class: 'actions', style: 'justify-content:flex-end;' },
      pdfBtn,
      el('button', { class: 'btn', onClick: () => backdrop.remove() }, '關閉'),
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
            el('button', { class: 'btn small', onClick: () => openOrderViewer('quotation', q.id) }, '檢視'),
            canEdit ? ' ' : null,
            canEdit
              ? el('button', { class: 'btn small', onClick: () => openOrderEditor('quotation', q.id, reload) }, '編輯')
              : null,
            canEdit ? ' ' : null,
            canEdit
              ? el('button', { class: 'btn small danger', onClick: () => deleteOrderInline('quotation', q, reload) }, '刪除')
              : null,
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
            el('button', { class: 'btn small', onClick: () => openOrderViewer('sales', o.id) }, '檢視'),
            canEdit ? ' ' : null,
            canEdit
              ? el('button', { class: 'btn small', onClick: () => openOrderEditor('sales', o.id, reload) }, '編輯')
              : null,
            canEdit && !isSales() ? ' ' : null,
            canEdit && !isSales()
              ? el('button', { class: 'btn small danger', onClick: () => deleteOrderInline('sales', o, reload) }, '刪除')
              : null,
          ),
        ));
      }
    } catch (e) { main.append(el('div', { class: 'err' }, e.message)); }
  }
  await reload();
}

// ============================================================
// 工作日誌（VisitLog）
// ============================================================
async function viewVisitLogs(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '工作日誌'));
  main.append(el('div', { class: 'page-sub' }, isSales()
    ? '業務帳號只看自己建立的拜訪紀錄；SALES 列表自動過濾。'
    : '管理所有業務員的拜訪紀錄。'));

  // Filters
  const today = new Date(); today.setHours(0,0,0,0);
  const thirty = new Date(today); thirty.setDate(thirty.getDate() - 30);
  const isoOf = (d) => d.toISOString().slice(0,10);
  const fromInput = el('input', { type: 'date', value: isoOf(thirty) });
  const toInput = el('input', { type: 'date', value: isoOf(today) });
  const empSelect = el('select', {});
  empSelect.append(el('option', { value: '' }, '全部業務'));
  if (!isSales()) {
    const employees = await loadEmployeeOptions();
    for (const e of employees) empSelect.append(el('option', { value: e.id }, `${e.employeeId} ${e.name}`));
  } else {
    empSelect.disabled = true;
  }

  const tbody = el('tbody');
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '拜訪日'),
      el('th', {}, '客戶'),
      el('th', {}, '內容'),
      el('th', {}, '業務'),
      el('th', {}, '下次行動'),
      el('th', {}, '操作'),
    )),
    tbody,
  );

  async function reload() {
    tbody.innerHTML = '';
    try {
      const params = new URLSearchParams();
      if (fromInput.value) params.set('from', fromInput.value);
      if (toInput.value) params.set('to', toInput.value);
      if (empSelect.value) params.set('employeeId', empSelect.value);
      params.set('limit', '300');
      const rows = await api.get('/visit-logs?' + params.toString());
      if (!rows || !rows.length) {
        tbody.append(el('tr', {}, el('td', { colspan: 6, class: 'empty' }, '沒有日誌資料')));
        return;
      }
      for (const r of rows) {
        const previewContent = (r.content || '').length > 60 ? (r.content.slice(0, 60) + '…') : (r.content || '');
        tbody.append(el('tr', {},
          el('td', {}, fmtDate(r.visitDate)),
          el('td', {}, r.customer?.name ?? '—'),
          el('td', { title: r.content || '' }, previewContent),
          el('td', {}, r.createdByEmployee ? `${r.createdByEmployee.name}` : '—'),
          el('td', {}, r.nextActionDate ? fmtDate(r.nextActionDate) : '—'),
          el('td', {},
            el('button', { class: 'btn small', onClick: () => openVisitLogEditor(r, reload) }, '編輯'),
            ' ',
            el('button', { class: 'btn small danger', onClick: async () => {
              if (!confirmBox('刪除此日誌？')) return;
              try { await api.del('/visit-logs/' + r.id); toast('已刪除', 'ok'); reload(); }
              catch (e) { toast(e.message, 'err'); }
            } }, '刪除'),
          ),
        ));
      }
    } catch (e) { tbody.append(el('tr', {}, el('td', { colspan: 6, class: 'err' }, e.message))); }
  }

  const toolbar = el('div', { class: 'toolbar' },
    el('label', { style: 'font-size:12px;color:var(--muted);' }, '從 ', fromInput),
    el('label', { style: 'font-size:12px;color:var(--muted);' }, ' 至 ', toInput),
    el('label', { style: 'font-size:12px;color:var(--muted);' }, ' 業務 ', empSelect),
    el('button', { class: 'btn', onClick: reload }, '搜尋'),
    el('div', { style: 'flex:1;' }),
    el('button', { class: 'btn primary', onClick: () => openVisitLogEditor(null, reload) }, '+ 新增日誌'),
  );
  fromInput.addEventListener('change', reload);
  toInput.addEventListener('change', reload);
  empSelect.addEventListener('change', reload);

  main.append(toolbar, table);
  await reload();
}

// -------- 業績獎金報表（v2.15.0）--------
async function viewBonusReport(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '業績獎金'));
  main.append(el('div', { class: 'page-sub' }, isSales()
    ? '只看自己當月業績獎金。獎金 =（成交價 − 產品售價）× 數量。'
    : '業務業績獎金月結。獎金 =（成交價 − 產品售價）× 數量，累計後扣代開發票 % 為實發。'));

  const now = new Date();
  const yearSel = el('select', {});
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) {
    yearSel.append(el('option', { value: String(y) }, String(y)));
  }
  const monthSel = el('select', {});
  for (let m = 1; m <= 12; m++) monthSel.append(el('option', { value: String(m) }, m + ' 月'));
  monthSel.value = String(now.getMonth() + 1);

  const empSelect = el('select', {});
  if (!isSales()) {
    empSelect.append(el('option', { value: '' }, '全部業務'));
    const employees = await loadEmployeeOptions();
    for (const e of employees.filter((x) => x.role === 'SALES')) {
      empSelect.append(el('option', { value: e.id }, `${e.employeeId} ${e.name}`));
    }
  } else {
    empSelect.append(el('option', { value: '' }, '本人'));
    empSelect.disabled = true;
  }

  const deductSel = el('select', {});
  for (const p of [0, 8, 10, 13]) {
    deductSel.append(el('option', { value: String(p) }, p === 0 ? '不扣除' : p + '%'));
  }
  deductSel.value = '8';

  const resultBox = el('div', {});

  function renderReport(rep) {
    resultBox.innerHTML = '';
    if (!rep.rows.length) {
      resultBox.append(el('div', { class: 'empty', style: 'padding:24px;' }, '本月無銷貨單'));
      return;
    }
    for (const o of rep.rows) {
      const tb = el('tbody');
      for (const it of o.items) {
        tb.append(el('tr', {},
          el('td', {}, it.productName + (it.isFallback ? ' *' : '')),
          el('td', { class: 'num' }, String(it.quantity)),
          el('td', { class: 'num' }, fmtMoney(it.unitPrice)),
          el('td', { class: 'num' }, fmtMoney(it.salePrice)),
          el('td', { class: 'num' }, fmtMoney(it.bonus)),
        ));
      }
      const itemTbl = el('table', { class: 'data', style: 'margin:4px 0;' },
        el('thead', {}, el('tr', {},
          el('th', {}, '品名'),
          el('th', { class: 'num' }, '數量'),
          el('th', { class: 'num' }, '成交價'),
          el('th', { class: 'num' }, '售價'),
          el('th', { class: 'num' }, '獎金'),
        )),
        tb,
      );
      resultBox.append(el('div', { class: 'card', style: 'padding:12px;margin-bottom:10px;' },
        el('div', { style: 'display:flex;justify-content:space-between;font-weight:600;flex-wrap:wrap;gap:4px;' },
          el('span', {}, `${o.orderNo} · ${o.customerName}`),
          el('span', { style: 'color:var(--muted);font-weight:400;font-size:12px;' }, `${o.orderDate} · 業務 ${o.salesPersonName}`),
        ),
        itemTbl,
        el('div', { style: 'text-align:right;font-weight:600;' }, `單筆獎金：${fmtMoney(o.orderBonus)}`),
      ));
    }
    const deducted = rep.totalBonus - rep.netAmount;
    resultBox.append(el('div', { class: 'card', style: 'padding:16px;margin-top:8px;background:#f0f7ff;border:1px solid #b6d4fe;' },
      el('div', { style: 'display:flex;justify-content:space-between;margin-bottom:6px;' },
        el('span', {}, '累計獎金'), el('strong', {}, fmtMoney(rep.totalBonus))),
      el('div', { style: 'display:flex;justify-content:space-between;margin-bottom:6px;' },
        el('span', {}, `扣除代開發票 ${rep.deductPct}%`), el('span', {}, '− ' + fmtMoney(deducted))),
      el('div', { style: 'display:flex;justify-content:space-between;font-size:18px;font-weight:700;color:#0a4d99;' },
        el('span', {}, '實發金額'), el('span', {}, fmtMoney(rep.netAmount))),
    ));
    resultBox.append(el('div', { style: 'font-size:12px;color:var(--muted);margin-top:6px;' },
      '標「*」的品項無成交當下售價快照，以目前產品售價估算（產品調價後數字可能變動）。'));
  }

  async function reload() {
    resultBox.innerHTML = '載入中…';
    try {
      const params = new URLSearchParams();
      params.set('year', yearSel.value);
      params.set('month', monthSel.value);
      if (empSelect.value) params.set('employeeId', empSelect.value);
      params.set('deductPct', deductSel.value);
      const rep = await api.get('/commission/monthly?' + params.toString());
      renderReport(rep);
    } catch (e) {
      resultBox.innerHTML = '';
      resultBox.append(el('div', { class: 'err' }, e.message));
    }
  }

  const toolbar = el('div', { class: 'toolbar' },
    yearSel, monthSel,
    el('label', { style: 'font-size:12px;color:var(--muted);' }, ' 業務 ', empSelect),
    el('label', { style: 'font-size:12px;color:var(--muted);' }, ' 代開發票 ', deductSel),
    el('button', { class: 'btn', onClick: reload }, '查詢'),
  );
  [yearSel, monthSel, empSelect, deductSel].forEach((s) => s.addEventListener('change', reload));
  main.append(toolbar, resultBox);
  await reload();
}

async function openVisitLogEditor(log, onSaved) {
  // 客戶 picker：用 customer list 做 datalist（已存在的客戶限定）
  let customers = [];
  try { customers = await api.get('/customers'); } catch (e) {}
  const customerMap = new Map(customers.map((c) => [c.name, c.id]));

  const initial = log
    ? {
      visitDate: log.visitDate ? new Date(log.visitDate).toISOString().slice(0, 10) : '',
      customerName: log.customer?.name || '',
      content: log.content || '',
      nextActionDate: log.nextActionDate ? new Date(log.nextActionDate).toISOString().slice(0, 10) : '',
    }
    : {
      visitDate: new Date().toISOString().slice(0, 10),
      customerName: '',
      content: '',
      nextActionDate: '',
    };

  openModal({
    title: log ? '編輯工作日誌' : '新增工作日誌',
    initial,
    fields: [
      { type: 'row', fields: [
        { name: 'visitDate', label: '拜訪日期', type: 'date', required: true },
        { name: 'nextActionDate', label: '下次行動（選填）', type: 'date' },
      ]},
      { name: 'customerName', label: '客戶', required: true, list: 'customer-options' },
      { name: 'content', label: '拜訪內容', type: 'textarea', required: true },
    ],
    onSubmit: async (v) => {
      if (!v.visitDate) throw new Error('拜訪日期必填');
      if (!v.customerName) throw new Error('客戶必填');
      if (!v.content || !v.content.trim()) throw new Error('拜訪內容必填');
      const customerId = customerMap.get(v.customerName);
      if (!customerId) throw new Error('找不到客戶「' + v.customerName + '」，請從建議清單選擇');
      const body = {
        visitDate: v.visitDate,
        customerId,
        content: v.content,
        nextActionDate: v.nextActionDate || null,
      };
      if (log) await api.put('/visit-logs/' + log.id, body);
      else await api.post('/visit-logs', body);
      toast(log ? '已更新' : '已新增', 'ok');
      if (onSaved) onSaved();
    },
  });

  // 補一個 datalist 到 body 提供 autocomplete
  let dl = document.getElementById('customer-options');
  if (dl) dl.remove();
  dl = document.createElement('datalist');
  dl.id = 'customer-options';
  for (const c of customers) {
    const opt = document.createElement('option');
    opt.value = c.name;
    dl.appendChild(opt);
  }
  document.body.appendChild(dl);
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
            el('button', { class: 'btn small', onClick: () => openOrderViewer('purchase', o.id) }, '檢視'),
            canEdit ? ' ' : null,
            canEdit
              ? el('button', { class: 'btn small', onClick: () => openOrderEditor('purchase', o.id, reload) }, '編輯')
              : null,
            canEdit ? ' ' : null,
            canEdit
              ? el('button', { class: 'btn small danger', onClick: () => deleteOrderInline('purchase', o, reload) }, '刪除')
              : null,
          ),
        ));
      }
    } catch (e) { main.append(el('div', { class: 'err' }, e.message)); }
  }
  await reload();
}

async function viewReceivables(main) {
  await viewAccount(main, 'receivables', '應收帳款', '客戶');
  // SALES 只能查自己銷貨單的 AR，且月結帳單 API 限 ADMIN/ACCOUNTING，故藏起按鈕。
  if (isSales()) return;
  const bar = el('div', { class: 'toolbar', style: 'justify-content:flex-end;margin-top:12px;' },
    el('button', { class: 'btn', onClick: openBatchMonthlyInvoiceDialog }, '📦 批次月結帳單（ZIP）'),
    el('button', { class: 'btn primary', onClick: openMonthlyInvoiceDialog }, '📄 產生月結請款單'),
  );
  main.append(bar);
}
async function viewPayables(main) {
  await viewAccount(main, 'payables', '應付帳款', '供應商');
  const bar = el('div', { class: 'toolbar', style: 'justify-content:flex-end;margin-top:12px;' },
    el('button', { class: 'btn primary', onClick: openMonthlyPayableDialog }, '📄 產生月結對帳單'),
  );
  main.append(bar);
}

/**
 * Modal: pick customer + year + month → open PDF in new tab.
 */
async function openMonthlyInvoiceDialog() {
  let customers = [];
  try { customers = await api.get('/customers'); }
  catch (e) { toast(e.message, 'err'); return; }

  const now = new Date();
  const defaults = {
    customerId: customers[0]?.id || '',
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
  };

  openModal({
    title: '產生月結請款單',
    initial: defaults,
    fields: [
      { name: 'customerId', label: '客戶', type: 'select', required: true,
        options: customers.map((c) => ({ value: c.id, label: c.name })) },
      { type: 'row', fields: [
        { name: 'year', label: '年' },
        { name: 'month', label: '月（1-12）' },
      ]},
    ],
    onSubmit: async (v) => {
      if (!v.customerId) throw new Error('請選擇客戶');
      const year = Number(v.year), month = Number(v.month);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error('年/月格式錯誤');
      }
      const url = `/api/statements/monthly-invoice/${v.customerId}/${year}/${month}`;
      window.open(url, '_blank');
    },
  });
}

/**
 * Modal: 列出當月有未付 AR 的客戶 + 批次下載 ZIP（內含每客戶一份 PDF）。
 * v2.9.0+ 新增。
 */
async function openBatchMonthlyInvoiceDialog() {
  const now = new Date();
  const yearInput = el('input', { type: 'number', value: String(now.getFullYear()), style: 'width:100px;' });
  const monthInput = el('input', { type: 'number', min: '1', max: '12', value: String(now.getMonth() + 1), style: 'width:80px;' });
  const refreshBtn = el('button', { class: 'btn' }, '查詢');
  const summary = el('div', { style: 'font-size:13px;color:var(--muted);margin:6px 0;' }, '請選擇年月並按「查詢」。');
  const listBody = el('tbody');
  const listTable = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '客戶'),
      el('th', { class: 'num' }, '未付金額'),
      el('th', { class: 'num' }, '張數'),
      el('th', {}, '最早到期'),
      el('th', {}, '操作'),
    )),
    listBody,
  );
  const downloadAllBtn = el('button', { class: 'btn primary', disabled: 'true' }, '📦 下載全部 ZIP');

  async function refresh() {
    const y = Number(yearInput.value), m = Number(monthInput.value);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
      summary.textContent = '年/月格式錯誤';
      return;
    }
    listBody.innerHTML = '';
    summary.textContent = '載入中…';
    downloadAllBtn.disabled = true;
    try {
      const data = await api.get(`/statements/monthly-invoice/unpaid-customers?year=${y}&month=${m}`);
      summary.textContent = data.customerCount > 0
        ? `${y}/${m} 共 ${data.customerCount} 位客戶有未付，合計 NT$ ${fmtMoney(data.totalUnpaid)}`
        : `${y}/${m} 沒有任何未付請款。`;
      if (data.customerCount > 0) downloadAllBtn.disabled = false;
      for (const it of (data.items || [])) {
        listBody.append(el('tr', {},
          el('td', {}, it.customerName),
          el('td', { class: 'num' }, fmtMoney(it.unpaidAmount)),
          el('td', { class: 'num' }, String(it.arCount)),
          el('td', {}, fmtDate(it.oldestDueDate)),
          el('td', {},
            el('button', { class: 'btn small', onClick: () => {
              window.open(`/api/statements/monthly-invoice/${it.customerId}/${y}/${m}`, '_blank');
            } }, '單張 PDF'),
          ),
        ));
      }
      if (data.customerCount === 0) {
        listBody.append(el('tr', {}, el('td', { colspan: 5, class: 'empty' }, '無資料')));
      }
    } catch (e) {
      summary.textContent = '查詢失敗：' + e.message;
    }
  }

  refreshBtn.addEventListener('click', refresh);
  downloadAllBtn.addEventListener('click', () => {
    const y = Number(yearInput.value), m = Number(monthInput.value);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return;
    window.location.href = `/api/statements/monthly-invoice/batch.zip?year=${y}&month=${m}`;
  });

  // Custom modal — openModal 不夠彈性，我們手刻一個。
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal', style: 'width:680px;max-width:calc(100vw - 32px);' },
    el('h3', {}, '批次月結帳單（當月有未付的客戶）'),
    el('div', { class: 'body' },
      el('div', { style: 'display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:8px;' },
        el('div', { class: 'field', style: 'margin:0;flex:0 0 110px;' },
          el('label', {}, '年'), yearInput,
        ),
        el('div', { class: 'field', style: 'margin:0;flex:0 0 80px;' },
          el('label', {}, '月'), monthInput,
        ),
        refreshBtn,
      ),
      summary,
      listTable,
    ),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onClick: () => backdrop.remove() }, '關閉'),
      downloadAllBtn,
    ),
  );
  // 讓 yearInput / monthInput 撐滿其 wrapper 寬度（不再覆寫成 100px / 80px）
  yearInput.style.width = '100%';
  monthInput.style.width = '100%';
  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
  await refresh();
}

/**
 * Modal: pick supplier + year + month → open AP statement PDF in new tab.
 */
async function openMonthlyPayableDialog() {
  let suppliers = [];
  try { suppliers = await api.get('/suppliers'); }
  catch (e) { toast(e.message, 'err'); return; }

  const now = new Date();
  const defaults = {
    supplierId: suppliers[0]?.id || '',
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
  };

  openModal({
    title: '產生月結應付對帳單',
    initial: defaults,
    fields: [
      { name: 'supplierId', label: '供應商', type: 'select', required: true,
        options: suppliers.map((s) => ({ value: s.id, label: s.name })) },
      { type: 'row', fields: [
        { name: 'year', label: '年' },
        { name: 'month', label: '月（1-12）' },
      ]},
    ],
    onSubmit: async (v) => {
      if (!v.supplierId) throw new Error('請選擇供應商');
      const year = Number(v.year), month = Number(v.month);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error('年/月格式錯誤');
      }
      const url = `/api/statements/monthly-payable/${v.supplierId}/${year}/${month}`;
      window.open(url, '_blank');
    },
  });
}

// ----- E-invoice: issue modal on AR row -----

async function openAllowanceModal(inv, onSaved) {
  const items = (inv.items || []).map((it) => ({
    originalSequence: it.sequence,
    description: it.description,
    quantity: 0,
    unitPrice: Number(it.unitPrice),
  }));
  const errBox = el('div', { class: 'err' });
  const reasonInput = el('input', { type: 'text', placeholder: '折讓原因（例：瑕疵退貨）' });

  function renderItems(host) {
    host.innerHTML = '';
    items.forEach((it, idx) => {
      const row = el('div', { class: 'field row', style: 'gap:6px;align-items:flex-end;' },
        el('div', { class: 'field', style: 'flex:1;' },
          el('label', {}, `原序 ${it.originalSequence}：${it.description}`),
          el('input', { type: 'text', value: it.description, disabled: true })),
        el('div', { class: 'field', style: 'max-width:90px;' },
          el('label', {}, '折讓數量'),
          el('input', { type: 'number', min: '0', step: '0.01', value: String(it.quantity),
            oninput: (ev) => { items[idx].quantity = Number(ev.target.value) || 0; } })),
        el('div', { class: 'field', style: 'max-width:110px;' },
          el('label', {}, '單價'),
          el('input', { type: 'number', min: '0', step: '0.01', value: String(it.unitPrice),
            oninput: (ev) => { items[idx].unitPrice = Number(ev.target.value) || 0; } })),
      );
      host.append(row);
    });
  }
  const itemsHost = el('div', {});
  renderItems(itemsHost);

  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal', style: 'max-width:720px;' },
    el('h3', {}, `折讓單 — 原發票 ${inv.invoiceNo}`),
    el('div', { class: 'body' },
      el('div', { class: 'field' }, el('label', {}, '折讓原因'), reasonInput),
      el('hr'),
      el('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:4px;' },
        '輸入各品項折讓數量（0 表示不折讓）。送出會產生 D0401 XML 寫入 Turnkey 匯入目錄。'),
      itemsHost,
    ),
    errBox,
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onClick: () => backdrop.remove() }, '取消'),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          const sending = items
            .filter((it) => it.quantity > 0 && it.unitPrice >= 0)
            .map((it, i) => ({
              sequence: i + 1,
              originalSequence: it.originalSequence,
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
            }));
          if (!sending.length) throw new Error('至少一個品項要有折讓數量');
          await api.post('/einvoice-allowances/issue', {
            invoiceId: inv.id,
            items: sending,
            reason: reasonInput.value.trim() || undefined,
          });
          toast('折讓單已開立', 'ok');
          backdrop.remove();
          if (onSaved) await onSaved();
        } catch (e) { errBox.textContent = e.message; }
      } }, '開立折讓單'),
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

async function openEinvoiceIssueModal(ar, onSaved) {
  // Pull sales order so we can pre-fill items & buyer info.
  let order = null;
  try {
    if (ar.salesOrderId) order = await api.get(`/sales-orders/${ar.salesOrderId}`);
  } catch { /* fall through with blank items */ }

  const customer = ar.customer ?? {};
  const defaultItems = (order?.items ?? []).map((it) => ({
    description: it.productName,
    quantity: Number(it.quantity),
    unitPrice: Number(it.unitPrice),
  }));

  const state = {
    buyerType: customer.taxId ? 'B2B' : 'B2C',
    buyerName: customer.name || '',
    buyerTaxId: customer.taxId || '',
    buyerAddress: customer.address || '',
    items: defaultItems.length ? defaultItems : [{ description: '', quantity: 1, unitPrice: 0 }],
    // MIG 4.1 新增欄位
    taxType: '1',
    mainRemark: '',
    customsClearanceMark: '',
    zeroTaxRateReason: '',
  };
  const errBox = el('div', { class: 'err' });

  function renderItems(host) {
    host.innerHTML = '';
    state.items.forEach((it, idx) => {
      const row = el('div', { class: 'field row', style: 'gap:6px;align-items:flex-end;' },
        wrapField('品名', el('input', { type: 'text', value: it.description,
          oninput: (ev) => { state.items[idx].description = ev.target.value; } })),
        wrapField('數量', el('input', { type: 'number', min: '0', step: '0.01',
          value: String(it.quantity),
          oninput: (ev) => { state.items[idx].quantity = Number(ev.target.value) || 0; } }), 80),
        wrapField('單價', el('input', { type: 'number', min: '0', step: '0.01',
          value: String(it.unitPrice),
          oninput: (ev) => { state.items[idx].unitPrice = Number(ev.target.value) || 0; } }), 100),
        el('button', { class: 'btn small danger', type: 'button',
          onClick: () => { state.items.splice(idx, 1); renderItems(host); } }, '移除'),
      );
      host.append(row);
    });
    host.append(el('button', { class: 'btn small', type: 'button',
      onClick: () => { state.items.push({ description: '', quantity: 1, unitPrice: 0 }); renderItems(host); } },
      '＋新增品項'));
  }
  function wrapField(label, input, width) {
    return el('div', { class: 'field', style: width ? `max-width:${width}px;` : '' },
      el('label', {}, label), input);
  }

  state.carrierType = '';
  state.carrierId = '';
  state.npoban = '';

  const typeSelect = el('select', {},
    el('option', { value: 'B2B' }, 'B2B（有統編）'),
    el('option', { value: 'B2C' }, 'B2C（無統編）'));
  typeSelect.value = state.buyerType;
  typeSelect.addEventListener('change', () => {
    state.buyerType = typeSelect.value;
    taxIdInput.disabled = state.buyerType === 'B2C';
    if (state.buyerType === 'B2C') taxIdInput.value = '';
    b2cBox.style.display = state.buyerType === 'B2C' ? '' : 'none';
  });
  const taxIdInput = el('input', { type: 'text', value: state.buyerTaxId, placeholder: '8 碼數字' });
  taxIdInput.disabled = state.buyerType === 'B2C';
  taxIdInput.addEventListener('input', () => { state.buyerTaxId = taxIdInput.value; });
  const nameInput = el('input', { type: 'text', value: state.buyerName });
  nameInput.addEventListener('input', () => { state.buyerName = nameInput.value; });
  const addrInput = el('input', { type: 'text', value: state.buyerAddress });
  addrInput.addEventListener('input', () => { state.buyerAddress = addrInput.value; });

  // B2C 特有欄位：載具 / 捐贈碼（擇一或皆無）
  const carrierTypeSelect = el('select', {},
    el('option', { value: '' }, '（不使用載具）'),
    el('option', { value: '3J0002' }, '手機條碼'),
    el('option', { value: 'CQ0001' }, '自然人憑證'),
    el('option', { value: 'EJ0113' }, '會員載具'));
  carrierTypeSelect.addEventListener('change', () => { state.carrierType = carrierTypeSelect.value; });
  const carrierIdInput = el('input', { type: 'text', placeholder: '手機條碼 /ABCDEFG / 憑證 AB0123...' });
  carrierIdInput.addEventListener('input', () => { state.carrierId = carrierIdInput.value.trim(); });
  const npobanInput = el('input', { type: 'text', placeholder: '3-7 碼愛心碼' });
  npobanInput.addEventListener('input', () => { state.npoban = npobanInput.value.trim(); });
  const b2cBox = el('div', { style: state.buyerType === 'B2C' ? '' : 'display:none;' },
    el('hr'),
    el('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:4px;' }, 'B2C 載具 / 捐贈（擇一）'),
    el('div', { class: 'field row', style: 'gap:6px;' },
      wrapField('載具類別', carrierTypeSelect, 140),
      wrapField('載具 ID', carrierIdInput, 200),
    ),
    el('div', { class: 'field row', style: 'gap:6px;' },
      wrapField('或 捐贈碼（愛心碼）', npobanInput, 160),
    ),
  );

  const itemsHost = el('div', {});
  renderItems(itemsHost);

  // MIG 4.1 新增欄位
  const taxTypeSelect = el('select', {
    onChange: (ev) => { state.taxType = ev.target.value; updateTaxFields(); },
  },
    el('option', { value: '1' }, '1 應稅'),
    el('option', { value: '2' }, '2 零稅率'),
    el('option', { value: '3' }, '3 免稅'),
    el('option', { value: '4' }, '4 應稅(特種稅率)'),
  );
  const customsSelect = el('select', {
    onChange: (ev) => { state.customsClearanceMark = ev.target.value; },
  },
    el('option', { value: '' }, '（不適用）'),
    el('option', { value: '1' }, '1 非經海關出口'),
    el('option', { value: '2' }, '2 經海關出口'),
  );
  const zeroReasonInput = el('input', {
    type: 'text', maxlength: 60, placeholder: '如「外銷」、「保稅區」',
    oninput: (ev) => { state.zeroTaxRateReason = ev.target.value; },
  });
  const remarkInput = el('input', {
    type: 'text', maxlength: 200, placeholder: '寫入 XML <MainRemark>，最多 200 字',
    oninput: (ev) => { state.mainRemark = ev.target.value; },
  });
  const customsField = wrapField('通關方式', customsSelect);
  const zeroReasonField = wrapField('零稅率原因', zeroReasonInput);
  function updateTaxFields() {
    const isZero = state.taxType === '2';
    customsField.style.display = isZero ? '' : 'none';
    zeroReasonField.style.display = isZero ? '' : 'none';
  }
  updateTaxFields();

  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal', style: 'max-width:720px;' },
    el('h3', {}, `開立電子發票 — ${customer.name || ''}`),
    el('div', { class: 'body' },
      wrapField('買受人型態', typeSelect),
      wrapField('買受人名稱', nameInput),
      wrapField('統一編號', taxIdInput),
      wrapField('地址', addrInput),
      b2cBox,
      el('hr'),
      el('div', { class: 'field row', style: 'gap:8px;' },
        wrapField('課稅別 (MIG 4.1)', taxTypeSelect, 200),
        customsField,
      ),
      zeroReasonField,
      wrapField('總備註 MainRemark', remarkInput),
      el('hr'),
      el('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:4px;' },
        '品項（金額 = 數量 × 單價；稅額依公司稅率自動計算）'),
      itemsHost,
    ),
    errBox,
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onClick: () => backdrop.remove() }, '取消'),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          if (!state.buyerName.trim()) throw new Error('請填寫買受人名稱');
          if (state.buyerType === 'B2B' && !/^\d{8}$/.test(state.buyerTaxId.trim())) {
            throw new Error('B2B 統編需為 8 碼數字');
          }
          const items = state.items
            .filter((it) => it.description.trim() && it.quantity > 0 && it.unitPrice >= 0)
            .map((it, i) => ({
              sequence: i + 1,
              description: it.description.trim(),
              quantity: it.quantity,
              unitPrice: it.unitPrice,
            }));
          if (!items.length) throw new Error('至少一個有效品項');
          if (state.taxType === '2' && !state.customsClearanceMark) {
            throw new Error('零稅率須選通關方式');
          }
          const payload = {
            receivableId: ar.id,
            salesOrderId: ar.salesOrderId,
            buyerTaxId: state.buyerType === 'B2B' ? state.buyerTaxId.trim() : null,
            buyerName: state.buyerName.trim(),
            buyerAddress: state.buyerAddress.trim() || undefined,
            items,
            taxType: state.taxType,
          };
          if (state.mainRemark.trim()) payload.mainRemark = state.mainRemark.trim();
          if (state.customsClearanceMark) payload.customsClearanceMark = state.customsClearanceMark;
          if (state.zeroTaxRateReason.trim()) payload.zeroTaxRateReason = state.zeroTaxRateReason.trim();
          if (state.buyerType === 'B2C') {
            if (state.carrierType && state.carrierId) {
              payload.carrierType = state.carrierType;
              payload.carrierId = state.carrierId;
            } else if (state.npoban) {
              payload.npoban = state.npoban;
            }
          }
          await api.post('/einvoices/issue', payload);
          toast('已開立', 'ok');
          backdrop.remove();
          if (onSaved) await onSaved();
        } catch (e) { errBox.textContent = e.message; }
      } }, '開立'),
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

// ----- E-invoice list view -----

async function viewEinvoices(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '電子發票'));
  main.append(el('div', { class: 'page-sub' },
    '列出已開立 / 作廢的電子發票。作廢需填寫原因，會寫出 C0501 XML 至 Turnkey 目錄。'));

  const tbody = el('tbody');
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '發票號碼'),
      el('th', {}, '日期'),
      el('th', {}, '買受人'),
      el('th', {}, '統編'),
      el('th', { class: 'num' }, '銷售額'),
      el('th', { class: 'num' }, '稅額'),
      el('th', { class: 'num' }, '總計'),
      el('th', {}, '狀態'),
      el('th', {}, '關聯銷貨單'),
      el('th', {}, '操作'),
    )),
    tbody,
  );

  async function reload() {
    const list = await api.get('/einvoices');
    tbody.innerHTML = '';
    if (!list.length) {
      tbody.append(el('tr', {}, el('td', { colspan: '10',
        style: 'text-align:center;color:var(--muted);padding:24px;' }, '尚無發票')));
      return;
    }
    for (const e of list) {
      const badge = e.status === 'voided' ? 'bad'
        : e.status === 'rejected' ? 'bad'
        : e.status === 'confirmed' ? 'ok'
        : 'warn';
      tbody.append(el('tr', {},
        el('td', {}, e.invoiceNo),
        el('td', {}, fmtDate(e.invoiceDate)),
        el('td', {}, e.buyerName),
        el('td', {}, e.buyerTaxId || '（無）'),
        el('td', { class: 'num' }, fmtMoney(e.salesAmount)),
        el('td', { class: 'num' }, fmtMoney(e.taxAmount)),
        el('td', { class: 'num' }, fmtMoney(e.totalAmount)),
        el('td', {}, el('span', { class: 'badge ' + badge }, e.status)),
        el('td', {}, e.salesOrder?.orderNo || ''),
        el('td', { class: 'actions wrap' },
          el('a', { class: 'btn small', href: `/api/einvoices/${e.id}/proof.pdf`, target: '_blank' }, 'PDF'),
          ' ',
          el('a', { class: 'btn small', href: `/api/einvoices/${e.id}/xml`, target: '_blank' }, 'C0401 XML'),
          e.voidXmlPath ? ' ' : null,
          e.voidXmlPath ? el('a', { class: 'btn small', href: `/api/einvoices/${e.id}/xml?kind=void`, target: '_blank' }, 'C0501 XML') : null,
          ' ',
          window.__session?.employee?.role === 'ADMIN'
            ? el('button', { class: 'btn small', onClick: () => openAllowanceModal(e, reload) }, '折讓')
            : null,
          e.status !== 'voided' && window.__session?.employee?.role === 'ADMIN' ? ' ' : null,
          e.status !== 'voided' && window.__session?.employee?.role === 'ADMIN'
            ? el('button', { class: 'btn small danger', onClick: () => voidEinvoice(e, reload) }, '作廢')
            : null,
        ),
      ));
    }
  }

  function voidEinvoice(e, after) {
    const reason = window.prompt(`作廢發票 ${e.invoiceNo}，請輸入原因：`);
    if (!reason || !reason.trim()) return;
    api.post(`/einvoices/${e.id}/void`, { reason: reason.trim() })
      .then(() => { toast('已作廢', 'ok'); return after(); })
      .catch((err) => toast(err.message, 'err'));
  }

  main.append(table);
  reload();
}

// ----- E-invoice number pools view -----

async function viewEinvoicePools(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '電子發票配號'));
  main.append(el('div', { class: 'page-sub' },
    '每兩個月從國稅局取得字軌核定。新增時把「字軌」「起號」「迄號」照抄進來，系統依 FIFO 取號。'));

  const tbody = el('tbody');
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, '期別'),
      el('th', {}, '字軌'),
      el('th', {}, '起號'),
      el('th', {}, '迄號'),
      el('th', {}, '下一號'),
      el('th', { class: 'num' }, '剩餘'),
      el('th', {}, '狀態'),
      el('th', {}, '備註'),
      el('th', {}, '操作'),
    )),
    tbody,
  );

  async function reload() {
    const list = await api.get('/einvoice-number-pools?includeInactive=true');
    tbody.innerHTML = '';
    if (!list.length) {
      tbody.append(el('tr', {}, el('td', { colspan: '9',
        style: 'text-align:center;color:var(--muted);padding:24px;' }, '尚未設定配號')));
      return;
    }
    for (const p of list) {
      const remaining = Math.max(0, p.rangeEnd - p.nextNumber + 1);
      tbody.append(el('tr', {},
        el('td', {}, p.yearMonth),
        el('td', {}, p.trackAlpha),
        el('td', {}, String(p.rangeStart).padStart(8, '0')),
        el('td', {}, String(p.rangeEnd).padStart(8, '0')),
        el('td', {}, String(p.nextNumber).padStart(8, '0')),
        el('td', { class: 'num' }, String(remaining)),
        el('td', {}, el('span', { class: 'badge ' + (p.isActive ? 'ok' : 'mute') },
          p.isActive ? '啟用' : '停用')),
        el('td', {}, p.note || ''),
        el('td', { class: 'actions' },
          el('button', { class: 'btn small',
            onClick: () => togglePool(p, reload) }, p.isActive ? '停用' : '啟用'),
        ),
      ));
    }
  }

  function togglePool(p, after) {
    api.put(`/einvoice-number-pools/${p.id}`, { isActive: !p.isActive })
      .then(() => { toast('已更新', 'ok'); return after(); })
      .catch((err) => toast(err.message, 'err'));
  }

  const addBtn = el('button', { class: 'btn primary', onClick: () => openModal({
    title: '新增配號區間',
    initial: { yearMonth: '', trackAlpha: '', rangeStart: 0, rangeEnd: 99999999 },
    fields: [
      { name: 'yearMonth', label: '期別 7 碼：民國年 3 碼 + 單月 2 碼 + 雙月 2 碼，如 1131112 = 113 年 11-12 月', required: true },
      { name: 'trackAlpha', label: '字軌（兩個大寫英文字母，如 AB）', required: true },
      { name: 'rangeStart', label: '起號（整數，0–99999999）', type: 'number', required: true },
      { name: 'rangeEnd', label: '迄號', type: 'number', required: true },
      { name: 'note', label: '備註' },
    ],
    onSubmit: async (v) => {
      await api.post('/einvoice-number-pools', {
        yearMonth: String(v.yearMonth || '').trim(),
        trackAlpha: String(v.trackAlpha || '').trim().toUpperCase(),
        rangeStart: Number(v.rangeStart),
        rangeEnd: Number(v.rangeEnd),
        note: v.note ? String(v.note) : undefined,
      });
      toast('已新增', 'ok');
      reload();
    },
  }) }, '＋新增配號');

  // CSV 匯入：依財政部「自行檢測表」項 1(1) 以平台 CSV 配號檔匯入
  const csvFile = el('input', { type: 'file', accept: '.csv,text/csv', style: 'display:none;' });
  csvFile.addEventListener('change', async () => {
    const f = csvFile.files?.[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { toast('檔案超過 1MB', 'err'); csvFile.value = ''; return; }
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch('/api/einvoice-number-pools/import-csv', {
        method: 'POST', credentials: 'same-origin', body: fd,
      });
      if (res.status === 401) { location.href = './login.html'; return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || '匯入失敗');
      const errSummary = (data.errors || []).length
        ? `（${data.errors.length} 筆錯誤：${data.errors.slice(0, 3).map((e) => `第${e.row}列 ${e.message}`).join('；')}${data.errors.length > 3 ? '…' : ''}）`
        : '';
      toast(`已匯入 ${data.inserted}，略過 ${data.skipped} ${errSummary}`, data.errors?.length ? 'warn' : 'ok');
      reload();
    } catch (err) { toast(err.message, 'err'); }
    finally { csvFile.value = ''; }
  });
  const importBtn = el('button', { class: 'btn', onClick: () => csvFile.click() }, '匯入 CSV');

  main.append(el('div', { class: 'toolbar' }, addBtn, importBtn, csvFile), table);
  reload();
}

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
            !isSales() ? el('button', { class: 'btn small', onClick: () => editAccount(a) }, '編輯') : null,
            !isSales() && !a.isPaid ? ' ' : null,
            !isSales() && !a.isPaid ? el('button', { class: 'btn small primary', onClick: () => markPaid(a) }, '標記已付') : null,
            path === 'receivables' ? ' ' : null,
            path === 'receivables' && window.__session?.employee?.role === 'ADMIN'
              ? el('button', { class: 'btn small', onClick: () => openEinvoiceIssueModal(a, reload) }, '開立發票')
              : null,
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

  // ---- 電子發票設定 ----
  const einvTitle = el('h3', { style: 'margin-top:24px;' }, '電子發票設定');
  const einvSub = el('div', { class: 'page-sub' },
    '影響所有開立 / 作廢 / 折讓 / 證明聯 PDF 行為。金鑰欄位留空＝保留原值。');
  const einvForm = el('form', { class: 'card', style: 'padding:16px;max-width:640px;' });
  const einvErr = el('div', { class: 'err', style: 'margin-top:8px;' });

  function einvField(name, label, opts = {}) {
    const input = opts.type === 'checkbox'
      ? el('input', { type: 'checkbox', name })
      : el('input', { name, type: opts.type || 'text', placeholder: opts.placeholder || '', style: 'width:100%;' });
    const row = el('div', { style: 'margin-bottom:12px;' },
      el('label', { style: 'display:block;font-size:12px;color:#666;margin-bottom:4px;' }, label),
      input);
    einvForm.append(row);
    return input;
  }
  const eEnabled = einvField('enabled', '啟用電子發票模組', { type: 'checkbox' });
  // v2.7.4 起賣方資訊（統編 / 名稱 / 地址）一律取自上方「公司資料」，不再於此覆蓋。
  // 加一段唯讀提示，讓使用者知道該去哪裡改。
  einvForm.append(el('div', {
    style: 'margin-bottom:12px;padding:10px 12px;background:#f0f7ff;border:1px solid #b6d4fe;border-radius:4px;font-size:12px;line-height:1.6;',
  },
    el('div', { style: 'font-weight:600;color:#0a4d99;margin-bottom:4px;' }, '賣方資訊（自動）'),
    el('div', {}, '電子發票 XML 與證明聯 PDF 的「賣方統編 / 名稱 / 地址」一律取自上方「公司資料」，不可在此覆蓋。'),
    el('div', { style: 'color:#666;' }, '若需修改 → 請至本頁最上方「公司資料」區塊更新。'),
  ));
  const eTaxRegNo = einvField('taxRegistrationNo', '稅籍編號（字軌申請書用）');
  const eInboundDir = einvField('turnkeyInboundDir', 'Turnkey 匯入目錄（絕對路徑）',
    { placeholder: '/data/einvoice/inbound' });
  const eOutboundDir = einvField('turnkeyOutboundDir', 'Turnkey 回執目錄（絕對路徑）',
    { placeholder: '/data/einvoice/outbound' });
  const eOnlineCode = einvField('turnkeyOnlineCode', 'Turnkey 上線通行碼（整合平台提供）');
  const eQrKey = einvField('qrAesKey', '證明聯 QR 加密金鑰（32 字元 hex；空＝保留原值）',
    { placeholder: '0123456789abcdef0123456789abcdef' });
  const eTaxType = el('select', { name: 'defaultTaxType' },
    el('option', { value: '1' }, '應稅 (1)'),
    el('option', { value: '2' }, '零稅率 (2)'),
    el('option', { value: '3' }, '免稅 (3)'));
  einvForm.append(el('div', { style: 'margin-bottom:12px;' },
    el('label', { style: 'display:block;font-size:12px;color:#666;margin-bottom:4px;' }, '預設稅別'),
    eTaxType));
  const eEnableCarrier = einvField('enableCarrier', '開立 B2C 時允許載具', { type: 'checkbox' });
  const eEnableDonation = einvField('enableDonation', '開立 B2C 時允許捐贈碼', { type: 'checkbox' });
  const ePrintFlag = el('select', { name: 'defaultPrintFlag' },
    el('option', { value: 'Y' }, 'Y 列印證明聯'),
    el('option', { value: 'N' }, 'N 不列印（載具/捐贈預設 N）'));
  einvForm.append(el('div', { style: 'margin-bottom:12px;' },
    el('label', { style: 'display:block;font-size:12px;color:#666;margin-bottom:4px;' }, '預設列印註記'),
    ePrintFlag));

  const einvSave = el('button', { type: 'submit', class: 'btn primary' }, '儲存發票設定');
  einvForm.append(einvSave, einvErr);
  main.append(einvTitle, einvSub, einvForm);

  try {
    const cfg = await api.get('/tenant/me/einvoice-settings');
    eEnabled.checked = !!cfg.enabled;
    eTaxRegNo.value = cfg.taxRegistrationNo || '';
    eInboundDir.value = cfg.turnkeyInboundDir || '';
    eOutboundDir.value = cfg.turnkeyOutboundDir || '';
    eOnlineCode.value = cfg.turnkeyOnlineCode || '';
    eQrKey.placeholder = cfg.qrAesKeySet ? '（已設定，空白＝保留）' : '0123456789abcdef0123456789abcdef';
    eTaxType.value = cfg.defaultTaxType || '1';
    eEnableCarrier.checked = cfg.enableCarrier !== false;
    eEnableDonation.checked = cfg.enableDonation !== false;
    ePrintFlag.value = cfg.defaultPrintFlag || 'Y';
  } catch (e) { einvErr.textContent = '讀取發票設定失敗：' + e.message; }

  einvForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    einvErr.textContent = '';
    einvSave.disabled = true;
    try {
      const body = {
        enabled: eEnabled.checked,
        taxRegistrationNo: eTaxRegNo.value.trim(),
        turnkeyInboundDir: eInboundDir.value.trim(),
        turnkeyOutboundDir: eOutboundDir.value.trim(),
        turnkeyOnlineCode: eOnlineCode.value.trim(),
        defaultTaxType: eTaxType.value,
        enableCarrier: eEnableCarrier.checked,
        enableDonation: eEnableDonation.checked,
        defaultPrintFlag: ePrintFlag.value,
      };
      if (eQrKey.value.trim()) body.qrAesKey = eQrKey.value.trim();
      await api.put('/tenant/me/einvoice-settings', body);
      toast('發票設定已儲存', 'ok');
      eQrKey.value = '';
    } catch (e) { einvErr.textContent = e.message; }
    finally { einvSave.disabled = false; }
  });

  // ---- 發票章 ----
  const stampTitle = el('h3', { style: 'margin-top:24px;' }, '發票章');
  const stampSub = el('div', { class: 'page-sub' },
    '上傳後會蓋在報價單 PDF 右下、B2B 電子發票證明聯的「營業人蓋統一發票專用章」位置。建議透明背景 PNG，方形比例。');
  const stampCard = el('div', { class: 'card', style: 'padding:16px;max-width:640px;display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;' });
  const stampPreviewBox = el('div', { style: 'width:160px;height:160px;border:1px dashed #999;display:flex;align-items:center;justify-content:center;background:#fafafa;' });
  const stampPreview = el('img', { style: 'max-width:100%;max-height:100%;display:none;' });
  const stampNoneText = el('div', { style: 'color:#888;font-size:12px;' }, '尚未上傳');
  stampPreviewBox.append(stampPreview, stampNoneText);
  const stampControls = el('div', { style: 'flex:1;min-width:240px;' });
  const stampInfo = el('div', { style: 'font-size:12px;color:#666;margin-bottom:8px;' });
  const stampFile = el('input', { type: 'file', accept: 'image/png' });
  const stampOpacity = el('input', { type: 'number', min: '0.1', max: '1', step: '0.05', value: '0.85', style: 'width:80px;' });
  const stampUploadBtn = el('button', { type: 'button', class: 'btn primary' }, '上傳');
  const stampDeleteBtn = el('button', { type: 'button', class: 'btn' }, '移除');
  const stampErr = el('div', { class: 'err', style: 'margin-top:8px;' });
  stampControls.append(
    stampInfo,
    el('div', { style: 'margin-bottom:8px;' },
      el('label', { style: 'display:block;font-size:12px;color:#666;margin-bottom:4px;' }, 'PNG 圖檔（≤ 2MB）'),
      stampFile),
    el('div', { style: 'margin-bottom:8px;' },
      el('label', { style: 'display:block;font-size:12px;color:#666;margin-bottom:4px;' }, '透明度（0.1–1）'),
      stampOpacity),
    el('div', { style: 'display:flex;gap:8px;' }, stampUploadBtn, stampDeleteBtn),
    stampErr,
  );
  stampCard.append(stampPreviewBox, stampControls);
  main.append(stampTitle, stampSub, stampCard);

  async function loadStamp() {
    try {
      const cfg = await api.get('/tenant/me/invoice-stamp');
      stampOpacity.value = cfg.opacity ?? 0.85;
      if (cfg.hasStamp) {
        stampPreview.src = `/api/tenant/me/invoice-stamp/image?t=${encodeURIComponent(cfg.uploadedAt || Date.now())}`;
        stampPreview.style.display = 'block';
        stampNoneText.style.display = 'none';
        stampInfo.textContent = `已上傳：${cfg.uploadedAt ? new Date(cfg.uploadedAt).toLocaleString() : ''}`;
      } else {
        stampPreview.style.display = 'none';
        stampNoneText.style.display = 'block';
        stampInfo.textContent = '尚未上傳發票章。';
      }
    } catch (e) { stampErr.textContent = '讀取發票章狀態失敗：' + e.message; }
  }
  loadStamp();

  stampUploadBtn.addEventListener('click', async () => {
    stampErr.textContent = '';
    const file = stampFile.files?.[0];
    if (!file) { stampErr.textContent = '請選擇 PNG 檔'; return; }
    if (file.size > 2 * 1024 * 1024) { stampErr.textContent = '檔案需 ≤ 2MB'; return; }
    stampUploadBtn.disabled = true;
    try {
      const fd = new FormData();
      fd.append('stamp', file);
      fd.append('opacity', String(stampOpacity.value || '0.85'));
      const r = await fetch('/api/tenant/me/invoice-stamp', { method: 'POST', body: fd, credentials: 'include' });
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      toast('發票章已上傳', 'ok');
      stampFile.value = '';
      await loadStamp();
    } catch (e) { stampErr.textContent = e.message; }
    finally { stampUploadBtn.disabled = false; }
  });

  stampDeleteBtn.addEventListener('click', async () => {
    if (!confirm('確定移除已上傳的發票章？')) return;
    stampErr.textContent = '';
    stampDeleteBtn.disabled = true;
    try {
      const r = await fetch('/api/tenant/me/invoice-stamp', { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      toast('已移除', 'ok');
      await loadStamp();
    } catch (e) { stampErr.textContent = e.message; }
    finally { stampDeleteBtn.disabled = false; }
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

// ============================================================
// 會計 (Phase A 最小可用會計)
// ============================================================
//
// 會計模組預設關閉。ADMIN 在「總覽」頁按「啟用會計模組」才會：
//   1. 種子預設 30+ 個科目
//   2. 建立當年度 12 期間
//   3. flip Tenant.settings.accounting.enabled
// 啟用後再填期初餘額。

const ACCT_TYPE_LABEL = {
  asset: '資產', liability: '負債', equity: '權益',
  income: '收入', cost: '成本', expense: '費用',
};

async function loadAcctStatus() {
  return await api.get('/accounting/status');
}

async function viewAcctOverview(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '會計總覽'));
  const status = await loadAcctStatus();

  if (!status.enabled) {
    if (!isAdmin()) {
      main.append(el('div', { class: 'empty' }, '會計模組尚未啟用，請通知 ADMIN 啟用。'));
      return;
    }
    main.append(el('div', { class: 'page-sub' },
      '會計模組目前未啟用。啟用後系統會自動：(1) 種子 30+ 個常用科目 (2) 建立當年度 12 期間 (3) 開啟自動分錄產生器（會計可審核）'));
    const card = el('div', { class: 'card', style: 'padding:16px;max-width:520px;' });
    const yearInput = el('input', { type: 'number', value: String(new Date().getFullYear()), style: 'width:120px;' });
    const monthInput = el('input', { type: 'number', min: '1', max: '12', value: '1', style: 'width:80px;' });
    const btn = el('button', { class: 'btn primary' }, '啟用會計模組');
    const errBox = el('div', { class: 'err', style: 'margin-top:8px;' });
    card.append(
      el('div', { style: 'margin-bottom:12px;' },
        el('label', { style: 'display:block;font-size:12px;color:#666;margin-bottom:4px;' }, '會計年度'),
        yearInput),
      el('div', { style: 'margin-bottom:12px;' },
        el('label', { style: 'display:block;font-size:12px;color:#666;margin-bottom:4px;' }, '會計年度起始月份（一般 1 = Calendar Year）'),
        monthInput),
      btn, errBox,
    );
    main.append(card);
    btn.addEventListener('click', async () => {
      errBox.textContent = '';
      btn.disabled = true;
      try {
        const r = await api.post('/accounting/activate', {
          year: Number(yearInput.value),
          fiscalYearStartMonth: Number(monthInput.value),
        });
        toast(`已啟用：建立 ${r.inserted} 個科目、${r.periodsCreated} 個期間`, 'ok');
        location.reload();
      } catch (e) { errBox.textContent = e.message; btn.disabled = false; }
    });
    return;
  }

  // 已啟用 — 顯示啟用資訊與期初餘額狀態
  const grid = el('div', { class: 'grid', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px;' });
  grid.append(
    el('div', { class: 'card', style: 'padding:14px;' },
      el('div', { style: 'font-size:12px;color:#666;' }, '當前會計年度'),
      el('div', { style: 'font-size:22px;font-weight:600;' }, String(status.currentYear))),
    el('div', { class: 'card', style: 'padding:14px;' },
      el('div', { style: 'font-size:12px;color:#666;' }, '自動分錄'),
      el('div', { style: 'font-size:22px;font-weight:600;' }, status.autoJournalEnabled ? '開啟' : '關閉')),
    el('div', { class: 'card', style: 'padding:14px;' },
      el('div', { style: 'font-size:12px;color:#666;' }, '期初餘額'),
      el('div', { style: 'font-size:22px;font-weight:600;color:' + (status.openingBalanceDone ? '#0a0' : '#d80') + ';' },
        status.openingBalanceDone ? '已建立' : '尚未建立')),
  );
  main.append(grid);

  // 期初餘額表單（沒建過才顯示）
  if (!status.openingBalanceDone && isAdmin()) {
    main.append(el('h3', { style: 'margin-top:24px;' }, '期初餘額'));
    main.append(el('div', { class: 'page-sub' },
      '建立一筆開帳分錄，例：現金 500,000 / 業主資本 500,000。借貸需平衡。'));
    const form = el('div', { class: 'card', style: 'padding:16px;max-width:680px;' });
    const dateInput = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10), style: 'width:160px;' });
    const linesBox = el('div');

    function makeLine(defaults = {}) {
      const codeInput = el('input', { type: 'text', placeholder: '科目編號(4 位)', value: defaults.code || '', style: 'width:130px;' });
      const debitInput = el('input', { type: 'number', placeholder: '借', step: '0.01', value: defaults.debit ?? '', style: 'width:130px;' });
      const creditInput = el('input', { type: 'number', placeholder: '貸', step: '0.01', value: defaults.credit ?? '', style: 'width:130px;' });
      const removeBtn = el('button', { class: 'btn', type: 'button' }, '×');
      const row = el('div', { style: 'display:flex;gap:6px;margin-bottom:6px;' }, codeInput, debitInput, creditInput, removeBtn);
      removeBtn.addEventListener('click', () => row.remove());
      row._readers = () => ({
        accountCode: codeInput.value.trim(),
        debit: debitInput.value ? Number(debitInput.value) : 0,
        credit: creditInput.value ? Number(creditInput.value) : 0,
      });
      return row;
    }
    linesBox.append(
      makeLine({ code: '1101', debit: 500000 }),
      makeLine({ code: '3101', credit: 500000 }),
    );
    const addBtn = el('button', { type: 'button', class: 'btn' }, '+ 加一行');
    addBtn.addEventListener('click', () => linesBox.append(makeLine()));
    const submitBtn = el('button', { class: 'btn primary' }, '建立期初分錄');
    const errBox = el('div', { class: 'err', style: 'margin-top:8px;' });
    form.append(
      el('div', { style: 'margin-bottom:12px;' },
        el('label', { style: 'display:block;font-size:12px;color:#666;margin-bottom:4px;' }, '日期'),
        dateInput),
      el('div', { style: 'font-size:12px;color:#666;margin-bottom:6px;' }, '科目編號 / 借 / 貸（同一行借貸只能一邊有值）'),
      linesBox, addBtn,
      el('div', { style: 'margin-top:12px;' }, submitBtn, errBox),
    );
    main.append(form);
    submitBtn.addEventListener('click', async () => {
      errBox.textContent = '';
      submitBtn.disabled = true;
      try {
        const lines = [...linesBox.children].map((r) => r._readers()).filter((l) => l.accountCode);
        await api.post('/accounting/opening-balance', {
          entryDate: new Date(dateInput.value).toISOString(),
          description: '期初開帳',
          lines,
        });
        toast('期初餘額已建立', 'ok');
        location.reload();
      } catch (e) { errBox.textContent = e.message; submitBtn.disabled = false; }
    });
  }
}

// 類型 → 正常餘額自動推導（會計鐵則）
const ACCT_NORMAL_SIDE = {
  asset: 'debit', cost: 'debit', expense: 'debit',
  liability: 'credit', equity: 'credit', income: 'credit',
};

async function viewAcctCoa(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '科目表'));
  const status = await loadAcctStatus();
  if (!status.enabled) {
    main.append(el('div', { class: 'empty' }, '會計模組尚未啟用。')); return;
  }

  async function reload() {
    const list = await api.get('/accounting/coa');
    render(list);
  }

  function render(list) {
    main.querySelectorAll('.coa-host').forEach((n) => n.remove());
    const host = el('div', { class: 'coa-host' });

    if (isAdmin()) {
      const addBtn = el('button', { class: 'btn primary', onClick: () => openCoaCreateModal(list, reload) }, '＋新增科目');
      host.append(el('div', { class: 'toolbar' }, addBtn));
    }

    const tbl = el('table', { class: 'data-table' });
    const headerRow = el('tr', {},
      el('th', {}, '編號'),
      el('th', {}, '名稱'),
      el('th', {}, '類型'),
      el('th', {}, '正常餘額'),
      el('th', {}, '系統'),
      el('th', {}, '狀態'),
    );
    if (isAdmin()) headerRow.append(el('th', {}, '動作'));
    tbl.append(el('thead', {}, headerRow));

    const tb = el('tbody');
    list.forEach((a) => {
      const row = el('tr', {},
        el('td', {}, a.code),
        el('td', { style: 'padding-left:' + (a.level - 1) * 16 + 'px;' }, a.name),
        el('td', {}, ACCT_TYPE_LABEL[a.type] || a.type),
        el('td', {}, a.normalSide === 'debit' ? '借' : '貸'),
        el('td', {}, a.isSystem ? '是' : ''),
        el('td', {}, a.isActive
          ? el('span', { style: 'color:#0a8a3e;' }, '啟用')
          : el('span', { style: 'color:#888;' }, '停用')),
      );
      if (isAdmin()) {
        const editBtn = el('button', { class: 'btn small', style: 'margin-right:4px;',
          onClick: () => openCoaEditModal(a, reload) }, '編輯');
        const toggleBtn = el('button', { class: 'btn small', style: 'margin-right:4px;',
          onClick: async () => {
            try {
              await api.put(`/accounting/coa/${a.id}`, { isActive: !a.isActive });
              toast(a.isActive ? '已停用' : '已啟用', 'ok');
              reload();
            } catch (e) { toast(e.message, 'err'); }
          } }, a.isActive ? '停用' : '啟用');
        const cell = el('td', {}, editBtn, toggleBtn);
        if (!a.isSystem) {
          const delBtn = el('button', { class: 'btn small danger',
            onClick: async () => {
              if (!confirm(`確定刪除科目 ${a.code} ${a.name}？\n（僅未引用過的科目可刪；已引用請改停用）`)) return;
              try {
                await api.del(`/accounting/coa/${a.id}`);
                toast('已刪除', 'ok');
                reload();
              } catch (e) { toast(e.message, 'err'); }
            } }, '刪除');
          cell.append(delBtn);
        }
        row.append(cell);
      }
      tb.append(row);
    });
    tbl.append(tb);
    host.append(tbl);
    host.append(el('div', { class: 'page-sub', style: 'margin-top:8px;' },
      `共 ${list.length} 個科目（含 ${list.filter((x) => !x.isActive).length} 個停用）。系統預設科目可改名稱／停用，但不可刪除。`));
    main.append(host);
  }

  await reload();
}

function openCoaCreateModal(currentList, reload) {
  const typeOptions = [
    { value: 'asset', label: '資產 (debit)' },
    { value: 'liability', label: '負債 (credit)' },
    { value: 'equity', label: '權益 (credit)' },
    { value: 'income', label: '收入 (credit)' },
    { value: 'cost', label: '成本 (debit)' },
    { value: 'expense', label: '費用 (debit)' },
  ];
  // 上層科目：只列 level=1 的科目，作為新增 level=2 的 parent
  const parents = currentList.filter((a) => a.level === 1);
  const parentOptions = [{ value: '', label: '（無 / level 1 頂層）' }]
    .concat(parents.map((p) => ({ value: p.id, label: `${p.code} ${p.name} (${ACCT_TYPE_LABEL[p.type]})` })));

  openModal({
    title: '新增科目',
    initial: { code: '', name: '', type: 'asset', parentId: '', description: '' },
    fields: [
      { name: 'code', label: '編號（4 位數字）', required: true, placeholder: '如 1151' },
      { name: 'name', label: '名稱', required: true },
      { name: 'type', label: '類型', type: 'select', options: typeOptions, required: true },
      { name: 'parentId', label: '上層科目（可空）', type: 'select', options: parentOptions },
      { name: 'description', label: '描述（選填）' },
    ],
    onSubmit: async (v) => {
      if (!/^\d{4}$/.test(String(v.code || '').trim())) throw new Error('編號需 4 位數字');
      if (!v.name?.trim()) throw new Error('請填名稱');
      const type = v.type;
      const normalSide = ACCT_NORMAL_SIDE[type];
      if (!normalSide) throw new Error('類型不合法');
      // 若選了 parent，要求 parent 同類型
      if (v.parentId) {
        const parent = currentList.find((a) => a.id === v.parentId);
        if (parent && parent.type !== type) throw new Error('上層科目類型必須與本科目相同');
      }
      await api.post('/accounting/coa', {
        code: String(v.code).trim(),
        name: v.name.trim(),
        type,
        normalSide,
        level: v.parentId ? 2 : 1,
        parentId: v.parentId || null,
        description: v.description?.trim() || null,
      });
      toast('已新增', 'ok');
      reload();
    },
  });
}

function openCoaEditModal(account, reload) {
  openModal({
    title: `編輯科目 ${account.code}`,
    initial: {
      name: account.name,
      description: account.description || '',
      isActive: account.isActive ? '1' : '0',
    },
    fields: [
      { name: 'name', label: '名稱', required: true },
      { name: 'description', label: '描述' },
      { name: 'isActive', label: '狀態', type: 'select', options: [
        { value: '1', label: '啟用' },
        { value: '0', label: '停用' },
      ] },
    ],
    onSubmit: async (v) => {
      if (!v.name?.trim()) throw new Error('請填名稱');
      await api.put(`/accounting/coa/${account.id}`, {
        name: v.name.trim(),
        description: v.description?.trim() || null,
        isActive: String(v.isActive) === '1',
      });
      toast('已更新', 'ok');
      reload();
    },
  });
}

async function viewAcctPeriods(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '會計期間'));
  const status = await loadAcctStatus();
  if (!status.enabled) { main.append(el('div', { class: 'empty' }, '會計模組尚未啟用。')); return; }
  const list = await api.get('/accounting/periods');
  const tbl = el('table', { class: 'data-table' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, '年度'),
    el('th', {}, '月份'),
    el('th', {}, '起'),
    el('th', {}, '迄'),
    el('th', {}, '狀態'),
    el('th', {}, '動作'),
  )));
  const tb = el('tbody');
  list.forEach((p) => {
    const fmt = (d) => new Date(d).toLocaleDateString('zh-TW');
    const actionCell = el('td');
    if (isAdmin()) {
      if (p.status === 'open') {
        const b = el('button', { class: 'btn', style: 'font-size:12px;' }, '關閉');
        b.addEventListener('click', async () => {
          if (!confirm(`關閉 ${p.year}/${p.period} 期？關閉後此期間無法新增傳票。`)) return;
          try { await api.post(`/accounting/periods/${p.id}/close`); toast('已關閉', 'ok'); viewAcctPeriods(main); }
          catch (e) { toast(e.message, 'err'); }
        });
        actionCell.append(b);
      } else {
        const b = el('button', { class: 'btn', style: 'font-size:12px;' }, '重開');
        b.addEventListener('click', async () => {
          if (!confirm(`重新開放 ${p.year}/${p.period} 期？`)) return;
          try { await api.post(`/accounting/periods/${p.id}/reopen`); toast('已重開', 'ok'); viewAcctPeriods(main); }
          catch (e) { toast(e.message, 'err'); }
        });
        actionCell.append(b);
      }
    }
    tb.append(el('tr', {},
      el('td', {}, String(p.year)),
      el('td', {}, String(p.period)),
      el('td', {}, fmt(p.startDate)),
      el('td', {}, fmt(p.endDate)),
      el('td', {}, p.status === 'open' ? '開放' : '關閉'),
      actionCell,
    ));
  });
  tbl.append(tb);
  main.append(tbl);
}

async function viewAcctJournal(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '傳票'));
  const status = await loadAcctStatus();
  if (!status.enabled) { main.append(el('div', { class: 'empty' }, '會計模組尚未啟用。')); return; }

  // 工具列：快速費用登記 + 拍照辨識上傳 + 零用金調撥
  const toolbar = el('div', { class: 'toolbar', style: 'display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;' });
  const expenseBtn = el('button', { class: 'btn primary',
    onClick: () => openQuickExpenseModal(() => reload()) }, '＋快速費用登記');
  // 拍照辨識上傳：避開 LINE 拍照壓縮造成的低辨識率
  const ocrFile = el('input', {
    type: 'file', accept: 'image/jpeg,image/png,image/heic,image/webp',
    style: 'display:none;',
  });
  ocrFile.addEventListener('change', async () => {
    const f = ocrFile.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('檔案超過 5MB', 'err'); ocrFile.value = ''; return; }
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch('/api/accounting/expense/ocr', {
        method: 'POST', credentials: 'same-origin', body: fd,
      });
      if (res.status === 401) { location.href = './login.html'; return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'OCR 失敗');
      const fields = [];
      if (data.merchantName) fields.push(`商家：${data.merchantName}`);
      if (data.amount != null) fields.push(`金額：$${Number(data.amount).toLocaleString('zh-TW')}`);
      if (data.invoiceDate) fields.push(`日期：${data.invoiceDate}`);
      if (data.invoiceNo) fields.push(`發票號：${data.invoiceNo}`);
      toast(`📷 已辨識：${fields.join('；') || '欄位皆空，請手動輸入'}`, fields.length ? 'ok' : 'warn');
      // 開啟 modal 並預填
      openQuickExpenseModal(() => reload(), {
        description: data.merchantName || '',
        amount: data.amount,
        invoiceDate: data.invoiceDate,
        voucherNo: data.invoiceNo,
        inferred: data.inferred,
      });
    } catch (err) { toast(err.message, 'err'); }
    finally { ocrFile.value = ''; }
  });
  const ocrBtn = el('button', { class: 'btn', onClick: () => ocrFile.click() }, '📷 拍照辨識上傳');
  const pettyBtn = el('button', { class: 'btn',
    onClick: () => openPettyCashModal(() => reload()) }, '零用金調撥');
  toolbar.append(expenseBtn, ocrBtn, pettyBtn, ocrFile);
  main.append(toolbar);

  // 篩選列
  const filters = el('div', { style: 'display:flex;gap:8px;margin-bottom:12px;align-items:center;' });
  const stSel = el('select', {},
    el('option', { value: '' }, '全部狀態'),
    el('option', { value: 'pending' }, '待審核'),
    el('option', { value: 'posted' }, '已過帳'),
    el('option', { value: 'reversed' }, '已反沖'),
  );
  filters.append(el('span', { style: 'font-size:12px;color:#666;' }, '狀態'), stSel);
  const refresh = el('button', { class: 'btn' }, '重新整理');
  filters.append(refresh);
  main.append(filters);

  const tblBox = el('div');
  main.append(tblBox);

  async function reload() {
    const params = new URLSearchParams();
    if (stSel.value) params.set('status', stSel.value);
    const list = await api.get('/accounting/journal' + (params.toString() ? '?' + params : ''));
    tblBox.innerHTML = '';
    if (!list.length) { tblBox.append(el('div', { class: 'empty' }, '尚無傳票')); return; }
    const tbl = el('table', { class: 'data-table' });
    tbl.append(el('thead', {}, el('tr', {},
      el('th', {}, '編號'),
      el('th', {}, '日期'),
      el('th', {}, '說明'),
      el('th', {}, '來源'),
      el('th', {}, '借合計'),
      el('th', {}, '狀態'),
      el('th', {}, '動作'),
    )));
    const tb = el('tbody');
    list.forEach((e) => {
      const totalDebit = e.lines.reduce((s, l) => s + Number(l.debit), 0);
      const actCell = el('td', { style: 'display:flex;gap:4px;' });
      if (e.status === 'pending') {
        const postBtn = el('button', { class: 'btn primary', style: 'font-size:12px;' }, '過帳');
        postBtn.addEventListener('click', async () => {
          try { await api.post(`/accounting/journal/${e.id}/post`); toast('已過帳', 'ok'); reload(); }
          catch (err) { toast(err.message, 'err'); }
        });
        actCell.append(postBtn);
        const editBtn = el('button', { class: 'btn', style: 'font-size:12px;' }, '編輯');
        editBtn.addEventListener('click', () => openJournalEntryEditor(e, () => reload()));
        actCell.append(editBtn);
        if (isAdmin()) {
          const delBtn = el('button', { class: 'btn', style: 'font-size:12px;' }, '刪除');
          delBtn.addEventListener('click', async () => {
            if (!confirm('確定刪除此 pending 傳票？')) return;
            try { await api.del(`/accounting/journal/${e.id}`); toast('已刪除', 'ok'); reload(); }
            catch (err) { toast(err.message, 'err'); }
          });
          actCell.append(delBtn);
        }
      } else if (e.status === 'posted' && isAdmin()) {
        const revBtn = el('button', { class: 'btn', style: 'font-size:12px;' }, '反沖');
        revBtn.addEventListener('click', async () => {
          const reason = prompt('反沖原因？');
          if (reason === null) return;
          try { await api.post(`/accounting/journal/${e.id}/reverse`, { reason }); toast('已反沖', 'ok'); reload(); }
          catch (err) { toast(err.message, 'err'); }
        });
        actCell.append(revBtn);
      }
      tb.append(el('tr', {},
        el('td', {}, e.entryNo),
        el('td', {}, new Date(e.entryDate).toLocaleDateString('zh-TW')),
        el('td', {}, e.description),
        el('td', {}, e.source),
        el('td', { style: 'text-align:right;' }, fmtMoney(totalDebit)),
        el('td', {}, e.status === 'pending' ? '待審核' : e.status === 'posted' ? '已過帳' : '已反沖'),
        actCell,
      ));
    });
    tbl.append(tb);
    tblBox.append(tbl);
  }

  stSel.addEventListener('change', reload);
  refresh.addEventListener('click', reload);
  reload();
}

// ----- 編輯傳票 modal（pending 才開得起來）-----
// service 端會擋 status !== 'pending'，UI 也只在 pending row 上掛按鈕。
async function openJournalEntryEditor(entry, onSaved) {
  // 載完整科目表（含 inactive 不要，避免使用者選到停用科目）
  let accounts = [];
  try {
    accounts = await api.get('/accounting/coa?activeOnly=1');
  } catch (e) { toast('載入科目表失敗：' + e.message, 'err'); return; }

  const dateValue = (() => {
    try { return new Date(entry.entryDate).toISOString().slice(0, 10); }
    catch { return ''; }
  })();
  const dateInput = el('input', { type: 'date', value: dateValue });
  const descInput = el('input', { type: 'text', value: entry.description || '' });

  const linesBody = el('tbody');
  const totalDebitCell = el('td', { style: 'text-align:right;font-weight:600;' }, '0');
  const totalCreditCell = el('td', { style: 'text-align:right;font-weight:600;' }, '0');
  const balanceMsg = el('span', { style: 'font-size:12px;' }, '');

  function recalcTotals() {
    let td = 0; let tc = 0;
    linesBody.querySelectorAll('tr').forEach((tr) => {
      const numInputs = tr.querySelectorAll('input[type="number"]');
      td += Number(numInputs[0]?.value || 0);
      tc += Number(numInputs[1]?.value || 0);
    });
    totalDebitCell.textContent = td.toLocaleString('zh-TW');
    totalCreditCell.textContent = tc.toLocaleString('zh-TW');
    if (Math.abs(td - tc) < 0.005 && td > 0) {
      balanceMsg.textContent = '✓ 借貸平衡';
      balanceMsg.style.color = '#0a7d2c';
    } else {
      balanceMsg.textContent = `差異：${(td - tc).toLocaleString('zh-TW')}`;
      balanceMsg.style.color = '#c9302c';
    }
  }

  function buildLineRow(line) {
    const accSel = el('select', { style: 'width:100%;min-width:200px;' });
    accSel.append(el('option', { value: '' }, '選擇科目…'));
    for (const a of accounts) {
      const o = el('option', { value: a.id }, `${a.code} ${a.name}`);
      if (line.accountId === a.id) o.selected = true;
      accSel.append(o);
    }
    const debitInput = el('input', {
      type: 'number', step: '0.01', min: '0',
      style: 'width:110px;text-align:right;',
      value: line.debit != null ? String(Number(line.debit)) : '0',
    });
    const creditInput = el('input', {
      type: 'number', step: '0.01', min: '0',
      style: 'width:110px;text-align:right;',
      value: line.credit != null ? String(Number(line.credit)) : '0',
    });
    const memoInput = el('input', {
      type: 'text', style: 'width:100%;min-width:140px;',
      value: line.description || '',
    });
    const removeBtn = el('button', {
      class: 'btn', style: 'font-size:12px;padding:2px 8px;', title: '刪除此分錄',
    }, '×');
    const tr = el('tr', {},
      el('td', {}, accSel),
      el('td', {}, debitInput),
      el('td', {}, creditInput),
      el('td', {}, memoInput),
      el('td', { style: 'text-align:center;' }, removeBtn),
    );
    removeBtn.addEventListener('click', () => { tr.remove(); recalcTotals(); });
    debitInput.addEventListener('input', recalcTotals);
    creditInput.addEventListener('input', recalcTotals);
    return tr;
  }

  for (const l of (entry.lines || [])) linesBody.append(buildLineRow(l));
  if (!linesBody.children.length) {
    linesBody.append(buildLineRow({ accountId: '', debit: 0, credit: 0, description: '' }));
    linesBody.append(buildLineRow({ accountId: '', debit: 0, credit: 0, description: '' }));
  }
  recalcTotals();

  const addLineBtn = el('button', {
    class: 'btn', style: 'margin-top:8px;font-size:12px;',
  }, '＋ 增加分錄');
  addLineBtn.addEventListener('click', () => {
    linesBody.append(buildLineRow({ accountId: '', debit: 0, credit: 0, description: '' }));
    recalcTotals();
  });

  const errBox = el('div', { class: 'err' });

  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal', style: 'max-width:820px;width:96%;' },
    el('h3', {}, `編輯傳票 ${entry.entryNo}`),
    el('div', { class: 'body' },
      el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;' },
        el('div', { class: 'field', style: 'flex:0 0 180px;' },
          el('label', {}, '日期 *'),
          dateInput,
        ),
        el('div', { class: 'field', style: 'flex:1;min-width:220px;' },
          el('label', {}, '說明 *'),
          descInput,
        ),
      ),
      el('div', { style: 'margin-top:6px;font-weight:600;font-size:13px;color:#333;' }, '分錄明細'),
      el('table', { class: 'data-table', style: 'width:100%;font-size:13px;margin-top:6px;' },
        el('thead', {}, el('tr', {},
          el('th', {}, '科目'),
          el('th', { style: 'text-align:right;width:120px;' }, '借'),
          el('th', { style: 'text-align:right;width:120px;' }, '貸'),
          el('th', {}, '摘要'),
          el('th', { style: 'width:36px;' }, ''),
        )),
        linesBody,
        el('tfoot', {}, el('tr', {},
          el('td', { style: 'text-align:right;color:#666;' }, '合計'),
          totalDebitCell,
          totalCreditCell,
          el('td', { colspan: '2' }, balanceMsg),
        )),
      ),
      addLineBtn,
      el('div', { style: 'margin-top:8px;font-size:12px;color:#666;' },
        '註：已過帳 / 已反沖的傳票不可在此編輯，需先反沖再重新建立。'),
    ),
    errBox,
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onClick: () => backdrop.remove() }, '取消'),
      el('button', { class: 'btn primary', onClick: async () => {
        errBox.textContent = '';
        try {
          if (!dateInput.value) throw new Error('日期不可空白');
          const desc = descInput.value.trim();
          if (!desc) throw new Error('說明不可空白');
          const lines = [];
          linesBody.querySelectorAll('tr').forEach((tr) => {
            const accSel = tr.querySelector('select');
            const inputs = tr.querySelectorAll('input');
            const accountId = accSel?.value || '';
            const debit = Number(inputs[0]?.value || 0);
            const credit = Number(inputs[1]?.value || 0);
            const memo = inputs[2]?.value?.trim() || '';
            // 略過完全空白 row（無科目且金額皆 0）
            if (!accountId && debit === 0 && credit === 0) return;
            if (!accountId) throw new Error('每筆分錄都必須選擇科目');
            lines.push({ accountId, debit, credit, description: memo || undefined });
          });
          if (lines.length < 2) throw new Error('至少需 2 筆分錄');
          await api.put(`/accounting/journal/${entry.id}`, {
            entryDate: dateInput.value,
            description: desc,
            lines,
          });
          backdrop.remove();
          toast(`已更新 ${entry.entryNo}`, 'ok');
          if (onSaved) onSaved();
        } catch (e) { errBox.textContent = e.message; }
      } }, '儲存'),
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

// ----- 快速費用登記 modal -----
// prefill: 從 OCR 上傳預填，shape = { description, amount, invoiceDate, voucherNo, inferred }
async function openQuickExpenseModal(onSaved, prefill) {
  const today = new Date().toISOString().slice(0, 10);
  // 載入費用 + 成本科目給「手動覆蓋」下拉
  let expenseAccts = [];
  try {
    const [exp, cost] = await Promise.all([
      api.get('/accounting/coa?type=expense&activeOnly=1'),
      api.get('/accounting/coa?type=cost&activeOnly=1'),
    ]);
    expenseAccts = [...exp, ...cost].sort((a, b) => a.code.localeCompare(b.code));
  } catch (e) { /* 啟用前查不到，繼續以 inferred 為準 */ }

  const errBox = el('div', { class: 'err' });
  const dateInput = el('input', { type: 'date', value: prefill?.invoiceDate || today });
  const descInput = el('input', {
    type: 'text', value: prefill?.description || '',
    placeholder: '如：搭計程車到客戶端 / 繳電費 / 文具採購',
  });
  const amountInput = el('input', {
    type: 'number', min: '1', step: '1',
    value: prefill?.amount != null ? String(prefill.amount) : '',
  });
  const payRadioCash = el('input', { type: 'radio', name: 'payMethod', value: 'cash', checked: true });
  const payRadioBank = el('input', { type: 'radio', name: 'payMethod', value: 'bank' });
  const payRadioPay = el('input', { type: 'radio', name: 'payMethod', value: 'payable' });
  const voucherInput = el('input', {
    type: 'text', value: prefill?.voucherNo || '',
    placeholder: '如：發票號 / 收據編號',
  });
  const statusSelect = el('select', {},
    el('option', { value: 'pending' }, '待審核（之後過帳）'),
    el('option', { value: 'posted' }, '直接過帳'),
  );

  // 自動判斷顯示區
  const inferredBadge = el('div', {
    style: 'padding:8px 10px;background:#f0f7ff;border:1px solid #b6d4fe;border-radius:4px;font-size:13px;line-height:1.5;',
  }, '輸入用途後自動判斷會計科目');
  // 若有 OCR prefill 的科目推論，先顯示
  if (prefill?.inferred?.code) {
    const r = prefill.inferred;
    const kw = r.matchedKeyword ? `（命中：${r.matchedKeyword}）` : '（無命中→雜項）';
    inferredBadge.innerHTML = '';
    inferredBadge.append(
      el('span', { style: 'color:#0a4d99;font-weight:600;' }, `${r.code} ${r.name}`),
      el('span', { style: 'color:#666;margin-left:8px;' }, kw),
    );
  }
  let manualOverrideId = '';
  const overrideSelect = el('select', { style: 'margin-top:6px;' },
    el('option', { value: '' }, '（自動判斷）'),
    ...expenseAccts.map((a) => el('option', { value: a.id }, `${a.code} ${a.name}`)),
  );
  overrideSelect.addEventListener('change', () => { manualOverrideId = overrideSelect.value; });

  // debounced preview
  let inferTimer = null;
  let lastInferred = null;
  async function refreshInferred() {
    const desc = descInput.value.trim();
    if (!desc) {
      inferredBadge.textContent = '輸入用途後自動判斷會計科目';
      lastInferred = null;
      return;
    }
    try {
      const r = await api.get('/accounting/expense/preview?description=' + encodeURIComponent(desc));
      lastInferred = r;
      const kw = r.matchedKeyword ? `（命中關鍵字：${r.matchedKeyword}）` : '（無命中，預設雜項）';
      inferredBadge.innerHTML = '';
      inferredBadge.append(
        el('span', { style: 'color:#0a4d99;font-weight:600;' }, `${r.code} ${r.name}`),
        el('span', { style: 'color:#666;margin-left:8px;' }, kw),
      );
    } catch (e) {
      inferredBadge.textContent = '判斷失敗：' + (e.message || e);
    }
  }
  descInput.addEventListener('input', () => {
    clearTimeout(inferTimer);
    inferTimer = setTimeout(refreshInferred, 250);
  });

  function payValue() {
    if (payRadioBank.checked) return 'bank';
    if (payRadioPay.checked) return 'payable';
    return 'cash';
  }
  function row(label, ...children) {
    return el('div', { class: 'field' },
      el('label', {}, label),
      ...children,
    );
  }

  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal', style: 'max-width:520px;' },
    el('h3', {}, '快速費用登記'),
    el('div', { class: 'body' },
      row('日期', dateInput),
      row('用途說明 *', descInput),
      row('金額 *', amountInput),
      row('付款方式 *',
        el('div', { style: 'display:flex;gap:14px;font-size:14px;' },
          el('label', {}, payRadioCash, ' 現金 (1101)'),
          el('label', {}, payRadioBank, ' 銀行存款 (1111)'),
          el('label', {}, payRadioPay, ' 應付帳款（賒帳，2101）'),
        ),
      ),
      el('div', { class: 'field' },
        el('label', {}, '判斷的會計科目'),
        inferredBadge,
        el('details', { style: 'margin-top:6px;font-size:12px;' },
          el('summary', { style: 'cursor:pointer;color:#666;' }, '手動指定（覆蓋自動判斷）'),
          overrideSelect,
        ),
      ),
      row('憑證號（選填）', voucherInput),
      row('過帳狀態', statusSelect),
    ),
    errBox,
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onClick: () => backdrop.remove() }, '取消'),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          const desc = descInput.value.trim();
          if (!desc) throw new Error('請填用途說明');
          const amount = Number(amountInput.value);
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('金額需 > 0');
          const payload = {
            date: dateInput.value || today,
            description: desc,
            amount,
            paymentMethod: payValue(),
            status: statusSelect.value,
          };
          if (voucherInput.value.trim()) payload.voucherNo = voucherInput.value.trim();
          if (manualOverrideId) payload.expenseAccountId = manualOverrideId;
          const result = await api.post('/accounting/expense/quick', payload);
          const inf = result?.inferred;
          const msg = inf
            ? `已建立傳票 ${result.entry.entryNo}（${inf.expenseCode} ${inf.expenseName} / ${inf.paymentCode} ${inf.paymentName}）`
            : `已建立傳票 ${result.entry.entryNo}`;
          toast(msg, 'ok');
          backdrop.remove();
          if (onSaved) await onSaved();
        } catch (e) { errBox.textContent = e.message; }
      } }, '建立傳票'),
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

// ----- 零用金調撥 modal -----
async function openPettyCashModal(onSaved) {
  const today = new Date().toISOString().slice(0, 10);
  const errBox = el('div', { class: 'err' });
  const dateInput = el('input', { type: 'date', value: today });
  const directionSelect = el('select', {},
    el('option', { value: 'withdraw' }, '撥補（從銀行提現補充零用金）'),
    el('option', { value: 'deposit' }, '繳回（零用金存回銀行）'),
  );
  const amountInput = el('input', { type: 'number', min: '1', step: '1', value: '' });
  const descInput = el('input', { type: 'text', placeholder: '空白＝預設「零用金撥補/繳回」' });

  const hint = el('div', {
    style: 'padding:8px 10px;background:#fff8e1;border:1px solid #ffe0a0;border-radius:4px;font-size:12px;line-height:1.5;color:#6c5400;',
  });
  function refreshHint() {
    if (directionSelect.value === 'withdraw') {
      hint.textContent = '撥補：Dr 1101 現金 / Cr 1111 銀行存款（直接過帳）';
    } else {
      hint.textContent = '繳回：Dr 1111 銀行存款 / Cr 1101 現金（直接過帳）';
    }
  }
  directionSelect.addEventListener('change', refreshHint);
  refreshHint();

  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal', style: 'max-width:480px;' },
    el('h3', {}, '零用金調撥'),
    el('div', { class: 'body' },
      el('div', { class: 'field' }, el('label', {}, '日期'), dateInput),
      el('div', { class: 'field' }, el('label', {}, '方向'), directionSelect),
      el('div', { class: 'field' }, el('label', {}, '金額 *'), amountInput),
      el('div', { class: 'field' }, el('label', {}, '說明（選填）'), descInput),
      el('div', { class: 'field' }, el('label', {}, '會計分錄'), hint),
    ),
    errBox,
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onClick: () => backdrop.remove() }, '取消'),
      el('button', { class: 'btn primary', onClick: async () => {
        try {
          const amount = Number(amountInput.value);
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('金額需 > 0');
          const payload = {
            date: dateInput.value || today,
            direction: directionSelect.value,
            amount,
          };
          if (descInput.value.trim()) payload.description = descInput.value.trim();
          const result = await api.post('/accounting/expense/petty-cash', payload);
          toast(`已建立傳票 ${result.entry.entryNo}（已過帳）`, 'ok');
          backdrop.remove();
          if (onSaved) await onSaved();
        } catch (e) { errBox.textContent = e.message; }
      } }, '建立傳票'),
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

async function viewAcctTrialBalance(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '試算表'));
  const status = await loadAcctStatus();
  if (!status.enabled) { main.append(el('div', { class: 'empty' }, '會計模組尚未啟用。')); return; }
  const tb = await api.get('/accounting/reports/trial-balance');
  main.append(el('div', { class: 'page-sub' },
    `借合計 ${fmtMoney(tb.totalDebit)} / 貸合計 ${fmtMoney(tb.totalCredit)} — ${tb.balanced ? '✓ 平衡' : '✗ 不平衡'}`));
  const tbl = el('table', { class: 'data-table' });
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, '編號'),
    el('th', {}, '名稱'),
    el('th', {}, '類型'),
    el('th', { style: 'text-align:right;' }, '借'),
    el('th', { style: 'text-align:right;' }, '貸'),
    el('th', { style: 'text-align:right;' }, '餘額'),
  )));
  const body = el('tbody');
  tb.balances.forEach((b) => {
    body.append(el('tr', {},
      el('td', {}, b.code),
      el('td', {}, b.name),
      el('td', {}, ACCT_TYPE_LABEL[b.type] || b.type),
      el('td', { style: 'text-align:right;' }, fmtMoney(b.totalDebit)),
      el('td', { style: 'text-align:right;' }, fmtMoney(b.totalCredit)),
      el('td', { style: 'text-align:right;font-weight:600;' }, fmtMoney(b.balance)),
    ));
  });
  tbl.append(body);
  main.append(tbl);
}

async function viewAcctIncome(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '損益表'));
  const status = await loadAcctStatus();
  if (!status.enabled) { main.append(el('div', { class: 'empty' }, '會計模組尚未啟用。')); return; }
  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const fromInput = el('input', { type: 'date', value: yearStart.toISOString().slice(0, 10) });
  const toInput = el('input', { type: 'date', value: today.toISOString().slice(0, 10) });
  const refreshBtn = el('button', { class: 'btn' }, '查詢');
  main.append(el('div', { style: 'display:flex;gap:8px;margin-bottom:12px;align-items:center;' },
    el('span', { style: 'font-size:12px;color:#666;' }, '從'), fromInput,
    el('span', { style: 'font-size:12px;color:#666;' }, '到'), toInput,
    refreshBtn,
  ));
  const out = el('div');
  main.append(out);
  async function reload() {
    const r = await api.get(`/accounting/reports/income-statement?from=${fromInput.value}&to=${toInput.value}`);
    out.innerHTML = '';
    function section(title, items, total) {
      const sec = el('div', { style: 'margin-bottom:16px;' });
      sec.append(el('h3', {}, title));
      const t = el('table', { class: 'data-table' });
      t.append(el('thead', {}, el('tr', {}, el('th', {}, '編號'), el('th', {}, '名稱'), el('th', { style: 'text-align:right;' }, '金額'))));
      const tb = el('tbody');
      items.forEach((it) => tb.append(el('tr', {},
        el('td', {}, it.code), el('td', {}, it.name),
        el('td', { style: 'text-align:right;' }, fmtMoney(it.balance)))));
      tb.append(el('tr', { style: 'background:#f4f4f4;font-weight:600;' },
        el('td', { colSpan: '2' }, '小計'),
        el('td', { style: 'text-align:right;' }, fmtMoney(total))));
      t.append(tb);
      sec.append(t);
      return sec;
    }
    out.append(section('營業收入', r.income, r.totalIncome));
    out.append(section('銷貨成本', r.cost, r.totalCost));
    out.append(el('div', { class: 'card', style: 'padding:12px;margin-bottom:16px;background:#eef;' },
      `毛利：${fmtMoney(r.grossProfit)}`));
    out.append(section('營業費用', r.expense, r.totalExpense));
    out.append(el('div', { class: 'card', style: 'padding:14px;background:#dfe;font-size:18px;font-weight:600;' },
      `本期淨利（損）：${fmtMoney(r.netIncome)}`));
  }
  refreshBtn.addEventListener('click', reload);
  reload();
}

async function viewAcctBalance(main) {
  main.innerHTML = '';
  main.append(el('h2', {}, '資產負債表'));
  const status = await loadAcctStatus();
  if (!status.enabled) { main.append(el('div', { class: 'empty' }, '會計模組尚未啟用。')); return; }
  const today = new Date();
  const asOfInput = el('input', { type: 'date', value: today.toISOString().slice(0, 10) });
  const refreshBtn = el('button', { class: 'btn' }, '查詢');
  main.append(el('div', { style: 'display:flex;gap:8px;margin-bottom:12px;align-items:center;' },
    el('span', { style: 'font-size:12px;color:#666;' }, '截止日'), asOfInput, refreshBtn));
  const out = el('div');
  main.append(out);
  async function reload() {
    const r = await api.get(`/accounting/reports/balance-sheet?asOf=${asOfInput.value}`);
    out.innerHTML = '';
    function section(title, items, total) {
      const sec = el('div', { style: 'margin-bottom:16px;' });
      sec.append(el('h3', {}, title));
      const t = el('table', { class: 'data-table' });
      t.append(el('thead', {}, el('tr', {}, el('th', {}, '編號'), el('th', {}, '名稱'), el('th', { style: 'text-align:right;' }, '金額'))));
      const tb = el('tbody');
      items.forEach((it) => tb.append(el('tr', {},
        el('td', {}, it.code), el('td', {}, it.name),
        el('td', { style: 'text-align:right;' }, fmtMoney(it.balance)))));
      tb.append(el('tr', { style: 'background:#f4f4f4;font-weight:600;' },
        el('td', { colSpan: '2' }, '小計'),
        el('td', { style: 'text-align:right;' }, fmtMoney(total))));
      t.append(tb);
      sec.append(t);
      return sec;
    }
    out.append(section('資產', r.asset, r.totalAsset));
    out.append(section('負債', r.liability, r.totalLiability));
    out.append(section('權益（不含本期淨利）', r.equity, r.totalEquity - r.netIncomeYTD));
    out.append(el('div', { class: 'card', style: 'padding:12px;margin-bottom:16px;background:#eef;' },
      `本期累計淨利：${fmtMoney(r.netIncomeYTD)}`));
    out.append(el('div', { class: 'card', style: 'padding:14px;background:' + (r.balanced ? '#dfe' : '#fdd') + ';font-size:16px;font-weight:600;' },
      `資產 ${fmtMoney(r.totalAsset)} = 負債 ${fmtMoney(r.totalLiability)} + 權益 ${fmtMoney(r.totalEquity)}　${r.balanced ? '✓ 平衡' : '✗ 不平衡'}`));
  }
  refreshBtn.addEventListener('click', reload);
  reload();
}

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

// Load marked.js (markdown renderer) on demand — used by the help view only.
// CDN version is tiny (~40KB) and cached by browser. If offline / blocked,
// falls back to plain <pre> rendering so the manual is still readable.
let _markedPromise = null;
function loadMarked() {
  if (window.marked) return Promise.resolve(window.marked);
  if (_markedPromise) return _markedPromise;
  _markedPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js';
    s.onload = () => resolve(window.marked);
    s.onerror = () => reject(new Error('markdown renderer offline'));
    document.head.appendChild(s);
  });
  return _markedPromise;
}

async function viewHelp(main) {
  main.innerHTML = '';
  const toolbar = el('div', { class: 'toolbar', style: 'display:flex;gap:8px;justify-content:space-between;align-items:center;margin-bottom:12px;' },
    el('h2', { style: 'margin:0;' }, '使用說明'),
    el('div', {},
      el('button', { class: 'btn', onClick: () => window.print() }, '🖨 列印 / 儲存 PDF'),
      ' ',
      el('a', { class: 'btn', href: './manual.md', target: '_blank', style: 'margin-left:6px;' }, '📄 下載原始 Markdown'),
    ),
  );
  const content = el('div', { class: 'help-content markdown-body' }, el('div', { class: 'empty' }, '載入中…'));
  main.append(toolbar, content);

  let md;
  let ver = { version: '?', commit: '?', deployedAt: null };
  try {
    const [mdRes, verRes] = await Promise.all([
      fetch('./manual.md?v=' + Date.now()).then((r) => r.text()),
      fetch('/api/version').then((r) => r.json()).catch(() => ver),
    ]);
    md = mdRes;
    ver = verRes || ver;
  } catch (e) {
    content.innerHTML = '';
    content.append(el('div', { class: 'err' }, '無法載入手冊：' + e.message));
    return;
  }

  // Substitute {{APP_VERSION}} / {{APP_COMMIT}} / {{APP_DEPLOYED_AT}} placeholders
  // so the manual always reflects the currently-deployed version without requiring
  // a manual.md edit on every release.
  const deployedDisplay = ver.deployedAt
    ? new Date(ver.deployedAt).toLocaleString('zh-TW', { hour12: false })
    : '—';
  md = md
    .replace(/\{\{APP_VERSION\}\}/g, ver.version || '?')
    .replace(/\{\{APP_COMMIT\}\}/g, ver.commit || '?')
    .replace(/\{\{APP_DEPLOYED_AT\}\}/g, deployedDisplay);

  try {
    const marked = await loadMarked();
    content.innerHTML = marked.parse(md);
    // Anchor-style links inside the TOC reference #section — rewrite to
    // plain in-page scroll so they don't collide with the SPA's hash router.
    for (const a of content.querySelectorAll('a[href^="#"]')) {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        const id = decodeURIComponent(a.getAttribute('href').slice(1));
        const target = content.querySelector(`[id="${CSS.escape(id)}"]`)
          || [...content.querySelectorAll('h1,h2,h3,h4')].find((h) => h.textContent.trim() === id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  } catch {
    // Fallback: show raw markdown in a <pre> if CDN blocked.
    content.innerHTML = '';
    content.append(el('pre', { style: 'white-space:pre-wrap;font-family:system-ui;font-size:14px;line-height:1.6;' }, md));
  }
}

// ----- Group views (tab-based consolidation) -----
//
// Each group renders a <div class="tabs"> + a <div class="tab-body">; the
// corresponding sub-view (unchanged, pre-existing) is invoked into the body
// when its tab is active. Tabs are filtered by role, so non-ADMIN users
// still see only what they're allowed to (e.g. SALES sees no 員工 tab).
//
// Hash format: `#<group>/<tab>`. Bare `#<group>` picks the first visible tab.

function isAdmin() { return window.__session?.employee?.role === 'ADMIN'; }
function isSales() { return window.__session?.employee?.role === 'SALES'; }

const GROUPS = {
  management: {
    title: '管理',
    tabs: [
      { key: 'customers',  label: '客戶',   view: 'customers' },
      { key: 'products',   label: '產品',   view: 'products' },
      { key: 'suppliers',  label: '供應商', view: 'suppliers', denySales: true },
      { key: 'employees',  label: '員工',   view: 'employees', adminOnly: true },
    ],
  },
  sales: {
    title: '業務功能',
    tabs: [
      { key: 'visit-logs',   label: '工作日誌', view: 'visit-logs' },
      { key: 'bonus-report', label: '業績獎金', view: 'bonus-report', roles: ['ADMIN', 'ACCOUNTING', 'SALES'] },
    ],
  },
  accounts: {
    title: '帳款',
    tabs: [
      { key: 'receivables', label: '應收帳款', view: 'receivables' },
      { key: 'payables',    label: '應付帳款', view: 'payables', denySales: true },
    ],
  },
  invoices: {
    title: '發票',
    tabs: [
      { key: 'einvoices',       label: '電子發票', view: 'einvoices' },
      { key: 'einvoice-pools',  label: '發票配號', view: 'einvoice-pools', adminOnly: true },
    ],
  },
  accounting: {
    title: '會計',
    tabs: [
      { key: 'overview',      label: '總覽',     view: 'acct-overview', denySales: true },
      { key: 'coa',           label: '科目表',   view: 'acct-coa', denySales: true },
      { key: 'periods',       label: '會計期間', view: 'acct-periods', denySales: true },
      { key: 'journal',       label: '傳票',     view: 'acct-journal', denySales: true },
      { key: 'trial-balance', label: '試算表',   view: 'acct-trial-balance', denySales: true },
      { key: 'income',        label: '損益表',   view: 'acct-income', denySales: true },
      { key: 'balance',       label: '資產負債', view: 'acct-balance', denySales: true },
    ],
  },
  logs: {
    title: '紀錄',
    tabs: [
      { key: 'audit-logs', label: '操作紀錄', view: 'audit-logs', adminOnly: true },
      { key: 'error-logs', label: '異常紀錄', view: 'error-logs', adminOnly: true },
    ],
  },
};

// Legacy single hashes → new group/tab hash. Preserves existing bookmarks.
const LEGACY_REDIRECT = {
  customers: 'management/customers',
  products: 'management/products',
  suppliers: 'management/suppliers',
  employees: 'management/employees',
  receivables: 'accounts/receivables',
  payables: 'accounts/payables',
  einvoices: 'invoices/einvoices',
  'einvoice-pools': 'invoices/einvoice-pools',
  'visit-logs': 'sales/visit-logs',
  'bonus-report': 'sales/bonus-report',
  'audit-logs': 'logs/audit-logs',
  'error-logs': 'logs/error-logs',
};

function visibleTabs(group) {
  const role = window.__session?.employee?.role;
  return group.tabs.filter((t) => {
    if (t.adminOnly && !isAdmin()) return false;
    if (t.denySales && isSales()) return false;
    if (t.roles && !t.roles.includes(role)) return false;
    return true;
  });
}

async function renderGroup(main, groupKey, selectedTabKey) {
  const group = GROUPS[groupKey];
  const tabs = visibleTabs(group);
  if (!tabs.length) {
    main.innerHTML = '';
    main.append(el('h2', {}, group.title));
    main.append(el('div', { class: 'empty' }, '此區塊僅 ADMIN 可檢視。'));
    return;
  }
  const active = tabs.find((t) => t.key === selectedTabKey) || tabs[0];

  main.innerHTML = '';
  const tabBar = el('div', { class: 'tabs' });
  tabs.forEach((t) => {
    const btn = el('button', {
      class: t.key === active.key ? 'active' : '',
      onClick: () => {
        location.hash = `#${groupKey}/${t.key}`;
      },
    }, t.label);
    tabBar.append(btn);
  });
  const body = el('div', { class: 'tab-body' });
  main.append(tabBar, body);

  const viewFn = LEAF_VIEWS[active.view];
  if (!viewFn) {
    body.append(el('div', { class: 'err' }, `未知檢視：${active.view}`));
    return;
  }
  try { await viewFn(body); }
  catch (e) { body.innerHTML = ''; body.append(el('div', { class: 'err' }, e.message)); }
}

// Leaf views keyed by the hash segment they used to own. These are still
// reachable directly (e.g. legacy LINE message links that linked to
// `#customers` now redirect here). The functions themselves are untouched.
const LEAF_VIEWS = {
  dashboard: viewDashboard,
  customers: viewCustomers,
  products: viewProducts,
  suppliers: viewSuppliers,
  employees: viewEmployees,
  quotations: viewQuotations,
  'sales-orders': viewSalesOrders,
  'visit-logs': viewVisitLogs,
  'bonus-report': viewBonusReport,
  'purchase-orders': viewPurchaseOrders,
  receivables: viewReceivables,
  payables: viewPayables,
  einvoices: viewEinvoices,
  'einvoice-pools': viewEinvoicePools,
  inventory: viewInventory,
  'acct-overview':       viewAcctOverview,
  'acct-coa':            viewAcctCoa,
  'acct-periods':        viewAcctPeriods,
  'acct-journal':        viewAcctJournal,
  'acct-trial-balance':  viewAcctTrialBalance,
  'acct-income':         viewAcctIncome,
  'acct-balance':        viewAcctBalance,
  'audit-logs': viewAuditLogs,
  'error-logs': viewErrorLogs,
  company: viewCompany,
  help: viewHelp,
};

async function route() {
  let raw = (location.hash || '#dashboard').slice(1);
  // Legacy redirect (bookmark-safe): old single hash → group/tab hash.
  if (LEGACY_REDIRECT[raw]) {
    location.replace('#' + LEGACY_REDIRECT[raw]);
    return;
  }
  const [head, sub] = raw.split('/');
  const main = document.getElementById('main');

  // Sidebar "active" highlighting — works for both group hash and leaf hash.
  for (const a of document.querySelectorAll('#nav a')) {
    a.classList.toggle('active', a.dataset.view === head);
  }

  if (GROUPS[head]) {
    try { await renderGroup(main, head, sub); }
    catch (e) { main.innerHTML = ''; main.append(el('div', { class: 'err' }, e.message)); }
    return;
  }

  const fn = LEAF_VIEWS[head] || viewDashboard;
  try { await fn(main); }
  catch (e) { main.innerHTML = ''; main.append(el('div', { class: 'err' }, e.message)); }
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
  // Hide entries SALES has no access to (server enforces; UI hides for cleanliness).
  if (session.employee?.role === 'SALES') {
    for (const a of document.querySelectorAll('#nav a[data-deny-sales]')) {
      a.style.display = 'none';
    }
  }
  // System version display (fire-and-forget; failure is non-fatal).
  try {
    const v = await (await fetch('/api/version')).json();
    const el = document.getElementById('versionInfo');
    if (el) {
      const deployDate = v.deployedAt ? new Date(v.deployedAt).toLocaleString('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }) : '';
      el.textContent = `v${v.version} · ${v.commit} · ${deployDate}`;
      el.title = `版本：v${v.version}\ncommit：${v.commit}\n部署時間：${deployDate}`;
    }
  } catch { /* non-fatal */ }

  window.addEventListener('hashchange', route);
  route();
}

boot();
