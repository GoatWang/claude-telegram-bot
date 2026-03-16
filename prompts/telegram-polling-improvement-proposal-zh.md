# Telegram Polling / 圖片訊息穩定性改善提案

## 背景

目前觀察到兩類錯誤：

1. `sendMessage` 失敗
2. `getUpdates` timeout / `ECONNRESET`

這兩者都指向同一個核心問題：

- 與 Telegram API 的連線在高延遲、長連線、或短暫網路抖動下不夠穩定
- 系統對「暫時性失敗」的容錯不一致

圖片訊息會讓問題更容易浮現，但通常不是直接根因。

原因是：

- 圖片流程會多做一次 Telegram 檔案下載
- 接著還要交給 Claude 做分析
- 期間會產生更多狀態訊息、更多 API 呼叫、更多等待時間

換句話說：

```text
文字訊息
  -> 少量 API 呼叫
  -> 短流程
  -> 失敗面較小

圖片訊息
  -> getFile
  -> download file
  -> send status
  -> call Claude
  -> stream response
  -> 更多 edit/send/delete
  -> 失敗面變大
```

所以我的判斷是：

```text
圖片不是直接讓 getUpdates 變慢
圖片是讓整體系統更忙、更脆弱
真正需要修的是 polling 與 Telegram API 的韌性
```

---

## 問題拆解

### 1. `getUpdates` timeout 代表什麼

`getUpdates` 是 long polling。

它本來就會長時間掛著等 Telegram 回資料，所以 timeout 或連線被重置，在實務上常常是「可恢復的暫時性問題」，不一定代表 bot 邏輯壞掉。

可以把它想像成：

```text
[Bot] ---- open long poll ----> [Telegram]
         .... waiting ....
         .... waiting ....
         x timeout / reset

然後應該要：

[Bot] retry polling
```

如果我們把這種情況當成「重大錯誤」，log 就會看起來像 bot 壞了。

其實很多時候它只是：

```text
網路晃一下
or
Telegram 長輪詢連線被關掉
or
Bun fetch timeout / socket reset
```

---

### 2. `sendMessage` 失敗代表什麼

這個比較像是「輸出階段」的問題。

也就是：

```text
Bot 想回訊息給使用者
-> 呼叫 Telegram sendMessage
-> socket reset / timeout
-> 這次回覆失敗
```

專案內其實已經有 retry helper，但不是所有路徑都有使用。

這會造成：

```text
同樣都是暫時性錯誤

有些路徑：
  retry 後成功

有些路徑：
  直接往上丟
  看起來像 bot crash
```

這是目前最應該優先統一的地方。

---

## 我的修法提案

我會分成 4 個層次處理。

### 提案 A: 把 `getUpdates` timeout / reset 視為可恢復事件

#### 做法

在 polling runner 周圍增加更明確的錯誤分類：

- `TimeoutError`
- `ECONNRESET`
- `ETIMEDOUT`
- `socket closed unexpectedly`

這些歸類為 transient polling errors。

對這些錯誤：

- 不當成 crash
- 降級成 warn / debug log
- 讓 runner 自動重試
- 必要時加入小型 backoff

#### 為什麼有效

因為這類錯誤本質上不是業務邏輯錯誤，而是長連線世界中的正常噪音。

把它從「錯誤」改成「可恢復事件」，能改善兩件事：

1. bot 心智模型更正確
2. log 不再誤導

#### terminal 視覺化

```text
現在：

[runner] Error while fetching updates
  -> 看起來像 bot 壞掉

改善後：

[polling] transient timeout on getUpdates
[polling] retrying in 1.0s
[polling] resumed
```

---

### 提案 B: 所有 Telegram 寫操作統一走 retry wrapper

#### 做法

把這些操作全面收斂到同一層：

- `ctx.reply`
- `ctx.api.sendMessage`
- `ctx.api.editMessageText`
- `ctx.api.deleteMessage`

建立一致的 helper，例如：

```text
telegramSend()
telegramEdit()
telegramDelete()
```

內部統一做：

- transient error retry
- exponential backoff
- error normalization
- optional safe fallback

#### 為什麼有效

現在的問題不是沒有 retry，而是 retry 不一致。

一致化之後，系統面對短暫網路問題時會變成：

```text
第一次失敗 -> 等一下 -> 重試 -> 成功
```

