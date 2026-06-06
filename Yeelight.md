# Yeelight LAN Control Reference

This file summarizes the Yeelight LAN control method table and detailed method notes from `Yeelight_Inter-Operation_Spec.pdf` (sections 4.1-4.3).

## Transport summary

- Discovery: UDP multicast to `239.255.255.250:1982` with `ST: wifi_bulb`
- Control channel: TCP, usually `55443`
- Command format: JSON line terminated with `\r\n`
- Result format: JSON line with either `result` or `error`
- Notification format: `{"method":"props","params":{...}}`
- Device limits from the spec:
  - up to 4 simultaneous TCP connections
  - 60 commands per minute per connection
  - 144 LAN commands per minute total

## Command message format

```json
{"id":1,"method":"set_power","params":["on","smooth",500]}\r\n
```

- `id`: integer chosen by the caller and echoed back in the result
- `method`: command name from the device's `support` header
- `params`: method-specific array

## Common parameter rules

| Name | Values |
| --- | --- |
| `effect` | `"sudden"` or `"smooth"` |
| `duration` | milliseconds, minimum `30` for gradual transitions |
| `power` | `"on"` or `"off"` |
| `mode` in `set_power` / `bg_set_power` | `0` normal, `1` CT, `2` RGB, `3` HSV, `4` color flow, `5` night light |
| `percentage` in `adjust_*` | `-100` to `100` |
| `action` in `set_adjust` | `"increase"`, `"decrease"`, `"circle"` |
| `prop` in `set_adjust` | `"bright"`, `"ct"`, `"color"` |

### Flow tuple format

`start_cf`, `bg_start_cf`, and `set_scene` with class `cf` use a flow expression made of repeated tuples:

```text
[duration, mode, value, brightness]
```

- `duration`: milliseconds, minimum `50`
- `mode`:
  - `1` color
  - `2` color temperature
  - `7` sleep
- `value`:
  - RGB value when mode is `1`
  - CT value when mode is `2`
  - ignored when mode is `7`
- `brightness`:
  - `-1` or `1..100`
  - ignored when mode is `7`

## Method table

| Method | Params | Parameters |
| --- | --- | --- |
| `get_prop` | `1..N` | property names |
| `set_ct_abx` | `3` | `ct_value`, `effect`, `duration` |
| `set_rgb` | `3` | `rgb_value`, `effect`, `duration` |
| `set_hsv` | `4` | `hue`, `sat`, `effect`, `duration` |
| `set_bright` | `3` | `brightness`, `effect`, `duration` |
| `set_power` | `3..4` | `power`, `effect`, `duration`, optional `mode` |
| `toggle` | `0` | none |
| `set_default` | `0` | none |
| `start_cf` | `3` | `count`, `action`, `flow_expression` |
| `stop_cf` | `0` | none |
| `set_scene` | `3..4` | `class`, `val1`, `val2`, optional `val3` |
| `cron_add` | `2` | `type`, `value` |
| `cron_get` | `1` | `type` |
| `cron_del` | `1` | `type` |
| `set_adjust` | `2` | `action`, `prop` |
| `set_music` | `1..3` | `action`, optional `host`, optional `port` |
| `set_name` | `1` | `name` |
| `bg_set_rgb` | `3` | same as `set_rgb`, but for background light |
| `bg_set_hsv` | `4` | same as `set_hsv`, but for background light |
| `bg_set_ct_abx` | `3` | same as `set_ct_abx`, but for background light |
| `bg_start_cf` | `3` | same as `start_cf`, but for background light |
| `bg_stop_cf` | `0` | none |
| `bg_set_scene` | `3..4` | same as `set_scene`, but for background light |
| `bg_set_default` | `0` | none |
| `bg_set_power` | `3..4` | same as `set_power`, but for background light |
| `bg_set_bright` | `3` | same as `set_bright`, but for background light |
| `bg_set_adjust` | `2` | same as `set_adjust`, but for background light |
| `bg_toggle` | `0` | toggle background light |
| `dev_toggle` | `0` | toggle main and background light together |
| `adjust_bright` | `2` | `percentage`, `duration` |
| `adjust_ct` | `2` | `percentage`, `duration` |
| `adjust_color` | `2` | `percentage`, `duration` |
| `bg_adjust_bright` | `2` | same as `adjust_bright`, but for background light |
| `bg_adjust_ct` | `2` | same as `adjust_ct`, but for background light |
| `bg_adjust_color` | `2` | same as `adjust_color`, but for background light |

