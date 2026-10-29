# 待修改清單（2026-10-29 neo 核定，依建議順序施作）

## 已完成（前置修復）
- [x] 09-30 寫死日期跑馬燈修復（commit d79aa30）
- [x] 盈虧趨勢與目前總盈虧不一致修復（commit d79aa30）
- [x] 時區日期、現金流污染趨勢、已實現損益＋股利、儲存安全（commit 7fd8cfb）

## 本批功能（依建議順序）
- [x] F2 組合 vs 大盤對照：盈虧趨勢下方新增對照卡，近 60 日累計報酬 vs 0050，含超額報酬（market.js）
- [x] F1 大盤指數條：資產頁頂部加權／櫃買／0050 即時報價（Fugle，失敗自動隱藏）（market.js）
- [x] F4 市場風險儀表：以 0050 趨勢訊號＋距高回撤顯示風險燈號（併入指數條）（market.js）
- [x] F3 產業配置＋產業趨勢：FinMind 產業分類自動標記、產業占比／未實現損益／20 日動能（market.js）
- [x] F5 績效指標：期間報酬、年化報酬、年化波動、最大回撤、Sharpe（reports.js）
- [x] F6 股利中心：年度／累計股利、對成本殖利率、月分佈、個股股利排行（reports.js）
- [x] F7 年度損益報表：已實現＋股利依年彙總、CSV 匯出（reports.js）
- [x] F8 再平衡偏離提醒：超過容許偏差的持股列出建議買賣股數與費稅估算（再平衡頁頂部）（reports.js）
- [x] F9 雲端同步：GitHub Gist 備份上傳／還原（需自備 gist 權限 Token）（reports.js＋設定頁）
- [x] F10 AI 組合解讀：使用既有 Gemini API Key 產生組合風險與建議摘要（設定頁）（reports.js）
- [x] F11 PWA＋深色模式：manifest＋Service Worker（網路優先快取）、深色模式切換（設定頁）

## 第二批優化與功能（2026-10-29 neo 核定，依建議順序施作）
- [x] O1 效能：calculateDailyPortfolioHistory 狀態簽名快取（assets.js）
- [x] O5 單元測試＋GitHub Actions CI：tests/run-tests.js + GitHub Actions workflow（範本 workflow-test.yml；GitHub App 無 workflows 權限，需手動放至 .github/workflows/test.yml 才會啟用）
- [x] O3 交易邏輯統一：core.collectAllTransactions / deleteTransactionWithRollback，trade.js 與 transactions.js 共用；修正個股明細刪除的過時警告文字（原本誤稱不回滾，實際會回滾）
- [x] O4 安全與資料健壯性：validateBackupData 匯入驗證（匯入與 Gist 還原共用把關）、本機自動備份快照（覆蓋前/每日/手動，最多 5 份，可還原）
- [x] O6 XIRR 資金加權年化（core.computeXirr）＋盈虧趨勢區間切換 30/60/180/全部
- [x] N7 股利除息行事曆：FinMind TaiwanStockDividend（欄位 2026-10-29 實測：CashExDividendTradingDate / CashDividendPaymentDate / CashEarningsDistribution），預估待領金額
- [x] N8 警示中心：再平衡偏離、集中度、未實現虧損 ≤-15%、14 天內除息彙整
- [x] N9 情境模擬：大盤 -5%/-10%/-20% × 個股 Beta 推估組合影響
- [x] N10 集中度健檢：最大單一、前三大、單一產業占比與門檻警示
- [x] N11 報稅彙總 CSV：逐筆已實現＋股利，依年匯出附合計
- [x] N12 Gist 自動同步：opt-in 開關，開啟時比對雲端更新時間，本機未再改動才提示還原（不自動覆蓋）
- [x] O2 架構第一步：api.js 統一 API 層（逾時/重試/快取/新鮮度標示），market.js 基準與產業兩條已遷移；其餘模組的 fetch 逐步遷移

## 後續未排（待 neo 指示）
- [ ] api.js 全面遷移（waterlevel／watch／assets 的 fetch 改走統一層）
- [ ] assets.js／waterlevel.js 大檔拆分
- [ ] 指數條成交金額／法人買賣超（無可靠免費來源，找到再做）
