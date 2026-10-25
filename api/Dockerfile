FROM python:3.13-slim

# uv instala las dependencias exactas de uv.lock
RUN pip install --no-cache-dir uv==0.13.0

WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

COPY app ./app

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
