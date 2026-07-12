#!/bin/bash

# GEDO.AI Ollama 模型部署脚本
# 用于下载和配置本地 LLM 和嵌入模型

set -e

echo "🚀 GEDO.AI Ollama 模型部署"
echo "=========================="

# 检查 Ollama 是否安装
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama 未安装"
    echo ""
    echo "请先安装 Ollama:"
    echo "  macOS: brew install ollama"
    echo "  Linux: curl -fsSL https://ollama.com/install.sh | sh"
    echo "  官网: https://ollama.com/"
    exit 1
fi

echo "✅ Ollama 已安装"
echo ""

# 检查 Ollama 服务是否运行
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "🔄 启动 Ollama 服务..."
    ollama serve &
    sleep 3
fi

echo "✅ Ollama 服务运行中"
echo ""

# 下载 LLM 模型
echo "📥 下载 Qwen2.5 7B 模型（约 4.4GB）..."
echo "   用于：目标澄清、SMART 拆解、调整建议"
ollama pull qwen2.5:7b-instruct

echo ""
echo "✅ Qwen2.5 7B 下载完成"

# 下载嵌入模型
echo ""
echo "📥 下载 BGE-M3 嵌入模型（约 2.2GB）..."
echo "   用于：记忆向量化、语义检索"
ollama pull bge-m3

echo ""
echo "✅ BGE-M3 下载完成"

# 验证模型
echo ""
echo "🔍 验证已安装模型..."
ollama list

echo ""
echo "=========================="
echo "🎉 所有模型部署完成！"
echo ""
echo "环境变量配置（添加到 .env）:"
echo "  LLM_PROVIDER=ollama"
echo "  OLLAMA_HOST=http://localhost:11434"
echo "  OLLAMA_MODEL=qwen2.5:7b-instruct"
echo "  EMBEDDING_MODEL=bge-m3"
echo ""
echo "测试命令:"
echo "  ollama run qwen2.5:7b-instruct '你好'"
echo ""

