## Detailed method reference

### `get_prop`

- Usage: read one or more current properties
- Parameters: list of property names
- Result: array of property values in the same order
- If a property name is unknown, the device returns `""` for that slot
- Note: All supported properties are defined in table 4-2, section 4.3.

Example:

```json
{"id":1,"method":"get_prop","params":["power","not_exist","bright"]}
{"id":1,"result":["on","","100"]}
```

### `set_ct_abx`

- Usage: change color temperature
- `ct_value`: integer, `1700..6500`
- `effect`: `sudden` or `smooth`
- `duration`: total transition time in milliseconds
- Note: accepted only when the light is on

Example:

```json
{"id":1,"method":"set_ct_abx","params":[3500,"smooth",500]}
```

### `set_rgb`

- Usage: change RGB color
- `rgb_value`: integer, `0..16777215` (`0x000000..0xFFFFFF`)
- `effect` and `duration`: same meaning as `set_ct_abx`
- Note: accepted only when the light is on

Example:

```json
{"id":1,"method":"set_rgb","params":[255,"smooth",500]}
```

### `set_hsv`

- Usage: change hue/saturation color
- `hue`: integer, `0..359`
- `sat`: integer, `0..100`
- `effect` and `duration`: same meaning as `set_ct_abx`
- Note: accepted only when the light is on

Example:

```json
{"id":1,"method":"set_hsv","params":[255,45,"smooth",500]}
```

### `set_bright`

- Usage: change brightness percentage
- `brightness`: integer, `1..100`
- `effect` and `duration`: same meaning as `set_ct_abx`
- Note: accepted only when the light is on

Example:

```json
{"id":1,"method":"set_bright","params":[50,"smooth",500]}
```

### `set_power`

- Usage: switch the light on or off
- `power`: `"on"` or `"off"`
- `effect` and `duration`: same meaning as `set_ct_abx`
- Optional `mode` when turning on:
  - `0` normal
  - `1` CT mode
  - `2` RGB mode
  - `3` HSV mode
  - `4` color flow mode
  - `5` night light mode (ceiling light only)
- Note: N/A

Example:

```json
{"id":1,"method":"set_power","params":["on","smooth",500]}
```

### `toggle`

- Usage: flip the current main-light power state
- Parameters: none
- Note: This method is defined because sometimes the user may just want to flip the state without knowing the current state.

Example:

```json
{"id":1,"method":"toggle","params":[]}
```

### `set_default`

- Usage: persist the current state as the power-on default
- Parameters: none
- Note: For example, if the user likes the current color (red) and brightness (50%) and wants to make this the default initial state every time the smart LED is powered on, this method can be used to snapshot that state. Only accepted if the smart LED is currently in `"on"` state.

Example:

```json
{"id":1,"method":"set_default","params":[]}
```

### `start_cf`

- Usage: start a color flow program
- `count`: total visible state changes, `0` means infinite loop
- `action` after the flow stops:
  - `0` recover the previous state
  - `1` stay at the final state
  - `2` turn the light off
- `flow_expression`: comma-separated series of flow tuples
- Note: Each visible state change is a flow tuple with 4 elements: `[duration, mode, value, brightness]`, and a flow expression is a series of those tuples. In the spec example, the light changes to 2700K at maximum brightness in 1000ms, then to red at 10% brightness in 500ms, then stays there for 5 seconds, then changes to 5000K at minimum brightness in 500ms; after 4 changes it stops and powers off. Tuple rules from the note: 
  - `duration` is gradual-change or sleep time in milliseconds with a minimum of `50`; 
  - `mode` `1` is color, `2` is color temperature, `7` is sleep; 
  - `value` is RGB for mode `1`, CT for mode `2`, and ignored for mode `7`; 
  - `brightness` is `-1` or `1..100`, ignored for mode `7`, and `-1` means brightness is ignored so only color or CT changes take effect. Only accepted if the smart LED is currently in `"on"` state.

