# Yeelight LAN 控制参考

本文根据 `Yeelight_Inter-Operation_Spec.pdf` 第 4.1-4.3 节整理，提炼出 Yeelight 局域网控制的命令表、方法说明、结果消息和通知属性表。

## 传输摘要

- 发现协议：向 `239.255.255.250:1982` 发送 UDP 组播，`ST: wifi_bulb`
- 控制通道：TCP，通常为 `55443`
- 命令格式：以 `\r\n` 结尾的 JSON 行
- 响应格式：包含 `result` 或 `error` 的 JSON 行
- 通知格式：`{"method":"props","params":{...}}`
- 规范中的限制：
    - 最多 4 条并发 TCP 连接
    - 每条连接每分钟最多 60 条命令
    - 全部 LAN 命令总额每分钟最多 144 条

## COMMAND 消息格式

```json
{"id":1,"method":"set_power","params":["on","smooth",500]}\r\n
```

- `id`：调用方填写的整数，设备会在响应中原样返回
- `method`：命令名，必须来自设备 `support` 头部公布的方法
- `params`：该方法对应的参数数组

## 通用参数规则

| 名称 | 取值 |
| --- | --- |
| `effect` | `"sudden"` 或 `"smooth"` |
| `duration` | 毫秒；渐变模式下最小 `30` |
| `power` | `"on"` 或 `"off"` |
| `mode`（`set_power` / `bg_set_power`） | `0` 普通开灯，`1` CT，`2` RGB，`3` HSV，`4` color flow，`5` night light |
| `percentage`（`adjust_*`） | `-100..100` |
| `action`（`set_adjust`） | `"increase"`、`"decrease"`、`"circle"` |
| `prop`（`set_adjust`） | `"bright"`、`"ct"`、`"color"` |

### Flow tuple 结构

`start_cf`、`bg_start_cf`、`set_scene` 的 `cf` 场景都使用以下 4 元组序列：

```text
[duration, mode, value, brightness]
```

- `duration`：毫秒，最小 `50`
- `mode`：
    - `1` 颜色模式
    - `2` 色温模式
    - `7` 睡眠模式
- `value`：
    - `mode=1` 时表示 RGB
    - `mode=2` 时表示色温
    - `mode=7` 时忽略
- `brightness`：
    - `-1` 或 `1..100`
    - `mode=7` 时忽略

## 方法表

| 方法 | 参数个数 | 参数说明 |
| --- | --- | --- |
| `get_prop` | `1..N` | 属性名列表 |
| `set_ct_abx` | `3` | `ct_value`, `effect`, `duration` |
| `set_rgb` | `3` | `rgb_value`, `effect`, `duration` |
| `set_hsv` | `4` | `hue`, `sat`, `effect`, `duration` |
| `set_bright` | `3` | `brightness`, `effect`, `duration` |
| `set_power` | `3..4` | `power`, `effect`, `duration`, 可选 `mode` |
| `toggle` | `0` | 无 |
| `set_default` | `0` | 无 |
| `start_cf` | `3` | `count`, `action`, `flow_expression` |
| `stop_cf` | `0` | 无 |
| `set_scene` | `3..4` | `class`, `val1`, `val2`, 可选 `val3` |
| `cron_add` | `2` | `type`, `value` |
| `cron_get` | `1` | `type` |
| `cron_del` | `1` | `type` |
| `set_adjust` | `2` | `action`, `prop` |
| `set_music` | `1..3` | `action`，可选 `host`，可选 `port` |
| `set_name` | `1` | `name` |
| `bg_set_rgb` | `3` | 与 `set_rgb` 相同，但作用于背景光 |
| `bg_set_hsv` | `4` | 与 `set_hsv` 相同，但作用于背景光 |
| `bg_set_ct_abx` | `3` | 与 `set_ct_abx` 相同，但作用于背景光 |
| `bg_start_cf` | `3` | 与 `start_cf` 相同，但作用于背景光 |
| `bg_stop_cf` | `0` | 无 |
| `bg_set_scene` | `3..4` | 与 `set_scene` 相同，但作用于背景光 |
| `bg_set_default` | `0` | 无 |
| `bg_set_power` | `3..4` | 与 `set_power` 相同，但作用于背景光 |
| `bg_set_bright` | `3` | 与 `set_bright` 相同，但作用于背景光 |
| `bg_set_adjust` | `2` | 与 `set_adjust` 相同，但作用于背景光 |
| `bg_toggle` | `0` | 切换背景光开关 |
| `dev_toggle` | `0` | 同时切换主灯和背景光 |
| `adjust_bright` | `2` | `percentage`, `duration` |
| `adjust_ct` | `2` | `percentage`, `duration` |
| `adjust_color` | `2` | `percentage`, `duration` |
| `bg_adjust_bright` | `2` | 与 `adjust_bright` 相同，但作用于背景光 |
| `bg_adjust_ct` | `2` | 与 `adjust_ct` 相同，但作用于背景光 |
| `bg_adjust_color` | `2` | 与 `adjust_color` 相同，但作用于背景光 |

