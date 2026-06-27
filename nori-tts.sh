#!/bin/bash
# nori-tts 一键启停脚本（本机执行）
# 服务: GPT-SoVITS (nori-tts) 流式合成服务
# 服务器: 10.0.1.92 (NVIDIA GB10 128GB)
# 端口: 8091 | 虚拟环境: gsv-tts | 工作目录: /data/nori-tts

set -euo pipefail

# ── 配置 ──────────────────────────────────────────────
SERVICE_DIR="/data/nori-tts"
CONDA_ENV="gsv-tts"
CONDA_PATH="/home/skyzhishui/miniconda3"
SERVICE_PORT=8091
LOG_FILE="${SERVICE_DIR}/server.log"

# ── 获取 python 进程 PID（通过端口监听）──────────────
get_pid() {
    ss -tlnp 2>/dev/null | grep ":${SERVICE_PORT} " | grep -oP 'pid=\K[0-9]+' | head -1
}

# ── 检查服务是否存活 ────────────────────────────────────
is_alive() {
    [[ -n "$(get_pid)" ]]
}

# ── conda 环境激活 ────────────────────────────────────
conda_activate() {
    # shellcheck disable=SC1090
    source "${CONDA_PATH}/etc/profile.d/conda.sh"
    conda activate "${CONDA_ENV}"
}

# ── 启动服务 ────────────────────────────────────────────
do_start() {
    if is_alive; then
        printf "\033[0;33m⚠ 服务已在运行 (PID: %s)\033[0m\n" "$(get_pid)"
        return 0
    fi

    printf "\033[0;32m▶ 启动 nori-tts 服务...\033[0m\n"
    cd "${SERVICE_DIR}"
    conda_activate

    nohup python tts_server.py \
        --host 0.0.0.0 \
        --port "${SERVICE_PORT}" \
        > "${LOG_FILE}" 2>&1 &

    local pid=$!
    echo "  进程已提交: PID=${pid}"

    # 等待端口就绪
    local elapsed=0
    printf "  等待端口 %s 就绪" "${SERVICE_PORT}"
    while [[ ${elapsed} -lt 120 ]]; do
        if ss -tlnp 2>/dev/null | grep -q ":${SERVICE_PORT} "; then
            printf " ✓ (%ds)\n" "${elapsed}"
            printf "\033[0;32m✓ nori-tts 服务启动成功\033[0m\n"
            do_status
            return 0
        fi
        printf "."
        sleep 2
        elapsed=$((elapsed + 2))
    done
    printf " ✗ 超时\n"
    printf "\033[0;31m✗ 启动超时，请检查日志: %s\033[0m\n" "${LOG_FILE}"
    return 1
}

# ── 停止服务 ────────────────────────────────────────────
do_stop() {
    if ! is_alive; then
        printf "\033[0;33m⚠ 服务未运行\033[0m\n"
        return 0
    fi

    local pid
    pid=$(get_pid)
    printf "\033[0;31m■ 停止 nori-tts 服务 (PID: %s)...\033[0m\n" "${pid}"
    kill "${pid}" 2>/dev/null || true

    # 等待进程退出
    local waited=0
    while [[ ${waited} -lt 30 ]]; do
        if ! is_alive; then
            printf "\033[0;32m✓ 服务已停止\033[0m\n"
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done

    # 强制终止
    echo "  正常终止超时，发送 SIGKILL..."
    kill -9 "${pid}" 2>/dev/null || true
    sleep 2
    printf "\033[0;32m✓ 服务已强制停止\033[0m\n"
}

# ── 重启服务 ────────────────────────────────────────────
do_restart() {
    do_stop
    sleep 2
    do_start
}

# ── 查看状态 ────────────────────────────────────────────
do_status() {
    echo "┌─────────────────────────────────────────┐"
    echo "│  nori-tts 服务状态                       │"
    echo "├─────────────────────────────────────────┤"

    if is_alive; then
        printf "│  进程:  \033[0;32m运行中\033[0m (PID: %s)\n" "$(get_pid)"
    else
        printf "│  进程:  \033[0;31m未运行\033[0m\n"
    fi

    # 检查端口
    if ss -tlnp 2>/dev/null | grep -q ":${SERVICE_PORT} "; then
        printf "│  端口:  %s \033[0;32m✓\033[0m (监听中)\n" "${SERVICE_PORT}"
    else
        printf "│  端口:  %s \033[0;31m✗\033[0m (未监听)\n" "${SERVICE_PORT}"
    fi

    # 健康检查
    if curl -sf "http://localhost:${SERVICE_PORT}/health" >/dev/null 2>&1; then
        printf "│  健康:  \033[0;32m✓\033[0m\n"
    else
        printf "│  健康:  \033[0;31m✗\033[0m\n"
    fi

    echo "│  目录:  ${SERVICE_DIR}"
    echo "│  日志:  ${LOG_FILE}"
    echo "└─────────────────────────────────────────┘"
}

# ── 查看日志 ────────────────────────────────────────────
do_logs() {
    local lines=${1:-50}
    tail -n "${lines}" "${LOG_FILE}"
}

# ── 跟踪日志 ────────────────────────────────────────────
do_tailf() {
    echo "跟踪日志 (Ctrl+C 退出)..."
    tail -f "${LOG_FILE}"
}

# ── 帮助 ────────────────────────────────────────────────
do_help() {
    cat <<EOF
nori-tts 一键启停脚本

用法: $(basename "$0") <命令> [参数]

命令:
  start    启动服务
  stop     停止服务
  restart  重启服务
  status   查看服务状态
  logs     查看最近日志 (默认50行，可传行数)
  tailf    实时跟踪日志
  help     显示此帮助

示例:
  $(basename "$0") start
  $(basename "$0") logs 100
  $(basename "$0") tailf
EOF
}

# ── 入口 ────────────────────────────────────────────────
case "${1:-help}" in
    start)   do_start ;;
    stop)    do_stop ;;
    restart) do_restart ;;
    status)  do_status ;;
    logs)    do_logs "${2:-50}" ;;
    tailf)   do_tailf ;;
    help|*)  do_help ;;
esac
