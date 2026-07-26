# 潤樋科技網站優化 — 執行交接檔

**版本**: 1.0  
**日期**: 2026-06-26  
**狀態**: Ready for Execution  
**優先級**: P1-P3 (3 個月衝刺)  

---

## 📋 快速概覽

| 階段 | 時間 | 優先級 | 工作項 | 預期效果 |
|------|------|--------|--------|---------|
| Phase 1 | 第 1 月 | 🔴 P1 | 首頁改造 + 客戶故事 | 詢價 ↑30-50% |
| Phase 2 | 第 2-3 月 | 🟠 P2 | 應用場景 + 計算器 | 詢價 ↑50-100% |
| Phase 3 | 第 4 週 | 🟡 P3 | 定價頁面 + SEO | 轉換 ↑20-40% |

---

## 🎯 Phase 1 — 第 1 個月 (網站結構改造)

### P1.1: 首頁重構 — 新增「痛點 → 解決」區塊

**優先級**: 🔴 最高  
**工作量**: 2-3 天  
**負責**: 前端 + 行銷  

#### 實施細節

**A. HTML 結構改動**

在首頁 `index.html` 中新增區塊（位置：Hero Banner 下方）

```html
<!-- 新增: 中小廠房的痛點區塊 -->
<section class="pain-points-section">
  <div class="container">
    <h2>中小廠房常見的 5 大痛點</h2>
    <div class="pain-points-grid">
      
      <!-- 痛點 1 -->
      <div class="pain-point-card">
        <div class="pain-icon">⏱️</div>
        <h3>報價太慢</h3>
        <p class="pain-desc">業務手工報價 30-60 分，客戶在等待中流失</p>
        <div class="solution-box">
          <strong>解決方案:</strong> 自動報價系統
          <ul>
            <li>3 分鐘內自動報價</li>
            <li>客戶可線上查詢和修改</li>
            <li>成功率提升 40%</li>
          </ul>
        </div>
        <p class="cta-link"><a href="/solutions/quotation">了解報價管理方案 →</a></p>
      </div>

      <!-- 痛點 2 -->
      <div class="pain-point-card">
        <div class="pain-icon">🚚</div>
        <h3>派工調度難</h3>
        <p class="pain-desc">派車手工調度，浪費時間和燃料成本</p>
        <div class="solution-box">
          <strong>解決方案:</strong> AI 智能派工
          <ul>
            <li>派工時間縮短 50%</li>
            <li>路線優化節省油耗 15%</li>
            <li>月省人力 NT$50K</li>
          </ul>
        </div>
        <p class="cta-link"><a href="/solutions/dispatch">了解派工方案 →</a></p>
      </div>

      <!-- 痛點 3 -->
      <div class="pain-point-card">
        <div class="pain-icon">🤖</div>
        <h3>機台無法掌控</h3>
        <p class="pain-desc">生產進度不透明，故障難以預測</p>
        <div class="solution-box">
          <strong>解決方案:</strong> CNC 即時監控
          <ul>
            <li>FANUC FOCAS 直連</li>
            <li>實時看到每台機台狀態</li>
            <li>提前預警機台故障</li>
          </ul>
        </div>
        <p class="cta-link"><a href="/solutions/cnc-monitoring">了解機台監控 →</a></p>
      </div>

      <!-- 痛點 4 -->
      <div class="pain-point-card">
        <div class="pain-icon">📊</div>
        <h3>手工報表浪費人力</h3>
        <p class="pain-desc">每月花費 8-16 小時彙總報表</p>
        <div class="solution-box">
          <strong>解決方案:</strong> AI 自動報告
          <ul>
            <li>月報自動生成</li>
            <li>月省 NT$80K 人力</li>
            <li>決策速度快 10 倍</li>
          </ul>
        </div>
        <p class="cta-link"><a href="/solutions/analytics">了解分析方案 →</a></p>
      </div>

      <!-- 痛點 5 -->
      <div class="pain-point-card">
        <div class="pain-icon">💰</div>
        <h3>ERP 費用太貴</h3>
        <p class="pain-desc">大廠 ERP 月租 NT$60K+，中小廠負擔不起</p>
        <div class="solution-box">
          <strong>解決方案:</strong> 透明定價
          <ul>
            <li>月租 NT$10-30K</li>
            <li>省費用 65-85%</li>
            <li>包含 AI + 全部功能</li>
          </ul>
        </div>
        <p class="cta-link"><a href="/pricing">查看完整定價 →</a></p>
      </div>

    </div>
  </div>
</section>
```

