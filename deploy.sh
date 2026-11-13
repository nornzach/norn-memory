#!/bin/bash

echo "================================================"
echo "🚀 Norn-M 一键部署脚本"
echo "================================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查Docker
echo "检查Docker..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker未安装${NC}"
    echo "请先安装Docker: https://docs.docker.com/get-docker/"
    exit 1
fi
echo -e "${GREEN}✅ Docker已安装${NC}"

# 检查docker-compose
echo "检查Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}⚠️  docker-compose未安装，尝试使用 docker compose${NC}"
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
    echo -e "${GREEN}✅ Docker Compose已安装${NC}"
fi

echo ""

# 检查.env文件
echo "检查环境配置..."
if [ ! -f "server/.env" ]; then
    echo -e "${YELLOW}⚠️  .env文件不存在，创建模板...${NC}"
    cat > server/.env <<EOF
# 数据库配置
NORN_M_DATABASE_URL=postgresql://norn:norn@db:5432/norn_m

# 密钥（请替换为随机生成的密钥）
NORN_M_SECRET_KEY=$(openssl rand -hex 32)

# LLM配置
NORN_M_LLM_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key-here

# 向量存储
NORN_M_VECTOR_STORE=pgvector
EOF
    chmod 600 server/.env
    echo -e "${GREEN}✅ 已创建 server/.env 模板${NC}"
    echo -e "${YELLOW}⚠️  请编辑 server/.env 并填入你的API密钥${NC}"
    echo ""
    read -p "是否现在编辑.env文件? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} server/.env
    fi
else
    echo -e "${GREEN}✅ .env文件已存在${NC}"
fi

echo ""

# 运行部署验证
echo "运行部署验证..."
python3 verify_deployment.py
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 部署验证失败${NC}"
    exit 1
fi

echo ""
echo "================================================"
echo "开始部署..."
echo "================================================"
echo ""

# 停止现有容器
echo "停止现有容器..."
$DOCKER_COMPOSE -f docker-compose.production.yml down

# 构建镜像
echo ""
echo "构建Docker镜像..."
$DOCKER_COMPOSE -f docker-compose.production.yml build

# 启动服务
echo ""
echo "启动服务..."
$DOCKER_COMPOSE -f docker-compose.production.yml up -d

# 等待服务启动
echo ""
echo "等待服务启动..."
sleep 5

# 检查服务状态
echo ""
echo "检查服务状态..."
$DOCKER_COMPOSE -f docker-compose.production.yml ps

# 检查健康状态
echo ""
echo "检查API健康状态..."
for i in {1..10}; do
    if curl -s http://localhost:8000/health > /dev/null; then
        echo -e "${GREEN}✅ API服务已就绪！${NC}"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${RED}❌ API服务启动超时${NC}"
        echo "查看日志:"
        $DOCKER_COMPOSE -f docker-compose.production.yml logs norn-m-api
        exit 1
    fi
    echo "等待... ($i/10)"
    sleep 3
done

echo ""
echo "================================================"
echo "🎉 部署成功！"
echo "================================================"
echo ""
echo "服务地址:"
echo "  - API文档: http://localhost:8000/docs"
echo "  - API健康检查: http://localhost:8000/health"
echo "  - Dashboard: http://localhost:3000 (如果启用)"
echo ""
echo "常用命令:"
echo "  - 查看日志: $DOCKER_COMPOSE -f docker-compose.production.yml logs -f"
echo "  - 停止服务: $DOCKER_COMPOSE -f docker-compose.production.yml down"
echo "  - 重启服务: $DOCKER_COMPOSE -f docker-compose.production.yml restart"
echo ""
echo "安全提示:"
echo "  ⚠️  请确保已修改 server/.env 中的 OPENAI_API_KEY"
echo "  ⚠️  生产环境请使用HTTPS (配置Nginx反向代理)"
echo "  ⚠️  建议启用防火墙，只开放必要端口"
echo ""
