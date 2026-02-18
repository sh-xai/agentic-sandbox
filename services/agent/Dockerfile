# ABOUTME: Container image for the LangChain agent.
# ABOUTME: Python 3.12 slim base with LangChain and OTel dependencies.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "agent.py"]
