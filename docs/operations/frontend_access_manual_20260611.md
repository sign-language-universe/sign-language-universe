# 前端访问操作手册

本文说明如何访问当前仓库中的团队前端页面。

当前前端位置：

```text
/data/WYC/sign-language-universe/apps/web
```

模块类型：

```text
原生 HTML/CSS/JavaScript 静态前端
```

因此不需要 `npm install`，也不需要 Vite、Next.js 或 Node.js dev server。使用 Python 自带的静态 HTTP server 即可。

## 1. 前置条件

确认已经进入主仓库：

```bash
cd /data/WYC/sign-language-universe
```

确认前端入口存在：

```bash
test -f apps/web/index.html && echo "frontend entry exists"
```

确认 Python 可用：

```bash
python --version
```

如果系统里 `python` 不存在，可以尝试：

```bash
python3 --version
```

## 2. 推荐访问方式：本机启动静态服务

进入前端目录：

```bash
cd /data/WYC/sign-language-universe/apps/web
```

启动静态服务：

```bash
python -m http.server 5173 --bind 127.0.0.1
```

如果系统使用 `python3`：

```bash
python3 -m http.server 5173 --bind 127.0.0.1
```

浏览器打开：

```text
http://127.0.0.1:5173/
```

看到 `手语小宇宙 / Sign Language Universe` 启动页，就说明前端已经正常访问。

## 3. 在服务器上后台运行

如果希望服务持续运行，不想占用当前终端，推荐用 `tmux`。

创建会话：

```bash
tmux new -s slu-web
```

在 tmux 会话里运行：

```bash
cd /data/WYC/sign-language-universe/apps/web
python -m http.server 5173 --bind 127.0.0.1
```

保持服务运行并退出 tmux 窗口：

```text
Ctrl-b 然后按 d
```

重新进入：

```bash
tmux attach -t slu-web
```

停止服务：

```text
Ctrl-C
```

关闭 tmux 会话：

```bash
tmux kill-session -t slu-web
```

## 4. 从自己电脑访问服务器上的前端

如果前端服务运行在服务器上，而浏览器在你自己的电脑上，推荐使用 SSH 端口转发。

在你自己的电脑终端运行：

```bash
ssh -L 5173:127.0.0.1:5173 <你的服务器用户名>@<服务器地址>
```

保持这个 SSH 窗口不要关闭。

然后在自己电脑浏览器打开：

```text
http://127.0.0.1:5173/
```

这时访问的是服务器里的：

```text
/data/WYC/sign-language-universe/apps/web
```

这种方式不需要把服务器 `5173` 端口公开到外网，更适合私有开发。

## 5. 局域网或服务器 IP 访问

如果确定当前网络环境安全，也可以让服务监听服务器所有网卡：

```bash
cd /data/WYC/sign-language-universe/apps/web
python -m http.server 5173 --bind 0.0.0.0
```

然后在同一网络中的浏览器打开：

```text
http://<服务器IP>:5173/
```

当前机器可先用以下命令查看 IP：

```bash
hostname -I
```

注意：

- 只有在服务器防火墙、安全组或校园/公司网络允许访问 `5173` 端口时，这种方式才可用。
- 不建议长期把开发预览端口暴露到公网。
- 如果只是自己访问，优先使用 SSH 端口转发。

## 6. 验证服务是否启动成功

在服务器上运行：

```bash
curl -I http://127.0.0.1:5173/
```

正常应看到类似：

```text
HTTP/1.0 200 OK
Content-type: text/html
```

也可以检查端口：

```bash
ss -ltnp | grep 5173
```

## 7. 当前可访问的页面和资源

主入口：

```text
http://127.0.0.1:5173/
```

3D 资源查看页示例：

```text
http://127.0.0.1:5173/assets/3d/banana_viewer.html
http://127.0.0.1:5173/assets/3d/flower_viewer.html
http://127.0.0.1:5173/assets/3d/runner_viewer.html
http://127.0.0.1:5173/assets/3d/steering_wheel_viewer.html
```

当前前端包含：

- 启动页
- 学习宇宙入口
- 个人空间入口
- 星系/星球选择
- 词汇学习卡片
- 词汇检索
- 测评页面
- 个人空间站

## 8. 常见问题

### 8.1 端口被占用

如果启动时报错 `Address already in use`，说明 `5173` 已经被占用。

查看占用：

```bash
ss -ltnp | grep 5173
```

换一个端口：

```bash
python -m http.server 5174 --bind 127.0.0.1
```

浏览器打开：

```text
http://127.0.0.1:5174/
```

### 8.2 页面能打开但资源加载失败

优先确认你是通过 HTTP 服务访问，而不是直接双击打开 `index.html`。

推荐：

```text
http://127.0.0.1:5173/
```

不推荐：

```text
file:///data/WYC/sign-language-universe/apps/web/index.html
```

原因是部分浏览器对本地文件加载脚本、模型或跨文件资源有限制。

### 8.3 服务器 IP 打不开

可能原因：

- 静态服务只绑定了 `127.0.0.1`。
- 服务器防火墙没有开放 `5173`。
- 云服务器安全组没有开放 `5173`。
- 你和服务器不在可互通网络中。

解决办法：

```text
优先使用 SSH 端口转发
```

也就是：

```bash
ssh -L 5173:127.0.0.1:5173 <你的服务器用户名>@<服务器地址>
```

### 8.4 修改代码后页面没变化

尝试：

```text
浏览器强制刷新：Ctrl+F5
```

或者关闭旧服务后重新启动：

```text
Ctrl-C
python -m http.server 5173 --bind 127.0.0.1
```

### 8.5 团队成员拿不到最新前端

团队成员先更新代码：

```bash
cd /data/WYC/sign-language-universe
git pull
```

然后重新启动前端服务：

```bash
cd apps/web
python -m http.server 5173 --bind 127.0.0.1
```

## 9. 与评分 API 的关系

当前 `apps/web` 是静态前端 demo，页面里已经预留动作检测和评分接入点，但还没有把浏览器端交互完整接到 `services/scoring-api`。

如果只想查看已有前端页面：

```text
只启动 apps/web 即可
```

如果后续要联调评分 API，需要另外启动：

```text
services/scoring-api
```

评分 API 的启动方式见仓库根目录 `README.md`。
