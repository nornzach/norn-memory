# Build from the repository root so the image runs this repo's SDK, not the PyPI release:
#   docker build -t mem0-api-server -f server/Dockerfile .
FROM python:3.12-slim

WORKDIR /sdk
COPY pyproject.toml README.md ./
COPY mem0 ./mem0
RUN pip install --no-cache-dir .

WORKDIR /app
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server .

EXPOSE 8000

ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
