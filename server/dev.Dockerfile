FROM python:3.12

WORKDIR /app

# Install the SDK from this repo (editable, at /sdk) before the server requirements,
# so `mem0ai` is already satisfied and never fetched from PyPI.
# docker-compose.yaml mounts ../mem0 over /sdk/mem0, so SDK edits take effect without a rebuild.
WORKDIR /sdk
COPY pyproject.toml README.md ./
COPY mem0 ./mem0
RUN pip install -e .[graph]

WORKDIR /app
COPY server/requirements.txt .
RUN pip install -r requirements.txt

COPY server .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app", "--reload-dir", "/sdk/mem0"]