**B. CSS 樣式**

```css
.pain-points-section {
  background: linear-gradient(135deg, #f8f9fa 0%, #fff 100%);
  padding: 80px 20px;
  margin: 60px 0;
}

.pain-points-section h2 {
  font-size: 2.2em;
  text-align: center;
  margin-bottom: 50px;
  color: #333;
}

.pain-points-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 30px;
  max-width: 1400px;
  margin: 0 auto;
}

.pain-point-card {
  background: white;
  border-radius: 12px;
  padding: 30px;
  border-left: 6px solid #667eea;
  transition: all 0.3s;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}

.pain-point-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
}

.pain-icon {
  font-size: 2.5em;
  margin-bottom: 15px;
}

.pain-point-card h3 {
  font-size: 1.3em;
  color: #333;
  margin-bottom: 10px;
}

.pain-desc {
  font-size: 0.95em;
  color: #666;
  margin-bottom: 15px;
  line-height: 1.6;
}

.solution-box {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  margin: 15px 0;
  border-left: 4px solid #28a745;
}

.solution-box strong {
  display: block;
  color: #28a745;
  margin-bottom: 8px;
}

.solution-box ul {
  margin: 8px 0 0 20px;
  padding: 0;
}

.solution-box li {
  margin: 5px 0;
  font-size: 0.9em;
}

.cta-link {
  text-align: right;
  margin-top: 15px;
}

.cta-link a {
  color: #667eea;
  text-decoration: none;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.cta-link a:hover {
  text-decoration: underline;
}

@media (max-width: 768px) {
  .pain-points-grid {
    grid-template-columns: 1fr;
  }
  
  .pain-points-section h2 {
    font-size: 1.5em;
  }
}
```

#### 檢查點

- [ ] HTML 區塊正確插入首頁  
- [ ] CSS 樣式正確載入  
- [ ] 5 個痛點都有內容  
- [ ] 每個痛點卡片都有「了解更多」CTA 連結  
- [ ] 行動裝置適應性檢查 (768px 以下)  
- [ ] 顏色對比符合 WCAG AA 標準  

---

### P1.2: 客戶成功故事頁面

**優先級**: 🔴 最高  
**工作量**: 3-4 週 (內容協調 + 影片製作)  
**負責**: 行銷 + 影片製作  

#### 頁面架構

**路徑**: `/customers/success-stories` 或 `/case-studies`

