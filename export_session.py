# export_session.py (最终修正版 - 保证输出正确的 Session String)

import os
from dotenv import load_dotenv
from telethon import TelegramClient
# 导入 StringSession，我们将用它来转换
from telethon.sessions import StringSession

# 加载 .env 文件中的配置
load_dotenv()
API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")

# 确保配置存在
if not all([API_ID, API_HASH]):
    print("错误: 请确保 .env 文件中有 TELEGRAM_API_ID 和 TELEGRAM_API_HASH")
    exit(1)
    
try:
    API_ID = int(API_ID)
except ValueError:
    print("错误: TELEGRAM_API_ID 必须是数字。")
    exit(1)

# 【核心修改】直接以 StringSession 模式启动
# 我们不需要 'anon.session' 文件了。脚本会直接在内存中处理 session，并打印出来。
# 如果是第一次运行，它会要求登录，登录成功后直接打印出可用的 session string。
client = TelegramClient(StringSession(), API_ID, API_HASH)

async def main():
    # 连接客户端
    await client.connect()

    # 如果没有预先提供的 session string (我们就是这种情况)，
    # 并且客户端没有被授权，那么就需要登录。
    if not await client.is_user_authorized():
        print("!!! 需要交互式登录 !!!")
        print("请输入您的电话号码 (例如 +886912345678):")
        phone_number = input()
        
        await client.send_code_request(phone_number)
        
        try:
            # 尝试使用验证码登录
            await client.sign_in(phone_number, input('请输入您收到的 Telegram 验证码: '))
        except Exception as e:
            # 如果开启了两步验证，会进入这里
            print("看起来您开启了两步验证。")
            await client.sign_in(password=input('请输入您的两步验证密码: '))
            
    print("\n成功连接并授权！")
    
    # 【核心修改】现在 client.session 就是一个 StringSession 对象，
    # 它的 save() 方法会返回我们需要的那个字符串！
    string_session = client.session.save()
    
    print("\n" + "="*50)
    print("这是您 100% 正确的 TELEGRAM_SESSION_STRING：")
    print("请完整复制下面的整段长字符串 (不要包含 = 号前后的空格)")
    print("="*50 + "\n")
    
    # 打印出最终的、可以直接使用的 StringSession 字符串
    print(string_session)
    
    print("\n" + "="*50)
    print("复制完成后，请将它更新到 Secret Manager 中。")
    print("="*50 + "\n")

# 使用 client.run_until_disconnected() 来运行，更适合交互式会话
# 注意：这个脚本在打印出 session 后不会自动退出，您需要手动按 Ctrl+C 来结束它。
if __name__ == '__main__':
    with client:
        client.loop.run_until_complete(main())