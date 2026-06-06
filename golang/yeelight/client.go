package yeelight

import (
	"encoding/json"
	"fmt"
	"net"
	"sort"
	"sync/atomic"
	"time"
)

var nextRequestID uint64

type Client struct {
	Host      string
	Port      int
	Support   []string
	TimeoutMS int
}

func NewClient(options ControlConnectionOptions) *Client {
	port := options.Port
	if port == 0 {
		port = DefaultControlPort
	}
	timeoutMS := options.TimeoutMS
	if timeoutMS == 0 {
		timeoutMS = DefaultCommandTimeout
	}
	return &Client{
		Host:      options.Host,
		Port:      port,
		Support:   append([]string(nil), options.Support...),
		TimeoutMS: timeoutMS,
	}
}

func NewClientFromDevice(device DiscoveredDevice, timeoutMS int) *Client {
	return NewClient(ControlConnectionOptions{
		Host:      device.Host,
		Port:      device.Port,
		Support:   device.Support,
		TimeoutMS: timeoutMS,
	})
}

func (client *Client) SendCommand(method string, params []any, options CommandOptions) (any, error) {
	if err := client.ensureSupported(method); err != nil {
		return nil, err
	}
	response, err := client.SendRawCommand(method, params, options)
	if err != nil {
		return nil, err
	}
	if response.Error != nil {
		return nil, fmt.Errorf("Yeelight command failed (%d): %s", response.Error.Code, response.Error.Message)
	}
	return response.Result, nil
}

