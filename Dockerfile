# Dockerfile (最終 Cloud Run Jobs 版本)

FROM python:3.11-slim

WORKDIR /app

# 更新 pip
RUN pip install --no-cache-dir --upgrade pip

# 先複製 requirements.txt 並安裝依賴
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製其餘應用程式檔案
COPY . .

CMD ["python", "everypy.py"]