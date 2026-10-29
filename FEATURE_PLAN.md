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

## 後續未排（中低優先，待 neo 指示）
- [ ] 開啟效能：updateAllData 重複計算整合、輸入防抖
- [ ] trade.js 與 transactions.js 交易邏輯統一
- [ ] 單元測試＋GitHub Actions CI
- [ ] innerHTML 跳脫統一、備份匯入欄位驗證強化
- [ ] 趨勢圖區間切換與 XIRR（現金流加權年化）