Example:

```json
{"id":1,"method":"start_cf","params":[4,2,"1000,2,2700,100,500,1,255,10,5000,7,0,0,500,2,5000,1"]}
```

### `stop_cf`

- Usage: stop the currently running color flow
- Parameters: none
- Note: N/A

Example:

```json
{"id":1,"method":"stop_cf","params":[]}
```

### `set_scene`

- Usage: set the light directly to a specific state; if the light is off, it is turned on first
- `class` can be:
  - `color`
  - `hsv`
  - `ct`
  - `cf`
  - `auto_delay_off`
- `val1`, `val2`, `val3` depend on the chosen class
- Note: Accepted in both `"on"` and `"off"` state. In the examples above: the first sets color to `65280` at 70% brightness; the second sets Hue `300`, Saturation `70`, and maximum brightness; the third sets CT to `5400K` at 100% brightness; the fourth starts an infinite color flow with two flow tuples; the fifth turns the light on to 50% brightness and then turns it off after 5 minutes.

Examples:

```json
{"id":1,"method":"set_scene","params":["color",65280,70]}
{"id":1,"method":"set_scene","params":["hsv",300,70,100]}
{"id":1,"method":"set_scene","params":["ct",5400,100]}
{"id":1,"method":"set_scene","params":["cf",0,0,"500,1,255,100,1000,1,16776960,70"]}
{"id":1,"method":"set_scene","params":["auto_delay_off",50,5]}
```

### `cron_add`

- Usage: start a timer job on the device
- `type`: currently only `0` (power off timer)
- `value`: timer length in minutes
- Note: For example, if a user wants to start a sleep timer that automatically turns off the smart LED after 20 minutes, they can send `{"id":1,"method":"cron_add","params":[0,20]}`. Only accepted if the smart LED is currently in `"on"` state.

Example:

```json
{"id":1,"method":"cron_add","params":[0,15]}
```

### `cron_get`

- Usage: read the current timer job for the given type
- `type`: currently only `0`
- Result: array of cron entries such as `{"type":0,"delay":15,"mix":0}`
- Note: N/A

Example:

```json
{"id":1,"method":"cron_get","params":[0]}
```

### `cron_del`

- Usage: stop the timer job of the given type
- `type`: currently only `0`
- Note: N/A

Example:

```json
{"id":1,"method":"cron_del","params":[0]}
```

### `set_adjust`

- Usage: relative adjustment without reading the current value first
- `action`:
  - `increase`
  - `decrease`
  - `circle`
- `prop`:
  - `bright`
  - `ct`
  - `color`
- Special rule: when `prop` is `color`, `action` must be `circle`
- Note: N/A

Example:

```json
{"id":1,"method":"set_adjust","params":["increase","ct"]}
```

### `set_music`

- Usage: start or stop music mode
- `action`:
  - `0` stop music mode
  - `1` start music mode
- When starting music mode, `host` and `port` point to the caller's TCP server
- In music mode:
  - the device stops reporting properties
  - quota checking is disabled
- The caller can stop music mode with another command or by closing the socket
- Note: When a control device wants to start music mode, it must start a TCP server first and then call `set_music` so the bulb knows the IP and port of that listening socket. After receiving the command, the LED device will try to connect to the specified peer. If that TCP connection succeeds, the control device can send all supported commands through this channel without limit to simulate music effects. Music mode can be stopped either by sending the stop command explicitly or just by closing the socket.

Examples:

```json
{"id":1,"method":"set_music","params":[1,"192.168.0.2",54321]}
{"id":1,"method":"set_music","params":[0]}
```

### `set_name`

