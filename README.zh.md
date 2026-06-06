# Yeelight CLI

这是一个基于 Bun + TypeScript 的轻量级项目，用于在局域网中发现并控制 Yeelight 灯具。

仓库同时提供可复用的 **TypeScript 库**，构建输出位于 `dist/`，便于后续二次开发。

## 开始前

**先在 Yeelight 手机 App 中开启该灯的 LAN control。** 如果没有开启，发现和控制都会失败。

## 环境要求

- Bun 1.3+
- 与 Yeelight 灯具处于同一局域网

## 使用方式

直接通过 Bun 运行：

```bash
bun run start -- <command> [options]
```

或者使用 Bun 全局链接后运行：

```bash
bun link
yeelight <command> [options]
```

构建 TypeScript 库：

```bash
bun install
bun run build
```

## 命令

```text
discover                 在局域网中发现灯具
status                   通过 get_prop 读取实时状态（必须指定设备）
on                       开灯（必须指定设备）
off                      关灯（必须指定设备）
bright <1-100>           设置绝对亮度（必须指定设备）
ct <1700-6500>           设置色温（必须指定设备）
rgb <hex|r g b>          设置 RGB 颜色（必须指定设备）
exec <method> [params]   直接执行 Yeelight 原始命令并打印响应（必须指定设备）
probe                    列出目标设备公布的 Yeelight 支持方法（必须指定设备）
help                     显示帮助
```

## 通用选项

```text
除 `discover` 和 `help` 外，其余命令都必须且只能使用一个设备选择器：`--id`、`--name` 或 `--host`。

--id <deviceId>          通过设备 id 选择已发现的灯
--name <label>           通过解码后的设备名选择已发现的灯
--host <ip[:port]>       通过 IP 直连灯具，可选附带端口
--timeout <ms>           覆盖发现或命令超时时间
--refresh                忽略缓存，强制重新发现
--json                   输出 JSON
--params <json-array>    给 exec 命令提供 JSON 数组参数
--effect <sudden|smooth> 写命令时使用的过渡效果
--duration <ms>          写命令时使用的过渡时长
```

## 示例

```bash
bun run start -- discover
bun run start -- status --id 0x0000000012345678
bun run start -- on --id 0x0000000012345678
bun run start -- bright 40 --name Bedroom
bun run start -- ct 3500 --host 192.168.1.23:55443 --effect smooth --duration 500
bun run start -- rgb ff0000 --id 0x0000000012345678
bun run start -- rgb 255 0 0 --name Bedroom --effect smooth --duration 500
bun run start -- exec toggle --id 0x0000000012345678
bun run start -- exec set_power on smooth 500 --host 192.168.1.23:55443
bun run start -- exec start_cf 0 0 "1500,1,6553855,500,1500,1,16711935,500" --id 0x0000000012345678
bun run start -- exec set_scene --params "[\"color\",65280,70]" --id 0x0000000012345678
bun run start -- probe --name Bedroom
```

## Yeelight 协议参考文档

仓库根目录中还提供两份从规范 PDF 提炼出来的参考文档：

- `Yeelight.md` - 英文版方法表和详细说明
- `Yeelight.zh.md` - 中文版方法表和详细说明

这两份文档都只基于 `Yeelight_Inter-Operation_Spec.pdf` 提取整理，没有使用外部网页资料。

## TypeScript 库

项目源码以 TypeScript 为主。可复用库位于 `src/library/`，Bun CLI 位于 `src/cli.ts`，构建产物输出到 `dist/`。

```ts
import { YeelightClient, buildFlowExpression, discoverDevices } from "yeelight-cli";

const devices = await discoverDevices({ timeoutMs: 5000 });
const client = YeelightClient.fromDevice(devices[0]);

await client.setPower("on", { effect: "smooth", duration: 300 });
await client.setRgb(0xff6600, { effect: "smooth", duration: 500 });

const sceneFlow = buildFlowExpression([
  { duration: 1000, mode: 2, value: 2700, brightness: 100 },
  { duration: 1000, mode: 1, value: 0xff0000, brightness: 20 }
]);

await client.startColorFlow(0, 1, sceneFlow);
```

TypeScript 库当前封装了规范中的这些能力：

- 发现协议解析，以及按活动 IPv4 网卡逐个绑定的组播发现
- 通过 `YeelightClient.sendCommand(...)` 发送类型化命令
- 主灯 / 背景光 / scene / color flow / cron / adjust / name / music mode 的辅助方法

当前这份 PDF **没有** 给出 `udp_sess_new`、`udp_sess_keep_alive`、`udp_chroma_sess_new` 的参数结构，因此库中仍把它们暴露为原始 `unknown[]` 参数方法。

## 说明

- 发现结果会缓存到 `~/.yeelight-cli-cache.json`，便于后续命令快速执行。
- 发现逻辑会在每个活动 IPv4 网卡上绑定组播 socket，并同时监听搜索响应和 Yeelight 的 `NOTIFY` 广播，这一点参考了可工作的 demo。
- CLI 会根据灯具在 `support` 头里声明的方法来限制受支持的命令。
- `status` 会实时调用 `get_prop`，不会依赖可能已经过期的发现结果。
- 测试通过 `bun test` 运行。
