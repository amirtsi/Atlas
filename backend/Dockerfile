FROM python:3.13-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY app ./app

# tzdata backs zoneinfo (the Asia/Jerusalem daily-brief scheduler) on slim images.
# The [mcp] extra bakes in the Hermes seam so `python -m app.mcp_server` works
# inside the container (spawned over `docker exec` by an external MCP client).
RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir ".[mcp]" tzdata

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import sys, urllib.request as u; sys.exit(0 if u.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