```html
<section class="customer-stories">
  <h1>客戶成功故事</h1>
  
  <!-- Story 1: 貿易公司 -->
  <article class="story-card">
    <div class="story-header">
      <h2>智慧報價系統幫助貿易商月增 30 個訂單</h2>
      <div class="meta">
        <span class="industry">貿易業</span>
        <span class="company">某 B2B 貿易商</span>
      </div>
    </div>
    
    <div class="story-body">
      <div class="section">
        <h3>原本的痛點</h3>
        <p>業務團隊每天手工報價 20-30 次，每次花 30-60 分鐘...</p>
        <ul>
          <li>報價太慢 → 客戶向其他廠商下單</li>
          <li>報價數字常錯 → 訂單履約成本超支</li>
          <li>無法追蹤報價成交率 → 無法優化定價</li>
        </ul>
      </div>

      <div class="section">
        <h3>使用潮樋後的變化</h3>
        <p>
          導入潮樋 AI 報價系統後，報價流程完全改變...
        </p>
        <div class="results-before-after">
          <div class="before">
            <strong>導入前 (每月)</strong>
            <p>⏱️ 報價時間: 30-60 分/次</p>
            <p>📊 成交率: 15-20%</p>
            <p>👥 人力投入: 業務 40% 時間</p>
            <p>💰 月營收: NT$2M</p>
          </div>
          <div class="after">
            <strong>導入後 (每月)</strong>
            <p>✅ 報價時間: 3 分/次</p>
            <p>✅ 成交率: 35-40%</p>
            <p>✅ 人力投入: 業務 5% 時間</p>
            <p>✅ 月營收: NT$2.9M</p>
          </div>
        </div>

        <div class="highlight-results">
          <h4>💡 核心成果</h4>
          <ul>
            <li><strong>月增 30+ 訂單</strong> (成交率翻倍)</li>
            <li><strong>月省 80 小時</strong> (業務報價時間)</li>
            <li><strong>月增 NT$900K 營收</strong> (1 個月回本)</li>
            <li><strong>顧客滿意度 ↑</strong> (快速報價是差異化優勢)</li>
          </ul>
        </div>
      </div>

      <div class="section video-section">
        <h3>客戶推薦 (60 秒影片)</h3>
        <video width="100%" height="auto" controls poster="/images/customer-story-1-thumb.jpg">
          <source src="/videos/customer-story-1-testimonial.mp4" type="video/mp4">
          瀏覽器不支援影片播放
        </video>
        <p class="caption">
          <strong>陳經理 (業務部主管)</strong><br>
          "以前報價是生意的瓶頸，現在變成我們的競爭優勢。潮樋省了我們一堆人力，我們可以把精力放在開發新客戶。"
        </p>
      </div>
    </div>

    <div class="story-sidebar">
      <div class="company-snapshot">
        <h4>公司背景</h4>
        <p><strong>業界:</strong> B2B 國際貿易</p>
        <p><strong>規模:</strong> 30 人, 月訂單 80-100 張</p>
        <p><strong>導入版本:</strong> 標準方案 (NT$15K/月)</p>
        <p><strong>上線用時:</strong> 6 週</p>
      </div>

      <div class="cta-box">
        <p>想了解我們如何幫助貿易商?</p>
        <a href="/solutions/quotation" class="btn">查看報價管理方案</a>
        <a href="/contact" class="btn btn-secondary">預約 Demo</a>
      </div>
    </div>
  </article>

  <!-- Story 2: 環保公司 (派工優化) -->
  <!-- Story 3: 製造廠 (機台監控) -->
  <!-- ... 結構類似 Story 1 -->
</section>
```

#### 內容清單

| 故事 | 行業 | 痛點 | 解決方案 | ROI 數字 |
|------|------|------|---------|---------|
| Story 1 | 貿易 | 報價慢 | AI 報價 | 月增 NT$900K |
| Story 2 | 環保/物流 | 派工難 | AI 派工 | 月省 NT$80K + 油耗 15% |
| Story 3 | 精密製造 | 機台盲 | CNC 監控 | 停機 ↓60%, 成本月省 NT$200K |

#### 影片製作規格

- **長度**: 60-90 秒  
- **格式**: MP4 (H.264)  
- **解析度**: 1920x1080 @ 30fps  
- **內容**: 老闆/主管 20 秒推薦 + 系統功能展示 30 秒 + 數字成果 10 秒  
- **字幕**: 中英文雙語  
- **配樂**: 專業背景音樂 (版權清楚)  
- **製作時間**: 1 個故事 5-7 天  
- **製作費用**: NT$50-70K/個 (總 NT$150-210K for 3 個)  

#### 檢查點

- [ ] 3 個完整故事內容確認 (與客戶核實數字無誤)  
- [ ] 3 支影片已上傳 CDN (youtube/vimeo/self-hosted)  
- [ ] 頁面響應式設計已驗證  
- [ ] 影片播放器在行動裝置可用  
- [ ] SEO meta tags 已設定 (title, description, og:image)  
- [ ] 追蹤代碼已裝入 (GA, 轉換追蹤)  

---

## 🎯 Phase 2 — 第 2-3 個月 (內容擴展)

### P2.1: 應用場景頁面庫 (10+ 頁)

**優先級**: 🟠 高  
**工作量**: 2-3 週  
**負責**: 行銷 + 內容編寫  

#### 頁面清單與 SEO 關鍵字

| # | 頁面名稱 | URL 路徑 | 主要 SEO 關鍵字 | 預期流量 |
|---|---------|---------|-----------------|----------|
| 1 | 報價管理 | `/solutions/quotation` | 廠房報價系統, 自動報價 | 150/月 |
| 2 | 派工調度 | `/solutions/dispatch` | AI 派工, 派車管理 | 120/月 |
| 3 | 機台監控 | `/solutions/cnc-monitoring` | CNC 監控, 機台管理 | 180/月 |
| 4 | 績效分析 | `/solutions/analytics` | 廠房報表, 績效分析 | 100/月 |
| 5 | 客戶管理 | `/solutions/crm` | 廠房 CRM, 客戶管理 | 90/月 |
| 6 | 庫存追蹤 | `/solutions/inventory` | 庫存管理, 進銷存 | 110/月 |
| 7 | 簽核流程 | `/solutions/approval` | 簽核系統, 工作流 | 70/月 |
| 8 | 文件掃描 | `/solutions/ocr` | 文件 OCR, 單據掃描 | 100/月 |
| 9 | 成本追蹤 | `/solutions/cost-tracking` | 成本分析, 利潤計算 | 80/月 |
| 10 | 異常警報 | `/solutions/alerts` | 預警系統, 異常通知 | 60/月 |

