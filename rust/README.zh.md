# Yeelight Rust CLI

这是 Bun/TypeScript 版 Yeelight 局域网控制项目的 Rust 版本，包含可复用库和一个命令行工具，用于发现灯具、读取状态并发送与 Node.js 版本相同的常用命令。

## 开始前

先在 Yeelight 手机 App 中开启该灯的 LAN control。否则发现和控制都会失败。

## 环境要求

- Rust 1.92+
- 与 Yeelight 灯具位于同一局域网

## 使用方式

直接通过 Cargo 运行 CLI：

```bash
cargo run -- <command> [options]
```

构建库和二进制：

```bash
cargo build
```

运行测试：

```bash
cargo test
```

本地安装 CLI：

```bash
cargo install --path .
yeelight <command> [options]
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
cargo run -- discover
cargo run -- status --id 0x0000000012345678
cargo run -- on --id 0x0000000012345678
cargo run -- bright 40 --name Bedroom
cargo run -- ct 3500 --host 192.168.1.23:55443 --effect smooth --duration 500
cargo run -- rgb ff0000 --id 0x0000000012345678
cargo run -- rgb 255 0 0 --name Bedroom --effect smooth --duration 500
cargo run -- exec toggle --id 0x0000000012345678
cargo run -- exec set_power on smooth 500 --host 192.168.1.23:55443
cargo run -- exec set_scene --params "[\"color\",65280,70]" --id 0x0000000012345678
cargo run -- probe --name Bedroom
```

## Rust 库

```rust
use yeelight_cli::{
    FlowExpression, YeelightClient, YeelightDiscoveryOptions, YeelightFlowTuple,
    YeelightTransitionOptions, discover_devices,
};

let devices = discover_devices(YeelightDiscoveryOptions {
    timeout_ms: Some(5_000),
})?;
let client = YeelightClient::from_device(devices[0].clone(), Some(5_000));

client.set_power(
    "on",
    YeelightTransitionOptions {
        effect: Some("smooth".to_owned()),
        duration: Some(300),
        timeout_ms: Some(5_000),
    },
)?;

client.set_rgb(
    0xff6600,
    YeelightTransitionOptions {
        effect: Some("smooth".to_owned()),
        duration: Some(500),
        timeout_ms: Some(5_000),
    },
)?;

client.start_color_flow(
    0,
    1,
    FlowExpression::Tuples(vec![
        YeelightFlowTuple { duration: 1000, mode: 2, value: 2700, brightness: 100 },
        YeelightFlowTuple { duration: 1000, mode: 1, value: 0xff0000, brightness: 20 },
    ]),
    None,
)?;
```

Rust 库目前包含：

- 发现协议解析，以及按活动 IPv4 网卡逐个绑定的组播发现
- 一个 TCP Yeelight 客户端，封装了与 Node.js 版本对应的主灯和背景光常用命令
- flow expression、scene 序列化、RGB 校验和状态归一化等协议辅助函数

## 说明

- 发现结果会缓存到 `~/.yeelight-cli-cache.json`。
- 发现逻辑会在每个活动 IPv4 网卡上绑定组播 socket，并在网络允许时同时接收搜索响应和组播通知。
- `status` 会实时调用 `get_prop`，不会依赖过期的发现结果。
- 测试通过 `cargo test` 运行。
