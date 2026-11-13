#!/bin/bash
set -e

echo "=========================================="
echo "Norn-M Production Startup"
echo "=========================================="

# 等待数据库就绪
echo "Waiting for database..."
until PGPASSWORD=$POSTGRES_PASSWORD psql -h "db" -U "norn" -d "norn_m" -c '\q' 2>/dev/null; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "Database is up!"

# 运行数据库迁移
echo "Running database migrations..."
cd /app/server
alembic upgrade head || {
    echo "⚠️  Migration failed, continuing anyway..."
}

# 启用安全中间件（如果需要）
echo "Checking security configuration..."
if grep -q "SecurityHeadersMiddleware" main.py; then
    echo "✅ Security middleware is configured"
else
    echo "⚠️  Security middleware not found in main.py"
    echo "Consider adding: app.add_middleware(SecurityHeadersMiddleware)"
fi

echo "=========================================="
echo "Starting Norn-M API Server..."
echo "=========================================="

# 执行传入的命令
exec "$@"