## 详细方法说明

### `get_prop`

- 用途：读取一个或多个当前属性
- 参数：属性名列表
- 返回：与请求顺序一致的属性值数组
- 如果属性名无法识别，对应位置返回空字符串 `""`
- 备注：所有支持的属性都定义在表 4-2、第 4.3 节中。

示例：

```json
{"id":1,"method":"get_prop","params":["power","not_exist","bright"]}
{"id":1,"result":["on","","100"]}
```

### `set_ct_abx`

- 用途：设置色温
- `ct_value`：整数，范围 `1700..6500`
- `effect`：`sudden` 或 `smooth`
- `duration`：总过渡时长，单位毫秒
- 备注：只有在灯处于开启状态时才接受

示例：

```json
{"id":1,"method":"set_ct_abx","params":[3500,"smooth",500]}
```

### `set_rgb`

- 用途：设置 RGB 颜色
- `rgb_value`：整数，范围 `0..16777215`（`0x000000..0xFFFFFF`）
- `effect`、`duration`：与 `set_ct_abx` 相同
- 备注：只有在灯处于开启状态时才接受

示例：

```json
{"id":1,"method":"set_rgb","params":[255,"smooth",500]}
```

### `set_hsv`

- 用途：通过 hue / saturation 设置颜色
- `hue`：整数，范围 `0..359`
- `sat`：整数，范围 `0..100`
- `effect`、`duration`：与 `set_ct_abx` 相同
- 备注：只有在灯处于开启状态时才接受

示例：

```json
{"id":1,"method":"set_hsv","params":[255,45,"smooth",500]}
```

### `set_bright`

- 用途：设置亮度百分比
- `brightness`：整数，范围 `1..100`
- `effect`、`duration`：与 `set_ct_abx` 相同
- 备注：只有在灯处于开启状态时才接受

示例：

```json
{"id":1,"method":"set_bright","params":[50,"smooth",500]}
```

### `set_power`

- 用途：开灯或关灯
- `power`：`"on"` 或 `"off"`
- `effect`、`duration`：与 `set_ct_abx` 相同
- 可选 `mode`（开灯时使用）：
    - `0` 普通开灯
    - `1` 切到 CT 模式
    - `2` 切到 RGB 模式
    - `3` 切到 HSV 模式
    - `4` 切到 color flow 模式
    - `5` 切到 night light 模式（仅吸顶灯）
- 备注：无

示例：

```json
{"id":1,"method":"set_power","params":["on","smooth",500]}
```

### `toggle`

- 用途：切换主灯当前开关状态
- 参数：无
- 备注：定义这个方法，是因为有时用户只是想直接翻转当前状态，而并不知道当前状态到底是什么。

示例：

```json
{"id":1,"method":"toggle","params":[]}
```

### `set_default`

- 用途：把当前状态持久化为上电默认状态
- 参数：无
- 备注：例如，如果用户喜欢当前颜色（红色）和亮度（50%），并希望每次设备上电时都以这个状态作为默认初始状态，就可以用此方法做一次快照。只有在灯当前处于 `"on"` 状态时才接受。

示例：

```json
{"id":1,"method":"set_default","params":[]}
```

### `start_cf`

- 用途：启动 color flow 程序
- `count`：可见状态变化总次数，`0` 表示无限循环
- `action`：结束后的动作
    - `0` 恢复到 flow 之前的状态
    - `1` 停在结束时状态
    - `2` 结束后关灯
- `flow_expression`：逗号分隔的 flow tuple 序列
- 备注：每一次可见状态变化都由一个 4 元组 `[duration, mode, value, brightness]` 表示，而 flow expression 就是这些元组组成的序列。规范中的示例表示：1000ms 内渐变到 2700K 且亮度最大；500ms 内渐变为红色且亮度 10%；保持 5 秒；500ms 内渐变到 5000K 且亮度最小；完成 4 次变化后停止并关灯。   
    - `duration` 是渐变或睡眠时间，单位毫秒，最小 `50`；
    - `mode` 中 `1` 表示颜色、`2` 表示色温、`7` 表示睡眠；
    - `value` 在 `mode=1` 时是 RGB，在 `mode=2` 时是色温，在 `mode=7` 时忽略；
    - `brightness` 为 `-1` 或 `1..100`，在 `mode=7` 时忽略，而 `-1` 表示忽略亮度，仅应用颜色或色温变化。只有在灯当前处于 `"on"` 状态时才接受。