**預期月度新增流量**: 1,060 有機搜尋訪客

#### 每頁標準結構

```html
<article class="solution-page">
  <!-- Header -->
  <header class="solution-header">
    <h1>{解決方案名稱}</h1>
    <p class="tagline">{30 字核心承諾}</p>
    <div class="quick-benefits">
      <span>✅ {效果 1}</span>
      <span>✅ {效果 2}</span>
      <span>✅ {效果 3}</span>
    </div>
  </header>

  <!-- 問題說明 -->
  <section class="problem-section">
    <h2>您的挑戰是...</h2>
    <div class="problem-list">
      <p>❌ {痛點 1}</p>
      <p>❌ {痛點 2}</p>
      <p>❌ {痛點 3}</p>
    </div>
  </section>

  <!-- 解決方案 -->
  <section class="solution-section">
    <h2>潮樋的解決方案</h2>
    <div class="feature-list">
      <div class="feature">
        <h3>功能 1</h3>
        <p>{功能描述}</p>
      </div>
      <!-- ... -->
    </div>
  </section>

  <!-- 預期效果 (數字化) -->
  <section class="results-section">
    <h2>預期效果</h2>
    <div class="result-cards">
      <div class="result-card">
        <div class="metric">時間 ↓50%</div>
        <p>作業時間從 X 小時 → Y 分鐘</p>
      </div>
      <!-- ... -->
    </div>
  </section>

  <!-- 相關案例 -->
  <section class="related-cases">
    <h2>已驗證的成功案例</h2>
    <div class="case-cards">
      <a href="/customers/success-stories#case-1">
        <img src="..." alt="...">
        <h4>案例 1: {公司} 如何...</h4>
      </a>
      <!-- ... -->
    </div>
  </section>

  <!-- CTA -->
  <section class="cta-section">
    <h2>準備了解更多?</h2>
    <a href="/contact" class="btn btn-large">預約 30 分鐘 Demo</a>
    <a href="/pricing" class="btn btn-secondary">查看定價</a>
  </section>
</article>
```

#### 檢查點

- [ ] 10 個頁面全部發佈  
- [ ] 每頁都有 SEO meta tags (title ≤ 60 字, description ≤ 160 字)  
- [ ] 每頁都指向相關案例頁面  
- [ ] 每頁都有「預約 Demo」CTA  
- [ ] 內部連結互相交叉 (相關頁面引用)  
- [ ] Google Search Console 已提交 Sitemap  

---

### P2.2: 互動成本計算器

**優先級**: 🟠 高  
**工作量**: 1-2 週  
**負責**: 前端開發  

#### 功能規格

**URL**: `/pricing/calculator`  

**輸入參數:**
```
- 公司員工數: 20-500 (滑桿)
- 月訂單數: 10-1000 (滑桿)
- 派車頻率: 否 / 偶爾 / 頻繁 (選項)
- 文件掃描需求: 低 / 中 / 高 (選項)
```

**輸出計算:**
```
1. 潮樋年度成本
   = 月租 × 12 + 首次建置 + AI 按次費用

2. FansySoft 年度成本 (估算)
   = 月租 60K × 12 + 整合費用 50K

3. 節省金額與百分比
   = (FansySoft - 潮樋) / FansySoft × 100%
```

#### HTML 結構

