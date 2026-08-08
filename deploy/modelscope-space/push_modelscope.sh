#!/usr/bin/env bash
# 推送魔塔创空间（full + lite）部署脚本
# 读取 .env.modelscope 中的 MODELSCOPE_ACCESS_TOKEN，不打印完整 token
# 用法：bash deploy/modelscope-space/push_modelscope.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.modelscope"
BUNDLE_FULL="$REPO_ROOT/work/generated/modelscope-space-bundle"
BUNDLE_LITE="$REPO_ROOT/work/generated/modelscope-space-lite-push"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "错误：缺少环境文件 $ENV_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${MODELSCOPE_ACCESS_TOKEN:-}" ]]; then
  echo "错误：.env.modelscope 中 MODELSCOPE_ACCESS_TOKEN 为空，请先在 https://modelscope.cn/my/myaccesstoken 生成并填入" >&2
  exit 1
fi

push_space() {
  local bundle="$1"
  local space="$2"
  echo "==> 推送 $space"
  cd "$bundle"
  env -u GIT_ASKPASS -u SSH_ASKPASS GIT_TERMINAL_PROMPT=0 \
    git push "https://oauth2:${MODELSCOPE_ACCESS_TOKEN}@www.modelscope.cn/studios/${space}.git" HEAD:master
  echo "==> $space 推送成功"
}

push_space "$BUNDLE_FULL" "scottwyc/sign-language-universe"
push_space "$BUNDLE_LITE" "scottwyc/sign-language-universe-lite"
echo "全部推送完成"
