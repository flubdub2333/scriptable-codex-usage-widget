# iPhone Codex 用量小组件

使用 Scriptable 在 iPhone 桌面查看 Codex 额度：短期窗口（常见为五小时）和每周窗口的剩余百分比、重置时间及最近更新时间。取数、凭证和缓存均在 iPhone 上处理，不需要电脑常驻或自建服务器。

本项目显示的是 **Codex 用量**，不是 ChatGPT 所有聊天模型的统一额度，也不显示剩余消息条数。窗口时长及额度以服务端返回为准，账号或套餐不同可能不同。

## 三种样式

| 样式 | 脚本 | 显示方式 |
| --- | --- | --- |
| 进度条 | [Codex Usage.js](scriptable-codex-usage/Codex%20Usage.js) | 两条进度条、百分比、重置时间和相对时间；支持中号及紧凑小号 |
| 并排双环 | [Codex Rings Duo.js](scriptable-codex-rings/dist/Codex%20Rings%20Duo.js) | 两个并排圆环及各自重置时间；使用中号 |
| 双同心环 | [Codex Rings Orbit.js](scriptable-codex-rings/dist/Codex%20Rings%20Orbit.js) | 同心圆环、两组百分比及重置时间；使用中号 |

圆环和进度条表示**剩余比例**。灰色轨道表示总量，青色为短期窗口，蓝色为每周窗口。实际无数据或窗口已到期且未获取到新数据时，显示 `—` 或待刷新，不会自行推算成 100%。

## 准备

1. 在 iPhone 安装 [Scriptable](https://scriptable.app/)，并准备能够登录 ChatGPT、使用 Codex 的账号。
2. 在 iPhone 上打开本仓库，选择上表中的脚本文件。打开文件的原始文本（GitHub 的 **Raw**），复制全部内容。
3. 在 Scriptable 点击右上角 `+`，粘贴完整代码并分别命名为 `Codex Usage`、`Codex Rings Duo` 或 `Codex Rings Orbit`。需要哪种样式就添加哪一个；三个脚本都可单独运行。

## 登录与首次取数

首次在 Scriptable 中运行任一脚本。三个版本共用同一份 Scriptable Keychain 凭证和本地缓存，不必为每个组件重复登录。

### 方法一：网页登录

1. 选择 **网页登录 / 重新登录**，在官方页面自行完成登录和验证。
2. 确认账号后关闭网页窗口，脚本会尝试读取该网页的会话并请求用量。
3. 只有请求验证成功后，脚本才会保存凭证并显示预览。

内嵌网页可能跳到聊天页或无法取得会话；如果提示“未取得登录凭证”，使用下面的手动导入方式。Safari 或 ChatGPT App 已登录，并不保证 Scriptable 的内嵌网页自动登录。

### 方法二：在 iPhone 手动导入

1. 在 iPhone 的 Safari 打开 [chatgpt.com](https://chatgpt.com/) 并登录目标账号。
2. 在同一 Safari 会话打开 [会话页面](https://chatgpt.com/api/auth/session)。页面包含敏感登录信息，**不要截图、分享、提交到 GitHub，或发给任何人**。
3. 复制页面的完整 JSON，或仅复制其中 `accessToken` 的值。这里使用的是网页会话凭证，不是 OpenAI API Key。
4. 回到 Scriptable，运行脚本并选择 **手动导入登录凭证**，将内容粘贴到安全输入框。`Account ID` 通常留空；有多个工作区且无法识别时才填写对应账户 ID。
5. 点击 **验证并保存到 Keychain**。验证通过后查看小组件预览；复制一段无关文字可覆盖剪贴板中的凭证。

凭证可能过期；如果再次提示登录失效，请重新执行导入。不要将凭证写入脚本或通过第三方服务中转。

## 添加到 iPhone 桌面

1. 长按桌面空白处，点击添加小组件，搜索 **Scriptable**，选择中号并添加。
2. 长按新组件，选择 **编辑小组件**；在 `Script` 中选择相应脚本。需要三个样式时分别添加三个 Scriptable 小组件。
3. 如果有 `When Interacting` 选项，选择 `Run Script`；`Parameter` 留空。退出编辑并等待系统刷新。
4. 在 Scriptable 脚本列表中直接运行脚本，可选择刷新并预览；点击桌面组件会打开 Scriptable 并请求更新缓存，不弹配置菜单。iOS 控制桌面组件何时重绘，点击后不保证立即更新。

## 刷新、错误和数据安全

- 脚本向 iOS 请求约 15 分钟后刷新，但系统决定实际执行时机。数据以显示的更新时间为准。
- 请求失败时可显示最后一次成功的本地缓存和错误状态；超过 30 分钟标为过期。重置时间已过而没有取得新数据时，不会假定额度已经恢复。
- 重置时间使用 iPhone 本地时区。进度条版的相对时间在旧的桌面快照到期后可能继续变化；请以绝对重置时间及更新时间为准，并等待系统重新运行脚本。
- 凭证保存在 Scriptable Keychain；本地缓存仅保存套餐、规范化剩余比例、窗口时长、重置时间、获取时间及随机缓存标识。脚本不保存密码或原始用量响应。
- 用量请求发送到 `chatgpt.com` 的网页内部接口；该接口与网页会话格式并非稳定的第三方公开接口，可能随时变更或被拦截。遇到 401、403、网络错误或验证码时，先检查登录和网络，再尝试重新导入；不要将凭证发给他人排查。

## 开发与验证

进度条版是独立脚本；两种圆环版由共享渲染器与进度条版的认证、请求和缓存逻辑构建为独立脚本。修改圆环源码后，重新生成文件：

```sh
node scriptable-codex-rings/build.cjs
node --test scriptable-codex-usage/tests/*.test.cjs scriptable-codex-rings/tests/*.test.cjs
git diff --check
```

测试使用合成数据，不访问真实账号。iPhone 的实际登录、网络和桌面排版仍需在对应设备上验证。