```html
<div class="calculator-container">
  <h1>ERP 成本計算器</h1>
  <p>算一下換成潮樋能省多少錢</p>

  <!-- 輸入區 -->
  <form id="costCalculator" class="calculator-form">
    
    <div class="input-group">
      <label for="employeeCount">
        貴公司有多少員工?
        <span class="current-value" id="employeeCountValue">50</span> 人
      </label>
      <input 
        type="range" 
        id="employeeCount" 
        min="20" 
        max="500" 
        value="50"
        step="10"
      />
    </div>

    <div class="input-group">
      <label for="orderCount">
        平均月訂單數?
        <span class="current-value" id="orderCountValue">100</span> 張
      </label>
      <input 
        type="range" 
        id="orderCount" 
        min="10" 
        max="1000" 
        value="100"
        step="50"
      />
    </div>

    <div class="input-group">
      <label>派車頻率?</label>
      <div class="radio-group">
        <label><input type="radio" name="dispatch" value="0" checked /> 不需要</label>
        <label><input type="radio" name="dispatch" value="1" /> 偶爾</label>
        <label><input type="radio" name="dispatch" value="2" /> 經常</label>
      </div>
    </div>

    <div class="input-group">
      <label>文件掃描 (OCR) 需求?</label>
      <div class="radio-group">
        <label><input type="radio" name="ocr" value="0" checked /> 低</label>
        <label><input type="radio" name="ocr" value="1" /> 中等</label>
        <label><input type="radio" name="ocr" value="2" /> 高</label>
      </div>
    </div>
  </form>

  <!-- 輸出區 -->
  <div class="calculator-results">
    <h2>您的年度成本估算</h2>

    <div class="cost-comparison">
      <div class="cost-card luton-card">
        <h3>潮樋科技</h3>
        <div class="cost-breakdown">
          <div class="cost-line">
            <span>月租費用</span>
            <span id="rentCost">NT$180K</span>
          </div>
          <div class="cost-line">
            <span>首次建置</span>
            <span id="setupCost">NT$15K</span>
          </div>
          <div class="cost-line">
            <span>AI 按次費用 (年)</span>
            <span id="aiCost">NT$20K</span>
          </div>
          <div class="cost-line total">
            <span>🟢 年度總成本</span>
            <span id="lutonTotal" class="highlight-number">NT$215K</span>
          </div>
        </div>
      </div>

      <div class="vs-divider">VS</div>

      <div class="cost-card competitor-card">
        <h3>FansySoft ERP (估算)</h3>
        <div class="cost-breakdown">
          <div class="cost-line">
            <span>月租費用</span>
            <span id="compRent">NT$720K</span>
          </div>
          <div class="cost-line">
            <span>整合費用</span>
            <span id="compIntegration">NT$50K</span>
          </div>
          <div class="cost-line">
            <span>延伸模組</span>
            <span id="compModules">NT$60K</span>
          </div>
          <div class="cost-line total">
            <span>🔴 年度總成本</span>
            <span id="competitorTotal" class="highlight-number">NT$830K</span>
          </div>
        </div>
      </div>
    </div>

    <div class="savings-highlight">
      <h3>💰 您可以節省</h3>
      <div class="savings-amount">
        <span class="number" id="savingsAmount">NT$615K</span>
        <span class="percent" id="savingsPercent">(節省 74%)</span>
      </div>
      <p class="savings-detail">
        如果換用潮樋，每年可以省下相當於 <span id="staffEquivalent">7-8</span> 位員工的薪資
      </p>
    </div>

    <div class="cta-section">
      <p>這還只是成本面。潮樋還能帶來其他效益:</p>
      <ul>
        <li>⚡ 4-8 週快速上線 (vs FansySoft 的 6-12 週)</li>
        <li>📱 LINE 原生介面 (員工無需新學習)</li>
        <li>🤖 6 大 AI 功能全內建</li>
      </ul>

      <a href="/contact" class="btn btn-large">預約免費諮詢</a>
    </div>
  </div>
</div>
```

#### JavaScript 計算邏輯

