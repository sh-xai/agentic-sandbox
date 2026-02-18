# ABOUTME: Container image for the FastMCP tool server.
# ABOUTME: Python 3.12 slim base with FastMCP and OTel dependencies.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["python", "server.py"]