而不是：

```text
第一次失敗 -> 直接炸到最上層
```

#### terminal 視覺化

```text
[telegram] sendMessage failed: ECONNRESET
[telegram] retry 1/3 in 1000ms
[telegram] retry 2/3 in 2000ms
[telegram] sendMessage success
```

---

### 提案 C: 圖片流程減少 Telegram API 噪音

#### 做法

圖片訊息現在的風險不是單一大錯，而是「流程長、呼叫多」。

我會收斂圖片流程的訊息頻率：

- 只保留必要狀態
- 降低中間狀態訊息數
- 避免過多 edit / delete
- 盡量把工具狀態合併成單一摘要訊息

甚至可把流程設計成：

```text
收到圖片
-> 回一則簡短 ack
-> 背景下載圖片
-> 呼叫 Claude
-> 完成時回主要結果
```

而不是一路頻繁更新很多小訊息。

#### 為什麼有效

每多一次 Telegram API 呼叫，就多一次碰到 timeout/reset 的機會。

所以這個提案的核心不是「更快」，而是：

```text
更少的 API 次數
= 更少的失敗表面積
```

#### terminal 視覺化

```text
現在：

receive image
-> send "Processing image..."
-> edit tool status
-> send segment
-> edit segment
-> delete status
-> send done

改善後：

receive image
-> send "收到圖片，開始分析"
-> 背景處理
-> send final result
```

---

### 提案 D: 增加觀測點，確認圖片是否真的放大了 polling 問題

#### 做法

加入結構化 log：

- `getUpdates` 開始時間 / 結束時間
- `getUpdates` timeout 次數
- 圖片下載耗時
- Claude 分析耗時
- 每次回應期間的 Telegram API 呼叫次數
- queue 長度

#### 為什麼有效

目前「圖片讓 polling 變慢」是一個合理懷疑，但還不是證據。

應該把它驗證成可量測的結論：

```text
image request
  -> telegram calls: 9
  -> total time: 42s
  -> polling timeout count during window: 3

text request
  -> telegram calls: 3
  -> total time: 7s
  -> polling timeout count during window: 0
```

這樣之後才知道優化重點是：

- 網路
- polling timeout
- 回覆節流
- 圖片下載
- Claude latency

---

## 我想怎麼實作

### Phase 1: 穩定性優先

先做最值回票價的部分：

1. polling transient error 分類
2. 所有 Telegram write API 統一 retry
3. 保持既有行為，不改業務邏輯

這一階段的目標：

```text
不要因為短暫網路抖動看起來像 bot 掛掉
```

---

### Phase 2: 降低圖片流程噪音

接著處理圖片流程：

1. 減少狀態訊息數量
2. 合併中間更新
3. 對長時間任務改成較粗粒度回報

這一階段的目標：

```text
降低 Telegram API 呼叫密度
```

---

### Phase 3: 量測與驗證

最後補 observability：

1. timeout / reset 計數
2. 圖片與文字請求比較
3. 每 chat 的 API 呼叫密度

這一階段的目標：

```text
從「猜測原因」進化成「用數據確認原因」
```

---

## 為什麼這套方案可行

這套方案不是只修單點，而是同時處理：

```text
讀取端問題   -> getUpdates polling 容錯
寫入端問題   -> send/edit/delete retry 一致化
流量問題     -> 圖片流程降噪
診斷問題     -> 增加觀測資料
```

所以效果不是只有「少一點 error log」。

更實際的結果會是：

```text
1. Bot 不會因為 transient timeout 看起來像壞掉
2. sendMessage 失敗更容易自動恢復
3. 圖片分析時的 Telegram API 壓力下降
4. 未來能更快判斷是真網路問題、Telegram 問題、還是應用層問題
```

---

## 結論

我的判斷是：

```text
圖片訊息可能會放大問題
但不是 getUpdates timeout 的直接根因

真正該修的是：
1. polling 的容錯
2. Telegram API 寫操作的一致 retry
3. 圖片流程的 API 噪音
4. 可觀測性
```

如果要開始實作，我建議先做：

```text
Step 1: 統一 Telegram retry wrapper
Step 2: 降級 getUpdates transient error
Step 3: 精簡圖片流程中間訊息
Step 4: 加入 metrics / structured logs
```

這是最穩、風險最低、也最能快速看到效果的順序。