- Usage: save a device name in device-local persistent storage
- `name`: string, also available later through discovery and `get_prop`
- The spec notes that non-ASCII names should be Base64-encoded before storing
- Note: When using the official Yeelight app, the device name is stored in the cloud. This method stores the name in the device's persistent memory instead, so the two names can be different.

Example:

```json
{"id":1,"method":"set_name","params":["my_bulb"]}
```

### Background-light methods

These are the background-light equivalents of the main-light commands:

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

The spec says they follow the same semantics as the corresponding main-light commands, but target the background light instead. They are only valid on devices that actually have a background light.

- Note: These commands are only supported on lights that are equipped with a background light.

### `dev_toggle`

- Usage: toggle main light and background light together
- Parameters: none
- Note: When there is a main light and background light, `toggle` is used to toggle the main light, `bg_toggle` is used to toggle the background light, while `dev_toggle` is used to toggle both lights at the same time.

### `adjust_bright`

- Usage: adjust brightness by a relative percentage over a duration
- `percentage`: `-100..100`
- `duration`: same timing meaning as `set_ct_abx`
- Note: The example command decreases brightness by 20% within 500 milliseconds.

Example:

```json
{"id":1,"method":"adjust_bright","params":[-20,500]}
```

### `adjust_ct`

- Usage: adjust color temperature by a relative percentage over a duration
- `percentage`: `-100..100`
- `duration`: same timing meaning as `set_ct_abx`
- Note: The example command increases CT by 20% within 500 milliseconds.

Example:

```json
{"id":1,"method":"adjust_ct","params":[20,500]}
```

### `adjust_color`

- Usage: adjust color over a duration
- `percentage`: `-100..100`
- `duration`: same timing meaning as `set_ct_abx`
- Note: The percentage parameter is ignored and the color is internally defined by the device.

Example:

```json
{"id":1,"method":"adjust_color","params":[20,500]}
```

### `bg_adjust_bright`, `bg_adjust_ct`, `bg_adjust_color`

These methods are the background-light equivalents of:

- `adjust_bright`
- `adjust_ct`
- `adjust_color`

The spec says to use the same rules as the main-light versions.

- Note: Refer to `adjust_bright`, `adjust_ct`, and `adjust_color`.

## Result messages

Successful command:

```json
{"id":1,"result":["ok"]}
```

Failed command:

```json
{"id":2,"error":{"code":-1,"message":"unsupported method"}}
```

Property request result:

```json
{"id":3,"result":["on","100"]}
```

## Notification message

The only documented notification method is `props`:

```json
{"method":"props","params":{"power":"on","bright":"10"}}
```

All property values are strings.

## Property table

| Property | Meaning / values |
| --- | --- |
| `power` | `on` or `off` |
| `bright` | brightness percentage, `1..100` |
| `ct` | color temperature, `1700..6500` |
| `rgb` | RGB color, `1..16777215` |
| `hue` | `0..359` |
| `sat` | `0..100` |
| `color_mode` | `1` RGB, `2` CT, `3` HSV |
| `flowing` | `0` no flow, `1` flow running |
| `delayoff` | remaining sleep timer, `1..60` minutes |
| `flow_params` | current flow parameters |
| `music_on` | `1` on, `0` off |
| `name` | name saved by `set_name` |
| `bg_power` | background light power state |
| `bg_flowing` | background light flow state |
| `bg_flow_params` | background light flow parameters |
| `bg_ct` | background light color temperature |
| `bg_lmode` | `1` RGB, `2` CT, `3` HSV |
| `bg_bright` | background light brightness |
| `bg_rgb` | background light RGB |
| `bg_hue` | background light hue |
| `bg_sat` | background light saturation |
| `nl_br` | night mode brightness |
| `active_mode` | `0` daylight, `1` moonlight (ceiling light only) |

## Methods not documented in this PDF

Some modern devices advertise extra methods such as:

- `udp_sess_new`
- `udp_sess_keep_alive`
- `udp_chroma_sess_new`

They are not described in the extracted method table or detailed method sections of this PDF, so they are intentionally omitted from the documented reference above.
