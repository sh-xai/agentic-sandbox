# ABOUTME: Container image for the FastMCP tool server.
# ABOUTME: Python 3.12 slim base with FastMCP and OTel dependencies.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create the sandboxed workspace and seed it with sample files
RUN mkdir -p /workspace/docs /workspace/data && \
    printf 'Welcome to the Agentic Sandbox workspace.\n\nThis directory is where the MCP tools operate.\nFeel free to create, read, modify, and delete files here.\n' > /workspace/README.txt && \
    printf 'name,role,department\nAlice,Engineer,Platform\nBob,Designer,Product\nCarol,Manager,Engineering\n' > /workspace/data/team.csv && \
    printf '# Project Notes\n\n- Set up observability pipeline\n- Define OPA policies for tool access\n- Test agent tool invocations\n' > /workspace/docs/notes.md

EXPOSE 8000

CMD ["python", "server.py"]