```javascript
const calculator = {
  // 定價規則
  pricing: {
    baseMonthlyRent: 15000, // NT$/月 (標準方案)
    setupCost: 15000,        // 首次建置
    aiCostPerThousand: 5,    // $0.005/次
  },

  // 計算潮樋成本
  calculateLutonCost() {
    const employees = parseInt(document.getElementById('employeeCount').value);
    const orders = parseInt(document.getElementById('orderCount').value);
    
    // 根據規模調整月租
    let monthlyRent = this.pricing.baseMonthlyRent;
    if (employees > 100) {
      monthlyRent = 20000; // 進階方案
    }
    if (employees > 200) {
      monthlyRent = 30000; // 企業方案
    }

    // AI 成本估算
    const aiUsageMonthly = (orders * 10) + (this.getDispatchValue() * orders * 5);
    const aiCostYearly = aiUsageMonthly * this.pricing.aiCostPerThousand * 12 / 1000;

    const rentYearly = monthlyRent * 12;
    const total = rentYearly + this.pricing.setupCost + aiCostYearly;

    return {
      rent: rentYearly,
      setup: this.pricing.setupCost,
      ai: aiCostYearly,
      total: total
    };
  },

  // 計算 FansySoft 估算成本
  calculateCompetitorCost() {
    const employees = parseInt(document.getElementById('employeeCount').value);
    const monthlyRent = 60000; // FansySoft 典型月租
    const integration = 50000;
    const modules = 60000;

    return {
      rent: monthlyRent * 12,
      integration: integration,
      modules: modules,
      total: (monthlyRent * 12) + integration + modules
    };
  },

  getDispatchValue() {
    const dispatch = document.querySelector('input[name="dispatch"]:checked').value;
    return parseInt(dispatch);
  },

  updateDisplay() {
    const luton = this.calculateLutonCost();
    const competitor = this.calculateCompetitorCost();
    const savings = competitor.total - luton.total;

    // 更新潮樋成本
    document.getElementById('rentCost').textContent = this.formatCurrency(luton.rent);
    document.getElementById('setupCost').textContent = this.formatCurrency(luton.setup);
    document.getElementById('aiCost').textContent = this.formatCurrency(luton.ai);
    document.getElementById('lutonTotal').textContent = this.formatCurrency(luton.total);

    // 更新對手成本
    document.getElementById('compRent').textContent = this.formatCurrency(competitor.rent);
    document.getElementById('compIntegration').textContent = this.formatCurrency(competitor.integration);
    document.getElementById('compModules').textContent = this.formatCurrency(competitor.modules);
    document.getElementById('competitorTotal').textContent = this.formatCurrency(competitor.total);

    // 更新節省金額
    document.getElementById('savingsAmount').textContent = this.formatCurrency(savings);
    const savingsPercent = Math.round((savings / competitor.total) * 100);
    document.getElementById('savingsPercent').textContent = `(節省 ${savingsPercent}%)`;

    // 人力等價換算 (按年薪 NT$720K)
    const staffEquivalent = Math.round(savings / 720000);
    document.getElementById('staffEquivalent').textContent = staffEquivalent;
  },

  formatCurrency(num) {
    return 'NT$' + Math.round(num / 1000).toLocaleString('en-US') + 'K';
  },

  init() {
    // 綁定事件
    document.getElementById('employeeCount').addEventListener('input', () => this.updateDisplay());
    document.getElementById('orderCount').addEventListener('input', () => this.updateDisplay());
    document.querySelectorAll('input[name="dispatch"]').forEach(el => 
      el.addEventListener('change', () => this.updateDisplay())
    );
    document.querySelectorAll('input[name="ocr"]').forEach(el => 
      el.addEventListener('change', () => this.updateDisplay())
    );

    // 更新滑桿顯示值
    document.getElementById('employeeCount').addEventListener('input', (e) => {
      document.getElementById('employeeCountValue').textContent = e.target.value;
    });
    document.getElementById('orderCount').addEventListener('input', (e) => {
      document.getElementById('orderCountValue').textContent = e.target.value;
    });

    this.updateDisplay();
  }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => calculator.init());
```

#### 檢查點

- [ ] 計算器在所有裝置上正常運作  
- [ ] 輸入變更即時更新結果  
- [ ] 計算公式經財務確認無誤  
- [ ] 成本假設清楚標示在頁面下方  
- [ ] 追蹤代碼已裝入 (GA 自訂事件追蹤用戶互動)  

---

## 🎯 Phase 3 — 第 4 週 (細節完善)

### P3.1: 定價頁面詳細化

**優先級**: 🟡 中  
**工作量**: 1 週  
**負責**: 行銷 + 前端  

#### 新增內容

**路徑**: `/pricing` (重構現有頁面)

主要變更:
1. 新增「三個方案」對比表 (基礎/標準/進階)
2. 新增「包含 vs 不包含」明細表
3. 新增「常見問題」FAQ
4. 整合「成本計算器」連結

#### 方案對比表

