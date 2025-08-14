# app.py

from flask import Flask
import asyncio
import threading

# 從您現有的腳本中導入 run 函數
from main import run as run_telegram_script

app = Flask(__name__)

# 建立一個路由，例如 /run，用來觸發您的腳本
@app.route("/run", methods=['POST'])
def trigger_script():
    # Cloud Scheduler 發送的請求會包含特定的 Header，我們可以檢查它以增加安全性
    # if not request.headers.get('User-Agent') == 'Google-Cloud-Scheduler':
    #     return "Unauthorized", 401

    print("收到觸發請求，將在背景執行 Telegram 腳本...")

    # 因為 main 腳本是異步且可能耗時長，我們不能直接在請求中運行它
    # 否則會導致請求超時。我們將它放在一個新的線程中執行。
    def run_in_background():
        # 為新線程創建並設置事件循環
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(run_telegram_script())
        loop.close()
        print("背景 Telegram 腳本執行完畢。")

    thread = threading.Thread(target=run_in_background)
    thread.start()

    # 立刻返回 202 Accepted，告訴 Scheduler「我收到任務了，正在處理」
    return "Accepted: Script is running in the background.", 202

if __name__ == "__main__":
    # 從環境變數獲取端口，這是 Cloud Run 的要求
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port)