示例：

```json
{"id":1,"method":"start_cf","params":[4,2,"1000,2,2700,100,500,1,255,10,5000,7,0,0,500,2,5000,1"]}
```

### `stop_cf`

- 用途：停止当前 color flow
- 参数：无
- 备注：无

示例：

```json
{"id":1,"method":"stop_cf","params":[]}
```

### `set_scene`

- 用途：把灯直接切到指定状态；如果灯当前关闭，会先开灯再应用
- `class` 可取：
    - `color`
    - `hsv`
    - `ct`
    - `cf`
    - `auto_delay_off`
- `val1`、`val2`、`val3` 的含义取决于 `class`
- 备注：在 `"on"` 和 `"off"` 两种状态下都接受。以上示例中：第一个把颜色设置为 `65280` 且亮度 70%；第二个把颜色设置为 Hue `300`、Saturation `70` 且最大亮度；第三个把色温设置为 `5400K` 且亮度 100%；第四个启动一个由两个 flow tuple 组成的无限循环 color flow；第五个把灯打开到 50% 亮度，并在 5 分钟后关灯。

示例：

```json
{"id":1,"method":"set_scene","params":["color",65280,70]}
{"id":1,"method":"set_scene","params":["hsv",300,70,100]}
{"id":1,"method":"set_scene","params":["ct",5400,100]}
{"id":1,"method":"set_scene","params":["cf",0,0,"500,1,255,100,1000,1,16776960,70"]}
{"id":1,"method":"set_scene","params":["auto_delay_off",50,5]}
```

### `cron_add`

- 用途：启动定时任务
- `type`：当前只支持 `0`（关灯定时）
- `value`：定时长度，单位分钟
- 备注：例如，如果用户想启动一个睡眠定时器，让灯在 20 分钟后自动关闭，可以发送 `{"id":1,"method":"cron_add","params":[0,20]}`。只有在灯当前处于 `"on"` 状态时才接受。

示例：

```json
{"id":1,"method":"cron_add","params":[0,15]}
```

### `cron_get`

- 用途：读取指定类型的当前定时任务
- `type`：当前只支持 `0`
- 返回：类似 `{"type":0,"delay":15,"mix":0}` 的数组
- 备注：无

示例：

```json
{"id":1,"method":"cron_get","params":[0]}
```

### `cron_del`

- 用途：停止指定类型的定时任务
- `type`：当前只支持 `0`
- 备注：无

示例：

```json
{"id":1,"method":"cron_del","params":[0]}
```

### `set_adjust`

- 用途：不先读取当前值，直接做相对调节
- `action`：
    - `increase`
    - `decrease`
    - `circle`
- `prop`：
    - `bright`
    - `ct`
    - `color`
- 特殊规则：当 `prop=color` 时，`action` 只能是 `circle`
- 备注：无

示例：

```json
{"id":1,"method":"set_adjust","params":["increase","ct"]}
```

### `set_music`

- 用途：开启或关闭 music mode
- `action`：
    - `0` 关闭
    - `1` 开启
- 开启时，`host` 与 `port` 指向控制端自己监听的 TCP 服务
- 在 music mode 下：
    - 设备不再上报属性变化
    - 不再检查命令配额
- 停止方式：再次发命令，或直接关闭该 socket
- 备注：当控制端想启动 music mode 时，需要先启动一个 TCP 服务器，然后调用 `set_music` 让设备知道这个监听 socket 的 IP 和端口。设备收到命令后会尝试连接到指定对端；如果连接建立成功，控制端就可以通过这个通道无限制地发送所有受支持命令，以模拟音乐效果。停止 music mode 可以显式发送停止命令，也可以直接关闭该 socket。

示例：

```json
{"id":1,"method":"set_music","params":[1,"192.168.0.2",54321]}
{"id":1,"method":"set_music","params":[0]}
```

### `set_name`

- 用途：把设备名称持久化存到设备本地
- `name`：字符串；之后可在发现响应和 `get_prop` 中读取
- 规范说明：如果名称包含非 ASCII 字符，建议先做 Base64 再写入
- 备注：使用 Yeelight 官方 App 时，设备名称是保存在云端的；而此方法会把名称存入设备自身的持久化存储，所以这两个名称可能不同。