func (client *Client) SendRawCommand(method string, params []any, options CommandOptions) (RawCommandResponse, error) {
	timeoutMS := options.TimeoutMS
	if timeoutMS == 0 {
		timeoutMS = client.TimeoutMS
	}
	requestID := atomic.AddUint64(&nextRequestID, 1)
	address := fmt.Sprintf("%s:%d", client.Host, client.Port)
	conn, err := net.DialTimeout("tcp", address, time.Duration(timeoutMS)*time.Millisecond)
	if err != nil {
		return RawCommandResponse{}, fmt.Errorf("Unable to reach %s: %w", address, err)
	}
	defer conn.Close()

	_ = conn.SetWriteDeadline(time.Now().Add(time.Duration(timeoutMS) * time.Millisecond))
	if _, err := conn.Write([]byte(BuildCommand(method, params, requestID))); err != nil {
		return RawCommandResponse{}, fmt.Errorf("Unable to reach %s: %w", address, err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(time.Duration(timeoutMS) * time.Millisecond))
	pending := ""
	buffer := make([]byte, 4096)
	for {
		size, err := conn.Read(buffer)
		if err != nil {
			netErr, ok := err.(net.Error)
			if ok && netErr.Timeout() {
				return RawCommandResponse{}, fmt.Errorf("Timed out waiting for a response from %s after %dms.", address, timeoutMS)
			}
			if err.Error() == "EOF" {
				return RawCommandResponse{}, fmt.Errorf("The bulb closed the TCP connection before sending a response.")
			}
			return RawCommandResponse{}, fmt.Errorf("Unable to reach %s: %w", address, err)
		}

		lines, nextPending := SplitSocketBuffer(pending, string(buffer[:size]))
		pending = nextPending
		for _, line := range lines {
			var payload struct {
				ID     uint64          `json:"id"`
				Method string          `json:"method"`
				Result json.RawMessage `json:"result"`
				Error  *ErrorPayload   `json:"error"`
			}
			if err := json.Unmarshal([]byte(line), &payload); err != nil {
				return RawCommandResponse{}, fmt.Errorf("The bulb returned invalid JSON: %s", line)
			}
			if payload.Method == "props" || payload.ID != requestID {
				continue
			}

			response := RawCommandResponse{ID: requestID, Error: payload.Error}
			if payload.Error == nil {
				var result any
				if len(payload.Result) > 0 {
					if err := json.Unmarshal(payload.Result, &result); err != nil {
						return RawCommandResponse{}, fmt.Errorf("The bulb returned invalid JSON: %s", line)
					}
				}
				response.Result = result
			}
			return response, nil
		}
	}
}

func (client *Client) GetProperties(properties []string, options CommandOptions) ([]string, error) {
	if len(properties) == 0 {
		return nil, fmt.Errorf("At least one property is required.")
	}
	params := make([]any, 0, len(properties))
	for _, property := range properties {
		params = append(params, property)
	}
	result, err := client.SendCommand("get_prop", params, options)
	if err != nil {
		return nil, err
	}
	items, ok := result.([]any)
	if !ok {
		return nil, fmt.Errorf("The bulb returned an unexpected get_prop payload.")
	}
	values := make([]string, 0, len(items))
	for _, item := range items {
		values = append(values, valueAsString(item))
	}
	return values, nil
}

func (client *Client) GetStatus(options CommandOptions) (PropertyValues, error) {
	result, err := client.GetProperties(LiveStatusProperties, options)
	if err != nil {
		return nil, err
	}
	return NormalizeStatus(LiveStatusProperties, result), nil
}

func (client *Client) SetPower(power string, options TransitionOptions) (any, error) {
	return client.sendPowerCommand("set_power", power, options, nil)
}

func (client *Client) SetPowerWithMode(power string, options TransitionOptions, mode int) (any, error) {
	return client.sendPowerCommand("set_power", power, options, &mode)
}

func (client *Client) Toggle(options CommandOptions) (any, error) {
	return client.SendCommand("toggle", []any{}, options)
}

func (client *Client) SetDefault(options CommandOptions) (any, error) {
	return client.SendCommand("set_default", []any{}, options)
}

func (client *Client) SetBrightness(brightness int, options TransitionOptions) (any, error) {
	if err := ValidateBrightness(brightness); err != nil {
		return nil, err
	}
	return client.sendNumericTransitionCommand("set_bright", brightness, options)
}

func (client *Client) SetColorTemperature(colorTemperature int, options TransitionOptions) (any, error) {
	if err := ValidateColorTemperature(colorTemperature); err != nil {
		return nil, err
	}
	return client.sendNumericTransitionCommand("set_ct_abx", colorTemperature, options)
}

func (client *Client) SetRGB(rgbValue int, options TransitionOptions) (any, error) {
	if err := ValidateRGBValue(rgbValue); err != nil {
		return nil, err
	}
	return client.sendNumericTransitionCommand("set_rgb", rgbValue, options)
}

func (client *Client) SetHSV(hue, saturation int, options TransitionOptions) (any, error) {
	if err := ValidateHue(hue); err != nil {
		return nil, err
	}
	if err := ValidateSaturation(saturation); err != nil {
		return nil, err
	}
	effect, duration, timeoutMS, err := transitionParts(options)
	if err != nil {
		return nil, err
	}
	return client.SendCommand("set_hsv", []any{hue, saturation, effect, duration}, CommandOptions{TimeoutMS: timeoutMS})
}

func (client *Client) StartColorFlow(count, action int, expression FlowExpression, options CommandOptions) (any, error) {
	if err := ValidateFlowCount(count); err != nil {
		return nil, err
	}
	if err := ValidateFlowAction(action); err != nil {
		return nil, err
	}
	serialized := expression.Serialized
	if serialized == "" {
		value, err := BuildFlowExpression(expression.Tuples)
		if err != nil {
			return nil, err
		}
		serialized = value
	}
	return client.SendCommand("start_cf", []any{count, action, serialized}, options)
}

func (client *Client) StopColorFlow(options CommandOptions) (any, error) {
	return client.SendCommand("stop_cf", []any{}, options)
}

func (client *Client) SetScene(scene Scene, options CommandOptions) (any, error) {
	params, err := SerializeScene(scene)
	if err != nil {
		return nil, err
	}
	return client.SendCommand("set_scene", params, options)
}

func (client *Client) CronAdd(cronType, minutes int, options CommandOptions) (any, error) {
	if err := ValidateCronType(cronType); err != nil {
		return nil, err
	}
	return client.SendCommand("cron_add", []any{cronType, minutes}, options)
}

func (client *Client) CronGet(cronType int, options CommandOptions) ([]CronEntry, error) {
	if err := ValidateCronType(cronType); err != nil {
		return nil, err
	}
	result, err := client.SendCommand("cron_get", []any{cronType}, options)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var entries []CronEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func (client *Client) CronDelete(cronType int, options CommandOptions) (any, error) {
	if err := ValidateCronType(cronType); err != nil {
		return nil, err
	}
	return client.SendCommand("cron_del", []any{cronType}, options)
}

func (client *Client) SetAdjust(action, property string, options CommandOptions) (any, error) {
	return client.sendAdjustCommand("set_adjust", action, property, options)
}

func (client *Client) SetMusicOff(options CommandOptions) (any, error) {
	return client.SendCommand("set_music", []any{0}, options)
}

func (client *Client) SetMusicOn(host string, port int, options CommandOptions) (any, error) {
	if err := ValidateMusicStart(host, port); err != nil {
		return nil, err
	}
	return client.SendCommand("set_music", []any{1, host, port}, options)
}

func (client *Client) SetName(name string, options CommandOptions) (any, error) {
	if err := ValidateName(name); err != nil {
		return nil, err
	}
	return client.SendCommand("set_name", []any{name}, options)
}

func (client *Client) BGSetRGB(rgbValue int, options TransitionOptions) (any, error) {
	if err := ValidateRGBValue(rgbValue); err != nil {
		return nil, err
	}
	return client.sendNumericTransitionCommand("bg_set_rgb", rgbValue, options)
}

func (client *Client) BGSetHSV(hue, saturation int, options TransitionOptions) (any, error) {
	if err := ValidateHue(hue); err != nil {
		return nil, err
	}
	if err := ValidateSaturation(saturation); err != nil {
		return nil, err
	}
	effect, duration, timeoutMS, err := transitionParts(options)
	if err != nil {
		return nil, err
	}
	return client.SendCommand("bg_set_hsv", []any{hue, saturation, effect, duration}, CommandOptions{TimeoutMS: timeoutMS})
}

func (client *Client) BGSetColorTemperature(colorTemperature int, options TransitionOptions) (any, error) {
	if err := ValidateColorTemperature(colorTemperature); err != nil {
		return nil, err
	}
	return client.sendNumericTransitionCommand("bg_set_ct_abx", colorTemperature, options)
}

func (client *Client) BGStartColorFlow(count, action int, expression FlowExpression, options CommandOptions) (any, error) {
	if err := ValidateFlowCount(count); err != nil {
		return nil, err
	}
	if err := ValidateFlowAction(action); err != nil {
		return nil, err
	}
	serialized := expression.Serialized
	if serialized == "" {
		value, err := BuildFlowExpression(expression.Tuples)
		if err != nil {
			return nil, err
		}
		serialized = value
	}
	return client.SendCommand("bg_start_cf", []any{count, action, serialized}, options)
}

func (client *Client) BGStopColorFlow(options CommandOptions) (any, error) {
	return client.SendCommand("bg_stop_cf", []any{}, options)
}

func (client *Client) BGSetScene(scene Scene, options CommandOptions) (any, error) {
	params, err := SerializeScene(scene)
	if err != nil {
		return nil, err
	}
	return client.SendCommand("bg_set_scene", params, options)
}

func (client *Client) BGSetDefault(options CommandOptions) (any, error) {
	return client.SendCommand("bg_set_default", []any{}, options)
}

func (client *Client) BGSetPower(power string, options TransitionOptions) (any, error) {
	return client.sendPowerCommand("bg_set_power", power, options, nil)
}

func (client *Client) BGSetPowerWithMode(power string, options TransitionOptions, mode int) (any, error) {
	return client.sendPowerCommand("bg_set_power", power, options, &mode)
}

func (client *Client) BGSetBrightness(brightness int, options TransitionOptions) (any, error) {
	if err := ValidateBrightness(brightness); err != nil {
		return nil, err
	}
	return client.sendNumericTransitionCommand("bg_set_bright", brightness, options)
}

func (client *Client) BGSetAdjust(action, property string, options CommandOptions) (any, error) {
	return client.sendAdjustCommand("bg_set_adjust", action, property, options)
}

func (client *Client) BGToggle(options CommandOptions) (any, error) {
	return client.SendCommand("bg_toggle", []any{}, options)
}

func (client *Client) DevToggle(options CommandOptions) (any, error) {
	return client.SendCommand("dev_toggle", []any{}, options)
}

func (client *Client) AdjustBrightness(percentage, duration int, options CommandOptions) (any, error) {
	return client.sendAdjustPercentageCommand("adjust_bright", percentage, duration, options)
}

func (client *Client) AdjustColorTemperature(percentage, duration int, options CommandOptions) (any, error) {
	return client.sendAdjustPercentageCommand("adjust_ct", percentage, duration, options)
}

func (client *Client) AdjustColor(percentage, duration int, options CommandOptions) (any, error) {
	return client.sendAdjustPercentageCommand("adjust_color", percentage, duration, options)
}

func (client *Client) BGAdjustBrightness(percentage, duration int, options CommandOptions) (any, error) {
	return client.sendAdjustPercentageCommand("bg_adjust_bright", percentage, duration, options)
}

func (client *Client) BGAdjustColorTemperature(percentage, duration int, options CommandOptions) (any, error) {
	return client.sendAdjustPercentageCommand("bg_adjust_ct", percentage, duration, options)
}

func (client *Client) BGAdjustColor(percentage, duration int, options CommandOptions) (any, error) {
	return client.sendAdjustPercentageCommand("bg_adjust_color", percentage, duration, options)
}

func (client *Client) UDPSessionNew(params []any, options CommandOptions) (any, error) {
	return client.SendCommand("udp_sess_new", params, options)
}

func (client *Client) UDPSessionKeepAlive(params []any, options CommandOptions) (any, error) {
	return client.SendCommand("udp_sess_keep_alive", params, options)
}

func (client *Client) UDPChromaSessionNew(params []any, options CommandOptions) (any, error) {
	return client.SendCommand("udp_chroma_sess_new", params, options)
}

func (client *Client) ensureSupported(method string) error {
	if len(client.Support) == 0 {
		return nil
	}
	for _, supported := range client.Support {
		if supported == method {
			return nil
		}
	}
	supported := append([]string(nil), client.Support...)
	sort.Strings(supported)
	return fmt.Errorf("The bulb does not advertise support for %s. Supported methods: %s", method, stringsJoin(supported, ", "))
}

func (client *Client) sendNumericTransitionCommand(method string, value int, options TransitionOptions) (any, error) {
	effect, duration, timeoutMS, err := transitionParts(options)
	if err != nil {
		return nil, err
	}
	return client.SendCommand(method, []any{value, effect, duration}, CommandOptions{TimeoutMS: timeoutMS})
}

func (client *Client) sendPowerCommand(method, power string, options TransitionOptions, mode *int) (any, error) {
	if power != "on" && power != "off" {
		return nil, fmt.Errorf("Power must be \"on\" or \"off\".")
	}
	effect, duration, timeoutMS, err := transitionParts(options)
	if err != nil {
		return nil, err
	}
	params := []any{power, effect, duration}
	if mode != nil {
		if err := ValidatePowerMode(*mode); err != nil {
			return nil, err
		}
		params = append(params, *mode)
	}
	return client.SendCommand(method, params, CommandOptions{TimeoutMS: timeoutMS})
}

func (client *Client) sendAdjustCommand(method, action, property string, options CommandOptions) (any, error) {
	if err := ValidateAdjustAction(action); err != nil {
		return nil, err
	}
	if err := ValidateAdjustProperty(property); err != nil {
		return nil, err
	}
	if property == "color" && action != "circle" {
		return nil, fmt.Errorf("When adjusting \"color\", action must be \"circle\" according to the Yeelight spec.")
	}
	return client.SendCommand(method, []any{action, property}, options)
}

func (client *Client) sendAdjustPercentageCommand(method string, percentage, duration int, options CommandOptions) (any, error) {
	if err := ValidatePercentage(percentage); err != nil {
		return nil, err
	}
	if err := ValidateDuration(duration, DefaultDuration); err != nil {
		return nil, err
	}
	return client.SendCommand(method, []any{percentage, duration}, options)
}

func transitionParts(options TransitionOptions) (string, int, int, error) {
	effect := options.Effect
	if effect == "" {
		effect = DefaultEffect
	}
	duration := options.Duration
	if duration == 0 {
		duration = DefaultDuration
	}
	if err := ValidateEffect(effect); err != nil {
		return "", 0, 0, err
	}
	if err := ValidateDuration(duration, DefaultDuration); err != nil {
		return "", 0, 0, err
	}
	return effect, duration, options.TimeoutMS, nil
}

func stringsJoin(items []string, separator string) string {
	if len(items) == 0 {
		return ""
	}
	result := items[0]
	for _, item := range items[1:] {
		result += separator + item
	}
	return result
}