```html
<table class="pricing-plans">
  <thead>
    <tr>
      <th>功能</th>
      <th class="plan-starter">基礎方案<br/>NT$10K/月</th>
      <th class="plan-standard">標準方案<br/>NT$15K/月</th>
      <th class="plan-enterprise">進階方案<br/>NT$25-30K/月</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>適合規模</strong></td>
      <td>20 人以下</td>
      <td>50-100 人</td>
      <td>100+ 人 / 多廠</td>
    </tr>
    <tr>
      <td><strong>月訂單量上限</strong></td>
      <td>≤50 張</td>
      <td>50-200 張</td>
      <td>無上限</td>
    </tr>
    <tr class="feature-row">
      <td><strong>核心功能</strong></td>
      <td colspan="3"></td>
    </tr>
    <tr>
      <td>報價管理</td>
      <td>✅</td>
      <td>✅</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>派工調度</td>
      <td>✅</td>
      <td>✅</td>
      <td>✅</td>
    </tr>
    <!-- ... 其他核心功能 -->

    <tr class="feature-row">
      <td><strong>AI 功能</strong></td>
      <td colspan="3"></td>
    </tr>
    <tr>
      <td>AI 智能派工</td>
      <td>月 500 次</td>
      <td>月 2000 次</td>
      <td>無限</td>
    </tr>
    <tr>
      <td>AI 語音下單</td>
      <td>月 200 次</td>
      <td>月 1000 次</td>
      <td>無限</td>
    </tr>
    <tr>
      <td>OCR 文件掃描</td>
      <td>月 100 份</td>
      <td>月 500 份</td>
      <td>無限</td>
    </tr>
    <!-- ... 其他 AI 功能 -->

    <tr class="feature-row">
      <td><strong>支援</strong></td>
      <td colspan="3"></td>
    </tr>
    <tr>
      <td>客服回應時間</td>
      <td>48 小時</td>
      <td>24 小時</td>
      <td>4 小時</td>
    </tr>
    <tr>
      <td>專屬帳號經理</td>
      <td>❌</td>
      <td>❌</td>
      <td>✅</td>
    </tr>
    <!-- ... 其他支援項目 -->

    <tr class="cta-row">
      <td><a href="/contact">試用 30 天</a></td>
      <td><a href="/contact">試用 30 天</a></td>
      <td><a href="/contact">試用 30 天</a></td>
      <td><a href="/contact">試用 30 天</a></td>
    </tr>
  </tbody>
</table>
```

#### 包含 vs 不包含表

```html
<table class="what-included">
  <tr>
    <td><strong>✅ 月租內含</strong></td>
    <td><strong>❌ 另計費用</strong></td>
  </tr>
  <tr>
    <td>✅ 軟體授權 (不限人數)</td>
    <td>❌ 初次訓練 (NT$10-20K)</td>
  </tr>
  <tr>
    <td>✅ 雲端主機代管</td>
    <td>❌ 客製開發 (按時薪制)</td>
  </tr>
  <tr>
    <td>✅ 資安防護 (AES-256)</td>
    <td>❌ 超額 AI 使用 (按次計費)</td>
  </tr>
  <tr>
    <td>✅ 三層備份</td>
    <td>❌ 資料遷移服務</td>
  </tr>
  <tr>
    <td>✅ 48-24 小時客支</td>
    <td></td>
  </tr>
</table>
```

#### FAQ 區塊

```html
<section class="faq">
  <h2>常見問題</h2>

  <details>
    <summary>❓ 人數超過 100 人，費用怎麼算?</summary>
    <p>標準按方案計費，不會因人數增加而按人頭加費。如有特殊需求，可與我們聯繫</p>
  </details>

  <details>
    <summary>❓ 可以按年繳嗎？有折扣嗎?</summary>
    <p>可以。年繳享 5-10% 折扣，詳情請聯繫銷售團隊</p>
  </details>

  <details>
    <summary>❓ AI 功能用超過，額外費用多少?</summary>
    <p>超額按原價計費。例如語音下單 $0.005/次，OCR $0.01/份</p>
  </details>

  <details>
    <summary>❓ 有試用期嗎?</summary>
    <p>有。新客戶享 30 天免費試用期，無須提供信用卡</p>
  </details>

  <details>
    <summary>❓ 可以隨時取消嗎?</summary>
    <p>可以。以月計費，隨時可取消，無長期合約</p>
  </details>
</section>
```

