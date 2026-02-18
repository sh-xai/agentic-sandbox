# ABOUTME: Container image for the MCP proxy interceptor.
# ABOUTME: Python 3.12 slim base with FastAPI, httpx, and OTel dependencies.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001

CMD ["uvicorn", "proxy:app", "--host", "0.0.0.0", "--port", "8001"]