示例：

```json
{"id":1,"method":"set_name","params":["my_bulb"]}
```

### 背景光方法

以下方法是主灯命令在背景光上的对应版本：

- `bg_set_rgb`
- `bg_set_hsv`
- `bg_set_ct_abx`
- `bg_start_cf`
- `bg_stop_cf`
- `bg_set_scene`
- `bg_set_default`
- `bg_set_power`
- `bg_set_bright`
- `bg_set_adjust`
- `bg_toggle`

规范说明：这些命令的参数和行为与对应主灯命令一致，只是目标换成背景光。仅在设备具备背景光时可用。

- 备注：这些命令只在带有背景光的灯具上受支持。

### `dev_toggle`

- 用途：同时切换主灯和背景光
- 参数：无
- 备注：当设备同时具有主灯和背景光时，`toggle` 用于切换主灯，`bg_toggle` 用于切换背景光，而 `dev_toggle` 用于同时切换这两路灯光。

### `adjust_bright`

- 用途：在指定时长内按相对百分比调整亮度
- `percentage`：`-100..100`
- `duration`：与 `set_ct_abx` 的时长含义一致
- 备注：上面的示例命令会在 500 毫秒内把亮度降低 20%。

示例：

```json
{"id":1,"method":"adjust_bright","params":[-20,500]}
```

### `adjust_ct`

- 用途：在指定时长内按相对百分比调整色温
- `percentage`：`-100..100`
- `duration`：与 `set_ct_abx` 的时长含义一致
- 备注：上面的示例命令会在 500 毫秒内把色温提高 20%。

示例：

```json
{"id":1,"method":"adjust_ct","params":[20,500]}
```

### `adjust_color`

- 用途：在指定时长内调整颜色
- `percentage`：`-100..100`
- `duration`：与 `set_ct_abx` 的时长含义一致
- 备注：`percentage` 参数会被忽略，颜色变化由设备内部定义。

示例：

```json
{"id":1,"method":"adjust_color","params":[20,500]}
```

### `bg_adjust_bright`、`bg_adjust_ct`、`bg_adjust_color`

它们分别是以下方法的背景光版本：

- `adjust_bright`
- `adjust_ct`
- `adjust_color`

规范要求：直接沿用主灯版本的参数规则和语义。

- 备注：参考 `adjust_bright`、`adjust_ct`、`adjust_color`。

## RESULT 消息

成功响应：

```json
{"id":1,"result":["ok"]}
```

失败响应：

```json
{"id":2,"error":{"code":-1,"message":"unsupported method"}}
```

属性读取响应：

```json
{"id":3,"result":["on","100"]}
```

## NOTIFICATION 消息

规范中当前只定义了 `props` 通知：

```json
{"method":"props","params":{"power":"on","bright":"10"}}
```

所有属性值都是字符串。

## 属性表

| 属性 | 含义 / 取值 |
| --- | --- |
| `power` | `on` 或 `off` |
| `bright` | 亮度百分比，`1..100` |
| `ct` | 色温，`1700..6500` |
| `rgb` | RGB 颜色，`1..16777215` |
| `hue` | `0..359` |
| `sat` | `0..100` |
| `color_mode` | `1` RGB，`2` 色温，`3` HSV |
| `flowing` | `0` 无 flow，`1` flow 运行中 |
| `delayoff` | 剩余睡眠时间，`1..60` 分钟 |
| `flow_params` | 当前 flow 参数 |
| `music_on` | `1` 开启，`0` 关闭 |
| `name` | 由 `set_name` 设置的名称 |
| `bg_power` | 背景光电源状态 |
| `bg_flowing` | 背景光 flow 状态 |
| `bg_flow_params` | 背景光 flow 参数 |
| `bg_ct` | 背景光色温 |
| `bg_lmode` | `1` RGB，`2` 色温，`3` HSV |
| `bg_bright` | 背景光亮度 |
| `bg_rgb` | 背景光 RGB |
| `bg_hue` | 背景光 hue |
| `bg_sat` | 背景光 saturation |
| `nl_br` | 夜灯亮度 |
| `active_mode` | `0` daylight，`1` moonlight（仅吸顶灯） |

## 这份 PDF 没有说明的方法

部分新设备会额外公布以下方法：

- `udp_sess_new`
- `udp_sess_keep_alive`
- `udp_chroma_sess_new`

但当前这份 PDF 的方法表和详细说明没有覆盖它们，因此本文刻意不把它们列入“已文档化方法”部分。