#### 檢查點

- [ ] 定價頁面完整呈現三個方案  
- [ ] 所有數字與財務部確認無誤  
- [ ] FAQ 覆蓋常見客戶問題  
- [ ] 計算器在定價頁嵌入或有明顯連結  
- [ ] 頁面有「預約試用」CTA  

---

## 📊 監測與優化指標

### 每週檢查清單

```
【第 1 週檢查】
□ 首頁痛點區塊已上線
□ GA 設定追蹤痛點區塊點擊率
□ 檢查搜尋引擎是否已索引

【第 2-3 週檢查】
□ 客戶故事頁發佈 (至少 1 個完整案例)
□ 影片在各平台正常播放
□ 社群媒體分享首個案例

【第 4-6 週檢查】
□ 10 個應用場景頁面已發佈
□ 計算器已上線並可用
□ Sitemap 已提交 Google Search Console

【第 7-8 週檢查】
□ 定價頁完整重構
□ SEO title/description 全部更新
□ 行動版測試完成
```

### KPI 追蹤

| 指標 | 基準 | 目標 (第 3 個月) | 追蹤方式 |
|------|------|-----------------|---------|
| 月度詢價數 | 5-10 | 50-70 | 銷售 CRM |
| 網站月流量 | 200 | 600-800 | GA |
| 成功案例頁面點擊 | 0 | 100+ | GA 事件 |
| 計算器完成率 | 0 | 30%+ | GA 自訂事件 |
| 行動裝置轉化率 | <5% | 10%+ | GA 轉換追蹤 |

---

## 🚀 執行時間表

### 月度進度

| 週 | 工作項 | 負責 | 交付物 |
|----|--------|------|--------|
| W1 | P1.1 首頁改造 | 前端 + 行銷 | 上線首頁、痛點區塊 |
| W2-3 | P1.2 客戶故事內容 | 行銷 | 3 個故事文案 + 1 支影片 |
| W4 | P1.2 故事頁發佈 | 前端 | 客戶故事頁上線 |
| W5-6 | P2.1 應用場景頁 | 行銷 + 前端 | 10 個場景頁上線 |
| W7 | P2.2 計算器開發 | 前端 | 計算器頁上線 |
| W8 | P3.1 定價頁重構 | 行銷 + 前端 | 重構定價頁 |

---

## 📝 內容清單與責任人

### 行銷團隊待辦

- [ ] 客戶 1 成功故事文案 (1000 字)  
- [ ] 客戶 2 成功故事文案 (1000 字)  
- [ ] 客戶 3 成功故事文案 (1000 字)  
- [ ] 10 個應用場景頁面文案 (各 500 字)  
- [ ] FAQ 常見問題 10+ 條  
- [ ] 定價頁說明文案  
- [ ] 3 支影片腳本 (各 200 字)  

### 技術團隊待辦

- [ ] 首頁 HTML/CSS 改動  
- [ ] 成功故事頁面技術實現  
- [ ] 應用場景頁面模板建立  
- [ ] 計算器 JavaScript 開發 & 測試  
- [ ] SEO meta tags 全部更新  
- [ ] 性能測試 (頁面載入速度 < 3s)  
- [ ] 行動版 RWD 測試  
- [ ] GA 追蹤代碼調整  

### 銷售 & 客戶成功團隊待辦

- [ ] 與 3 個客戶協調故事內容  
- [ ] 收集客戶推薦語 & 影片  
- [ ] 驗證 ROI 數字無誤  

---

## 🎯 成功標準

**第 1 個月結束**
- ✅ 首頁痛點區塊上線
- ✅ 至少 1 個完整客戶故事發布
- ✅ 詢價數增加 30-50%

**第 3 個月結束**
- ✅ 10 個應用場景頁全部上線
- ✅ 計算器功能完整可用
- ✅ 定價頁面完整重構
- ✅ 詢價數增加 50-100%
- ✅ 網站月流量翻倍

---

## 🔗 參考文檔

- 【策略】CONSOLIDATED_STRATEGY_REPORT.html  
- 【舊分析】WEBSITE_CONTENT_ANALYSIS.html  
- 【舊分析】SWOT_EXPERT_ANALYSIS.html  

---

**交接完成: 2026-06-26**  
**下一步: 行銷與技術團隊確認時程後啟動 Phase 1**
