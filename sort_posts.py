import json

file_path = 'posts.json'

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        posts = json.load(f)
except FileNotFoundError:
    print(f"錯誤：找不到檔案 {file_path}")
    exit()
except json.JSONDecodeError:
    print(f"錯誤：無法解析檔案 {file_path} 的 JSON 內容")
    exit()
except Exception as e:
    print(f"讀取檔案時發生錯誤：{e}")
    exit()

if isinstance(posts, list):
    try:
        posts.sort(key=lambda x: x.get('id', 0), reverse=True)
    except Exception as e:
        print(f"排序時發生錯誤：{e}")
        exit()

    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(posts, f, indent=4, ensure_ascii=False)
        print(f"檔案 {file_path} 已成功排序並更新。")
    except Exception as e:
        print(f"寫入檔案時發生錯誤：{e}")
else:
    print(f"檔案 {file_path} 的內容不是一個 JSON 陣列。")