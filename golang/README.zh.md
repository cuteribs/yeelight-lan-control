# Yeelight Go CLI

这是 Bun/TypeScript 版 Yeelight 局域网控制项目的 Go 版本，包含一个只依赖标准库的可复用包和一个命令行工具，用于发现灯具、读取状态并发送与 Node.js 和 Rust 版本相同的常用命令。

## 开始前

先在 Yeelight 手机 App 中开启该灯的 LAN control。否则发现和控制都会失败。

## 环境要求

- Go 1.25+
- 与 Yeelight 灯具位于同一局域网
- 不依赖任何第三方 Go 包

## 使用方式

直接运行 CLI：

```bash
go run . -- <command> [options]
```

构建 CLI：

```bash
go build
```

运行测试：

```bash
go test ./...
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
除 discover 和 help 外，其余命令都必须且只能使用一个设备选择器：--id、--name 或 --host。

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
go run . -- discover
go run . -- status --id 0x0000000012345678
go run . -- on --id 0x0000000012345678
go run . -- bright 40 --name Bedroom
go run . -- ct 3500 --host 192.168.1.23:55443 --effect smooth --duration 500
go run . -- rgb ff0000 --id 0x0000000012345678
go run . -- rgb 255 0 0 --name Bedroom --effect smooth --duration 500
go run . -- exec toggle --id 0x0000000012345678
go run . -- exec set_power on smooth 500 --host 192.168.1.23:55443
go run . -- exec set_scene --params "[\"color\",65280,70]" --id 0x0000000012345678
go run . -- probe --name Bedroom
```

## Go 包

```go
import yeelight "yeelight-cli-go/yeelight"

devices, err := yeelight.DiscoverDevices(yeelight.DiscoveryOptions{TimeoutMS: 5000})
if err != nil {
    return err
}

client := yeelight.NewClientFromDevice(devices[0], 5000)

_, err = client.SetPower("on", yeelight.TransitionOptions{
    TimeoutMS: 5000,
    Duration:  300,
    Effect:    "smooth",
})
if err != nil {
    return err
}

_, err = client.SetRGB(0xff6600, yeelight.TransitionOptions{
    TimeoutMS: 5000,
    Duration:  500,
    Effect:    "smooth",
})
if err != nil {
    return err
}
```

这个包目前包含：

- 使用标准库实现的发现协议解析和按网卡发送的多播搜索
- 一个 TCP Yeelight 客户端，覆盖与其他版本一致的主灯和背景光命令族
- flow expression、scene 序列化、RGB 校验和状态归一化等协议辅助函数

## 说明

- 发现结果会缓存到 `~/.yeelight-cli-cache.json`。
- 发现逻辑会从每个活动 IPv4 网卡发送组播搜索，并在绑定的 UDP socket 上接收直接响应。
- `status` 会实时调用 `get_prop`，不会依赖过期的发现结果。
- 整个 Go 版本只使用标准库。
